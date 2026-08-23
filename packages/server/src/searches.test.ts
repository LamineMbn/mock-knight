import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import { openDatabase } from './db/database.js'
import { deleteSavedSearch, listSavedSearches, saveSearch } from './searches.js'

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
  for (const id of ['p1', 'p2']) {
    db.prepare(
      `INSERT INTO profile (id, name, adapter, base_url, origin, created_at)
       VALUES (?, ?, 'wiremock', 'http://localhost:8080', 'runtime', '2026-08-23T00:00:00Z')`,
    ).run(id, id)
  }
})
afterEach(() => db.close())

describe('saved searches', () => {
  it('round-trips a query', () => {
    saveSearch(db, 'p1', { name: 'broken checkout', query: 'method:POST status:5xx' })
    expect(listSavedSearches(db, 'p1')).toEqual([
      { id: expect.any(Number), name: 'broken checkout', query: 'method:POST status:5xx' },
    ])
  })

  it('replaces a save of the same name rather than refusing it', () => {
    // Refining a query and saving it again under the same name means "update this". A
    // uniqueness error there would be the tool arguing with an obvious intention.
    saveSearch(db, 'p1', { name: 'tenants', query: 'header:X-Tenant' })
    saveSearch(db, 'p1', { name: 'tenants', query: 'header:X-Tenant=acme' })
    const all = listSavedSearches(db, 'p1')
    expect(all).toHaveLength(1)
    expect(all[0]!.query).toBe('header:X-Tenant=acme')
  })

  it('keeps them per profile', () => {
    // A query naming a header or folder means nothing on a server that has neither.
    saveSearch(db, 'p1', { name: 'mine', query: 'folder:orders' })
    expect(listSavedSearches(db, 'p2')).toEqual([])
  })

  it('lists them by name, so the order does not shift as they are edited', () => {
    saveSearch(db, 'p1', { name: 'zebra', query: 'a' })
    saveSearch(db, 'p1', { name: 'alpha', query: 'b' })
    expect(listSavedSearches(db, 'p1').map((s) => s.name)).toEqual(['alpha', 'zebra'])
  })

  it('deletes only within its own profile', () => {
    const mine = saveSearch(db, 'p1', { name: 'x', query: 'q' })
    expect(deleteSavedSearch(db, 'p2', mine.id)).toBe(false)
    expect(listSavedSearches(db, 'p1')).toHaveLength(1)
    expect(deleteSavedSearch(db, 'p1', mine.id)).toBe(true)
    expect(listSavedSearches(db, 'p1')).toHaveLength(0)
  })

  it('goes with the profile when it is removed', () => {
    saveSearch(db, 'p1', { name: 'x', query: 'q' })
    db.prepare(`DELETE FROM profile WHERE id = 'p1'`).run()
    expect(listSavedSearches(db, 'p1')).toEqual([])
  })
})
