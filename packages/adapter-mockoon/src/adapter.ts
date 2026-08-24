import type {
  CapabilityBit,
  ConnectionConfig,
  ConnectionInfo,
  JsonObject,
  JournalQuery,
  Mock,
  MockBackendAdapter,
  MockDraft,
  Page,
  ServeEvent,
} from '@mock-knight/core'
import { DEFAULT_ADMIN_PATH, MockoonClient } from './client.js'
import { draftToRoute, environmentToMocks, logToServeEvent } from './mapping.js'

/**
 * Mockoon — the third backend, and the first that is not an admin API.
 *
 * Two backends are enough to catch a convention; three are what test a shape. WireMock and
 * MockServer are both "an HTTP control plane in front of a corpus", so a model that fits both
 * might still only describe API-driven servers. Mockoon is not one: its corpus is an environment
 * **JSON document**, and `GET /mockoon-admin/environment` is a 404 (§17.31). It cannot be
 * mirrored by connecting.
 *
 * What that cost the design, honestly:
 *
 *  - **The corpus is read from a file**, so a profile needs `documentPath`. That field is new,
 *    added to `ConnectionConfig` for this backend, because "where is the corpus" genuinely has a
 *    different kind of answer here.
 *  - **`replaceAll` and `resetAll` stopped being mandatory.** They were required of every adapter
 *    until a read-only backend existed. The bits — `corpus.replaceAll`, `corpus.reset` — were
 *    already in the capability model; only the method list had assumed every backend could write.
 *  - **A route holds many responses**, so one route becomes several mocks. The model absorbed
 *    that without a new field, which is the strongest evidence so far that it is not just
 *    WireMock's JSON renamed.
 *
 * Writes are off in this first pass, and not because they are hard: Mockoon's only write is a
 * whole-document `PUT` that **does not reach the file**, so the server and the document diverge
 * the moment it is used and the change is gone on restart. Shipping an edit button over that
 * would be shipping a lie about where a stub lives.
 */
export class MockoonAdapter implements MockBackendAdapter {
  readonly id = 'mockoon'
  readonly displayName = 'Mockoon'
  readonly shortName = 'MO'
  readonly defaultAdminPath = DEFAULT_ADMIN_PATH

  private client: MockoonClient | null = null
  private bits: Set<CapabilityBit> = new Set()
  private documentPath = ''

  private get transport(): MockoonClient {
    if (this.client === null) throw new Error('MockoonAdapter used before connect()')
    return this.client
  }

  async connect(config: ConnectionConfig): Promise<ConnectionInfo> {
    this.client = new MockoonClient(config)
    this.documentPath = this.client.documentPath

    // Reading the document is the connection. It throws if the file is missing or unparseable,
    // which is right: without it there is no corpus, and every other capability is decoration.
    const environment = await this.transport.readEnvironment()
    const name = typeof environment['name'] === 'string' ? environment['name'] : null
    const migration =
      typeof environment['lastMigration'] === 'number' ? environment['lastMigration'] : null

    const bits = new Set<CapabilityBit>([
      'corpus.list',
      'mock.read',
      // Mockoon keys both the route and the response, so the pair is a stable server id.
      'mock.stableServerId',
      // Not a number Mockoon stores — the order of responses is what decides which one answers,
      // which is the same idea and is read as a priority. It cannot be written, and no write
      // capability is on anyway.
      'mock.priority',
    ])

    /**
     * The traffic log is probed, not assumed.
     *
     * It is the one thing the admin API does better than MockServer's — entries carry `routeUUID`,
     * so a served request can name the stub that served it. But the admin API is token-protected
     * by default, so a profile without the token gets a 401 here: the honest result is a Mockoon
     * connection with no Traffic screen, not a failed connection.
     */
    const provenance: Record<string, 'probed' | 'version' | 'declared'> = {}
    const logsReachable = await this.transport
      .json('GET', '/logs', { expectedStatuses: [401, 403, 404] })
      .then((probe) => probe.status === 200)
      // A transport failure here means the mock server is not running. The document still is, so
      // the corpus is still readable and this is not a failed connection.
      .catch(() => false)
    if (logsReachable) {
      bits.add('journal.read')
      bits.add('journal.attribution')
    }
    for (const bit of bits) provenance[bit] = 'declared'
    provenance['journal.read'] = 'probed'
    provenance['journal.attribution'] = 'probed'

    this.bits = bits

    return {
      backendId: this.id,
      version: null,
      /**
       * Identity is the document, not the server.
       *
       * The corpus this profile shows comes from the file, so two Mockoon servers sharing one
       * environment are the same corpus, and one server pointed at a different file is a
       * different one. `lastMigration` moves when Mockoon rewrites the schema, which is exactly
       * when a cached mirror should be treated as stale.
       */
      fingerprint: `mockoon ${this.documentPath} ${name ?? 'unnamed'} m${migration ?? '?'}`,
      adminUrl: this.transport.adminUrl,
      // Mockoon exposes no uptime or start time, so a restart cannot be detected and the UI must
      // not pretend it can (§7.3).
      instanceStartedAt: null,
      capabilityProvenance: provenance,
    }
  }

  capabilities(): ReadonlySet<CapabilityBit> {
    return this.bits
  }

  interpret(raw: JsonObject): MockDraft {
    // A Mockoon route is only meaningful inside an environment — the folder tree lives there —
    // so it is read as a one-route environment. A route with several responses interprets as its
    // first, which is the one Mockoon consults first.
    const { mocks } = environmentToMocks({ routes: [raw], rootChildren: [], folders: [] })
    const first = mocks[0]
    if (first === undefined) {
      throw new Error('Not a Mockoon route: no response could be read from it.')
    }
    const { id: _id, clientKey: _key, contentHash: _hash, folderSource: _source, ...draft } = first
    return draft
  }

  render(draft: MockDraft): JsonObject {
    return draftToRoute(draft)
  }

  async listMocks(query: { limit?: number; offset?: number } = {}): Promise<Page<Mock>> {
    const environment = await this.transport.readEnvironment()
    const { mocks } = environmentToMocks(environment)
    const offset = query.offset ?? 0
    const limit = query.limit ?? mocks.length
    return {
      items: mocks.slice(offset, offset + limit),
      total: mocks.length,
      limit,
      offset,
    }
  }

  async listServeEvents(query: JournalQuery): Promise<Page<ServeEvent>> {
    const response = await this.transport.json<unknown>('GET', '/logs')
    const entries = Array.isArray(response.body) ? response.body : []
    // Mockoon returns the log newest-first already; the canonical journal is read the same way.
    const events = entries
      .map((entry, index) => logToServeEvent(entry, index))
      .filter((event): event is ServeEvent => event !== null)
      .filter((event) => query.since === undefined || event.at >= query.since)
    const offset = query.offset ?? 0
    const limit = query.limit ?? events.length
    return { items: events.slice(offset, offset + limit), total: events.length, limit, offset }
  }

  async close(): Promise<void> {
    await this.client?.close()
    this.client = null
  }
}

/** Kept for parity with the other adapters, which expose a factory rather than the class. */
export const createMockoonAdapter = (): MockBackendAdapter => new MockoonAdapter()
