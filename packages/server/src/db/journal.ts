import type { ServeEvent } from '@mock-knight/core'
import type { Database as Db } from 'better-sqlite3'

/**
 * The serve-event mirror.
 *
 * Every conclusion drawn from this table is a **bounded truth** (design brief §7.4): the
 * upstream journal is finite and resettable, so "this stub is unused" only ever means "no
 * request in the window we have seen matched it". `journal_window` records how far back that
 * window reaches, and the UI is required to show it rather than claiming something stronger.
 *
 * Events are deduped on `upstream_id` because polling overlaps: consecutive polls return the
 * same tail, and without the unique key the log would grow duplicates on every tick.
 */

export interface JournalIngestResult {
  readonly inserted: number
  readonly seen: number
  readonly earliestAt: string | null
}

const INSERT_EVENT = `
INSERT INTO serve_event (
  profile_id, upstream_id, at, matched, matched_key, method, url, status, duration_ms,
  correlation, raw
) VALUES (
  @profile_id, @upstream_id, @at, @matched, @matched_key, @method, @url, @status, @duration_ms,
  @correlation, @raw
)
ON CONFLICT (profile_id, upstream_id) DO NOTHING`

/** Redact before storage, not before display — the mirror must not become a secret store. */
function redact(event: ServeEvent, headerNames: readonly string[]): ServeEvent {
  if (headerNames.length === 0) return event
  const wanted = new Set(headerNames.map((name) => name.toLowerCase()))
  const headers: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(event.request.headers)) {
    headers[key] = wanted.has(key.toLowerCase()) ? '«redacted»' : value
  }
  return { ...event, request: { ...event.request, headers } }
}

export function recordServeEvents(
  db: Db,
  profileId: string,
  events: readonly ServeEvent[],
  options: { redactHeaders?: readonly string[]; observedAt?: string } = {},
): JournalIngestResult {
  const insert = db.prepare(INSERT_EVENT)
  const redactHeaders = options.redactHeaders ?? []
  let inserted = 0

  db.transaction(() => {
    for (const event of events) {
      const safe = redact(event, redactHeaders)
      const result = insert.run({
        profile_id: profileId,
        upstream_id: safe.id,
        at: safe.at,
        matched: safe.matched ? 1 : 0,
        matched_key: safe.matchedClientKey,
        method: safe.request.method,
        url: safe.request.url,
        status: safe.response?.status ?? null,
        duration_ms: null,
        correlation: safe.correlation,
        raw: JSON.stringify(safe.raw),
      })
      inserted += result.changes
    }
  })()

  const window = db
    .prepare(`SELECT min(at) earliest FROM serve_event WHERE profile_id = ?`)
    .get(profileId) as { earliest: string | null }

  db.prepare(
    `INSERT INTO journal_window (profile_id, earliest_at, observed_at)
     VALUES (?, ?, ?)
     ON CONFLICT (profile_id) DO UPDATE SET earliest_at = excluded.earliest_at,
                                            observed_at = excluded.observed_at`,
  ).run(profileId, window.earliest, options.observedAt ?? new Date().toISOString())

  return { inserted, seen: events.length, earliestAt: window.earliest }
}

export interface ServeEventRow {
  id: number
  upstreamId: string
  at: string
  matched: boolean
  matchedClientKey: string | null
  method: string | null
  url: string | null
  status: number | null
  correlation: string | null
}

export interface JournalQueryOptions {
  readonly matched?: boolean
  readonly correlation?: string
  readonly limit: number
  readonly offset: number
}

export interface JournalPage {
  readonly items: ServeEventRow[]
  readonly total: number
  /**
   * The oldest event we hold. Every "unused since…" and "never served" statement has to be
   * qualified by this, because the journal does not go back further.
   */
  readonly earliestAt: string | null
}

export function listServeEvents(
  db: Db,
  profileId: string,
  options: JournalQueryOptions,
): JournalPage {
  const where = ['profile_id = ?']
  const params: unknown[] = [profileId]
  if (options.matched !== undefined) {
    where.push('matched = ?')
    params.push(options.matched ? 1 : 0)
  }
  if (options.correlation !== undefined) {
    where.push('correlation = ?')
    params.push(options.correlation)
  }
  const clause = where.join(' AND ')

  const total = (
    db.prepare(`SELECT count(*) n FROM serve_event WHERE ${clause}`).get(...params) as { n: number }
  ).n

  const rows = db
    .prepare(
      `SELECT id, upstream_id, at, matched, matched_key, method, url, status, correlation
       FROM serve_event WHERE ${clause}
       ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, options.limit, options.offset) as {
    id: number
    upstream_id: string
    at: string
    matched: number
    matched_key: string | null
    method: string | null
    url: string | null
    status: number | null
    correlation: string | null
  }[]

  const window = db
    .prepare(`SELECT earliest_at FROM journal_window WHERE profile_id = ?`)
    .get(profileId) as { earliest_at: string | null } | undefined

  return {
    items: rows.map((row) => ({
      id: row.id,
      upstreamId: row.upstream_id,
      at: row.at,
      matched: row.matched === 1,
      matchedClientKey: row.matched_key,
      method: row.method,
      url: row.url,
      status: row.status,
      correlation: row.correlation,
    })),
    total,
    earliestAt: window?.earliest_at ?? null,
  }
}

/** The verbatim upstream event, for the explainer and the curl copy. */
export function getServeEventRaw(db: Db, profileId: string, id: number): unknown | null {
  const row = db
    .prepare(`SELECT raw FROM serve_event WHERE profile_id = ? AND id = ?`)
    .get(profileId, id) as { raw: string } | undefined
  return row === undefined ? null : (JSON.parse(row.raw) as unknown)
}
