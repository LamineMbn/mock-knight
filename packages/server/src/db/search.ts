import type { QueryFilter, QueryPlan } from '@mock-knight/core'
import type { Database as Db } from 'better-sqlite3'

/**
 * Compiling a parsed query into SQL — TECH-DESIGN §6.4.
 *
 * Two rules shape everything here:
 *
 *  1. **The browser never holds the corpus.** One page of rows plus facet counts computed with
 *     `GROUP BY`, never by loading rows and counting them in JS. That is what keeps the memory
 *     NFR true on both sides of the wire.
 *  2. **A short search term must not silently return nothing.** The trigram tokenizer returns
 *     zero rows for anything under three characters — verified, not theoretical — so terms that
 *     short are routed to a `LIKE` scan instead, and the result says which strategy ran.
 */

/** Below this length the trigram index cannot answer, so the planner falls back to LIKE. */
export const MIN_TRIGRAM_LENGTH = 3

export interface MockListItem {
  clientKey: string
  serverId: string | null
  name: string | null
  folder: string[]
  folderSource: string
  tags: string[]
  method: string | null
  url: { kind: string; value: string } | null
  status: number | null
  priority: number | null
  enabled: boolean | null
  scenario: string | null
  hasDelay: boolean
  hasFault: boolean
  isProxy: boolean
  bodyFile: string | null
  /** Request header matchers — on many corpora these are what actually distinguish two stubs. */
  headers: { name: string; operator: string; value: string | null }[]
  bodyTruncated: boolean
  lastServedAt: string | null
  contentHash: string
}

export interface FacetBucket {
  value: string
  count: number
}

export interface Facets {
  method: FacetBucket[]
  statusClass: FacetBucket[]
  scenario: FacetBucket[]
  folder: FacetBucket[]
  tag: FacetBucket[]
  /** Header *names* used as matchers, so the sidebar can offer the discriminator directly. */
  header: FacetBucket[]
  hasDelay: number
  hasFault: number
  isProxy: number
}

/** Which index actually answered, so the UI can be honest about a degraded search. */
export type TextStrategy = 'none' | 'fts' | 'like' | 'mixed'

export interface SearchResult {
  items: MockListItem[]
  total: number
  limit: number
  offset: number
  facets: Facets
  textStrategy: TextStrategy
  /** True when any matched stub's indexed body was capped, so `body:` results may be partial. */
  bodyIndexTruncated: boolean
}

export interface SearchRequest {
  profileId: string
  plan: QueryPlan
  limit: number
  offset: number
}

const LIKE_ESCAPE = '\\'

function escapeLike(value: string): string {
  return value
    .replaceAll(LIKE_ESCAPE, LIKE_ESCAPE + LIKE_ESCAPE)
    .replaceAll('%', LIKE_ESCAPE + '%')
    .replaceAll('_', LIKE_ESCAPE + '_')
}

/** `*` and `?` are the wildcards users type; SQL's are `%` and `_`. */
function globToLike(value: string): string {
  return escapeLike(value).replaceAll('*', '%').replaceAll('?', '_')
}

function ftsPhrase(term: string): string {
  return `"${term.replaceAll('"', '""')}"`
}

interface Conditions {
  sql: string[]
  params: unknown[]
  /** FTS5 match expression, or null when nothing needs the index. */
  match: string | null
  usedFts: boolean
  usedLike: boolean
}

function filterToSql(filter: QueryFilter): { sql: string; params: unknown[] } {
  switch (filter.field) {
    case 'method':
      return { sql: 'm.method = ?', params: [filter.value] }
    case 'status':
      return filter.op === 'class'
        ? {
            sql: 'm.status >= ? AND m.status < ?',
            params: [filter.value * 100, filter.value * 100 + 100],
          }
        : { sql: 'm.status = ?', params: [filter.value] }
    case 'priority': {
      const operator = { eq: '=', lt: '<', lte: '<=', gt: '>', gte: '>=' }[filter.op]
      return { sql: `m.priority ${operator} ?`, params: [filter.value] }
    }
    case 'scenario':
      return filter.op === 'glob'
        ? { sql: `m.scenario LIKE ? ESCAPE '${LIKE_ESCAPE}'`, params: [globToLike(filter.value)] }
        : { sql: 'm.scenario = ?', params: [filter.value] }
    case 'folder':
      return filter.op === 'glob'
        ? { sql: `m.folder LIKE ? ESCAPE '${LIKE_ESCAPE}'`, params: [globToLike(filter.value)] }
        : { sql: 'm.folder = ?', params: [filter.value] }
    case 'tag':
      return {
        sql: `EXISTS (SELECT 1 FROM json_each(m.tags) j WHERE j.value ${
          filter.op === 'glob' ? `LIKE ? ESCAPE '${LIKE_ESCAPE}'` : '= ?'
        })`,
        params: [filter.op === 'glob' ? globToLike(filter.value) : filter.value],
      }
    case 'url':
      return {
        sql: `m.url_value LIKE ? ESCAPE '${LIKE_ESCAPE}'`,
        params: [filter.op === 'glob' ? globToLike(filter.value) : `%${escapeLike(filter.value)}%`],
      }
    case 'body':
      // Handled through the FTS index, not here — a LIKE scan over 5k body excerpts of up to
      // 64KB each would miss the 150ms search budget by a wide margin.
      return { sql: '1=1', params: [] }
    case 'unused':
      return {
        sql: filter.value
          ? `NOT EXISTS (SELECT 1 FROM serve_event e
                         WHERE e.profile_id = m.profile_id AND e.matched_key = m.client_key)`
          : `EXISTS (SELECT 1 FROM serve_event e
                     WHERE e.profile_id = m.profile_id AND e.matched_key = m.client_key)`,
        params: [],
      }
    case 'disabled':
      return { sql: 'm.enabled = ?', params: [filter.value ? 0 : 1] }
    case 'header': {
      // Matched against the structured JSON rather than the flattened `header_text`, so a
      // value cannot accidentally match across two different headers. `json_each` over a NULL
      // column yields no rows, which is exactly "this stub has no header matchers".
      const name = `lower(json_extract(j.value, '$.name')) = ?`
      if (filter.op === 'present') {
        return {
          sql: `EXISTS (SELECT 1 FROM json_each(m.headers) j WHERE ${name})`,
          params: [filter.name],
        }
      }
      const value = filter.value ?? ''
      return {
        sql: `EXISTS (SELECT 1 FROM json_each(m.headers) j WHERE ${name}
                      AND json_extract(j.value, '$.value') LIKE ? ESCAPE '${LIKE_ESCAPE}')`,
        params: [filter.name, filter.op === 'glob' ? globToLike(value) : `%${escapeLike(value)}%`],
      }
    }
  }
}

/**
 * @param excludeField omit this field's filters — used for facet counts, so ticking one method
 *   does not zero the counts of every other method in the same group.
 */
function buildConditions(request: SearchRequest, excludeField?: string): Conditions {
  const sql: string[] = ['m.profile_id = ?']
  const params: unknown[] = [request.profileId]
  const phrases: string[] = []
  let usedLike = false

  for (const group of request.plan.groups) {
    if (group.field === excludeField) continue

    if (group.field === 'body') {
      for (const filter of group.filters) {
        const term = String(filter.value)
        if (term.length >= MIN_TRIGRAM_LENGTH) {
          // Column-scoped FTS: only the body, not the url or name.
          phrases.push(`body_excerpt : ${ftsPhrase(term)}`)
        } else {
          usedLike = true
          sql.push(`m.body_excerpt LIKE ? ESCAPE '${LIKE_ESCAPE}'`)
          params.push(`%${escapeLike(term)}%`)
        }
      }
      continue
    }

    const parts: string[] = []
    for (const filter of group.filters) {
      const compiled = filterToSql(filter)
      parts.push(`(${compiled.sql})`)
      params.push(...compiled.params)
    }
    // Within a field the filters OR, across fields they AND — which is what a facet sidebar of
    // checkboxes means when you tick two methods and one status.
    if (parts.length > 0) sql.push(`(${parts.join(' OR ')})`)
  }

  for (const term of request.plan.terms) {
    if (term.text.length >= MIN_TRIGRAM_LENGTH) {
      phrases.push(ftsPhrase(term.text))
    } else {
      usedLike = true
      const like = `%${escapeLike(term.text)}%`
      sql.push(
        `(m.url_value LIKE ? ESCAPE '${LIKE_ESCAPE}' OR m.name LIKE ? ESCAPE '${LIKE_ESCAPE}'
          OR m.folder LIKE ? ESCAPE '${LIKE_ESCAPE}' OR m.tags LIKE ? ESCAPE '${LIKE_ESCAPE}'
          OR m.body_excerpt LIKE ? ESCAPE '${LIKE_ESCAPE}')`,
      )
      params.push(like, like, like, like, like)
    }
  }

  return {
    sql,
    params,
    match: phrases.length > 0 ? phrases.join(' ') : null,
    usedFts: phrases.length > 0,
    usedLike,
  }
}

function strategyFor(conditions: Conditions): TextStrategy {
  if (conditions.usedFts && conditions.usedLike) return 'mixed'
  if (conditions.usedFts) return 'fts'
  if (conditions.usedLike) return 'like'
  return 'none'
}

/**
 * `FROM` clause plus WHERE, shared by the page query, the count, and every facet count.
 *
 * @param extraFrom additional table in the FROM list, e.g. `, json_each(m.tags) j` for the tag
 *   facet, which needs one row per tag rather than one per stub.
 */
function fromWhere(conditions: Conditions, extraFrom = ''): { sql: string; params: unknown[] } {
  // The FTS table must not be aliased: `MATCH` only resolves against the table's own name.
  const join =
    conditions.match !== null
      ? `FROM mock m${extraFrom} JOIN mock_fts ON mock_fts.rowid = m.rowid`
      : `FROM mock m${extraFrom}`
  const where = [...conditions.sql]
  const params: unknown[] = []
  if (conditions.match !== null) {
    where.unshift('mock_fts MATCH ?')
    params.push(conditions.match)
  }
  params.push(...conditions.params)
  return { sql: `${join} WHERE ${where.join(' AND ')}`, params }
}

interface MockRow {
  client_key: string
  server_id: string | null
  name: string | null
  folder: string | null
  folder_source: string | null
  tags: string | null
  method: string | null
  url_kind: string | null
  url_value: string | null
  status: number | null
  priority: number | null
  enabled: number | null
  scenario: string | null
  has_delay: number
  has_fault: number
  is_proxy: number
  body_file: string | null
  headers: string | null
  body_truncated: number
  last_served_at: string | null
  content_hash: string
}

function parseTags(raw: string | null): string[] {
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function parseHeaders(raw: string | null): MockListItem['headers'] {
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as MockListItem['headers']) : []
  } catch {
    return []
  }
}

function toItem(row: MockRow): MockListItem {
  return {
    clientKey: row.client_key,
    serverId: row.server_id,
    name: row.name,
    folder: row.folder === null || row.folder === '' ? [] : row.folder.split('/'),
    folderSource: row.folder_source ?? 'none',
    tags: parseTags(row.tags),
    method: row.method,
    url:
      row.url_kind === null || row.url_value === null
        ? null
        : { kind: row.url_kind, value: row.url_value },
    status: row.status,
    priority: row.priority,
    enabled: row.enabled === null ? null : row.enabled === 1,
    scenario: row.scenario,
    hasDelay: row.has_delay === 1,
    hasFault: row.has_fault === 1,
    isProxy: row.is_proxy === 1,
    bodyFile: row.body_file,
    headers: parseHeaders(row.headers),
    bodyTruncated: row.body_truncated === 1,
    lastServedAt: row.last_served_at,
    contentHash: row.content_hash,
  }
}

const SELECT_COLUMNS = `
  m.client_key, m.server_id, m.name, m.folder, m.folder_source, m.tags, m.method, m.url_kind,
  m.url_value, m.status, m.priority, m.enabled, m.scenario, m.has_delay, m.has_fault,
  m.is_proxy, m.body_file, m.headers, m.body_truncated, m.last_served_at, m.content_hash`

function countBucket(
  db: Db,
  request: SearchRequest,
  field: string,
  expression: string,
  extraFrom = '',
): FacetBucket[] {
  // Counts for a facet group exclude that group's own filters: ticking one method must not
  // zero the count beside every other method in the same list.
  const conditions = buildConditions(request, field)
  const { sql, params } = fromWhere(conditions, extraFrom)
  // Grouped and ordered by **ordinal**, not by the alias. `json_each` exposes its own column
  // called `value`, so `GROUP BY value` silently binds to that instead of the alias — which
  // split one header name into a group per row and made every count 1. The tag facet had the
  // same shape and only gave right answers by coincidence.
  const rows = db
    .prepare(
      `SELECT ${expression} AS facet_value, count(*) AS facet_count ${sql}
       AND ${expression} IS NOT NULL
       GROUP BY 1 ORDER BY 2 DESC, 1 ASC`,
    )
    .all(...params) as { facet_value: string | number; facet_count: number }[]
  return rows.map((row) => ({ value: String(row.facet_value), count: row.facet_count }))
}

function countFlag(db: Db, request: SearchRequest, column: string): number {
  const conditions = buildConditions(request)
  const { sql, params } = fromWhere(conditions)
  const row = db.prepare(`SELECT count(*) n ${sql} AND m.${column} = 1`).get(...params) as {
    n: number
  }
  return row.n
}

export function searchCorpus(db: Db, request: SearchRequest): SearchResult {
  const conditions = buildConditions(request)
  const { sql, params } = fromWhere(conditions)

  const totalRow = db.prepare(`SELECT count(*) n ${sql}`).get(...params) as { n: number }

  // bm25 ranks lower-is-better. Without a text term there is nothing to rank by, so fall back
  // to a stable alphabetical order — a list that reshuffles between pages is unusable.
  const order =
    conditions.match !== null
      ? 'ORDER BY bm25(mock_fts), m.rowid'
      : 'ORDER BY m.url_value, m.method, m.rowid'

  const rows = db
    .prepare(`SELECT ${SELECT_COLUMNS} ${sql} ${order} LIMIT ? OFFSET ?`)
    .all(...params, request.limit, request.offset) as MockRow[]

  const truncatedRow = db
    .prepare(`SELECT count(*) n ${sql} AND m.body_truncated = 1`)
    .get(...params) as { n: number }

  return {
    items: rows.map(toItem),
    total: totalRow.n,
    limit: request.limit,
    offset: request.offset,
    textStrategy: strategyFor(conditions),
    bodyIndexTruncated: truncatedRow.n > 0,
    facets: {
      method: countBucket(db, request, 'method', 'm.method'),
      statusClass: countBucket(db, request, 'status', "(m.status / 100) || 'xx'"),
      scenario: countBucket(db, request, 'scenario', 'm.scenario'),
      folder: countBucket(db, request, 'folder', 'm.folder'),
      tag: countBucket(db, request, 'tag', 'j.value', ', json_each(m.tags) j'),
      header: countBucket(
        db,
        request,
        'header',
        `json_extract(h.value, '$.name')`,
        ', json_each(m.headers) h',
      ),
      hasDelay: countFlag(db, request, 'has_delay'),
      hasFault: countFlag(db, request, 'has_fault'),
      isProxy: countFlag(db, request, 'is_proxy'),
    },
  }
}

/** One stub in full, including `raw`. Never returned by the list — bodies reach 5MB. */
export function getMock(
  db: Db,
  profileId: string,
  clientKey: string,
): (MockListItem & { raw: unknown }) | null {
  const row = db
    .prepare(
      `SELECT ${SELECT_COLUMNS}, m.raw FROM mock m WHERE m.profile_id = ? AND m.client_key = ?`,
    )
    .get(profileId, clientKey) as (MockRow & { raw: string }) | undefined
  if (row === undefined) return null
  return { ...toItem(row), raw: JSON.parse(row.raw) as unknown }
}
