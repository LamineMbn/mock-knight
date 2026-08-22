import { describe, expect, it } from 'vitest'
import { stubFromRequest } from './from-request.js'
import type { LoggedRequest } from './model.js'

const request = (over: Partial<LoggedRequest> = {}): LoggedRequest => ({
  method: 'POST',
  url: '/v1/orders?dryRun=true',
  absoluteUrl: 'http://mock:8080/v1/orders?dryRun=true',
  clientIp: null,
  headers: {
    Host: 'mock:8080',
    'User-Agent': 'curl/8.7.1',
    Accept: '*/*',
    'Content-Type': 'application/json',
    'X-Mock': 'anais-post-accountlogin-unparsable',
    Authorization: 'Bearer secret-token',
  },
  cookies: {},
  queryParameters: { dryRun: ['true'] },
  body: '{"sku":"AX-91","qty":2}',
  bodyTruncated: false,
  ...over,
})

describe('tightness', () => {
  it('pins method and path by default, and nothing else', () => {
    const { draft } = stubFromRequest(request())
    expect(draft.request.method).toBe('POST')
    expect(draft.request.url).toEqual({ kind: 'urlPath', value: '/v1/orders' })
    expect(draft.request.headers).toEqual({})
    expect(draft.request.queryParameters).toEqual({})
    expect(draft.request.bodyPatterns).toEqual([])
  })

  it('matches any method at the loosest setting', () => {
    const { draft, notes } = stubFromRequest(request(), { tightness: 'path' })
    expect(draft.request.method).toBeNull()
    expect(notes).toContain('Matching any method on this path.')
  })

  it('pins headers and query parameters at the tightest setting', () => {
    const { draft } = stubFromRequest(request(), { tightness: 'exact' })
    expect(draft.request.headers['X-Mock']).toEqual([
      { operator: 'equalTo', value: 'anais-post-accountlogin-unparsable', options: {} },
    ])
    expect(draft.request.queryParameters['dryRun']).toEqual([
      { operator: 'equalTo', value: 'true', options: {} },
    ])
  })

  it('never pins transport headers, which would work from curl and fail from the real client', () => {
    const { draft } = stubFromRequest(request(), { tightness: 'exact' })
    for (const noise of ['Host', 'User-Agent', 'Accept']) {
      expect(Object.keys(draft.request.headers)).not.toContain(noise)
    }
  })

  it('never copies a credential into a stub, and says why', () => {
    const { draft, notes } = stubFromRequest(request(), { tightness: 'exact' })
    expect(Object.keys(draft.request.headers)).not.toContain('Authorization')
    expect(notes.some((n) => n.includes('Authorization') && n.includes('credential'))).toBe(true)
  })

  it('strips the query string from the path rather than baking it in', () => {
    // A urlPath carrying `?dryRun=true` matches nothing; query matching has its own field.
    const { draft } = stubFromRequest(request(), { tightness: 'exact' })
    expect(draft.request.url?.value).toBe('/v1/orders')
  })
})

describe('body matching', () => {
  it('is off by default, because request bodies rarely repeat byte for byte', () => {
    expect(stubFromRequest(request()).draft.request.bodyPatterns).toEqual([])
  })

  it('matches JSON structurally when asked', () => {
    const { draft, notes } = stubFromRequest(request(), { matchBody: true })
    expect(draft.request.bodyPatterns[0]).toMatchObject({
      operator: 'equalToJson',
      value: { sku: 'AX-91', qty: 2 },
      options: { ignoreExtraElements: true },
    })
    expect(notes.some((n) => n.includes('ignoring extra fields'))).toBe(true)
  })

  it('falls back to an exact string for a body that is not JSON', () => {
    const { draft } = stubFromRequest(request({ body: 'plain text' }), { matchBody: true })
    expect(draft.request.bodyPatterns[0]).toMatchObject({
      operator: 'equalTo',
      value: 'plain text',
    })
  })
})

describe('the response skeleton', () => {
  it('is a placeholder a human is meant to replace', () => {
    const { draft } = stubFromRequest(request())
    expect(draft.response.status).toBe(200)
    expect(draft.response.body.kind).toBe('json')
    expect(JSON.stringify(draft.response.body.value)).toContain('TODO')
  })

  it('takes a status when one is given', () => {
    expect(stubFromRequest(request(), { responseStatus: 503 }).draft.response.status).toBe(503)
  })
})

describe('the draft as a whole', () => {
  it('names itself after the request, so it is findable straight away', () => {
    expect(stubFromRequest(request()).draft.name).toBe('POST /v1/orders')
  })

  it('carries an empty raw, so the vendor document is rendered rather than patched', () => {
    expect(stubFromRequest(request()).draft.raw).toEqual({})
  })
})
