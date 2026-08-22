import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseQuery, resolveCapabilities } from '@mock-knight/core'
import type { CapabilityBit, Mock } from '@mock-knight/core'
import { toCanonical } from '@mock-knight/adapter-wiremock'
import type { Database as Db } from 'better-sqlite3'
import { openDatabase } from './database.js'
import { BODY_INDEX_CAP_BYTES, mirrorStatus, replaceCorpus } from './mirror.js'
import { getMock, searchCorpus } from './search.js'

const ALL_CAPABILITIES = resolveCapabilities({
  backend: ['journal.read', 'mock.enableDisable', 'mock.priority'] as CapabilityBit[],
  environment: [],
})

function plan(query: string) {
  return parseQuery(query, { capabilities: ALL_CAPABILITIES })
}

function stub(over: Record<string, unknown>): Mock {
  return toCanonical({
    id: String(over['id'] ?? Math.random()),
    request: { method: 'GET', urlPath: '/v1/things', ...(over['request'] as object) },
    response: { status: 200, ...(over['response'] as object) },
    ...(over['top'] as object),
  })
}

let db: Db
const FETCHED_AT = '2026-08-22T10:00:00.000Z'

beforeEach(() => {
  db = openDatabase(':memory:')
  db.prepare(
    `INSERT INTO profile (id, name, adapter, base_url, origin, created_at)
     VALUES ('p1','local','wiremock','http://localhost:8080','runtime','2026-08-22T00:00:00Z')`,
  ).run()
})

afterEach(() => db.close())

function seed(mocks: Mock[]): void {
  replaceCorpus(db, 'p1', mocks, FETCHED_AT)
}

function search(query: string, limit = 50, offset = 0) {
  return searchCorpus(db, { profileId: 'p1', plan: plan(query), limit, offset })
}

const CORPUS = (): Mock[] => [
  stub({
    id: 'a',
    request: { method: 'POST', urlPath: '/v1/orders' },
    response: { status: 500, jsonBody: { error: 'insufficient funds' } },
    top: {
      name: 'orders create 500',
      priority: 3,
      scenarioName: 'checkout',
      metadata: { 'mock-knight': { folder: ['orders'], tags: ['legacy', 'slow'] } },
    },
  }),
  stub({
    id: 'b',
    request: { method: 'GET', urlPath: '/v1/orders/{id}' },
    response: { status: 200, body: 'ok' },
    top: {
      name: 'orders read',
      metadata: { 'mock-knight': { folder: ['orders'], tags: ['legacy'] } },
    },
  }),
  stub({
    id: 'c',
    request: { method: 'GET', urlPath: '/v1/customers' },
    response: { status: 404, body: 'not found', fixedDelayMilliseconds: 50 },
    top: {
      name: 'customers list',
      metadata: { 'mock-knight': { folder: ['customers'], tags: [] } },
    },
  }),
]

describe('replaceCorpus', () => {
  it('writes every stub and reports the count', () => {
    const stats = replaceCorpus(db, 'p1', CORPUS(), FETCHED_AT)
    expect(stats.inserted).toBe(3)
    expect(search('').total).toBe(3)
  })

  it('is a replace, not a merge — a stub deleted upstream disappears here too', () => {
    seed(CORPUS())
    replaceCorpus(db, 'p1', [CORPUS()[0]!], FETCHED_AT)
    expect(search('').total).toBe(1)
  })

  it('flattens the derived columns the list renders from', () => {
    seed(CORPUS())
    const row = search('method:POST').items[0]!
    expect(row).toMatchObject({
      clientKey: 'a',
      method: 'POST',
      url: { kind: 'urlPath', value: '/v1/orders' },
      status: 500,
      priority: 3,
      scenario: 'checkout',
      folder: ['orders'],
      folderSource: 'metadata',
      tags: ['legacy', 'slow'],
      enabled: null,
      hasDelay: false,
    })
  })

  it('caps the indexed body and records that it did', () => {
    const huge = 'x'.repeat(BODY_INDEX_CAP_BYTES + 1000)
    seed([stub({ id: 'big', response: { status: 200, body: huge } })])
    const result = search('')
    expect(result.items[0]!.bodyTruncated).toBe(true)
    expect(result.bodyIndexTruncated).toBe(true)
  })

  it('leaves a body under the cap untruncated', () => {
    seed(CORPUS())
    expect(search('').bodyIndexTruncated).toBe(false)
  })
})

describe('mirrorStatus', () => {
  it('reports the age of the mirror so the UI can mark it stale', () => {
    seed(CORPUS())
    const status = mirrorStatus(db, 'p1', new Date('2026-08-22T10:00:30.000Z'))
    expect(status).toMatchObject({ count: 3, fetchedAt: FETCHED_AT, ageSeconds: 30 })
  })

  it('says so plainly when a profile has never been fetched', () => {
    expect(mirrorStatus(db, 'p1', new Date())).toMatchObject({
      count: 0,
      fetchedAt: null,
      ageSeconds: null,
    })
  })
})

describe('searchCorpus — structured filters', () => {
  beforeEach(() => seed(CORPUS()))

  it('filters by method', () => {
    expect(
      search('method:GET')
        .items.map((i) => i.clientKey)
        .sort(),
    ).toEqual(['b', 'c'])
  })

  it('ORs two values of the same field', () => {
    expect(search('method:GET method:POST').total).toBe(3)
  })

  it('ANDs across fields', () => {
    expect(search('method:GET status:404').items.map((i) => i.clientKey)).toEqual(['c'])
  })

  it('filters by status class', () => {
    expect(search('status:5xx').items.map((i) => i.clientKey)).toEqual(['a'])
  })

  it('filters by scenario, folder, and tag', () => {
    expect(search('scenario:checkout').total).toBe(1)
    expect(search('folder:orders').total).toBe(2)
    expect(search('tag:legacy').total).toBe(2)
    expect(search('tag:slow').total).toBe(1)
  })

  it('compares priority', () => {
    expect(search('priority:<5').total).toBe(1)
    expect(search('priority:>5').total).toBe(0)
  })

  it('matches a url substring without a wildcard', () => {
    expect(search('url:/v1/orders').total).toBe(2)
  })

  it('matches a url glob', () => {
    expect(search('url:/v1/customers*').total).toBe(1)
  })

  it('treats a percent sign in a url filter as a literal, not a wildcard', () => {
    seed([...CORPUS(), stub({ id: 'pct', request: { method: 'GET', urlPath: '/v1/100%25' } })])
    expect(search('url:100%').total).toBe(1)
  })
})

describe('searchCorpus — text search', () => {
  beforeEach(() => seed(CORPUS()))

  it('finds a stub by a substring of its path, which unicode61 could not do', () => {
    const result = search('custom')
    expect(result.items.map((i) => i.clientKey)).toEqual(['c'])
    expect(result.textStrategy).toBe('fts')
  })

  it('finds a stub by its response body', () => {
    expect(search('insufficient').items.map((i) => i.clientKey)).toEqual(['a'])
  })

  it('scopes body: to the body, so it does not match a path', () => {
    expect(search('body:insufficient').total).toBe(1)
    expect(search('body:customers').total).toBe(0)
  })

  it('ANDs several free-text terms', () => {
    expect(search('orders insufficient').items.map((i) => i.clientKey)).toEqual(['a'])
  })

  it('falls back to LIKE for a term the trigram index cannot answer, and says so', () => {
    const result = search('v1')
    // Under three characters the FTS index returns nothing at all; the fallback is what stops
    // this being a silently empty result.
    expect(result.total).toBe(3)
    expect(result.textStrategy).toBe('like')
  })

  it('reports a mixed strategy when one term is short and another is not', () => {
    const result = search('v1 customers')
    expect(result.items.map((i) => i.clientKey)).toEqual(['c'])
    expect(result.textStrategy).toBe('mixed')
  })

  it('reports no text strategy when the query is only structured filters', () => {
    expect(search('method:GET').textStrategy).toBe('none')
  })

  it('combines free text with structured filters', () => {
    expect(search('orders method:GET').items.map((i) => i.clientKey)).toEqual(['b'])
  })
})

describe('searchCorpus — facets', () => {
  beforeEach(() => seed(CORPUS()))

  it('counts each facet group over the filtered set', () => {
    const { facets } = search('')
    expect(facets.method).toEqual([
      { value: 'GET', count: 2 },
      { value: 'POST', count: 1 },
    ])
    expect(facets.statusClass).toEqual(
      expect.arrayContaining([
        { value: '2xx', count: 1 },
        { value: '4xx', count: 1 },
        { value: '5xx', count: 1 },
      ]),
    )
    expect(facets.tag).toEqual([
      { value: 'legacy', count: 2 },
      { value: 'slow', count: 1 },
    ])
    expect(facets.hasDelay).toBe(1)
  })

  it('excludes a group’s own filter from its counts, so multi-select stays usable', () => {
    const { facets } = search('method:GET')
    // Having ticked GET, POST must still show its real count — otherwise you could never tick
    // a second method.
    expect(facets.method).toEqual([
      { value: 'GET', count: 2 },
      { value: 'POST', count: 1 },
    ])
    // Other groups *are* narrowed by the method filter.
    expect(facets.statusClass).toEqual(
      expect.arrayContaining([
        { value: '2xx', count: 1 },
        { value: '4xx', count: 1 },
      ]),
    )
    expect(facets.statusClass.find((b) => b.value === '5xx')).toBeUndefined()
  })
})

describe('searchCorpus — paging', () => {
  beforeEach(() => seed(CORPUS()))

  it('returns the total independently of the page size', () => {
    const page = search('', 2, 0)
    expect(page.items).toHaveLength(2)
    expect(page.total).toBe(3)
  })

  it('orders stably so a second page does not repeat the first', () => {
    const first = search('', 2, 0).items.map((i) => i.clientKey)
    const second = search('', 2, 2).items.map((i) => i.clientKey)
    expect(new Set([...first, ...second]).size).toBe(3)
  })
})

describe('getMock', () => {
  beforeEach(() => seed(CORPUS()))

  it('returns the verbatim raw payload, which the list never carries', () => {
    const mock = getMock(db, 'p1', 'a')
    expect(mock?.raw).toMatchObject({ request: { method: 'POST' }, response: { status: 500 } })
  })

  it('returns null for a key this profile does not have', () => {
    expect(getMock(db, 'p1', 'nope')).toBeNull()
  })
})
