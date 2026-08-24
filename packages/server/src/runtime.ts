import {
  DEPLOYED_ENVIRONMENT_CAPABILITIES,
  LOCAL_ENVIRONMENT_CAPABILITIES,
  capabilityReport,
  exposeCapableAdapter,
  resolveCapabilities,
} from '@mock-knight/core'
import type {
  CapabilityBit,
  CapabilityProvenance,
  CapabilityReportRow,
  CapabilitySet,
  MockBackendAdapter,
  ResolvedAuth,
} from '@mock-knight/core'
import { createAdapter } from './adapters.js'
import type { Database as Db } from 'better-sqlite3'
import { recordConnection } from './profiles.js'
import type { Profile } from './profiles.js'
import { setKey } from '@mock-knight/core'

/**
 * Live connections, one per profile.
 *
 * The registry is where the two capability sources meet: what the backend proved it can do, and
 * what this runtime mode permits. Nothing downstream sees them separately — routes and the SPA
 * only ever ask the resolved set (TECH-DESIGN §3.3).
 */

export type RuntimeMode = 'local' | 'deployed'

export interface Connection {
  readonly profileId: string
  readonly adapter: MockBackendAdapter
  readonly capabilities: CapabilitySet
  readonly provenance: Readonly<Record<string, CapabilityProvenance>>
  readonly version: string | null
  readonly fingerprint: string
  readonly adminUrl: string
  readonly instanceStartedAt: string | null
  readonly connectedAt: string
}

/**
 * How far two computed start times may drift and still mean the same process.
 *
 * WireMock reports uptime as whole seconds, so two connects a moment apart derive start times
 * up to a second or so apart for one instance. The tolerance has to exceed that jitter without
 * being wide enough to hide a genuine quick restart.
 */
export const RESTART_TOLERANCE_MS = 5_000

/**
 * Did the server restart between these two observations?
 *
 * `null` means *unknowable*, not `false` — a backend that cannot report uptime gives us no
 * grounds for either answer, and the UI must not show a reassuring "still the same server"
 * that it cannot back up.
 */
export function hasRestarted(previous: string | null, current: string | null): boolean | null {
  if (previous === null || current === null) return null
  const drift = Math.abs(new Date(current).getTime() - new Date(previous).getTime())
  return drift > RESTART_TOLERANCE_MS
}

export function environmentCapabilities(mode: RuntimeMode): readonly CapabilityBit[] {
  return mode === 'local' ? LOCAL_ENVIRONMENT_CAPABILITIES : DEPLOYED_ENVIRONMENT_CAPABILITIES
}

/**
 * Resolve a profile's auth to real values, from environment variables named by the profile.
 *
 * Reading `process.env` here and nowhere else keeps the blast radius of a secret to this
 * function's return value.
 */
export function resolveAuth(profile: Profile, env: NodeJS.ProcessEnv = process.env): ResolvedAuth {
  if (profile.authKind === 'none' || profile.authRef === null) return { kind: 'none' }
  switch (profile.authKind) {
    case 'bearer':
      return { kind: 'bearer', token: env[profile.authRef] ?? '' }
    case 'basic': {
      const [userVar, passVar] = profile.authRef.split(':')
      return {
        kind: 'basic',
        username: env[userVar ?? ''] ?? '',
        password: env[passVar ?? ''] ?? '',
      }
    }
    case 'headers': {
      const headers: Record<string, string> = {}
      for (const pair of profile.authRef.split(',')) {
        const [header, variable] = pair.split('=')
        if (header !== undefined && variable !== undefined)
          setKey(headers, header, env[variable] ?? '')
      }
      return { kind: 'headers', headers }
    }
    default:
      return { kind: 'none' }
  }
}

export class ConnectionRegistry {
  private readonly connections = new Map<string, Connection>()

  constructor(
    private readonly db: Db,
    private readonly mode: RuntimeMode,
    private readonly allowedHosts?: readonly string[],
  ) {}

  get(profileId: string): Connection | null {
    return this.connections.get(profileId) ?? null
  }

  async connect(profile: Profile): Promise<Connection> {
    await this.disconnect(profile.id)

    // Chosen by the profile rather than assumed: this build has more than one backend.
    const implementation = createAdapter(profile.adapter)
    const info = await implementation.connect({
      baseUrl: profile.baseUrl,
      adminPath: profile.adminPath ?? undefined,
      auth: resolveAuth(profile),
      allowedHosts: this.allowedHosts,
    })

    const capabilities = resolveCapabilities({
      backend: implementation.capabilities(),
      environment: environmentCapabilities(this.mode),
    })

    const connection: Connection = {
      profileId: profile.id,
      adapter: exposeCapableAdapter(implementation, capabilities),
      capabilities,
      provenance: info.capabilityProvenance,
      version: info.version,
      fingerprint: info.fingerprint,
      adminUrl: info.adminUrl,
      instanceStartedAt: info.instanceStartedAt,
      connectedAt: new Date().toISOString(),
    }
    this.connections.set(profile.id, connection)
    recordConnection(this.db, profile.id, [...capabilities], info.fingerprint)
    return connection
  }

  async disconnect(profileId: string): Promise<void> {
    const existing = this.connections.get(profileId)
    if (existing === undefined) return
    this.connections.delete(profileId)
    await existing.adapter.close?.()
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.connections.keys()].map((id) => this.disconnect(id)))
  }

  /**
   * The capability report behind design brief §6.9 — every bit, on or off, each with the gate
   * that decided it, how strong the evidence was, and what it costs the user when off.
   */
  report(profileId: string): (CapabilityReportRow & { provenance: CapabilityProvenance })[] {
    const connection = this.connections.get(profileId)
    const rows = capabilityReport({
      backend: connection === null || connection === undefined ? [] : [...connection.capabilities],
      environment: environmentCapabilities(this.mode),
    })
    return rows.map((row) => ({
      ...row,
      provenance: connection?.provenance[row.bit] ?? 'declared',
    }))
  }
}
