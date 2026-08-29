import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import type { ServeEvent } from '@mock-knight/core'
import { openDatabase } from './database.js'
import { recordServeEvents } from './journal.js'

/**
 * `redactHeaders` — the promise the README makes, asserted against the row rather than the
 * object.
 *
 * The defect this replaces was invisible to every test in the suite: `redact()` did scrub
 * `request.headers`, so anything inspecting the returned event agreed the feature worked, while
 * `raw` — the column the explainer and create-from-request read back — went to disk untouched.
 * The only assertion that could have caught it is this one: read every column of the stored row
 * and look for the secret in the serialised text.
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

const event = (raw: ServeEvent['raw']): ServeEvent => ({
  id: 'e1',
  at: '2026-08-23T10:00:00.000Z',
  timing: null,
  matched: false,
  matchedClientKey: null,
  matchedFingerprint: null,
  correlation: null,
  nearMisses: null,
  request: {
    method: 'GET',
    url: '/redaction-probe?q=1',
    absoluteUrl: 'http://localhost:8080/redaction-probe?q=1',
    clientIp: null,
    headers: { 'X-Api-Key': SECRET, Accept: '*/*' },
    queryParameters: {},
    cookies: {},
    body: null,
    bodyTruncated: false,
  },
  response: { status: 404, headers: {}, body: null, bodyTruncated: false },
  raw,
})

/** Every column of the stored row, as text. Nothing about the shape of `raw` is assumed. */
function storedRow(): string {
  const row = db.prepare(`SELECT * FROM serve_event WHERE profile_id = 'p1'`).get() as Record<
    string,
    unknown
  >
  return JSON.stringify(row)
}

describe('recordServeEvents with redactHeaders', () => {
  it("keeps the secret out of WireMock's stored row", () => {
    recordServeEvents(
      db,
      'p1',
      [
        event({
          request: {
            url: '/redaction-probe?q=1',
            method: 'GET',
            headers: { Host: 'localhost:18099', 'X-Api-Key': SECRET },
            body: '',
          },
          wasMatched: false,
        }),
      ],
      { redactHeaders: ['x-api-key'] },
    )
    expect(storedRow()).not.toContain(SECRET)
  })

  it("keeps the secret out of MockServer's stored row", () => {
    recordServeEvents(
      db,
      'p1',
      [
        event({
          method: 'GET',
          path: '/redaction-probe',
          headers: { Accept: ['*/*'], 'X-Api-Key': [SECRET] },
          queryStringParameters: { q: ['1'] },
        }),
      ],
      { redactHeaders: ['X-API-KEY'] },
    )
    expect(storedRow()).not.toContain(SECRET)
  })

  it("keeps the secret out of Mockoon's stored row", () => {
    recordServeEvents(
      db,
      'p1',
      [
        event({
          request: {
            method: 'get',
            urlPath: '/redaction-probe',
            headers: [
              { key: 'accept', value: '*/*' },
              { key: 'x-api-key', value: SECRET },
            ],
          },
          timestampMs: 1788034223914,
        }),
      ],
      { redactHeaders: ['X-Api-Key'] },
    )
    expect(storedRow()).not.toContain(SECRET)
  })

  it("keeps the secret out of WireMock's near-miss report, which quotes it in free text", () => {
    // The unmatched path — the one the match explainer exists for, and the one a developer
    // debugging a 404 hits most. The value is in a prose diff under no key named `headers`.
    recordServeEvents(
      db,
      'p1',
      [
        event({
          request: {
            url: '/near-miss-probe',
            method: 'GET',
            headers: { Host: 'localhost:18099', 'X-Api-Key': SECRET },
          },
          wasMatched: false,
          subEvents: [
            {
              type: 'REQUEST_NOT_MATCHED',
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
X-Api-Key: expected-value                                  | X-Api-Key: SECRET123                         <<<<< Header does not match
                                                           |
                                                           |
-----------------------------------------------------------------------------------------------------------------------
`,
              },
            },
          ],
        }),
      ],
      { redactHeaders: ['x-api-key'] },
    )
    expect(storedRow()).not.toContain(SECRET)
  })

  it('stores the payload whole when no header is configured', () => {
    recordServeEvents(db, 'p1', [event({ request: { headers: { 'X-Api-Key': SECRET } } })], {
      redactHeaders: [],
    })
    // Not an endorsement of storing it — the point is that redaction is opt-in and does not
    // quietly rewrite a payload for someone who configured nothing.
    expect(storedRow()).toContain(SECRET)
  })
})
