import { randomUUID } from 'node:crypto'
import type {
  CapabilityBit,
  ConnectionConfig,
  ConnectionInfo,
  JsonObject,
  Mock,
  MockBackendAdapter,
  MockDraft,
  Page,
} from '@mock-knight/core'
import { MockServerClient } from './client.js'
import { toCanonical, toVendor } from './mapping.js'

/**
 * MockServer — the second backend, and the reason the canonical model can be believed.
 *
 * What it declares is as much the point as what it does. Three capabilities are **off**, each
 * because MockServer genuinely cannot answer the question rather than because this adapter has
 * not got to it yet:
 *
 *  - **`journal.read`.** MockServer records requests and responses, and does not record which
 *    expectation served them or whether anything did. `ServeEvent.matched` would have to be
 *    guessed from the status code — and a 404 is a perfectly ordinary thing for a stub to
 *    return, so the guess would be wrong on exactly the corpus that cares. A traffic screen that
 *    is absent is better than one that labels a matched request unmatched.
 *  - **`state.read`/`state.write`.** `times` sequences an expectation; it does not name states.
 *    Rendering it as a state machine would put a graph on screen that the server cannot be asked
 *    about.
 *  - **`mock.enableDisable`.** No such concept, the same as WireMock.
 *
 * Each of those is a capability doing its job: the method is absent, the route 404s, and the UI
 * never draws the control (invariant 5).
 */
export class MockServerAdapter implements MockBackendAdapter {
  readonly id = 'mockserver'
  readonly displayName = 'MockServer'

  private client: MockServerClient | null = null
  private bits: Set<CapabilityBit> = new Set()

  private get transport(): MockServerClient {
    if (this.client === null) throw new Error('MockServerAdapter used before connect()')
    return this.client
  }

  async connect(config: ConnectionConfig): Promise<ConnectionInfo> {
    this.client = new MockServerClient(config)
    // `status` needs a body: without one it answers with a description of its own schema, which
    // parses as JSON and contains no version at all.
    const status = await this.transport.control<{ version?: string }>('/status', {})
    const version = typeof status.body.version === 'string' ? status.body.version : null

    this.bits = new Set<CapabilityBit>([
      'corpus.list',
      'corpus.replaceAll',
      'corpus.reset',
      'mock.read',
      'mock.create',
      // Upsert-only, and that is enough: an expectation is addressed by an id the caller may
      // supply, so an update is a create with the id it already had.
      'mock.update',
      'mock.delete',
      'mock.stableServerId',
      'mock.priority',
    ])

    return {
      backendId: this.id,
      version,
      // Identity is the control URL plus the version: MockServer offers no instance id, and two
      // servers on one address are the same server as far as anything here can tell.
      fingerprint: `mockserver ${this.transport.controlUrl} ${version ?? 'unknown'}`,
      adminUrl: this.transport.controlUrl,
      // No uptime or start time is exposed, so a restart cannot be detected here and the UI
      // must not pretend it can (§7.3).
      instanceStartedAt: null,
      // `declared`, not `probed`: these follow from what MockServer *is*, and the one call made
      // on connect proves the control API answers rather than proving each route exists.
      capabilityProvenance: Object.fromEntries([...this.bits].map((bit) => [bit, 'declared'])),
    }
  }

  capabilities(): ReadonlySet<CapabilityBit> {
    return this.bits
  }

  interpret(raw: JsonObject): MockDraft {
    const {
      id: _id,
      clientKey: _key,
      contentHash: _hash,
      folderSource: _src,
      ...draft
    } = toCanonical(raw)
    return draft
  }

  render(draft: MockDraft): JsonObject {
    return toVendor(draft)
  }

  private async expectations(): Promise<JsonObject[]> {
    const found = await this.transport.control<JsonObject[]>(
      '/retrieve?type=active_expectations&format=json',
      {},
    )
    return Array.isArray(found.body) ? found.body : []
  }

  async listMocks(query: { limit?: number; offset?: number } = {}): Promise<Page<Mock>> {
    const all = await this.expectations()
    const offset = query.offset ?? 0
    const limit = query.limit ?? all.length
    return {
      // The total describes the corpus, not the page: MockServer returns everything, so paging
      // happens here rather than being pushed onto a backend that cannot do it.
      total: all.length,
      limit,
      offset,
      items: all.slice(offset, offset + limit).map(toCanonical),
    }
  }

  async getMock(id: string): Promise<Mock> {
    const found = (await this.expectations()).find((raw) => raw['id'] === id)
    if (found === undefined) throw new Error(`No expectation with id ${id}`)
    return toCanonical(found)
  }

  async createMock(draft: MockDraft): Promise<Mock> {
    const raw = toVendor(draft)
    // An id is generated here rather than left to the server, because the write has to be able
    // to report which expectation it created and MockServer's response is an array that says
    // nothing about which entry is new.
    const id = typeof raw['id'] === 'string' && raw['id'] !== '' ? raw['id'] : randomUUID()
    await this.transport.control('/expectation', { ...raw, id })
    return this.getMock(id)
  }

  async updateMock(id: string, draft: MockDraft): Promise<Mock> {
    // Upsert: writing an expectation under an id it already has replaces it in place, verified
    // against 5.15.0 rather than assumed.
    await this.transport.control('/expectation', { ...toVendor(draft), id })
    return this.getMock(id)
  }

  async deleteMock(id: string): Promise<void> {
    await this.transport.control('/clear?type=expectations', { id })
  }

  async replaceAll(mocks: readonly Mock[]): Promise<void> {
    // No import endpoint that replaces, so it is reset-then-write. Not atomic, and that is worth
    // knowing: a request arriving mid-replace sees an empty corpus. WireMock's import avoids
    // that; this backend offers no equivalent.
    await this.resetAll()
    for (const mock of mocks) {
      const raw = toVendor(mock)
      await this.transport.control('/expectation', {
        ...raw,
        id: typeof raw['id'] === 'string' && raw['id'] !== '' ? raw['id'] : randomUUID(),
      })
    }
  }

  async resetAll(): Promise<void> {
    await this.transport.control('/reset', {})
  }

  async close(): Promise<void> {
    await this.client?.close()
    this.client = null
  }
}
