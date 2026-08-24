import { describe, expect, it } from 'vitest'
import { endpointToUrlMatch, environmentToMocks, folderPaths } from './mapping.js'
import type { JsonObject } from '@mock-knight/core'

/**
 * The Mockoon read path.
 *
 * Fixtures follow the document `mockoon/cli` actually accepted (TECH-DESIGN §17.31) rather than
 * a shape invented here — including the fields Mock Knight ignores, because an environment in the
 * wild carries them and `raw` has to keep them.
 */

const response = (over: Partial<JsonObject> = {}): JsonObject => ({
  uuid: 'r1',
  body: '{"ok":true}',
  latency: 0,
  statusCode: 200,
  label: '',
  headers: [{ key: 'Content-Type', value: 'application/json' }],
  bodyType: 'INLINE',
  filePath: '',
  databucketID: '',
  sendFileAsBody: false,
  rules: [],
  rulesOperator: 'OR',
  disableTemplating: false,
  fallbackTo404: false,
  default: true,
  crudKey: 'id',
  callbacks: [],
  ...over,
})

const route = (over: Partial<JsonObject> = {}): JsonObject => ({
  uuid: 'route-1',
  type: 'http',
  documentation: '',
  method: 'get',
  endpoint: 'v1/customers',
  responses: [response()],
  responseMode: null,
  streamingMode: null,
  streamingInterval: 0,
  ...over,
})

const environment = (over: Partial<JsonObject> = {}): JsonObject => ({
  uuid: 'env-1',
  lastMigration: 33,
  name: 'fixture',
  port: 3000,
  routes: [route()],
  rootChildren: [{ type: 'route', uuid: 'route-1' }],
  folders: [],
  data: [],
  ...over,
})

describe('environmentToMocks', () => {
  it('reads a route with one response as one mock', () => {
    const { mocks, skipped } = environmentToMocks(environment())

    expect(skipped).toEqual([])
    expect(mocks).toHaveLength(1)
    const mock = mocks[0]!
    // Both halves of the pair, because the pair is the unit the canonical model shows.
    expect(mock.id).toBe('route-1:r1')
    expect(mock.request.method).toBe('GET')
    expect(mock.request.url).toEqual({ kind: 'urlPath', value: '/v1/customers' })
    expect(mock.response.status).toBe(200)
    expect(mock.response.body).toEqual({ kind: 'json', value: { ok: true } })
  })

  it('splits a route with several responses into one mock each, ordered by precedence', () => {
    const { mocks } = environmentToMocks(
      environment({
        routes: [
          route({
            responses: [
              response({ uuid: 'first', statusCode: 403, label: 'forbidden for other tenants' }),
              response({ uuid: 'second', statusCode: 200, label: 'the usual answer' }),
            ],
          }),
        ],
      }),
    )

    expect(mocks).toHaveLength(2)
    expect(mocks.map((mock) => mock.id)).toEqual(['route-1:first', 'route-1:second'])
    // Order is the entire selection rule in Mockoon, so it reads as canonical priority: lower
    // wins. Without this the corpus would show two stubs on one path with nothing to separate
    // them, which is exactly what the Priority column exists to prevent.
    expect(mocks.map((mock) => mock.priority)).toEqual([1, 2])
    expect(mocks[0]!.name).toBe('forbidden for other tenants')
  })

  it('gives a lone response no priority, because there is nothing to rank it against', () => {
    const { mocks } = environmentToMocks(environment())

    // "Priority 1" for a single response implies a contest that does not exist — and it broke the
    // render/interpret round-trip, since a composed draft has no opinion about order.
    expect(mocks[0]!.priority).toBeNull()
  })

  it('keeps the whole route in each sibling, so no field is lost to the split', () => {
    const { mocks } = environmentToMocks(
      environment({
        routes: [
          route({
            documentation: 'customer lookup',
            responseMode: 'SEQUENTIAL',
            responses: [response({ uuid: 'a' }), response({ uuid: 'b' })],
          }),
        ],
      }),
    )

    for (const mock of mocks) {
      // Route-level fields are repeated across siblings. Duplicating is fine; losing is not.
      expect(mock.raw['responseMode']).toBe('SEQUENTIAL')
      expect(mock.raw['documentation']).toBe('customer lookup')
      // And each carries exactly its own response, so patching back is unambiguous.
      expect((mock.raw['responses'] as JsonObject[]).length).toBe(1)
    }
    expect((mocks[0]!.raw['responses'] as JsonObject[])[0]!['uuid']).toBe('a')
    expect((mocks[1]!.raw['responses'] as JsonObject[])[0]!['uuid']).toBe('b')
  })

  it('reads a rule on a header as a header matcher', () => {
    const { mocks } = environmentToMocks(
      environment({
        routes: [
          route({
            responses: [
              response({
                rules: [
                  { target: 'header', modifier: 'x-tenant', value: 'acme', operator: 'equals' },
                ],
              }),
            ],
          }),
        ],
      }),
    )

    expect(mocks[0]!.request.headers['x-tenant']).toEqual([
      { operator: 'equalTo', value: 'acme', options: {} },
    ])
  })

  it('never reads an inverted rule as the equality it is the opposite of', () => {
    const { mocks } = environmentToMocks(
      environment({
        routes: [
          route({
            responses: [
              response({
                rules: [
                  {
                    target: 'header',
                    modifier: 'x-tenant',
                    value: 'acme',
                    operator: 'equals',
                    invert: true,
                  },
                ],
              }),
            ],
          }),
        ],
      }),
    )

    // The rule fires when the header is *not* acme. Rendered as `equalTo acme` — which is what
    // hiding `invert` in `options` produced — the detail panel stated the reverse of what the
    // server does, and the matcher form and match explainer would both have repeated it.
    expect(mocks[0]!.request.headers['x-tenant']).toEqual([
      { operator: 'mockoon:not-equals', value: 'acme', options: { invert: true } },
    ])
  })

  it('keeps an operator the canonical vocabulary does not have, rather than dropping it', () => {
    const { mocks } = environmentToMocks(
      environment({
        routes: [
          route({
            responses: [
              response({
                rules: [
                  { target: 'header', modifier: 'x-list', value: 'a', operator: 'array_includes' },
                ],
              }),
            ],
          }),
        ],
      }),
    )

    // Namespaced, not translated: `matcherSchema.operator` is an open string so an unrecognised
    // predicate round-trips and renders read-only instead of being silently lost.
    expect(mocks[0]!.request.headers['x-list']).toEqual([
      { operator: 'mockoon:array_includes', value: 'a', options: {} },
    ])
  })

  it('reads a body rule as a body pattern, carrying its path', () => {
    const { mocks } = environmentToMocks(
      environment({
        routes: [
          route({
            responses: [
              response({
                rules: [
                  { target: 'body', modifier: 'user.role', value: 'admin', operator: 'equals' },
                ],
              }),
            ],
          }),
        ],
      }),
    )

    expect(mocks[0]!.request.bodyPatterns).toEqual([
      { operator: 'equalTo', value: 'admin', options: { expression: 'user.role' } },
    ])
  })

  it('does not force a rule with no canonical slot into one', () => {
    const { mocks } = environmentToMocks(
      environment({
        routes: [
          route({
            responses: [
              response({
                rules: [
                  { target: 'request_number', modifier: '', value: '3', operator: 'equals' },
                  { target: 'global_var', modifier: 'flag', value: 'on', operator: 'equals' },
                ],
              }),
            ],
          }),
        ],
      }),
    )

    const mock = mocks[0]!
    // Nothing invented. A rule about the third request is not a header matcher, and the match
    // explainer must not be handed a predicate that says it is.
    expect(mock.request.headers).toEqual({})
    expect(mock.request.queryParameters).toEqual({})
    expect(mock.request.bodyPatterns).toEqual([])
    // Still readable in full, because raw is the route document verbatim.
    const rules = (mock.raw['responses'] as JsonObject[])[0]!['rules'] as JsonObject[]
    expect(rules).toHaveLength(2)
  })

  it('reads the folder from Mockoon own tree, and says the server stated it', () => {
    const { mocks } = environmentToMocks(
      environment({
        folders: [
          { uuid: 'f1', name: 'v1', children: [{ type: 'folder', uuid: 'f2' }] },
          { uuid: 'f2', name: 'customers', children: [{ type: 'route', uuid: 'route-1' }] },
        ],
        rootChildren: [{ type: 'folder', uuid: 'f1' }],
      }),
    )

    expect(mocks[0]!.folder).toEqual(['v1', 'customers'])
    // The first backend of the three that states a folder instead of leaving Mock Knight to
    // guess one from a URL prefix — so the provenance is 'metadata', not 'path'.
    expect(mocks[0]!.folderSource).toBe('metadata')
  })

  it('says a route is unrepresentable rather than flattening it', () => {
    const { mocks, skipped } = environmentToMocks(
      environment({
        routes: [route(), route({ uuid: 'ws-1', type: 'ws', endpoint: 'live' })],
        rootChildren: [
          { type: 'route', uuid: 'route-1' },
          { type: 'route', uuid: 'ws-1' },
        ],
      }),
    )

    expect(mocks).toHaveLength(1)
    expect(skipped).toEqual([
      { uuid: 'ws-1', reason: 'WebSocket route: not a request/response stub' },
    ])
  })

  it('survives a cycle in the folder tree', () => {
    // The environment is a file a human edits. A cycle in it must not hang a corpus ingest.
    const { mocks } = environmentToMocks(
      environment({
        folders: [
          { uuid: 'f1', name: 'one', children: [{ type: 'folder', uuid: 'f2' }] },
          { uuid: 'f2', name: 'two', children: [{ type: 'folder', uuid: 'f1' }] },
        ],
        rootChildren: [{ type: 'folder', uuid: 'f1' }],
      }),
    )

    expect(mocks).toHaveLength(1)
    expect(mocks[0]!.folder).toEqual([])
  })

  it('reads latency as a delay and templating as a transformer', () => {
    const { mocks } = environmentToMocks(
      environment({
        routes: [route({ responses: [response({ latency: 250 })] })],
      }),
    )

    expect(mocks[0]!.response.delay).toEqual({ kind: 'fixed', milliseconds: 250, options: {} })
    expect(mocks[0]!.response.transformers).toEqual(['mockoon:templating'])
  })

  it('reads a non-JSON body as text rather than failing', () => {
    const { mocks } = environmentToMocks(
      environment({
        routes: [route({ responses: [response({ body: 'Hello {{queryParam "name"}}' })] })],
      }),
    )

    // A Mockoon body is a Handlebars template as often as it is JSON.
    expect(mocks[0]!.response.body).toEqual({
      kind: 'text',
      value: 'Hello {{queryParam "name"}}',
    })
  })

  it('reads a data-bucket body as external content, not as no body', () => {
    const { mocks } = environmentToMocks(
      environment({
        routes: [
          route({
            responses: [response({ bodyType: 'DATABUCKET', databucketID: 'bkt1', body: '' })],
          }),
        ],
      }),
    )

    expect(mocks[0]!.response.body).toEqual({ kind: 'file', value: 'databucket:bkt1' })
  })

  it('says nothing about enabled or scenarios, because Mockoon has neither', () => {
    const { mocks } = environmentToMocks(environment())

    expect(mocks[0]!.enabled).toBeNull()
    expect(mocks[0]!.state).toBeNull()
  })
})

describe('endpointToUrlMatch', () => {
  it('reads a literal endpoint as a path', () => {
    expect(endpointToUrlMatch('v1/customers')).toEqual({ kind: 'urlPath', value: '/v1/customers' })
  })

  it('reads a route parameter as a pattern, not as a literal path', () => {
    // `urlPath` here would have the corpus list claim the stub answers on the literal string
    // "/users/:id", which is not a URL anybody calls.
    const match = endpointToUrlMatch('users/:id/orders')
    expect(match.kind).toBe('urlPathPattern')
    expect(new RegExp(`^${match.value}$`).test('/users/42/orders')).toBe(true)
    expect(new RegExp(`^${match.value}$`).test('/users/42/orders/9')).toBe(false)
  })

  it('escapes what is regex in a path before adding regex of its own', () => {
    const match = endpointToUrlMatch('files/:name.json')
    expect(new RegExp(`^${match.value}$`).test('/files/report.json')).toBe(true)
    // The dot is a literal in the endpoint, so it must not match any character.
    expect(new RegExp(`^${match.value}$`).test('/files/reportxjson')).toBe(false)
  })
})

describe('folderPaths', () => {
  it('returns no path for a route the tree does not mention', () => {
    // Legal in the wild: a route present in `routes` but missing from `rootChildren` is not
    // served by Mockoon at all (§17.31), and it has no folder either.
    expect(folderPaths(environment({ rootChildren: [] })).get('route-1')).toBeUndefined()
  })
})
