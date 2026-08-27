import {
  AdapterTransportError,
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
/**
 * A profile whose credential is incomplete for the scheme it selected.
 *
 * Checked before connecting rather than after: basic auth with no password is a request that
 * will be refused, and "you did not finish filling this in" is a better sentence than whatever
 * the server says about the resulting 401.
 */
export function incompleteAuth(
  profile: Pick<Profile, 'authKind' | 'authUsername' | 'authSecret'>,
): string | null {
  if (profile.authKind === 'none') return null
  if (profile.authKind === 'basic') {
    if ((profile.authUsername ?? '') === '') return 'a username'
    if ((profile.authSecret ?? '') === '') return 'a password'
    return null
  }
  return (profile.authSecret ?? '') === '' ? 'a token' : null
}

/**
 * Auth as the adapter needs it: resolved values, server-side only.
 *
 * These come from the state database now rather than from environment variables. The value
 * exists in this process for the life of a request and reaches nothing else — not the audit
 * table, not a log line, not a URL, and not anything sent to the browser, which is enforced by
 * the profile API stripping it on the way out (PRD §12, TECH-DESIGN §13).
 */
export function resolveAuth(profile: Profile): ResolvedAuth {
  if (profile.authKind === 'none') return { kind: 'none' }
  switch (profile.authKind) {
    case 'bearer':
      return { kind: 'bearer', token: profile.authSecret ?? '' }
    case 'basic':
      return {
        kind: 'basic',
        username: profile.authUsername ?? '',
        password: profile.authSecret ?? '',
      }
    case 'headers':
      // One header, named by the username field. Kept because the contract has it; nothing in
      // the UI offers it, since no backend here needs it.
      return {
        kind: 'headers',
        headers: { [profile.authUsername ?? '']: profile.authSecret ?? '' },
      }
    default:
      return { kind: 'none' }
  }
}

/**
 * How long to wait after each consecutive failed connection attempt, in order.
 *
 * A profile that cannot be reached is usually a VPN that is down or a server still starting, and
 * both resolve on their own — so retrying is right, and retrying *hard* is not. The last value
 * is the steady state: one attempt every thirty seconds for as long as the screen is open, which
 * is far below the "do not poll the mock server aggressively" line.
 */
const RECONNECT_BACKOFF_MS = [0, 2_000, 5_000, 15_000, 30_000] as const

export interface ConnectionFailure {
  /** The transport code where there was one — ENOTFOUND, ECONNREFUSED — and null otherwise. */
  readonly code: string | null
  readonly message: string
  /** Epoch ms of the next attempt, so the UI can say when rather than implying "any moment". */
  readonly nextAttemptAt: number
}

export class ProfileConfigurationError extends Error {
  override readonly name = 'ProfileConfigurationError'
}

export class ConnectionRegistry {
  private readonly connections = new Map<string, Connection>()
  /** Per-profile retry state, held only while a profile is failing. */
  private readonly failures = new Map<string, ConnectionFailure & { attempts: number }>()

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

    /*
     * Fail on a missing credential *variable* before opening a connection.
     *
     * Otherwise the header is built from empty strings, the server refuses it, and the user is
     * told the server requires credentials — which they knew, having configured some. The useful
     * sentence names the variable that is not set, and this process is the only thing that can
     * know that.
     */
    const missing = incompleteAuth(profile)
    if (missing !== null) {
      throw new ProfileConfigurationError(
        `${profile.name} is set to use ${profile.authKind} authentication but has no ${missing}. ` +
          `Add it on the Servers screen, or set authentication to none.`,
      )
    }

    // Chosen by the profile rather than assumed: this build has more than one backend.
    const implementation = createAdapter(profile.adapter)
    const info = await implementation.connect({
      baseUrl: profile.baseUrl,
      adminPath: profile.adminPath ?? undefined,
      auth: resolveAuth(profile),
      allowedHosts: this.allowedHosts,
      // Where a document-backed backend keeps its corpus. `mappingsDir` is the profile's
      // on-disk field, already resolved to an absolute path by the config loader.
      documentPath: profile.mappingsDir,
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
    this.failures.delete(profile.id)
    recordConnection(this.db, profile.id, [...capabilities], info.fingerprint)
    return connection
  }

  /**
   * The connection for a profile, opening one if we do not already hold it.
   *
   * Nothing used to do this. A connection was made at startup for the profile named on the
   * command line and by an explicit refresh, and nowhere else — so switching to any other
   * server, or losing the network for a moment, left the top bar reading "reconnecting…"
   * indefinitely while nothing was in fact reconnecting. Clicking Refresh was the only way out,
   * which made a status badge into a control.
   *
   * Returns `null` rather than throwing: a server being down is an ordinary state to render, not
   * a request that failed. Read `lastFailure` for why, and honours a backoff so a server that is
   * down is not hammered by a polling UI.
   */
  async ensure(profile: Profile, now: number = Date.now()): Promise<Connection | null> {
    const existing = this.connections.get(profile.id)
    if (existing !== undefined) return existing

    const waiting = this.failures.get(profile.id)
    if (waiting !== undefined && now < waiting.nextAttemptAt) return null

    try {
      return await this.connect(profile)
    } catch (error) {
      const attempts = (waiting?.attempts ?? 0) + 1
      const delay = RECONNECT_BACKOFF_MS[Math.min(attempts, RECONNECT_BACKOFF_MS.length - 1)]!
      this.failures.set(profile.id, {
        attempts,
        code: error instanceof AdapterTransportError ? error.code : null,
        // Verbatim, because "cannot connect" tells a developer nothing they did not know: the
        // useful part is ENOTFOUND vs ECONNREFUSED vs a certificate.
        message: error instanceof Error ? error.message : String(error),
        nextAttemptAt: now + delay,
      })
      return null
    }
  }

  /**
   * Drop a connection that has stopped working, and record why.
   *
   * Detection is by *use*, not by probing. Once connected, a handle kept reporting healthy
   * however long the server had been gone — the badge stayed clean and every action failed on
   * its own instead, which is the app lying about the one thing the badge exists to say. A
   * transport failure against a live connection is proof enough, and it costs no extra traffic
   * to a server a whole team shares.
   *
   * The next `ensure` retries immediately rather than waiting out a backoff: nothing has failed
   * *to connect* yet, so there is nothing to back off from, and a blip should recover on the
   * next poll.
   */
  markUnreachable(profileId: string, error: unknown, now: number = Date.now()): void {
    if (!this.connections.has(profileId)) return
    void this.disconnect(profileId)
    this.failures.set(profileId, {
      attempts: 0,
      code: error instanceof AdapterTransportError ? error.code : null,
      message: error instanceof Error ? error.message : String(error),
      nextAttemptAt: now,
    })
  }

  /** Why the last attempt for this profile failed, or `null` if it is connected or untried. */
  lastFailure(profileId: string): ConnectionFailure | null {
    const failure = this.failures.get(profileId)
    if (failure === undefined) return null
    return { code: failure.code, message: failure.message, nextAttemptAt: failure.nextAttemptAt }
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
