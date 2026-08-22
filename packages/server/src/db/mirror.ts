import { canonicalJson } from '@mock-knight/core'
import type { Mock } from '@mock-knight/core'
import type { Database as Db } from 'better-sqlite3'

/**
 * Writing the corpus into the mirror.
 *
 * The mirror is a **disposable cache**, not a second source of truth (CLAUDE.md invariant 6).
 * Nothing here is authoritative: every value is re-derivable by re-fetching, which is what makes
 * `synchronous = NORMAL` and a destructive full-replace ingest safe.
 *
 * Bodies are indexed up to a cap. A 5MB response body trigram-indexed in full produces an index
 * larger than the corpus for no user benefit, so `body_excerpt` is capped and `body_truncated`
 * records that it was — which is what lets a `body:` search say it is partial instead of
 * silently missing matches.
 */

/** TECH-DESIGN §6.3. Lowerable if the index turns out too large against the 10k fixture. */
export const BODY_INDEX_CAP_BYTES = 64 * 1024

export interface MirrorStats {
  readonly inserted: number
  readonly profileId: string
  readonly fetchedAt: string
}

function bodyExcerptFor(mock: Mock): { excerpt: string | null; truncated: boolean } {
  const body = mock.response.body
  let text: string | null
  switch (body.kind) {
    case 'none':
    case 'file':
      // A body file's *name* is searchable through `body_file`; its contents live on the mock
      // server's disk, which v1 does not read.
      text = null
      break
    case 'json':
      // Plain stringify, not `canonicalJson`: this text is only ever substring-searched, so it
      // needs no sorted key order and no validation pass. Canonicalising every body was a deep
      // recursive sort of the largest values in the corpus, on the ingest hot path, for a
      // property nothing downstream reads.
      text = body.value === null ? null : JSON.stringify(body.value)
      break
    default:
      text = typeof body.value === 'string' ? body.value : null
  }
  if (text === null) return { excerpt: null, truncated: false }
  if (Buffer.byteLength(text, 'utf8') <= BODY_INDEX_CAP_BYTES) {
    return { excerpt: text, truncated: false }
  }
  // Slice by bytes, then drop a trailing partial code unit rather than emitting a lone surrogate.
  const sliced = Buffer.from(text, 'utf8').subarray(0, BODY_INDEX_CAP_BYTES).toString('utf8')
  return { excerpt: sliced.replace(/�$/, ''), truncated: true }
}

export interface StoredHeaderMatcher {
  name: string
  operator: string
  /** Rendered form of the matcher's value; `null` where the operator carries none. */
  value: string | null
}

/**
 * Flatten the request's header matchers for storage.
 *
 * `value` is stringified rather than kept as JSON because it is for display and substring
 * search, not for round-tripping — `raw` remains the only thing a write is ever rebuilt from.
 */
export function headerMatchersOf(mock: Mock): StoredHeaderMatcher[] {
  const out: StoredHeaderMatcher[] = []
  for (const [name, matchers] of Object.entries(mock.request.headers)) {
    for (const matcher of matchers) {
      const value =
        matcher.value === null
          ? null
          : typeof matcher.value === 'string'
            ? matcher.value
            : canonicalJson(matcher.value)
      out.push({ name, operator: matcher.operator, value })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.operator.localeCompare(b.operator))
}

/**
 * The searchable form: `name=value` per line, plus the bare name so `header:X-Mock` with no
 * value still matches. Lower-cased name, because HTTP header names are case-insensitive and the
 * query lower-cases them too; the value keeps its case, because values are not.
 */
export function headerSearchText(matchers: readonly StoredHeaderMatcher[]): string | null {
  if (matchers.length === 0) return null
  return matchers
    .map((m) => (m.value === null ? m.name.toLowerCase() : `${m.name.toLowerCase()}=${m.value}`))
    .join('\n')
}

interface MockRow {
  profile_id: string
  client_key: string
  server_id: string | null
  name: string | null
  folder: string | null
  folder_source: string
  tags: string
  method: string | null
  url_kind: string | null
  url_value: string | null
  status: number | null
  priority: number | null
  enabled: number | null
  scenario: string | null
  required_state: string | null
  new_state: string | null
  has_delay: number
  has_fault: number
  is_proxy: number
  body_file: string | null
  headers: string | null
  header_text: string | null
  content_hash: string
  raw: string
  body_excerpt: string | null
  body_truncated: number
  fetched_at: string
}

export function toRow(profileId: string, mock: Mock, fetchedAt: string): MockRow {
  const { excerpt, truncated } = bodyExcerptFor(mock)
  const headers = headerMatchersOf(mock)
  return {
    profile_id: profileId,
    client_key: mock.clientKey,
    server_id: mock.id,
    name: mock.name,
    folder: mock.folder.length > 0 ? mock.folder.join('/') : null,
    folder_source: mock.folderSource,
    tags: JSON.stringify(mock.tags),
    method: mock.request.method,
    url_kind: mock.request.url?.kind ?? null,
    url_value: mock.request.url?.value ?? null,
    status: mock.response.status,
    priority: mock.priority,
    // SQLite has no boolean; null still means "this backend has no such concept".
    enabled: mock.enabled === null ? null : mock.enabled ? 1 : 0,
    scenario: mock.state?.scenario ?? null,
    required_state: mock.state?.requiredState ?? null,
    new_state: mock.state?.newState ?? null,
    has_delay: mock.response.delay !== null ? 1 : 0,
    has_fault: mock.response.fault !== null ? 1 : 0,
    is_proxy: mock.response.proxy !== null ? 1 : 0,
    body_file: mock.response.body.kind === 'file' ? String(mock.response.body.value) : null,
    headers: headers.length > 0 ? JSON.stringify(headers) : null,
    header_text: headerSearchText(headers),
    content_hash: mock.contentHash,
    raw: JSON.stringify(mock.raw),
    body_excerpt: excerpt,
    body_truncated: truncated ? 1 : 0,
    fetched_at: fetchedAt,
  }
}

const INSERT_MOCK = `
INSERT INTO mock (
  profile_id, client_key, server_id, name, folder, folder_source, tags, method, url_kind,
  url_value, status, priority, enabled, scenario, required_state, new_state, has_delay,
  has_fault, is_proxy, body_file, headers, header_text, content_hash, raw, body_excerpt,
  body_truncated, fetched_at
) VALUES (
  @profile_id, @client_key, @server_id, @name, @folder, @folder_source, @tags, @method, @url_kind,
  @url_value, @status, @priority, @enabled, @scenario, @required_state, @new_state, @has_delay,
  @has_fault, @is_proxy, @body_file, @headers, @header_text, @content_hash, @raw, @body_excerpt,
  @body_truncated, @fetched_at
)`

/**
 * Replace a profile's whole corpus in one transaction.
 *
 * Full replace rather than diff-and-patch, because the upstream has no change feed: a stub that
 * vanished from the server has to vanish here too, and only a replace guarantees that. The FTS
 * index is rebuilt inside the same transaction so a reader never sees rows without their index.
 */
export function replaceCorpus(
  db: Db,
  profileId: string,
  mocks: readonly Mock[],
  fetchedAt: string,
): MirrorStats {
  const deleteExisting = db.prepare(`DELETE FROM mock WHERE profile_id = ?`)
  const insert = db.prepare(INSERT_MOCK)

  db.transaction(() => {
    deleteExisting.run(profileId)
    for (const mock of mocks) insert.run(toRow(profileId, mock, fetchedAt))
    // `rebuild` reindexes every profile's rows, not just this one. At 10k stubs that is a bulk
    // index build and cheap; if several large profiles are connected at once it becomes the
    // obvious thing to make incremental.
    db.exec(`INSERT INTO mock_fts(mock_fts) VALUES('rebuild')`)
  })()

  return { inserted: mocks.length, profileId, fetchedAt }
}

/**
 * Refresh a single stub after we wrote it, rather than re-ingesting the corpus.
 *
 * The FTS index is external-content, so the row has to be removed from it explicitly before the
 * replacement is indexed — an `INSERT` alone leaves the old terms searchable and the stub turns
 * up under text it no longer contains.
 */
export function replaceOne(db: Db, profileId: string, mock: Mock, fetchedAt: string): void {
  const insert = db.prepare(INSERT_MOCK)
  db.transaction(() => {
    db.prepare(`DELETE FROM mock WHERE profile_id = ? AND client_key = ?`).run(
      profileId,
      mock.clientKey,
    )
    insert.run(toRow(profileId, mock, fetchedAt))
    db.exec(`INSERT INTO mock_fts(mock_fts) VALUES('rebuild')`)
  })()
}

export interface MirrorStatus {
  readonly profileId: string
  readonly count: number
  /** ISO timestamp of the last ingest, or null when the profile has never been fetched. */
  readonly fetchedAt: string | null
  /** How old the mirror is, in seconds. The UI turns this into the stale-data affordance. */
  readonly ageSeconds: number | null
}

export function mirrorStatus(db: Db, profileId: string, now: Date): MirrorStatus {
  const row = db
    .prepare(`SELECT count(*) n, max(fetched_at) at FROM mock WHERE profile_id = ?`)
    .get(profileId) as { n: number; at: string | null }
  const fetchedAt = row.at
  return {
    profileId,
    count: row.n,
    fetchedAt,
    ageSeconds:
      fetchedAt === null
        ? null
        : Math.max(0, Math.round((now.getTime() - new Date(fetchedAt).getTime()) / 1000)),
  }
}
