import { describe, expect, it } from 'vitest'
import { REDACTION_MARKER, redactRawHeaders } from './redact-headers.js'
import type { JsonObject } from './types.js'

/**
 * Fixtures are captured vendor output, not invented shapes.
 *
 * Each was taken by sending `curl -H 'X-Api-Key: SECRET123' …` at a running backend and reading
 * the journal it recorded: WireMock 3.13.1 on `GET /__admin/requests`, MockServer 5.15.0 on
 * `PUT /mockserver/retrieve?type=REQUESTS`, Mockoon on `GET /mockoon-admin/logs`. The three
 * disagree about the *shape* of a header while agreeing on the key name, which is the whole
 * reason the walk keys on `headers` and then branches.
 */

const WIREMOCK_EVENT: JsonObject = {
  id: '7be58c39-180c-4094-a4ff-424b893b1d8d',
  request: {
    url: '/redaction-probe?q=1',
    absoluteUrl: 'http://localhost:18099/redaction-probe?q=1',
    method: 'GET',
    clientIp: '192.168.215.1',
    headers: {
      Host: 'localhost:18099',
      'User-Agent': 'curl/8.7.1',
      Accept: '*/*',
      'X-Api-Key': 'SECRET123',
      Authorization: 'Bearer TOKEN456',
    },
    cookies: {},
    body: '',
    queryParams: { q: { key: 'q', values: ['1'] } },
  },
  response: { status: 404, body: '' },
  wasMatched: false,
}

const MOCKSERVER_EVENT: JsonObject = {
  method: 'GET',
  path: '/redaction-probe',
  headers: {
    'content-length': ['0'],
    Accept: ['*/*'],
    'User-Agent': ['curl/8.7.1'],
    Host: ['localhost:11080'],
    'X-Api-Key': ['SECRET123'],
  },
  queryStringParameters: { q: ['1'] },
  keepAlive: true,
  secure: false,
}

const MOCKOON_EVENT: JsonObject = {
  request: {
    method: 'get',
    urlPath: '/redaction-probe',
    route: null,
    params: [],
    query: 'q=3',
    queryParams: { q: '3' },
    body: '',
    headers: [
      { key: 'accept', value: '*/*' },
      { key: 'host', value: 'localhost:13000' },
      { key: 'user-agent', value: 'curl/8.7.1' },
      { key: 'x-tenant-secret', value: 'SECRET123' },
    ],
  },
  response: {
    statusCode: 404,
    statusMessage: 'Not Found',
    headers: [{ key: 'content-length', value: '154' }],
  },
  proxied: false,
  timestampMs: 1788034223914,
  uuid: 'c946554b-b8a1-4d94-9223-783fcdd4a866',
}

describe('redactRawHeaders', () => {
  it("removes a secret from WireMock's header map", () => {
    const safe = redactRawHeaders(WIREMOCK_EVENT, ['x-api-key'])
    expect(JSON.stringify(safe)).not.toContain('SECRET123')
    const request = safe['request'] as JsonObject
    const headers = request['headers'] as JsonObject
    expect(headers['X-Api-Key']).toBe(REDACTION_MARKER)
    // Only the configured name goes. Everything else is what the explainer reads.
    expect(headers['Authorization']).toBe('Bearer TOKEN456')
    expect(headers['User-Agent']).toBe('curl/8.7.1')
    expect(request['url']).toBe('/redaction-probe?q=1')
    expect(request['queryParams']).toEqual({ q: { key: 'q', values: ['1'] } })
  })

  it("removes a secret from MockServer's object-of-arrays, keeping it an array", () => {
    const safe = redactRawHeaders(MOCKSERVER_EVENT, ['X-Api-Key'])
    expect(JSON.stringify(safe)).not.toContain('SECRET123')
    const headers = safe['headers'] as JsonObject
    expect(headers['X-Api-Key']).toEqual([REDACTION_MARKER])
    expect(headers['Accept']).toEqual(['*/*'])
    expect(safe['queryStringParameters']).toEqual({ q: ['1'] })
  })

  it("removes a secret from Mockoon's list of entries, keeping the name", () => {
    const safe = redactRawHeaders(MOCKOON_EVENT, ['X-Tenant-Secret'])
    expect(JSON.stringify(safe)).not.toContain('SECRET123')
    const request = safe['request'] as JsonObject
    expect(request['headers']).toEqual([
      { key: 'accept', value: '*/*' },
      { key: 'host', value: 'localhost:13000' },
      { key: 'user-agent', value: 'curl/8.7.1' },
      { key: 'x-tenant-secret', value: REDACTION_MARKER },
    ])
    expect(safe['uuid']).toBe('c946554b-b8a1-4d94-9223-783fcdd4a866')
  })

  it('matches the header name case-insensitively, in both directions', () => {
    const safe = redactRawHeaders({ headers: { 'X-API-KEY': 'SECRET123' } }, ['x-api-KEY'])
    expect(safe).toEqual({ headers: { 'X-API-KEY': REDACTION_MARKER } })
  })

  it("redacts WireMock's other header encoding, where the value is an object", () => {
    const safe = redactRawHeaders({ headers: { 'X-Api-Key': { values: ['SECRET123'] } } }, [
      'x-api-key',
    ])
    expect(JSON.stringify(safe)).not.toContain('SECRET123')
  })

  it('redacts a header wherever it is nested, not only at a known path', () => {
    const safe = redactRawHeaders(
      { stubMapping: { request: { headers: { 'X-Api-Key': { equalTo: 'SECRET123' } } } } },
      ['x-api-key'],
    )
    expect(JSON.stringify(safe)).not.toContain('SECRET123')
  })

  it('redacts a list entry it cannot read a name from, rather than passing it through', () => {
    // Over-redaction is a marker where a header used to be; under-redaction is the defect.
    const safe = redactRawHeaders({ headers: ['X-Api-Key: SECRET123', 42] }, ['x-api-key'])
    expect(safe).toEqual({ headers: [REDACTION_MARKER, REDACTION_MARKER] })
  })

  it('redacts a headers value that is neither a map nor a list', () => {
    const safe = redactRawHeaders({ headers: 'X-Api-Key: SECRET123' }, ['x-api-key'])
    expect(safe).toEqual({ headers: REDACTION_MARKER })
  })

  it('keeps a header literally named __proto__ as a property', () => {
    // Built with JSON.parse, the way `raw` reaches us: in an object literal `__proto__:` sets
    // the prototype instead of creating the key, so a literal here would not test anything.
    const raw = JSON.parse('{"headers":{"__proto__":"SECRET123","Accept":"*/*"}}') as JsonObject
    const safe = redactRawHeaders(raw, ['__proto__'])
    const headers = safe['headers'] as JsonObject
    expect(Object.keys(headers)).toEqual(['__proto__', 'Accept'])
    expect(Object.getOwnPropertyDescriptor(headers, '__proto__')?.value).toBe(REDACTION_MARKER)
    expect(Object.getPrototypeOf(headers)).toBe(Object.prototype)
    expect(JSON.stringify(safe)).not.toContain('SECRET123')
  })

  it('survives a payload whose own key is __proto__ outside a header container', () => {
    const raw = JSON.parse('{"body":{"__proto__":{"polluted":true}}}') as JsonObject
    const safe = redactRawHeaders(raw, ['x-api-key'])
    const body = safe['body'] as JsonObject
    expect(Object.getPrototypeOf(body)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(body, '__proto__')?.value).toEqual({ polluted: true })
  })

  it('never mutates its input', () => {
    const before = JSON.stringify(WIREMOCK_EVENT)
    redactRawHeaders(WIREMOCK_EVENT, ['x-api-key'])
    expect(JSON.stringify(WIREMOCK_EVENT)).toBe(before)
  })

  it('leaves the payload untouched when nothing is configured', () => {
    // The fail-safe rules must stay dormant here, or an unrecognised shape would be scrubbed for
    // someone who never asked for redaction.
    expect(redactRawHeaders({ headers: 'a blob' }, [])).toEqual({ headers: 'a blob' })
  })
})

/**
 * WireMock's near-miss diff, captured from 3.13.1 rather than written by hand — its exact
 * formatting is the thing pass two has to survive. A stub requiring `X-Api-Key: expected-value`
 * and a request carrying something else puts the request's value in the right-hand column, in
 * free text, under no key named `headers` at all.
 */
const WIREMOCK_NEAR_MISS: JsonObject = {
  id: '0c0fe5f2-84f4-4a25-9db3-2d4b0aa20a94',
  request: {
    url: '/near-miss-probe',
    method: 'GET',
    headers: { Host: 'localhost:18099', 'X-Api-Key': 'SECRET-IN-REPORT' },
    body: '',
  },
  wasMatched: false,
  subEvents: [
    {
      type: 'REQUEST_NOT_MATCHED',
      timeOffsetNanos: 3172333,
      data: {
        status: 404,
        contentType: 'text/plain',
        report: `
                                               Request was not matched
                                               =======================

-----------------------------------------------------------------------------------------------------------------------
| Closest stub                                             | Request                                                  |
-----------------------------------------------------------------------------------------------------------------------
                                                           |
redaction near-miss probe                                  |
                                                           |
GET                                                        | GET
[path] /near-miss-probe                                    | /near-miss-probe
                                                           |
X-Api-Key: expected-value                                  | X-Api-Key: SECRET-IN-REPORT                         <<<<< Header does not match
                                                           |
                                                           |
-----------------------------------------------------------------------------------------------------------------------
`,
      },
    },
  ],
}

describe('redactRawHeaders, second pass', () => {
  it("scrubs the value out of WireMock's near-miss report, where no key is named headers", () => {
    const safe = redactRawHeaders(WIREMOCK_NEAR_MISS, ['x-api-key'])
    expect(JSON.stringify(safe)).not.toContain('SECRET-IN-REPORT')

    const subEvents = safe['subEvents'] as JsonObject[]
    const report = (subEvents[0]!['data'] as JsonObject)['report']
    expect(report).toContain(REDACTION_MARKER)
    // The stub's own expectation is not the request's secret and stays legible, which is the
    // half of the report that explains the mismatch.
    expect(report).toContain('X-Api-Key: expected-value')
    expect(report).toContain('Header does not match')
  })

  it('scrubs the value wherever it appears, not only where a header key led us to it', () => {
    const safe = redactRawHeaders(
      {
        headers: { 'X-Api-Key': 'hunter2' },
        note: 'the token hunter2 was rejected',
        trail: ['saw hunter2 twice: hunter2'],
      },
      ['x-api-key'],
    )
    expect(safe['note']).toBe(`the token ${REDACTION_MARKER} was rejected`)
    expect(safe['trail']).toEqual([`saw ${REDACTION_MARKER} twice: ${REDACTION_MARKER}`])
  })

  it('accepts mangling ordinary text — a declared value is scrubbed wherever it occurs', () => {
    // Deliberate. No minimum-length guard: a guard is a hole, and a hole is what this closes.
    const safe = redactRawHeaders({ headers: { 'X-Api-Key': 'a' }, body: 'a cat sat' }, [
      'x-api-key',
    ])
    expect(safe['body']).toBe(`${REDACTION_MARKER} c${REDACTION_MARKER}t s${REDACTION_MARKER}t`)
  })

  it('collects every string inside a redacted value, not only a bare one', () => {
    const safe = redactRawHeaders(
      { headers: { 'X-Api-Key': { values: ['one', 'two'] } }, note: 'one and two' },
      ['x-api-key'],
    )
    expect(safe['note']).toBe(`${REDACTION_MARKER} and ${REDACTION_MARKER}`)
  })

  it('does not propagate a value from a container it could not parse', () => {
    // Pass one scrubs the unreadable entry in place, but nothing in it was shown to be the
    // configured header, so scrubbing it across the whole payload would be gratuitous.
    const safe = redactRawHeaders({ headers: ['*/*'], body: 'accepts */*' }, ['x-api-key'])
    expect(safe['headers']).toEqual([REDACTION_MARKER])
    expect(safe['body']).toBe('accepts */*')
  })

  it('never substitutes an empty or whitespace-only value', () => {
    const safe = redactRawHeaders({ headers: { 'X-Api-Key': '', 'X-Trace': '  ' }, body: 'ab' }, [
      'x-api-key',
      'x-trace',
    ])
    expect(safe['body']).toBe('ab')
  })

  it('does not re-substitute the marker pass one just wrote', () => {
    // A payload that already holds the marker must not have it treated as a secret.
    const safe = redactRawHeaders(
      { headers: { 'X-Api-Key': REDACTION_MARKER }, body: `left ${REDACTION_MARKER} alone` },
      ['x-api-key'],
    )
    expect(safe['body']).toBe(`left ${REDACTION_MARKER} alone`)
  })

  it('replaces the longer value first when one contains another', () => {
    const safe = redactRawHeaders(
      { headers: { 'X-Api-Key': 'abc', 'X-Other': 'abcdef' }, body: 'abcdef' },
      ['x-api-key', 'x-other'],
    )
    expect(safe['body']).toBe(REDACTION_MARKER)
  })
})
