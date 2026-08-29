import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import type { ServeEvent } from '@mock-knight/core'
import { openDatabase } from './database.js'
import { recordServeEvents } from './journal.js'

/**
 * `redactHeaders` — the promise the README makes, asserted against the stored row.
 *
 * The defect this replaces was invisible to every test in the suite: `redact()` scrubbed
 * `request.headers`, so anything inspecting the returned event agreed the feature worked, while
 * `raw` — the column the explainer and create-from-request read back — went to disk untouched.
 *
 * The **fixtures** are the other half of that lesson. Hand-trimmed ones (no `cookies`, no
 * `bodyAsBase64`, a `url` with the secret conveniently absent) let four further leaks pass a
 * correct assertion, so every payload below is one journal entry copied verbatim out of a live
 * server. The request behind each carried the same secret four ways at once:
 *
 *   curl -X POST 'http://<server>/probe?token=SECRET123' \
 *        -H 'X-Api-Key: SECRET123' -H 'Cookie: sid=COOKIESECRET; other=1' \
 *        -H 'content-type: application/json' -d '{"apiKey":"SECRET123"}'
 *
 * And the check reads every column, then decodes anything that looks like base64 and checks
 * that too — a stored row can pass a plaintext grep while holding the secret one decode away.
 */

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
  db.prepare(
    `INSERT INTO profile (id, name, adapter, base_url, origin, created_at)
     VALUES ('p1','local','wiremock','http://localhost:8080','runtime','2026-08-23T00:00:00Z')`,
  ).run()
})
afterEach(() => db.close())

const SECRET = 'SECRET123'
const COOKIE_SECRET = 'COOKIESECRET'
const REDACTED = ['x-api-key', 'cookie']

/** The canonical request the adapter builds from those payloads, with nothing left out. */
const event = (raw: ServeEvent['raw'], over: Partial<ServeEvent> = {}): ServeEvent => ({
  id: 'e1',
  at: '2026-08-23T10:00:00.000Z',
  timing: null,
  matched: true,
  matchedClientKey: null,
  matchedFingerprint: null,
  correlation: null,
  nearMisses: null,
  request: {
    method: 'POST',
    url: `/probe?token=${SECRET}`,
    absoluteUrl: `http://localhost:8080/probe?token=${SECRET}`,
    clientIp: '192.168.215.1',
    headers: {
      Host: 'localhost:8080',
      'X-Api-Key': SECRET,
      Cookie: `sid=${COOKIE_SECRET}; other=1`,
      'Content-Type': 'application/json',
    },
    queryParameters: { token: [SECRET] },
    cookies: { sid: COOKIE_SECRET, other: '1' },
    body: `{"apiKey":"${SECRET}"}`,
    bodyTruncated: false,
  },
  response: { status: 200, headers: {}, body: 'ok', bodyTruncated: false },
  raw,
  ...over,
})

/** Every column of every stored row, as text. Nothing about the shape of `raw` is assumed. */
function storedRows(): string {
  const rows = db.prepare(`SELECT * FROM serve_event WHERE profile_id = 'p1'`).all()
  return JSON.stringify(rows)
}

/** The same rows, with every base64-looking string decoded — leak 2 was invisible without it. */
function decodedRows(): string[] {
  const out: string[] = []
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (/^[A-Za-z0-9+/]{8,}={0,2}$/.test(value) && value.length % 4 === 0) {
        out.push(Buffer.from(value, 'base64').toString('utf8'))
      }
      // A column holds `raw` as text, so its own strings have to be reached too.
      if (value.startsWith('{') || value.startsWith('[')) {
        try {
          visit(JSON.parse(value))
        } catch {
          // not JSON, nothing nested to reach
        }
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (typeof value === 'object' && value !== null)
      for (const item of Object.values(value)) visit(item)
  }
  visit(db.prepare(`SELECT * FROM serve_event WHERE profile_id = 'p1'`).all())
  return out
}

function expectNothingLeaked(): void {
  const rows = storedRows()
  expect(rows).not.toContain(SECRET)
  expect(rows).not.toContain(COOKIE_SECRET)
  for (const decoded of decodedRows()) {
    expect(decoded).not.toContain(SECRET)
    expect(decoded).not.toContain(COOKIE_SECRET)
  }
}

const WIREMOCK_MATCHED: ServeEvent['raw'] = {
  id: 'a783cc61-884a-49d3-913b-e68c329269b8',
  request: {
    url: '/probe?token=SECRET123',
    absoluteUrl: 'http://localhost:18099/probe?token=SECRET123',
    method: 'POST',
    clientIp: '192.168.215.1',
    headers: {
      Host: 'localhost:18099',
      'User-Agent': 'curl/8.7.1',
      Accept: '*/*',
      'X-Api-Key': 'SECRET123',
      Cookie: 'sid=COOKIESECRET; other=1',
      'Content-Type': 'application/json',
      'Content-Length': '22',
    },
    cookies: {
      sid: 'COOKIESECRET',
      other: '1',
    },
    browserProxyRequest: false,
    loggedDate: 1788035856299,
    bodyAsBase64: 'eyJhcGlLZXkiOiJTRUNSRVQxMjMifQ==',
    body: '{"apiKey":"SECRET123"}',
    protocol: 'HTTP/1.1',
    scheme: 'http',
    host: 'localhost',
    port: 18099,
    loggedDateString: '2026-08-29T20:37:36.299Z',
    queryParams: {
      token: {
        key: 'token',
        values: ['SECRET123'],
      },
    },
    formParams: {},
  },
  responseDefinition: {
    status: 200,
    body: 'ok',
  },
  response: {
    status: 200,
    headers: {
      'Matched-Stub-Id': 'e6501cde-ae46-474d-9b64-345efce937df',
      'Matched-Stub-Name': 'redaction matched probe',
    },
    bodyAsBase64: 'b2s=',
    body: 'ok',
  },
  wasMatched: true,
  timing: {
    addedDelay: 0,
    processTime: 0,
    responseSendTime: 0,
    serveTime: 0,
    totalTime: 0,
  },
  subEvents: [],
  stubMapping: {
    id: 'e6501cde-ae46-474d-9b64-345efce937df',
    name: 'redaction matched probe',
    request: {
      urlPath: '/probe',
      method: 'POST',
    },
    response: {
      status: 200,
      body: 'ok',
    },
    uuid: 'e6501cde-ae46-474d-9b64-345efce937df',
  },
}

const WIREMOCK_UNMATCHED: ServeEvent['raw'] = {
  id: '079dfe1c-0250-4554-b2dd-d20c5045d75e',
  request: {
    url: '/miss?token=SECRET123',
    absoluteUrl: 'http://localhost:18099/miss?token=SECRET123',
    method: 'POST',
    clientIp: '192.168.215.1',
    headers: {
      Host: 'localhost:18099',
      'User-Agent': 'curl/8.7.1',
      Accept: '*/*',
      'X-Api-Key': 'SECRET123',
      Cookie: 'sid=COOKIESECRET; other=1',
      'Content-Type': 'application/json',
      'Content-Length': '22',
    },
    cookies: {
      sid: 'COOKIESECRET',
      other: '1',
    },
    browserProxyRequest: false,
    loggedDate: 1788035856310,
    bodyAsBase64: 'eyJhcGlLZXkiOiJTRUNSRVQxMjMifQ==',
    body: '{"apiKey":"SECRET123"}',
    protocol: 'HTTP/1.1',
    scheme: 'http',
    host: 'localhost',
    port: 18099,
    loggedDateString: '2026-08-29T20:37:36.31Z',
    queryParams: {
      token: {
        key: 'token',
        values: ['SECRET123'],
      },
    },
    formParams: {},
  },
  responseDefinition: {
    status: 404,
    fromConfiguredStub: false,
  },
  response: {
    status: 404,
    bodyAsBase64: '',
    body: '',
  },
  wasMatched: false,
  timing: {
    addedDelay: 0,
    processTime: 0,
    responseSendTime: 0,
    serveTime: 0,
    totalTime: 0,
  },
  subEvents: [
    {
      type: 'REQUEST_NOT_MATCHED',
      timeOffsetNanos: 505333,
      data: {
        status: 404,
        contentType: 'text/plain',
        report:
          '\n                                               Request was not matched\n                                               =======================\n\n-----------------------------------------------------------------------------------------------------------------------\n| Closest stub                                             | Request                                                  |\n-----------------------------------------------------------------------------------------------------------------------\n                                                           |\nredaction near-miss probe                                  |\n                                                           |\nPOST                                                       | POST\n[path] /miss                                               | /miss?token=SECRET123\n                                                           |\nX-Api-Key: expected-value                                  | X-Api-Key: SECRET123                                <<<<< Header does not match\n                                                           |\n                                                           |\n-----------------------------------------------------------------------------------------------------------------------\n',
      },
    },
  ],
  stubMapping: {
    id: 'a0f7484e-5d93-4a5b-a197-aa2a7de338d3',
    request: {
      method: 'ANY',
    },
    response: {
      status: 404,
      fromConfiguredStub: false,
    },
    uuid: 'a0f7484e-5d93-4a5b-a197-aa2a7de338d3',
  },
}

const MOCKSERVER: ServeEvent['raw'] = {
  body: {
    contentType: 'application/json',
    type: 'JSON',
    json: {
      apiKey: 'SECRET123',
    },
    rawBytes: 'eyJhcGlLZXkiOiJTRUNSRVQxMjMifQ==',
  },
  cookies: {
    other: '1',
    sid: 'COOKIESECRET',
  },
  headers: {
    Cookie: ['sid=COOKIESECRET; other=1'],
    Accept: ['*/*'],
    'User-Agent': ['curl/8.7.1'],
    Host: ['localhost:11080'],
    'content-type': ['application/json'],
    'X-Api-Key': ['SECRET123'],
    'Content-Length': ['22'],
  },
  keepAlive: true,
  method: 'POST',
  path: '/probe',
  queryStringParameters: {
    token: ['SECRET123'],
  },
  secure: false,
}

const MOCKOON: ServeEvent['raw'] = {
  request: {
    method: 'get',
    urlPath: '/redaction-probe',
    route: null,
    params: [],
    query: 'q=3',
    queryParams: {
      q: '3',
    },
    body: '',
    headers: [
      {
        key: 'accept',
        value: '*/*',
      },
      {
        key: 'host',
        value: 'localhost:13000',
      },
      {
        key: 'user-agent',
        value: 'curl/8.7.1',
      },
      {
        key: 'x-tenant-secret',
        value: 'SECRET123',
      },
    ],
  },
  response: {
    statusCode: 404,
    statusMessage: 'Not Found',
    headers: [
      {
        key: 'content-length',
        value: '154',
      },
      {
        key: 'content-security-policy',
        value: "default-src 'none'",
      },
      {
        key: 'content-type',
        value: 'text/html; charset=utf-8',
      },
      {
        key: 'x-content-type-options',
        value: 'nosniff',
      },
    ],
  },
  proxied: false,
  timestampMs: 1788034223914,
  uuid: 'c946554b-b8a1-4d94-9223-783fcdd4a866',
}

describe('recordServeEvents with redactHeaders', () => {
  it('keeps the secret out of a matched WireMock row', () => {
    recordServeEvents(db, 'p1', [event(WIREMOCK_MATCHED)], { redactHeaders: REDACTED })
    expectNothingLeaked()
  })

  it('keeps the secret out of an unmatched WireMock row, near-miss report included', () => {
    // The unmatched path — the one the match explainer exists for, and the one a developer
    // debugging a 404 hits most. WireMock quotes the header value in a free-text diff.
    recordServeEvents(db, 'p1', [event(WIREMOCK_UNMATCHED, { matched: false })], {
      redactHeaders: REDACTED,
    })
    const raw = db.prepare(`SELECT raw FROM serve_event`).get() as { raw: string }
    expect(raw.raw).toContain('Header does not match')
    expectNothingLeaked()
  })

  it('keeps the secret out of a MockServer row', () => {
    recordServeEvents(db, 'p1', [event(MOCKSERVER)], { redactHeaders: REDACTED })
    expectNothingLeaked()
  })

  it('keeps the secret out of a Mockoon row', () => {
    recordServeEvents(db, 'p1', [event(MOCKOON)], { redactHeaders: ['x-tenant-secret'] })
    expect(storedRows()).not.toContain(SECRET)
  })

  it('keeps the secret out of the url column, not only out of raw', () => {
    // `url` is what the Traffic list renders and what the ?path= filter searches with LIKE.
    recordServeEvents(db, 'p1', [event(WIREMOCK_MATCHED)], { redactHeaders: REDACTED })
    const row = db.prepare(`SELECT url, method FROM serve_event`).get() as {
      url: string
      method: string
    }
    expect(row.url).toBe('/probe?token=«redacted»')
    expect(row.method).toBe('POST')
  })

  it('keeps the secret out of the correlation column when the two settings overlap', () => {
    // `correlationHeader: "X-Api-Key"` with that header declared sensitive put the secret in a
    // dedicated indexed column exposed as an API filter.
    recordServeEvents(db, 'p1', [event(WIREMOCK_MATCHED, { correlation: SECRET })], {
      redactHeaders: REDACTED,
    })
    const row = db.prepare(`SELECT correlation FROM serve_event`).get() as {
      correlation: string
    }
    expect(row.correlation).toBe('«redacted»')
    expectNothingLeaked()
  })

  it('stores the payload whole when no header is configured', () => {
    recordServeEvents(db, 'p1', [event(WIREMOCK_MATCHED)], { redactHeaders: [] })
    // Not an endorsement of storing it — the point is that redaction is opt-in and does not
    // quietly rewrite a payload for someone who configured nothing.
    expect(storedRows()).toContain(SECRET)
  })
})
