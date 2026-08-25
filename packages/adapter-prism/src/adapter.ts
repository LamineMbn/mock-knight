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
import { DEFAULT_ADMIN_PATH, PrismClient } from './client.js'
import { documentToMocks } from './mapping.js'

/**
 * Prism — the fourth backend, and the first whose corpus was never written as mocks.
 *
 * WireMock, MockServer and Mockoon all store stubs somebody authored. Prism serves an **OpenAPI
 * document**: a description of an API, from which mock behaviour is derived. That makes it the
 * strongest test yet of whether the canonical model describes mock servers or just describes
 * stub stores — and it fit, because an operation with several declared responses is the same
 * shape Mockoon already proved the model absorbs.
 *
 * "No control API" is the documented surface, not an inference from a few probes: the CLI has
 * exactly two commands, `mock` and `proxy`, and documents no management endpoints. What it does
 * offer is per-request steering — `Prefer: code=403` / `example=ada`, or the same thing as a
 * `__code` / `__example` query parameter — which selects among an operation's declared responses
 * without changing anything on the server. That is why there is nothing here to call.
 *
 * Read-only, and not for the same reason as Mockoon. Mockoon can be written and the write goes to
 * the wrong place; here a write would mean *editing an API specification*, which is a different
 * act from editing a mock — it changes the contract other people generate clients from. That is a
 * product decision rather than a missing feature, so nothing pretends otherwise: the write bits
 * are off and the UI draws no control.
 */
export class PrismAdapter implements MockBackendAdapter {
  readonly id = 'prism'
  readonly displayName = 'Prism'
  readonly shortName = 'PR'
  readonly defaultAdminPath = DEFAULT_ADMIN_PATH
  readonly corpusDocument = {
    label: 'OpenAPI document',
    hint:
      'The absolute path to the OpenAPI file Prism was started with, YAML or JSON. Prism has no ' +
      'control API, so the document is the only source for the corpus.',
  }

  private client: PrismClient | null = null
  private bits: Set<CapabilityBit> = new Set()

  private get transport(): PrismClient {
    if (this.client === null) throw new Error('PrismAdapter used before connect()')
    return this.client
  }

  async connect(config: ConnectionConfig): Promise<ConnectionInfo> {
    this.client = new PrismClient(config)

    // Reading the document is the connection, as for Mockoon. It throws when the file is missing,
    // unparseable, or not an OpenAPI document at all.
    const document = await this.transport.readDocument()
    const info =
      typeof document['info'] === 'object' && document['info'] !== null
        ? (document['info'] as JsonObject)
        : {}
    const title = typeof info['title'] === 'string' ? info['title'] : null
    const apiVersion = typeof info['version'] === 'string' ? info['version'] : null
    const openapi = typeof document['openapi'] === 'string' ? document['openapi'] : null

    this.bits = new Set<CapabilityBit>([
      'corpus.list',
      'mock.read',
      // The document assigns the identity — operationId plus status code — and it survives a
      // reload, which is what this bit is about.
      'mock.stableServerId',
      // Not a number in the document: the lowest 2xx is what Prism serves, which is a real
      // precedence and is read as one. It cannot be written.
      'mock.priority',
    ])

    return {
      backendId: this.id,
      /*
       * The API's version, not Prism's.
       *
       * Prism exposes no version endpoint — there is no endpoint at all — so its own version is
       * unknowable from here. The document's is the honest thing to show, and it is what actually
       * changes when the corpus changes.
       */
      version: apiVersion,
      fingerprint: `prism ${this.transport.documentPath} ${title ?? 'untitled'} ${apiVersion ?? '?'} oas${openapi ?? '?'}`,
      adminUrl: this.transport.adminUrl,
      // No uptime, no start time, no endpoint to ask. A restart cannot be detected, and §7.3 says
      // not to pretend it can.
      instanceStartedAt: null,
      capabilityProvenance: {
        'corpus.list': 'declared',
        'mock.read': 'declared',
        'mock.stableServerId': 'declared',
        'mock.priority': 'declared',
      },
    }
  }

  capabilities(): ReadonlySet<CapabilityBit> {
    return this.bits
  }

  interpret(raw: JsonObject): MockDraft {
    // An operation is only meaningful under the path and method it sits at, which OpenAPI does
    // not record on the operation itself — `render` writes them back on for exactly this reason.
    const path = typeof raw['x-mock-knight-path'] === 'string' ? raw['x-mock-knight-path'] : '/'
    const method =
      typeof raw['x-mock-knight-method'] === 'string' ? raw['x-mock-knight-method'] : 'get'
    const { mocks } = documentToMocks({ paths: { [path]: { [method]: raw } } })
    const first = mocks[0]
    if (first === undefined) {
      throw new Error('Not an OpenAPI operation: no response could be read from it.')
    }
    const { id: _id, clientKey: _key, contentHash: _hash, folderSource: _source, ...draft } = first
    return draft
  }

  render(draft: MockDraft): JsonObject {
    const url = draft.request.url
    const template = url?.value ?? '/'
    const method = (draft.request.method ?? 'GET').toLowerCase()
    const status = String(draft.response.status ?? 200)

    const parameters: JsonObject[] = []
    const declare = (where: string, name: string): void => {
      parameters.push({ name, in: where, required: true, schema: { type: 'string' } })
    }
    for (const name of Object.keys(draft.request.headers)) declare('header', name)
    for (const name of Object.keys(draft.request.queryParameters)) declare('query', name)
    for (const name of Object.keys(draft.request.cookies)) declare('cookie', name)

    const body = draft.response.body
    const content: JsonObject =
      body.kind === 'none'
        ? {}
        : {
            [draft.response.headers['Content-Type'] === undefined
              ? 'application/json'
              : String(draft.response.headers['Content-Type'])]: {
              example: body.value,
            },
          }

    return {
      'x-mock-knight-path': template,
      'x-mock-knight-method': method,
      ...(draft.name === null ? {} : { summary: draft.name }),
      ...(draft.tags.length > 0 ? { tags: [...draft.tags] } : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      responses: {
        [status]: {
          description: draft.response.statusMessage ?? '',
          ...(Object.keys(content).length > 0 ? { content } : {}),
        },
      },
    }
  }

  async listMocks(query: { limit?: number; offset?: number } = {}): Promise<Page<Mock>> {
    const document = await this.transport.readDocument()
    const { mocks } = documentToMocks(document)
    const offset = query.offset ?? 0
    const limit = query.limit ?? mocks.length
    return { items: mocks.slice(offset, offset + limit), total: mocks.length, limit, offset }
  }
}
