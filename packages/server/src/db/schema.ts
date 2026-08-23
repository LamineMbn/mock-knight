/**
 * The mirror schema — TECH-DESIGN §6.2.
 *
 * Held as a string rather than a `.sql` file so the published tarball stays a single bundle
 * with no runtime asset loading (§16: no build step at runtime).
 *
 * Two things here are load-bearing and easy to break:
 *
 *  - **Every `mock_fts` column must exist on `mock`.** With `content='mock'`, FTS5 accepts a
 *    CREATE naming a column that isn't there and only fails later, at rebuild, with
 *    `no such column`. There is a test that rebuilds precisely to catch that.
 *  - **`detail=full` is not optional.** `detail=none` and `detail=column` break queries whose
 *    tokens are longer than three characters.
 *
 * `audit` deliberately has **no foreign key**: the record of a change has to outlive the
 * profile it was made against. Every other child table cascades.
 */

export interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

const INITIAL = `
CREATE TABLE profile (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  adapter       TEXT NOT NULL,
  base_url      TEXT NOT NULL,
  admin_path    TEXT,
  colour        TEXT,
  protected     INTEGER NOT NULL DEFAULT 0,
  read_only     INTEGER NOT NULL DEFAULT 0,
  mappings_dir  TEXT,
  auth_kind     TEXT,
  auth_ref      TEXT,
  correlation_header TEXT,
  redact_headers TEXT,
  capabilities  TEXT,
  server_ident  TEXT,
  origin        TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE mock (
  rowid         INTEGER PRIMARY KEY,
  profile_id    TEXT NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  client_key    TEXT NOT NULL,
  server_id     TEXT,
  name          TEXT,
  folder        TEXT,
  folder_source TEXT,
  tags          TEXT,
  method        TEXT,
  url_kind      TEXT,
  url_value     TEXT,
  status        INTEGER,
  priority      INTEGER,
  enabled       INTEGER,
  scenario      TEXT,
  required_state TEXT,
  new_state     TEXT,
  has_delay     INTEGER,
  has_fault     INTEGER,
  is_proxy      INTEGER,
  body_file     TEXT,
  content_hash  TEXT NOT NULL,
  raw           TEXT NOT NULL,
  body_excerpt  TEXT,
  body_truncated INTEGER NOT NULL DEFAULT 0,
  source_file   TEXT,
  last_served_at TEXT,
  fetched_at    TEXT NOT NULL,
  UNIQUE (profile_id, client_key)
);
CREATE INDEX mock_facets ON mock(profile_id, method, status, scenario, folder);
CREATE INDEX mock_srvid  ON mock(profile_id, server_id);
CREATE INDEX mock_prio   ON mock(profile_id, priority);

CREATE VIRTUAL TABLE mock_fts USING fts5(
  url_value, name, folder, tags, body_excerpt,
  tokenize = 'trigram',
  detail   = 'full',
  content  = 'mock',
  content_rowid = 'rowid'
);

CREATE TABLE serve_event (
  id           INTEGER PRIMARY KEY,
  profile_id   TEXT NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  upstream_id  TEXT NOT NULL,
  at           TEXT NOT NULL,
  matched      INTEGER NOT NULL,
  matched_key  TEXT,
  method TEXT, url TEXT, status INTEGER, duration_ms INTEGER,
  correlation  TEXT,
  raw          TEXT NOT NULL,
  UNIQUE (profile_id, upstream_id)
);
CREATE INDEX se_time ON serve_event(profile_id, at DESC);
CREATE INDEX se_corr ON serve_event(profile_id, correlation);
CREATE INDEX se_key  ON serve_event(profile_id, matched_key);

CREATE TABLE journal_window (
  profile_id  TEXT PRIMARY KEY REFERENCES profile(id) ON DELETE CASCADE,
  earliest_at TEXT,
  observed_at TEXT NOT NULL,
  reset_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audit (
  id          INTEGER PRIMARY KEY,
  profile_id  TEXT NOT NULL,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  client_key  TEXT,
  before      TEXT,
  after       TEXT,
  summary     TEXT NOT NULL
);
CREATE INDEX audit_profile ON audit(profile_id, at DESC);

CREATE TABLE draft (
  profile_id TEXT NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  client_key TEXT NOT NULL,
  body TEXT NOT NULL,
  base_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, client_key)
);

CREATE TABLE saved_search (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  UNIQUE (profile_id, name)
);
CREATE INDEX ss_profile ON saved_search(profile_id);
`

/**
 * Header matchers, added after the schema was first written.
 *
 * Stubs selected by a header are not a corner case: on a real corpus, 525 of 582 stubs were
 * distinguished only by `X-Mock`, so without this the list showed nine identical-looking rows
 * and search could not tell them apart.
 *
 * Two columns for the same reason `raw` and `body_excerpt` are separate: `headers` is JSON the
 * UI renders, `header_text` is the flattened `name=value` form the FTS index actually searches.
 * Indexing the JSON directly would make a free-text search for `equalTo` match everything.
 *
 * The FTS table has to be dropped and recreated — an external-content table's column list is
 * fixed at creation. The mirror is emptied in the same transaction rather than left half
 * indexed: it is a disposable cache (CLAUDE.md invariant 6), and the next refresh refills it.
 * Leaving stale rows would mean header search silently missing everything ingested before the
 * upgrade, which is the failure mode this whole feature exists to prevent.
 */
const ADD_HEADER_MATCHERS = `
ALTER TABLE mock ADD COLUMN headers TEXT;
ALTER TABLE mock ADD COLUMN header_text TEXT;

DELETE FROM mock;

DROP TABLE mock_fts;
CREATE VIRTUAL TABLE mock_fts USING fts5(
  url_value, name, folder, tags, body_excerpt, header_text,
  tokenize = 'trigram',
  detail   = 'full',
  content  = 'mock',
  content_rowid = 'rowid'
);
`

/**
 * An index for overlap detection (FR-FIND-7).
 *
 * Priority standing asks, for every row on the page, "what else can match this method and
 * path?" — a correlated count over the whole profile's corpus. Without an index that is a full
 * scan per row: at the 10k fixture, fifty rows a page, half a million rows visited to draw one
 * screen. The index turns each of those counts into a range seek.
 *
 * Index-only, so unlike v2 it keeps the mirror. Nothing needs re-ingesting to benefit.
 */
const ADD_PATH_INDEX = `
CREATE INDEX mock_path ON mock(profile_id, url_value, method);
`

/**
 * Room for the timing WireMock already reports.
 *
 * `duration_ms` has existed since v1 and was written as `null` on every row — a column that
 * looks like data and never held any. The upstream event carries `timing.totalTime` and
 * `timing.addedDelay`, and the second one matters: on a mock server a slow response is usually
 * deliberate, so a total without the configured delay beside it reads as a problem when it is a
 * setting.
 *
 * Additive and nullable, so the mirror survives. Rows ingested before this stay `null`, which
 * is the honest value for "we did not record it".
 */
const ADD_SERVE_TIMING = `
ALTER TABLE serve_event ADD COLUMN added_delay_ms INTEGER;
`

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial mirror schema', sql: INITIAL },
  { version: 2, name: 'index request header matchers', sql: ADD_HEADER_MATCHERS },
  { version: 3, name: 'index url and method for overlap detection', sql: ADD_PATH_INDEX },
  { version: 4, name: 'record serve timing', sql: ADD_SERVE_TIMING },
]

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version

/** The `mock_fts` columns, which must all exist on `mock`. Asserted by a test. */
export const FTS_COLUMNS = [
  'url_value',
  'name',
  'folder',
  'tags',
  'body_excerpt',
  'header_text',
] as const
