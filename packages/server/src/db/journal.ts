import { REDACTION_MARKER, redactRawHeaders, scrubSecrets, setKey } from '@mock-knight/core'
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
  profile_id, upstream_id, at, matched, matched_key, matched_fingerprint, method, url, status,
  duration_ms, added_delay_ms,
  correlation, raw
) VALUES (
  @profile_id, @upstream_id, @at, @matched, @matched_key, @matched_fingerprint, @method, @url, @status,
  @duration_ms, @added_delay_ms,
  @correlation, @raw
)
ON CONFLICT (profile_id, upstream_id) DO NOTHING`

/**
 * Redact before storage, not before display — the mirror must not become a secret store.
 *
 * Everything that reaches the database has to derive from this, because `serve_event` holds more
 * than the payload: `url`, `method` and `correlation` are columns of their own, and each is read
 * off the request. Through 0.7.1 only the canonical `request.headers` was scrubbed, and that is
 * the one copy no column holds — so the feature was a no-op, and the columns beside it carried
 * the secret in the clear.
 *
 * Three things happen here, in order:
 *
 *  1. `redactRawHeaders` scrubs the retained vendor payload and reports which values it replaced.
 *  2. The canonical `headers` and `cookies` are scrubbed the same way, and any value only they
 *     carry joins the list.
 *  3. Everything else derived from the request — the URL, the body, the query, the correlation
 *     id — goes through `scrubSecrets` with that list, so no column can hold what the payload no
 *     longer does.
 *
 * `cookies` matters as much as `headers`: `Cookie` is the header a developer is most likely to
 * declare sensitive, and both backends store its individual values in a sibling object that no
 * header-scoped rule reaches.
 */
function redact(event: ServeEvent, headerNames: readonly string[]): ServeEvent {
  if (headerNames.length === 0) return event
  const wanted = new Set(headerNames.map((name) => name.toLowerCase()))
  // Every cookie is part of the `Cookie` header's value, so declaring that header covers all of
  // them; a cookie whose own name matches a declared header is covered too.
  const cookieDeclared = (name: string): boolean =>
    wanted.has('cookie') || wanted.has(name.toLowerCase())

  const { payload, values } = redactRawHeaders(event.raw, headerNames)

  // Collect before rendering, the same way core does: a value the canonical copy carries and the
  // vendor payload does not still has to leave the URL, the body and the columns.
  const secrets = new Set(values)
  for (const [key, value] of Object.entries(event.request.headers)) {
    if (!wanted.has(key.toLowerCase())) continue
    // Whole values only, never decomposed — see `harvest` in core for why a declared `Cookie`
    // header is not split into its individual pairs.
    for (const item of Array.isArray(value) ? value : [value]) remember(item, secrets)
  }
  // Only a cookie whose own name was declared joins the sweep. One covered merely because
  // `Cookie` is declared is replaced, not swept — see `declared` in core.
  for (const [key, value] of Object.entries(event.request.cookies))
    if (wanted.has(key.toLowerCase())) remember(value, secrets)

  const all = [...secrets].sort((a, b) => b.length - a.length)
  const scrub = (text: string): string => scrubSecrets(text, all)

  const headers: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(event.request.headers)) {
    const redacted = wanted.has(key.toLowerCase())
    // setKey: a header literally named `__proto__` must not vanish from the stored journal.
    setKey(
      headers,
      key,
      Array.isArray(value)
        ? value.map((item) => (redacted ? REDACTION_MARKER : scrub(item)))
        : redacted
          ? REDACTION_MARKER
          : scrub(value),
    )
  }

  const cookies: Record<string, string> = {}
  for (const [key, value] of Object.entries(event.request.cookies))
    setKey(cookies, key, cookieDeclared(key) ? REDACTION_MARKER : scrub(value))

  const queryParameters: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(event.request.queryParameters))
    setKey(queryParameters, key, value.map(scrub))

  return {
    ...event,
    request: {
      ...event.request,
      headers,
      cookies,
      queryParameters,
      url: scrub(event.request.url),
      absoluteUrl: event.request.absoluteUrl === null ? null : scrub(event.request.absoluteUrl),
      method: scrub(event.request.method),
      body: event.request.body === null ? null : scrub(event.request.body),
    },
    correlation: event.correlation === null ? null : scrub(event.correlation),
    raw: payload,
  }
}

/** Blank values substitute into everything; the marker is what redaction writes. */
function remember(value: string, into: Set<string>): void {
  if (value.trim() === '' || value === REDACTION_MARKER) return
  into.add(value)
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
        matched_fingerprint: safe.matchedFingerprint,
        method: safe.request.method,
        url: safe.request.url,
        status: safe.response?.status ?? null,
        duration_ms: safe.timing?.totalMs ?? null,
        added_delay_ms: safe.timing?.addedDelayMs ?? null,
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
  /** What the server reported it took. `null` for rows recorded before v4, and where it said nothing. */
  durationMs: number | null
  /** How much of `durationMs` was a configured delay rather than work. */
  addedDelayMs: number | null
  /**
   * The stub in the corpus *now* that this event's stub corresponds to, or `null` if we cannot
   * tell. Usually `matchedClientKey`; after an import that reissued ids it is the stub with the
   * same behaviour, found by fingerprint. `null` means neither resolved — a stale mirror, or a
   * stub genuinely gone, and the UI must not claim to know which.
   */
  resolvedStubKey: string | null
}

export interface JournalQueryOptions {
  readonly matched?: boolean
  readonly correlation?: string
  /** Exact verb. The journal records what was sent, so this is not a matcher. */
  readonly method?: string
  /** Substring of the request URL, case-insensitive. */
  readonly path?: string
  /** A status class as its leading digit — 2 for 2xx — or an exact code. */
  readonly status?: number
  readonly statusClass?: number
  /** The stub that answered, by client key. "Show me only what this stub served." */
  readonly clientKey?: string
  /** ISO timestamps, inclusive. Bounded by the journal window either way. */
  readonly since?: string
  readonly until?: string
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
  if (options.method !== undefined) {
    where.push('method = ?')
    params.push(options.method.toUpperCase())
  }
  if (options.path !== undefined && options.path !== '') {
    // `LIKE` with an escaped pattern, not FTS: the journal is a bounded window of at most a few
    // thousand rows, and a substring of a URL is what someone actually types. Escaping matters
    // because `_` and `%` appear in real paths and would otherwise be wildcards.
    where.push(`url LIKE ? ESCAPE '\\'`)
    params.push(`%${options.path.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
  }
  if (options.status !== undefined) {
    where.push('status = ?')
    params.push(options.status)
  }
  if (options.statusClass !== undefined) {
    where.push('status >= ? AND status < ?')
    params.push(options.statusClass * 100, (options.statusClass + 1) * 100)
  }
  if (options.clientKey !== undefined) {
    where.push('matched_key = ?')
    params.push(options.clientKey)
  }
  if (options.since !== undefined) {
    where.push('at >= ?')
    params.push(options.since)
  }
  if (options.until !== undefined) {
    where.push('at <= ?')
    params.push(options.until)
  }
  const clause = where.join(' AND ')

  const total = (
    db.prepare(`SELECT count(*) n FROM serve_event WHERE ${clause}`).get(...params) as { n: number }
  ).n

  const rows = db
    .prepare(
      /**
       * `resolved_key` answers a question the recorded id cannot: which stub in the corpus
       * *now* is the one that served this request.
       *
       * WireMock assigns a fresh id to any mapping imported without one, so an import silently
       * renames every stub from here — and the journal, which reaches back further than the
       * corpus, ends up full of ids nothing holds any more. The recorded id is tried first; if
       * it is gone, the stub that behaves identically is used instead.
       */
      `SELECT id, upstream_id, at, matched, matched_key, method, url, status, correlation,
              duration_ms, added_delay_ms,
              COALESCE(
                (
                  SELECT client_key FROM mock
                  WHERE mock.profile_id = serve_event.profile_id
                    AND mock.client_key = serve_event.matched_key
                ),
                /*
                  Restricted to a *unique* behavioural match: two stubs may legitimately do the
                  same thing, and picking one of them would send someone to a stub that never
                  served their request. Ambiguity resolves to null, which the UI can say.
                */
                (
                  SELECT client_key FROM mock
                  WHERE mock.profile_id = serve_event.profile_id
                    AND mock.fingerprint IS NOT NULL
                    AND mock.fingerprint = serve_event.matched_fingerprint
                  GROUP BY mock.fingerprint
                  HAVING COUNT(*) = 1
                )
              ) AS resolved_key
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
    duration_ms: number | null
    added_delay_ms: number | null
    resolved_key: string | null
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
      durationMs: row.duration_ms,
      addedDelayMs: row.added_delay_ms,
      resolvedStubKey: row.resolved_key,
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
