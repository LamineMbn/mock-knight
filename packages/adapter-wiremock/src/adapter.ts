import { createHash } from 'node:crypto'
import type {
  JournalQuery,
  LoggedRequest,
  NearMiss,
  RequestMatcher,
  ServeEvent,
  CapabilityBit,
  CapabilityProvenance,
  ConnectionConfig,
  ConnectionInfo,
  Json,
  JsonObject,
  Mock,
  MockBackendAdapter,
  Page,
} from '@mock-knight/core'
import { WireMockClient } from './client.js'
import { toCanonical } from './mapping.js'
import { toNearMiss, toServeEvent } from './journal.js'

/**
 * The WireMock (Java) adapter — endpoint map in PRD Appendix A.
 *
 * Capability decisions come from three different strengths of evidence, and the adapter reports
 * which was used for each bit rather than flattening them:
 *
 *  - **declared** — a property of WireMock Java itself. `mock.enableDisable` is off because
 *    `StubMapping` has no enabled flag and the schema rejects unknown properties; no deployment
 *    changes that.
 *  - **probed** — we called the route and saw whether it exists. The only honest way to decide
 *    a route that lives outside the published OpenAPI spec, since several were back-ported
 *    unevenly and the version string does not predict them.
 *  - **version** — inferred from the version string, used only where a safe probe does not
 *    exist. Weaker, and labelled so in the capability report.
 */

const BACKEND_ID = 'wiremock'

/** True for WireMock Java regardless of version or deployment. */
const DECLARED_ON: readonly CapabilityBit[] = [
  'corpus.list',
  'corpus.replaceAll',
  'corpus.reset',
  'mock.read',
  'mock.create',
  'mock.update',
  'mock.delete',
  'mock.stableServerId',
  'mock.priority',
  'mock.metadata',
  'journal.read',
  'journal.attribution',
  'journal.clear',
  'diagnostics.nearMiss',
  'diagnostics.unmatched',
  'state.machine',
  'state.read',
  'state.resetAll',
  'files.export',
  'files.import',
  'files.serverSave',
]

/**
 * Declared *off*, with a reason. Listed explicitly rather than by omission so that the reason
 * is written down somewhere a reader will find it.
 *
 *  - `mock.enableDisable` — no such field on StubMapping; the schema rejects extras.
 *  - `journal.stream` — no push channel. The BFF polls and republishes over SSE, so the SPA
 *    still sees a stream; only the adapter knows it is a poll.
 *  - `state.kv` — WireMock models state as a named machine, not a key-value store.
 */
const DECLARED_OFF: readonly CapabilityBit[] = ['mock.enableDisable', 'journal.stream', 'state.kv']

interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

export function parseVersion(raw: string | null): ParsedVersion | null {
  if (raw === null) return null
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw)
  if (match === null) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0) }
}

export function atLeast(version: ParsedVersion | null, target: ParsedVersion): boolean {
  if (version === null) return false
  if (version.major !== target.major) return version.major > target.major
  if (version.minor !== target.minor) return version.minor > target.minor
  return version.patch >= target.patch
}

export class WireMockAdapter implements MockBackendAdapter {
  readonly id = BACKEND_ID
  readonly displayName = 'WireMock (Java)'

  private client: WireMockClient | null = null
  private correlationHeader: string | null = null
  private granted = new Set<CapabilityBit>()
  private provenance: Record<string, CapabilityProvenance> = {}

  private get transport(): WireMockClient {
    if (this.client === null) throw new Error('WireMock adapter used before connect()')
    return this.client
  }

  async connect(config: ConnectionConfig): Promise<ConnectionInfo> {
    const client = new WireMockClient(config)
    this.client = client
    this.correlationHeader = config.correlationHeader ?? null

    const versionText = await this.readVersion(client)
    const version = parseVersion(versionText)
    const instanceStartedAt = await this.readInstanceStart(client)

    const granted = new Set<CapabilityBit>()
    const provenance: Record<string, CapabilityProvenance> = {}
    for (const bit of DECLARED_ON) {
      granted.add(bit)
      provenance[bit] = 'declared'
    }
    for (const bit of DECLARED_OFF) provenance[bit] = 'declared'

    // Probed: a GET that cannot change anything, so it is safe to run on every connect.
    if (await this.routeExists(client, '/mappings/unmatched'))
      granted.add('diagnostics.unusedStubs')
    provenance['diagnostics.unusedStubs'] = 'probed'

    if (await this.routeExists(client, '/files')) granted.add('files.browse')
    provenance['files.browse'] = 'probed'

    // Version-inferred: the only safe probe for `PUT /scenarios/{name}/state` would be to call
    // it, and calling it resets a scenario. Changing a shared server's state to find out what
    // it supports is not an acceptable trade, so this one bit is inferred and labelled.
    if (atLeast(version, { major: 2, minor: 33, patch: 0 })) granted.add('state.write')
    provenance['state.write'] = 'version'

    this.granted = granted
    this.provenance = provenance

    return {
      backendId: BACKEND_ID,
      version: versionText,
      fingerprint: fingerprintFor(client.adminUrl, versionText),
      adminUrl: client.adminUrl,
      instanceStartedAt,
      capabilityProvenance: provenance,
    }
  }

  private async readVersion(client: WireMockClient): Promise<string | null> {
    const response = await client.json<Json>('GET', '/version', { expectedStatuses: [404] })
    if (response.status === 404) return null
    const body = response.body
    if (typeof body === 'string') return body.trim()
    if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
      const version = (body as JsonObject)['version']
      if (typeof version === 'string') return version
    }
    return null
  }

  /**
   * Derive when this process started from `GET /__admin/health`, which reports
   * `uptimeInSeconds` from WireMock 3.0.1 onward. Verified against 3.13.1: a freshly started
   * container reports 1, so this tracks the process rather than the host.
   */
  private async readInstanceStart(client: WireMockClient): Promise<string | null> {
    try {
      const response = await client.json<JsonObject>('GET', '/health', {
        expectedStatuses: [404],
      })
      if (response.status === 404) return null
      const uptime = response.body['uptimeInSeconds']
      if (typeof uptime !== 'number' || !Number.isFinite(uptime)) return null
      return new Date(Date.now() - uptime * 1000).toISOString()
    } catch {
      return null
    }
  }

  /** A 404 means the route is not there; any other status means it is. */
  private async routeExists(client: WireMockClient, path: string): Promise<boolean> {
    try {
      const response = await client.json('GET', path, { expectedStatuses: [404, 401, 403, 500] })
      return response.status !== 404
    } catch {
      // A transport failure is not evidence the route is missing, but it is not evidence it is
      // there either — and the safe default is to withhold the capability.
      return false
    }
  }

  capabilities(): ReadonlySet<CapabilityBit> {
    return this.granted
  }

  capabilityProvenance(): Readonly<Record<string, CapabilityProvenance>> {
    return this.provenance
  }

  async listMocks(query: { limit?: number; offset?: number } = {}): Promise<Page<Mock>> {
    const params = new URLSearchParams()
    if (query.limit !== undefined) params.set('limit', String(query.limit))
    if (query.offset !== undefined) params.set('offset', String(query.offset))
    const suffix = params.size > 0 ? `?${params.toString()}` : ''

    const { body } = await this.transport.json<JsonObject>('GET', `/mappings${suffix}`)
    const mappings = Array.isArray(body['mappings']) ? body['mappings'] : []
    const meta = body['meta']
    const total =
      meta !== null && typeof meta === 'object' && !Array.isArray(meta)
        ? Number((meta as JsonObject)['total'] ?? mappings.length)
        : mappings.length

    return {
      items: mappings
        .filter(
          (entry): entry is JsonObject =>
            typeof entry === 'object' && entry !== null && !Array.isArray(entry),
        )
        .map(toCanonical),
      total,
      limit: query.limit ?? mappings.length,
      offset: query.offset ?? 0,
    }
  }

  async getMock(id: string): Promise<Mock> {
    const { body } = await this.transport.json<JsonObject>(
      'GET',
      `/mappings/${encodeURIComponent(id)}`,
    )
    return toCanonical(body)
  }

  async replaceAll(mocks: readonly Mock[]): Promise<void> {
    // `POST /mappings/import` **merges** by default. Without deleteAllNotInImport a "replace"
    // silently becomes a merge, which is how a corpus quietly doubles.
    await this.transport.json('POST', '/mappings/import', {
      body: {
        mappings: mocks.map((mock) => mock.raw),
        importOptions: { duplicatePolicy: 'OVERWRITE', deleteAllNotInImport: true },
      },
    })
  }

  async resetAll(): Promise<void> {
    await this.transport.json('POST', '/mappings/reset')
  }

  // ------------------------------------------------------------------- traffic

  async listServeEvents(query: JournalQuery = {}): Promise<Page<ServeEvent>> {
    const params = new URLSearchParams()
    if (query.limit !== undefined) params.set('limit', String(query.limit))
    if (query.since !== undefined) params.set('since', query.since)
    const suffix = params.size > 0 ? `?${params.toString()}` : ''

    const { body } = await this.transport.json<JsonObject>('GET', `/requests${suffix}`)
    const events = Array.isArray(body['requests']) ? body['requests'] : []
    const meta = body['meta']
    const total =
      meta !== null && typeof meta === 'object' && !Array.isArray(meta)
        ? Number((meta as JsonObject)['total'] ?? events.length)
        : events.length

    return {
      items: events.filter(isJsonObject).map((e) => toServeEvent(e, this.correlationHeader)),
      total,
      limit: query.limit ?? events.length,
      offset: query.offset ?? 0,
    }
  }

  async listUnmatched(): Promise<ServeEvent[]> {
    const { body } = await this.transport.json<JsonObject>('GET', '/requests/unmatched')
    const events = Array.isArray(body['requests']) ? body['requests'] : []
    return events.filter(isJsonObject).map((e) => toServeEvent(e, this.correlationHeader))
  }

  async clearJournal(): Promise<void> {
    await this.transport.json('DELETE', '/requests')
  }

  /**
   * Candidates for a request that did not match — the data behind design brief §6.4.
   *
   * Sorted by the server's distance so the closest comes first; the screen expands only that
   * one, because one decision beats three.
   */
  async nearMissesForRequest(request: LoggedRequest): Promise<NearMiss[]> {
    const { body } = await this.transport.json<JsonObject>('POST', '/near-misses/request', {
      body: {
        url: request.url,
        absoluteUrl: request.absoluteUrl ?? request.url,
        method: request.method,
        headers: request.headers as unknown as Json,
        cookies: request.cookies as unknown as Json,
        body: request.body ?? '',
      },
    })
    return readNearMisses(body)
  }

  /** The reverse direction (FR-TRAF-4): which logged requests came close to *this* matcher. */
  async nearMissesForMatcher(matcher: RequestMatcher): Promise<NearMiss[]> {
    const pattern: JsonObject = {}
    if (matcher.method !== null) pattern['method'] = matcher.method
    if (matcher.url !== null) pattern[matcher.url.kind] = matcher.url.value
    const { body } = await this.transport.json<JsonObject>('POST', '/near-misses/request-pattern', {
      body: pattern,
    })
    return readNearMisses(body)
  }

  async findUnusedMocks(): Promise<Mock[]> {
    const { body } = await this.transport.json<JsonObject>('GET', '/mappings/unmatched')
    const mappings = Array.isArray(body['mappings']) ? body['mappings'] : []
    return mappings.filter(isJsonObject).map(toCanonical)
  }

  async close(): Promise<void> {
    await this.client?.close()
    this.client = null
  }
}

/**
 * Identifies *which server* we are talking to — admin URL plus version.
 *
 * Deliberately **not** the restart signal: that is `instanceStartedAt`, which comes from
 * `/__admin/health`'s uptime and has to be compared with a tolerance rather than hashed. Two
 * connects to one instance compute start times a few hundred milliseconds apart, so folding it
 * into a hash would report a restart on every reconnect.
 */
export function fingerprintFor(adminUrl: string, version: string | null): string {
  return createHash('sha256')
    .update(`${adminUrl} ${version ?? 'unknown'}`)
    .digest('hex')
    .slice(0, 32)
}

function isJsonObject(value: Json): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNearMisses(body: JsonObject): NearMiss[] {
  const raw = Array.isArray(body['nearMisses']) ? body['nearMisses'] : []
  return raw
    .filter(isJsonObject)
    .map(toNearMiss)
    .sort((a, b) => a.distance - b.distance)
}
