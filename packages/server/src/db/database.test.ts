import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import { SCHEMA_VERSION, FTS_COLUMNS } from './schema.js'
import { openDatabase } from './database.js'

/**
 * These tests re-verify the claims TECH-DESIGN §17.10 makes about the schema, on this machine
 * and this SQLite build, rather than trusting the record of a verification done once. An
 * earlier draft of that schema named an FTS column absent from `mock` and failed at rebuild —
 * which is exactly the kind of thing only running it catches.
 */

let directory: string
let db: Db

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mock-knight-test-'))
  db = openDatabase(join(directory, 'state.db'))
})

afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

function insertProfile(id: string): void {
  db.prepare(
    `INSERT INTO profile (id, name, adapter, base_url, origin, created_at)
     VALUES (?, ?, 'wiremock', 'http://localhost:8080', 'runtime', '2026-08-22T00:00:00Z')`,
  ).run(id, id)
}

let nextRowid = 1
function insertMock(profileId: string, fields: Record<string, unknown> = {}): number {
  const rowid = nextRowid++
  const row = {
    rowid,
    profile_id: profileId,
    client_key: `key-${rowid}`,
    method: 'GET',
    url_value: '/v1/orders',
    status: 200,
    folder: 'v1',
    tags: '[]',
    body_excerpt: '',
    content_hash: `hash-${rowid}`,
    raw: '{}',
    fetched_at: '2026-08-22T00:00:00Z',
    name: null,
    ...fields,
  }
  db.prepare(
    `INSERT INTO mock (rowid, profile_id, client_key, name, folder, tags, method, url_value,
                       status, body_excerpt, content_hash, raw, fetched_at)
     VALUES (@rowid, @profile_id, @client_key, @name, @folder, @tags, @method, @url_value,
             @status, @body_excerpt, @content_hash, @raw, @fetched_at)`,
  ).run(row)
  return rowid
}

function rebuildFts(): void {
  db.exec(`INSERT INTO mock_fts(mock_fts) VALUES('rebuild')`)
}

describe('openDatabase', () => {
  it('creates every table the mirror needs', () => {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name`)
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    for (const expected of [
      'profile',
      'mock',
      'mock_fts',
      'serve_event',
      'journal_window',
      'audit',
      'draft',
      'saved_search',
    ]) {
      expect(names, `missing table ${expected}`).toContain(expected)
    }
  })

  it('records the schema version so a future migration can find its starting point', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })

  it('sets the pragmas §6.1 requires', () => {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
    expect(db.pragma('synchronous', { simple: true })).toBe(1) // NORMAL
  })

  it('is idempotent — reopening an existing file does not re-run the migration', () => {
    const path = join(directory, 'state.db')
    insertProfile('p1')
    db.close()

    const reopened = openDatabase(path)
    expect(reopened.prepare('SELECT count(*) n FROM profile').get()).toEqual({ n: 1 })
    expect(reopened.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    reopened.close()
    db = openDatabase(path)
  })
})

describe('the FTS contract', () => {
  it('backs every FTS column with a real column on `mock`', () => {
    const columns = (db.pragma('table_info(mock)') as { name: string }[]).map((c) => c.name)
    for (const column of FTS_COLUMNS) {
      expect(columns, `mock_fts names ${column}, which mock does not have`).toContain(column)
    }
  })

  it('rebuilds — the step that fails when an FTS column is missing', () => {
    insertProfile('p1')
    insertMock('p1')
    expect(() => rebuildFts()).not.toThrow()
  })

  it('matches a substring of a url path, which is the whole reason for the trigram tokenizer', () => {
    insertProfile('p1')
    insertMock('p1', { url_value: '/v1/orders/{id}/cancel' })
    rebuildFts()
    const rows = db
      .prepare(`SELECT url_value FROM mock_fts WHERE mock_fts MATCH ?`)
      .all('"/v1/ord"') as { url_value: string }[]
    expect(rows).toHaveLength(1)
  })

  it('returns nothing at all for a query under three characters', () => {
    insertProfile('p1')
    insertMock('p1', { url_value: '/v1/orders' })
    rebuildFts()
    const rows = db.prepare(`SELECT url_value FROM mock_fts WHERE mock_fts MATCH ?`).all('"or"')
    // Not a bug to fix here — a property of the tokenizer. It is why the query planner has to
    // detect short terms and fall back to LIKE, and why that fallback is not optional.
    expect(rows).toEqual([])
  })

  it('is case-insensitive, matching what someone typing a path expects', () => {
    insertProfile('p1')
    insertMock('p1', { url_value: '/v1/Orders' })
    rebuildFts()
    const rows = db.prepare(`SELECT url_value FROM mock_fts WHERE mock_fts MATCH ?`).all('"orders"')
    expect(rows).toHaveLength(1)
  })
})

describe('referential integrity', () => {
  beforeEach(() => {
    insertProfile('p1')
    insertMock('p1')
    db.prepare(
      `INSERT INTO serve_event (profile_id, upstream_id, at, matched, raw)
       VALUES ('p1', 'u1', '2026-08-22T00:00:00Z', 1, '{}')`,
    ).run()
    db.prepare(
      `INSERT INTO draft (profile_id, client_key, body, base_hash, updated_at)
       VALUES ('p1', 'key-1', '{}', 'h', '2026-08-22T00:00:00Z')`,
    ).run()
    db.prepare(`INSERT INTO saved_search (profile_id, name, query) VALUES ('p1','mine','x')`).run()
    db.prepare(
      `INSERT INTO audit (profile_id, at, actor, action, summary)
       VALUES ('p1', '2026-08-22T00:00:00Z', 'dana@example.com', 'update', 'changed status')`,
    ).run()
  })

  it('cascades every child table when a profile is deleted', () => {
    db.prepare(`DELETE FROM profile WHERE id = 'p1'`).run()
    for (const table of ['mock', 'serve_event', 'draft', 'saved_search']) {
      const row = db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }
      expect(row.n, `${table} should have cascaded`).toBe(0)
    }
  })

  it('keeps the audit trail after its profile is gone', () => {
    db.prepare(`DELETE FROM profile WHERE id = 'p1'`).run()
    const row = db.prepare(`SELECT count(*) n FROM audit`).get() as { n: number }
    // The record of a change has to outlive the profile it was made against, or deleting a
    // profile becomes a way to erase history.
    expect(row.n).toBe(1)
  })
})

describe('the query shapes the corpus screen depends on', () => {
  beforeEach(() => {
    insertProfile('p1')
    insertMock('p1', { method: 'GET', status: 200, client_key: 'a' })
    insertMock('p1', { method: 'POST', status: 500, client_key: 'b' })
    insertMock('p1', { method: 'POST', status: 500, client_key: 'c' })
  })

  it('counts facets with a GROUP BY rather than by loading the corpus', () => {
    const rows = db
      .prepare(`SELECT method, count(*) n FROM mock WHERE profile_id = ? GROUP BY method`)
      .all('p1') as { method: string; n: number }[]
    expect(rows).toEqual([
      { method: 'GET', n: 1 },
      { method: 'POST', n: 2 },
    ])
  })

  it('finds unused stubs by left-joining the journal', () => {
    db.prepare(
      `INSERT INTO serve_event (profile_id, upstream_id, at, matched, matched_key, raw)
       VALUES ('p1','u1','2026-08-22T00:00:00Z',1,'a','{}')`,
    ).run()
    const rows = db
      .prepare(
        `SELECT m.client_key FROM mock m
         LEFT JOIN serve_event e ON e.matched_key = m.client_key AND e.profile_id = m.profile_id
         WHERE m.profile_id = ? AND e.id IS NULL
         ORDER BY m.client_key`,
      )
      .all('p1') as { client_key: string }[]
    expect(rows.map((r) => r.client_key)).toEqual(['b', 'c'])
  })
})
