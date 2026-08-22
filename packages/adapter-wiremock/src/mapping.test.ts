import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { canonicalJson } from '@mock-knight/core'
import type { Json, JsonObject } from '@mock-knight/core'
import { toCanonical, toVendor } from './mapping.js'

/** A stub exercising most of WireMock's mapping schema at once. */
const richStub: JsonObject = {
  id: '8b1e2f30-0000-4000-8000-000000000001',
  uuid: '8b1e2f30-0000-4000-8000-000000000001',
  name: 'orders create 500',
  priority: 3,
  scenarioName: 'checkout',
  requiredScenarioState: 'Started',
  newScenarioState: 'ordered',
  persistent: true,
  metadata: {
    'mock-knight': { folder: ['orders', 'v1'], tags: ['legacy'], notes: null, owner: null },
    team: 'payments',
  },
  request: {
    method: 'POST',
    urlPath: '/v1/orders',
    headers: {
      'X-Tenant': { equalTo: 'acme', caseInsensitive: true },
      Accept: { contains: 'json' },
    },
    queryParameters: { dryRun: { absent: true } },
    cookies: { session: { matches: '^s-.*' } },
    bodyPatterns: [
      { matchesJsonPath: '$.sku' },
      { equalToJson: { qty: 2 }, ignoreArrayOrder: true, ignoreExtraElements: true },
    ],
    basicAuthCredentials: { username: 'u', password: 'p' },
  },
  response: {
    status: 500,
    statusMessage: 'Internal Server Error',
    headers: { 'Content-Type': 'application/json' },
    jsonBody: { error: 'insufficient funds' },
    fixedDelayMilliseconds: 120,
    transformers: ['response-template'],
    transformerParameters: { region: 'eu' },
  },
}

/** The awkward end of the corpus: almost nothing set, and fields we do not model. */
const sparseStub: JsonObject = {
  request: { url: '/health' },
  response: { status: 200 },
  postServeActions: [{ name: 'webhook', parameters: { url: 'http://x' } }],
  someFutureWireMockField: { nested: [1, 2, 3] },
}

describe('toCanonical', () => {
  const mock = toCanonical(richStub)

  it('reads identity from the server id and keys on it', () => {
    expect(mock.id).toBe('8b1e2f30-0000-4000-8000-000000000001')
    expect(mock.clientKey).toBe('8b1e2f30-0000-4000-8000-000000000001')
  })

  it('falls back to a content-addressed key when the stub has no id', () => {
    expect(toCanonical(sparseStub).id).toBeNull()
    expect(toCanonical(sparseStub).clientKey).toMatch(/^h_[0-9a-f]{32}$/)
  })

  it('reads the url matcher as a kind plus a value, not four optional fields', () => {
    expect(mock.request.url).toEqual({ kind: 'urlPath', value: '/v1/orders' })
    expect(toCanonical(sparseStub).request.url).toEqual({ kind: 'url', value: '/health' })
  })

  it('splits a predicate into operator, value, and the operator’s own options', () => {
    expect(mock.request.headers['X-Tenant']).toEqual([
      { operator: 'equalTo', value: 'acme', options: { caseInsensitive: true } },
    ])
    expect(mock.request.bodyPatterns[1]).toEqual({
      operator: 'equalToJson',
      value: { qty: 2 },
      options: { ignoreArrayOrder: true, ignoreExtraElements: true },
    })
  })

  it('reports enabled as null — WireMock Java has no such field', () => {
    expect(mock.enabled).toBeNull()
  })

  it('reads folder and tags from the namespaced metadata key', () => {
    expect(mock.folder).toEqual(['orders', 'v1'])
    expect(mock.tags).toEqual(['legacy'])
  })

  it('keeps the rest of the metadata blob intact alongside our own key', () => {
    expect(mock.metadata['team']).toBe('payments')
  })

  it('derives a folder from the url path when metadata says nothing, and says it derived it', () => {
    const derived = toCanonical({ request: { urlPath: '/v1/customers/{id}' }, response: {} })
    expect(derived.folder).toEqual(['v1', 'customers'])
    expect(derived.folderSource).toBe('path')
    // A folder the server actually stated is a stronger claim and must not look the same.
    expect(mock.folderSource).toBe('metadata')
    expect(toCanonical({ request: {}, response: {} }).folderSource).toBe('none')
  })

  it('reads the state binding as one object', () => {
    expect(mock.state).toEqual({
      scenario: 'checkout',
      requiredState: 'Started',
      newState: 'ordered',
    })
    expect(toCanonical(sparseStub).state).toBeNull()
  })

  it('names the response body representation rather than guessing at read time', () => {
    expect(mock.response.body).toEqual({ kind: 'json', value: { error: 'insufficient funds' } })
    expect(toCanonical({ request: {}, response: { body: 'hi' } }).response.body).toEqual({
      kind: 'text',
      value: 'hi',
    })
    expect(
      toCanonical({ request: {}, response: { bodyFileName: 'o.json' } }).response.body,
    ).toEqual({ kind: 'file', value: 'o.json' })
    expect(toCanonical(sparseStub).response.body).toEqual({ kind: 'none', value: null })
  })

  it('reads a fixed delay and a delay distribution through the same shape', () => {
    expect(mock.response.delay).toEqual({ kind: 'fixed', milliseconds: 120, options: {} })
    const distributed = toCanonical({
      request: {},
      response: { delayDistribution: { type: 'lognormal', median: 80, sigma: 0.4 } },
    })
    expect(distributed.response.delay).toEqual({
      kind: 'lognormal',
      milliseconds: null,
      options: { median: 80, sigma: 0.4 },
    })
  })

  it('retains the raw payload verbatim', () => {
    expect(mock.raw).toEqual(richStub)
    expect(toCanonical(sparseStub).raw).toEqual(sparseStub)
  })

  it('hashes the canonical raw, so re-reading an unchanged stub gives the same hash', () => {
    expect(toCanonical(richStub).contentHash).toBe(toCanonical({ ...richStub }).contentHash)
  })
})

describe('toVendor — the round trip that must not lose anything', () => {
  it('returns the raw payload untouched when nothing changed', () => {
    for (const stub of [richStub, sparseStub]) {
      expect(canonicalJson(toVendor(toCanonical(stub)))).toBe(canonicalJson(stub))
    }
  })

  it('preserves fields the canonical model does not understand when something did change', () => {
    const mock = toCanonical(sparseStub)
    const patched = toVendor({ ...mock, response: { ...mock.response, status: 503 } })
    expect(patched['postServeActions']).toEqual(sparseStub['postServeActions'])
    expect(patched['someFutureWireMockField']).toEqual(sparseStub['someFutureWireMockField'])
    expect((patched['response'] as JsonObject)['status']).toBe(503)
  })

  it('patches only the field that changed, leaving sibling keys byte-identical', () => {
    const mock = toCanonical(richStub)
    const patched = toVendor({ ...mock, name: 'orders create 503' })
    expect(patched['name']).toBe('orders create 503')
    const before = { ...richStub } as JsonObject
    delete before['name']
    const after = { ...patched } as JsonObject
    delete after['name']
    expect(canonicalJson(after)).toBe(canonicalJson(before))
  })

  it('replaces the url matcher rather than leaving two of them behind', () => {
    const mock = toCanonical(richStub)
    const patched = toVendor({
      ...mock,
      request: { ...mock.request, url: { kind: 'urlPattern', value: '/v1/orders/.*' } },
    })
    const request = patched['request'] as JsonObject
    expect(request['urlPattern']).toBe('/v1/orders/.*')
    expect(request).not.toHaveProperty('urlPath')
    expect(request).not.toHaveProperty('url')
    // The parts of the matcher we did not touch are still there.
    expect(request['basicAuthCredentials']).toEqual({ username: 'u', password: 'p' })
  })

  it('writes a predicate back in the shape WireMock reads', () => {
    const mock = toCanonical(richStub)
    const patched = toVendor({
      ...mock,
      request: {
        ...mock.request,
        headers: {
          'X-Tenant': [
            { operator: 'equalTo', value: 'acme-corp', options: { caseInsensitive: true } },
          ],
        },
      },
    })
    const headers = (patched['request'] as JsonObject)['headers'] as JsonObject
    expect(headers['X-Tenant']).toEqual({ equalTo: 'acme-corp', caseInsensitive: true })
    // The header we removed from the canonical map is genuinely gone, not stale.
    expect(headers).not.toHaveProperty('Accept')
  })

  it('swaps the body representation cleanly instead of stacking two body fields', () => {
    const mock = toCanonical(richStub)
    const patched = toVendor({
      ...mock,
      response: { ...mock.response, body: { kind: 'text', value: 'plain' } },
    })
    const response = patched['response'] as JsonObject
    expect(response['body']).toBe('plain')
    expect(response).not.toHaveProperty('jsonBody')
    expect(response['transformerParameters']).toEqual({ region: 'eu' })
  })

  it('removes a field rather than writing null when a value is cleared', () => {
    const mock = toCanonical(richStub)
    const patched = toVendor({ ...mock, priority: null, state: null })
    expect(patched).not.toHaveProperty('priority')
    expect(patched).not.toHaveProperty('scenarioName')
    expect(patched).not.toHaveProperty('requiredScenarioState')
    expect(patched).not.toHaveProperty('newScenarioState')
  })

  it('writes folder and tags under the namespaced key without disturbing other metadata', () => {
    const mock = toCanonical(richStub)
    const patched = toVendor({ ...mock, folder: ['orders', 'v2'], tags: [] })
    const metadata = patched['metadata'] as JsonObject
    expect((metadata['mock-knight'] as JsonObject)['folder']).toEqual(['orders', 'v2'])
    expect((metadata['mock-knight'] as JsonObject)['tags']).toEqual([])
    expect(metadata['team']).toBe('payments')
  })

  it('does not invent a metadata key for a stub that had none and still has no folder', () => {
    const mock = toCanonical(sparseStub)
    const patched = toVendor({ ...mock, name: 'health' })
    expect(patched).not.toHaveProperty('metadata')
  })

  it('never writes an enabled field, because WireMock rejects unknown properties', () => {
    const mock = toCanonical(richStub)
    const patched = toVendor({ ...mock, enabled: true })
    expect(patched).not.toHaveProperty('enabled')
  })
})

describe('toVendor — property: an unchanged stub is byte-identical after a round trip', () => {
  /** WireMock-shaped stubs, including fields the canonical model has no opinion about. */
  const stubArb: fc.Arbitrary<JsonObject> = fc
    .record(
      {
        id: fc.uuid(),
        name: fc.string({ minLength: 1 }),
        priority: fc.integer({ min: 1, max: 10 }),
        scenarioName: fc.string({ minLength: 1 }),
        requiredScenarioState: fc.string({ minLength: 1 }),
        newScenarioState: fc.string({ minLength: 1 }),
        persistent: fc.boolean(),
        postServeActions: fc.constant([{ name: 'webhook' }] as unknown as Json),
        unknownFutureField: fc.constant({ deep: [1, { two: true }] } as unknown as Json),
        metadata: fc.record(
          {
            'mock-knight': fc.record(
              { folder: fc.array(fc.string({ minLength: 1 }), { maxLength: 3 }) },
              { requiredKeys: [] },
            ),
            team: fc.string(),
          },
          { requiredKeys: [] },
        ) as fc.Arbitrary<Json>,
        request: fc.record(
          {
            method: fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'ANY'),
            url: fc.constantFrom('/a', '/v1/orders'),
            urlPath: fc.constantFrom('/b', '/v1/customers/1'),
            urlPattern: fc.constant('/v1/.*'),
            headers: fc.constant({
              'X-Tenant': { equalTo: 'acme', caseInsensitive: true },
            } as unknown as Json),
            queryParameters: fc.constant({ q: { matches: '.+' } } as unknown as Json),
            cookies: fc.constant({ s: { absent: true } } as unknown as Json),
            bodyPatterns: fc.constant([
              { matchesJsonPath: '$.sku' },
              { equalToJson: { a: 1 }, ignoreArrayOrder: true },
            ] as unknown as Json),
            basicAuthCredentials: fc.constant({ username: 'u', password: 'p' } as unknown as Json),
          },
          { requiredKeys: [] },
        ) as fc.Arbitrary<Json>,
        response: fc.record(
          {
            status: fc.integer({ min: 100, max: 599 }),
            statusMessage: fc.string(),
            headers: fc.constant({ 'Content-Type': 'application/json' } as unknown as Json),
            body: fc.string(),
            jsonBody: fc.constant({ ok: true } as unknown as Json),
            base64Body: fc.constant('aGk='),
            bodyFileName: fc.constant('body.json'),
            fixedDelayMilliseconds: fc.integer({ min: 0, max: 5000 }),
            delayDistribution: fc.constant({
              type: 'lognormal',
              median: 80,
              sigma: 0.4,
            } as unknown as Json),
            fault: fc.constantFrom('CONNECTION_RESET_BY_PEER', 'EMPTY_RESPONSE'),
            proxyBaseUrl: fc.webUrl(),
            additionalProxyRequestHeaders: fc.constant({ 'X-Fwd': '1' } as unknown as Json),
            transformers: fc.constant(['response-template'] as unknown as Json),
            transformerParameters: fc.constant({ region: 'eu' } as unknown as Json),
          },
          { requiredKeys: [] },
        ) as fc.Arbitrary<Json>,
      },
      { requiredKeys: [] },
    )
    .map((stub) => stub as JsonObject)

  it('round-trips any generated stub with no change at all', () => {
    fc.assert(
      fc.property(stubArb, (stub) => {
        expect(canonicalJson(toVendor(toCanonical(stub)))).toBe(canonicalJson(stub))
      }),
      { numRuns: 500 },
    )
  })

  it('changes only the response status when only the response status was changed', () => {
    fc.assert(
      fc.property(stubArb, fc.integer({ min: 100, max: 599 }), (stub, status) => {
        const mock = toCanonical(stub)
        fc.pre(mock.response.status !== status)
        const patched = toVendor({ ...mock, response: { ...mock.response, status } })

        expect((patched['response'] as JsonObject | undefined)?.['status']).toBe(status)

        // Everything outside response.status is untouched, including what we do not model.
        // A stub with no `response` object at all is the one legitimate structural change:
        // there is nowhere to put a status without creating one, so an emptied `response`
        // counts as absent for this comparison.
        const strip = (value: JsonObject): JsonObject => {
          const copy = structuredClone(value)
          const response = copy['response']
          if (response !== null && typeof response === 'object' && !Array.isArray(response)) {
            delete response['status']
            if (Object.keys(response).length === 0) delete copy['response']
          }
          return copy
        }
        expect(canonicalJson(strip(patched))).toBe(canonicalJson(strip(stub)))
      }),
      { numRuns: 500 },
    )
  })
})

describe('toVendor — creating structure that was not there', () => {
  it('creates the response object when a stub that had none is given a status', () => {
    const mock = toCanonical({})
    const patched = toVendor({ ...mock, response: { ...mock.response, status: 404 } })
    expect(patched).toEqual({ response: { status: 404 } })
  })

  it('does not create a request or response object for a change that does not need one', () => {
    const mock = toCanonical({})
    expect(toVendor({ ...mock, name: 'health' })).toEqual({ name: 'health' })
  })
})
