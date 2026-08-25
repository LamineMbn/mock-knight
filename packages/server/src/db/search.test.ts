import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseQuery, resolveCapabilities, WIREMOCK_PRIORITY } from '@mock-knight/core'
import type { CapabilityBit, Mock, PriorityModel } from '@mock-knight/core'
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
  const parsed = plan(query)
  return {
    ...searchCorpus(db, {
      profileId: 'p1',
      plan: parsed,
      limit,
      offset,
      priority: WIREMOCK_PRIORITY,
    }),
    plan: parsed,
  }
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
    const mock = getMock(db, 'p1', 'a', WIREMOCK_PRIORITY)
    expect(mock?.raw).toMatchObject({ request: { method: 'POST' }, response: { status: 500 } })
  })

  it('returns null for a key this profile does not have', () => {
    expect(getMock(db, 'p1', 'nope', WIREMOCK_PRIORITY)).toBeNull()
  })
})

describe('header matchers — the discriminator on a header-selected corpus', () => {
  const HEADER_CORPUS = (): Mock[] => [
    stub({
      id: 'h1',
      request: {
        method: 'POST',
        urlPath: '/accountlogin/v3',
        headers: { 'X-Mock': { equalTo: 'anais-post-accountlogin-unparsable' } },
      },
      response: { status: 200 },
    }),
    stub({
      id: 'h2',
      request: {
        method: 'POST',
        urlPath: '/accountlogin/v3',
        headers: { 'X-Mock': { equalTo: 'anais-post-accountlogin-wrong-access-code' } },
      },
      response: { status: 200 },
    }),
    stub({
      id: 'h3',
      request: {
        method: 'POST',
        urlPath: '/accountlogin/v3',
        headers: { 'X-Tenant': { matches: 'acme.*' }, Accept: { contains: 'json' } },
      },
      response: { status: 200 },
    }),
    stub({ id: 'h4', request: { method: 'GET', urlPath: '/health' }, response: { status: 200 } }),
  ]

  beforeEach(() => seed(HEADER_CORPUS()))

  it('stores each matcher with its name, operator, and value', () => {
    const row = search('header:X-Mock=unparsable').items[0]!
    expect(row.headers).toEqual([
      { name: 'X-Mock', operator: 'equalTo', value: 'anais-post-accountlogin-unparsable' },
    ])
  })

  it('keeps every matcher when a stub has several', () => {
    const row = search('header:X-Tenant').items[0]!
    expect(row.headers).toEqual([
      { name: 'Accept', operator: 'contains', value: 'json' },
      { name: 'X-Tenant', operator: 'matches', value: 'acme.*' },
    ])
  })

  it('reports an empty list, not null, for a stub that matches on no header', () => {
    expect(search('url:/health').items[0]!.headers).toEqual([])
  })

  it('finds stubs that match on a header at all', () => {
    expect(search('header:X-Mock').total).toBe(2)
    expect(search('header:X-Tenant').total).toBe(1)
    expect(search('header:X-Absent').total).toBe(0)
  })

  it('matches the header name case-insensitively, as HTTP does', () => {
    expect(search('header:x-mock').total).toBe(2)
    expect(search('header:X-MOCK').total).toBe(2)
  })

  it('separates two stubs that differ only by header value', () => {
    // The whole point: these two share method, path and status, so nothing else can tell them
    // apart.
    expect(search('header:X-Mock=unparsable').items.map((i) => i.clientKey)).toEqual(['h1'])
    expect(search('header:X-Mock=wrong-access').items.map((i) => i.clientKey)).toEqual(['h2'])
  })

  it('supports a glob in the header value', () => {
    expect(search('header:X-Mock=anais-*-unparsable').items.map((i) => i.clientKey)).toEqual(['h1'])
  })

  it('does not let a value match against a different header of the same stub', () => {
    // `Accept: json` and `X-Tenant: acme.*` live on one stub; asking for X-Tenant=json must not
    // match by leaking across matchers.
    expect(search('header:X-Tenant=json').total).toBe(0)
  })

  it('finds a header value through plain free-text search too', () => {
    const result = search('wrong-access-code')
    expect(result.items.map((i) => i.clientKey)).toEqual(['h2'])
    expect(result.textStrategy).toBe('fts')
  })

  it('does not let the stored operator name pollute free-text search', () => {
    // `equalTo` is structure, not content: it must not be in the text index.
    expect(search('equalTo').total).toBe(0)
  })

  it('facets header names so the sidebar can offer the discriminator', () => {
    expect(search('').facets.header).toEqual([
      { value: 'X-Mock', count: 2 },
      { value: 'Accept', count: 1 },
      { value: 'X-Tenant', count: 1 },
    ])
  })

  it('needs no capability — header matchers come from the mirror', () => {
    expect(search('header:X-Mock').plan?.rejected ?? []).toEqual([])
  })
})

describe('unused stubs — a bounded truth, and which boundary applies', () => {
  beforeEach(() => {
    seed(CORPUS())
    db.prepare(
      `INSERT INTO serve_event (profile_id, upstream_id, at, matched, matched_key, raw)
       VALUES ('p1','u1','2026-08-22T09:14:00Z',1,'a','{}')`,
    ).run()
  })

  it('derives unused stubs from the mirrored journal when that is all we have', () => {
    expect(
      search('unused:true')
        .items.map((i) => i.clientKey)
        .sort(),
    ).toEqual(['b', 'c'])
    expect(search('unused:false').items.map((i) => i.clientKey)).toEqual(['a'])
  })

  it('prefers the server’s answer over our own when it is supplied', () => {
    // The server says only `c` is unused. Our journal would have said `b` and `c`; the server
    // knows about traffic from before we started polling, so its answer wins.
    const result = searchCorpus(db, {
      profileId: 'p1',
      plan: plan('unused:true'),
      limit: 50,
      offset: 0,
      unusedKeys: ['c'],
      priority: WIREMOCK_PRIORITY,
    })
    expect(result.items.map((i) => i.clientKey)).toEqual(['c'])
  })

  it('inverts correctly against the server’s answer', () => {
    const result = searchCorpus(db, {
      profileId: 'p1',
      plan: plan('unused:false'),
      limit: 50,
      offset: 0,
      unusedKeys: ['c'],
      priority: WIREMOCK_PRIORITY,
    })
    expect(result.items.map((i) => i.clientKey).sort()).toEqual(['a', 'b'])
  })

  it('handles the server reporting nothing unused without matching everything', () => {
    // An empty IN () list is a SQL syntax error, and the naive fallback of dropping the clause
    // would turn "nothing is unused" into "everything matches".
    const result = searchCorpus(db, {
      profileId: 'p1',
      plan: plan('unused:true'),
      limit: 50,
      offset: 0,
      unusedKeys: [],
      priority: WIREMOCK_PRIORITY,
    })
    expect(result.total).toBe(0)
  })
})

describe('priority standing (FR-FIND-7)', () => {
  const contenders = (): Mock[] => [
    // Three stubs on one method and path, picked between by request header — the shape a team
    // that selects mocks by header actually has.
    stub({
      id: 'p-1',
      request: { method: 'GET', urlPath: '/v1/rates', headers: { 'X-Tier': { equalTo: 'gold' } } },
      top: { name: 'gold', priority: 1 },
    }),
    stub({
      id: 'p-2',
      request: { method: 'GET', urlPath: '/v1/rates', headers: { 'X-Tier': { equalTo: 'std' } } },
      top: { name: 'standard', priority: 3 },
    }),
    stub({
      id: 'p-3',
      request: { method: 'GET', urlPath: '/v1/rates' },
      top: { name: 'fallback' },
    }),
    // Same path, different method: not a contender.
    stub({ id: 'p-4', request: { method: 'POST', urlPath: '/v1/rates' }, top: { name: 'post' } }),
    // Different path entirely.
    stub({ id: 'p-5', request: { method: 'GET', urlPath: '/v1/other' }, top: { name: 'other' } }),
  ]

  const byName = (query = '') => {
    const found = search(query, 100)
    return new Map(found.items.map((item) => [item.name, item.standing]))
  }

  it('ranks stubs that share a method and path, and leaves the others alone', () => {
    seed(contenders())
    const s = byName()

    expect(s.get('gold')).toMatchObject({ priority: 1, explicit: true, contenders: 3, ahead: 0 })
    expect(s.get('standard')).toMatchObject({ priority: 3, contenders: 3, ahead: 1 })
    // No priority set, so judged at the default — and it loses to both.
    expect(s.get('fallback')).toMatchObject({
      priority: 5,
      explicit: false,
      contenders: 3,
      ahead: 2,
    })

    // A different method on the same path is not a contender, nor is a different path.
    expect(s.get('post')).toMatchObject({ contenders: 1, ahead: 0 })
    expect(s.get('other')).toMatchObject({ contenders: 1, ahead: 0 })
  })

  it('counts a method-less stub as contending with every method on its path', () => {
    seed([
      // No `method` at all: WireMock matches any verb, so it really does compete with both.
      stub({
        id: 'any',
        request: { method: undefined, urlPath: '/v1/wild' },
        top: { name: 'any' },
      }),
      stub({ id: 'get', request: { method: 'GET', urlPath: '/v1/wild' }, top: { name: 'get' } }),
      stub({ id: 'del', request: { method: 'DELETE', urlPath: '/v1/wild' }, top: { name: 'del' } }),
    ])
    const s = byName()
    expect(s.get('any')?.contenders).toBe(3)
    expect(s.get('get')?.contenders).toBe(2)
    expect(s.get('del')?.contenders).toBe(2)
  })

  it('reports a tie rather than inventing a winner', () => {
    seed([
      stub({ id: 't1', request: { urlPath: '/v1/tie' }, top: { name: 'one', priority: 2 } }),
      stub({ id: 't2', request: { urlPath: '/v1/tie' }, top: { name: 'two', priority: 2 } }),
    ])
    const s = byName()
    expect(s.get('one')).toMatchObject({ ahead: 0, tied: 1, contenders: 2 })
    expect(s.get('two')).toMatchObject({ ahead: 0, tied: 1, contenders: 2 })
  })

  it('counts over the whole corpus, not the filtered page', () => {
    seed(contenders())
    // Searching for the loser alone must still say two stubs are ahead of it: a warning that
    // disappears when you filter down to the row it is about would be worse than none.
    const filtered = search('fallback', 100)
    expect(filtered.items).toHaveLength(1)
    expect(filtered.items[0]!.standing).toMatchObject({ contenders: 3, ahead: 2 })
  })

  it('carries the same standing on a single-stub read', () => {
    seed(contenders())
    const listed = byName().get('standard')!
    const one = search('standard', 1).items[0]!
    expect(getMock(db, 'p1', one.clientKey, WIREMOCK_PRIORITY)?.standing).toEqual(listed)
  })
})

describe('priority standing follows the backend, not WireMock', () => {
  /**
   * The bug this pins: the standing SQL inlined WireMock's rule — implicit 5, lower wins — for
   * every backend. MockServer does the opposite on both counts (verified, §17.34), so `ahead`
   * was inverted and the Priority column named the losing stub as the winner, which is precisely
   * the answer the column exists to give.
   */
  const MOCKSERVER: PriorityModel = {
    implicit: 0,
    direction: 'higher-wins',
    backend: 'MockServer',
  }
  const NO_NUMBER: PriorityModel = { implicit: null, direction: 'lower-wins', backend: 'Prism' }

  const twoOnOnePath = (first: number | null, second: number | null): Mock[] => [
    stub({
      id: 'low',
      request: { method: 'GET', urlPath: '/contested' },
      top: { name: 'low', ...(first === null ? {} : { priority: first }) },
    }),
    stub({
      id: 'high',
      request: { method: 'GET', urlPath: '/contested' },
      top: { name: 'high', ...(second === null ? {} : { priority: second }) },
    }),
  ]

  const standingOf = (corpus: Mock[], model: PriorityModel) => {
    replaceCorpus(db, 'p1', corpus, new Date().toISOString())
    const page = searchCorpus(db, {
      profileId: 'p1',
      plan: plan('/contested'),
      limit: 50,
      offset: 0,
      priority: model,
    })
    return new Map(page.items.map((item) => [item.name ?? item.clientKey, item.standing]))
  }

  it('gives the win to the lower number on a lower-wins backend', () => {
    const standing = standingOf(twoOnOnePath(1, 9), WIREMOCK_PRIORITY)
    expect(standing.get('low')?.ahead).toBe(0)
    expect(standing.get('high')?.ahead).toBe(1)
  })

  it('gives the win to the higher number on a higher-wins backend', () => {
    const standing = standingOf(twoOnOnePath(1, 9), MOCKSERVER)
    // The exact inversion. MockServer serves the priority-9 expectation, so 9 is ahead.
    expect(standing.get('high')?.ahead).toBe(0)
    expect(standing.get('low')?.ahead).toBe(1)
  })

  it('uses the backend own implicit priority for a stub that states none', () => {
    // On MockServer an unset priority is 0, not 5 — so a stub at 3 outranks one that says
    // nothing. Under WireMock's rule the unset stub would have been treated as 5 and lost too,
    // but for the wrong reason and with the wrong number on screen.
    const standing = standingOf(twoOnOnePath(null, 3), MOCKSERVER)
    expect(standing.get('high')?.ahead).toBe(0)
    expect(standing.get('low')?.ahead).toBe(1)
    expect(standing.get('low')?.priority).toBe(0)
  })

  it('leaves a stub unranked where the backend has no priority number', () => {
    const standing = standingOf(twoOnOnePath(null, null), NO_NUMBER)
    // Neither outranks the other, and neither is given a number it does not have.
    expect(standing.get('low')?.priority).toBeNull()
    expect(standing.get('low')?.ahead).toBe(0)
    expect(standing.get('high')?.ahead).toBe(0)
  })
})
