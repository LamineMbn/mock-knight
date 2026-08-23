import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import { openDatabase } from './database.js'
import { listServeEvents, recordServeEvents } from './journal.js'
import type { ServeEvent } from '@mock-knight/core'

/**
 * Journal filters — FR-TRAF-2.
 *
 * The Traffic screen could only split matched from unmatched, which on a busy server is not a
 * filter so much as a halving. These are the predicates behind method, path, status, stub and
 * time.
 */

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
  db.prepare(
    `INSERT INTO profile (id, name, adapter, base_url, origin, created_at)
     VALUES ('p1','local','wiremock','http://localhost:8080','runtime','2026-08-23T00:00:00Z')`,
  ).run()
  recordServeEvents(db, 'p1', EVENTS, { redactHeaders: [] })
})
afterEach(() => db.close())

const event = (over: Partial<ServeEvent> & { id: string }): ServeEvent =>
  ({
    at: '2026-08-23T10:00:00.000Z',
    matched: true,
    matchedClientKey: null,
    correlation: null,
    durationMs: 1,
    request: {
      method: 'GET',
      url: '/v1/orders',
      absoluteUrl: 'http://localhost:8080/v1/orders',
      headers: {},
      queryParameters: {},
      cookies: {},
      body: null,
    },
    response: { status: 200, headers: {}, body: null, bodyTruncated: false },
    raw: {},
    ...over,
  }) as ServeEvent

const EVENTS: ServeEvent[] = [
  event({ id: 'a', at: '2026-08-23T10:00:00.000Z' }),
  event({
    id: 'b',
    at: '2026-08-23T11:00:00.000Z',
    request: { ...event({ id: 'x' }).request, method: 'POST', url: '/v1/orders' },
    response: { status: 500, headers: {}, body: null, bodyTruncated: false },
    matched: false,
  }),
  event({
    id: 'c',
    at: '2026-08-23T12:00:00.000Z',
    request: { ...event({ id: 'x' }).request, method: 'GET', url: '/v1/customers_100%' },
    response: { status: 404, headers: {}, body: null, bodyTruncated: false },
    matchedClientKey: 'stub-42',
  }),
]

const list = (options: Parameters<typeof listServeEvents>[2]) =>
  listServeEvents(db, 'p1', options).items.map((item) => item.upstreamId)

describe('journal filters', () => {
  it('filters by method, exactly and case-insensitively', () => {
    expect(list({ method: 'POST', limit: 50, offset: 0 })).toEqual(['b'])
    expect(list({ method: 'post', limit: 50, offset: 0 })).toEqual(['b'])
  })

  it('filters by a substring of the path', () => {
    expect(list({ path: 'orders', limit: 50, offset: 0 }).sort()).toEqual(['a', 'b'])
  })

  it('treats LIKE wildcards in a path as literal characters', () => {
    // `_` and `%` occur in real URLs. Unescaped they are wildcards, so searching for one path
    // would quietly return others — the kind of wrong answer nobody checks.
    expect(list({ path: 'customers_100%', limit: 50, offset: 0 })).toEqual(['c'])
    expect(list({ path: 'customers_100x', limit: 50, offset: 0 })).toEqual([])
    // A bare `_` must not behave as "any character".
    expect(list({ path: 'v1_orders', limit: 50, offset: 0 })).toEqual([])
  })

  it('filters by exact status and by class', () => {
    expect(list({ status: 500, limit: 50, offset: 0 })).toEqual(['b'])
    expect(list({ statusClass: 4, limit: 50, offset: 0 })).toEqual(['c'])
    expect(list({ statusClass: 2, limit: 50, offset: 0 })).toEqual(['a'])
  })

  it('filters by the stub that answered', () => {
    expect(list({ clientKey: 'stub-42', limit: 50, offset: 0 })).toEqual(['c'])
  })

  it('filters by time, inclusively at both ends', () => {
    expect(list({ since: '2026-08-23T11:00:00.000Z', limit: 50, offset: 0 })).toEqual(['c', 'b'])
    expect(list({ until: '2026-08-23T11:00:00.000Z', limit: 50, offset: 0 })).toEqual(['b', 'a'])
  })

  it('combines filters with AND', () => {
    expect(list({ path: 'orders', matched: false, limit: 50, offset: 0 })).toEqual(['b'])
    expect(list({ path: 'orders', method: 'GET', limit: 50, offset: 0 })).toEqual(['a'])
  })

  it('reports the total for the filtered set, not the whole journal', () => {
    // The footer count has to describe what is on screen, or paging lies about how much is left.
    expect(listServeEvents(db, 'p1', { path: 'orders', limit: 50, offset: 0 }).total).toBe(2)
    expect(listServeEvents(db, 'p1', { limit: 50, offset: 0 }).total).toBe(3)
  })
})
