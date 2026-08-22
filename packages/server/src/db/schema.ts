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

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial mirror schema', sql: INITIAL },
]

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version

/** The `mock_fts` columns, which must all exist on `mock`. Asserted by a test. */
export const FTS_COLUMNS = ['url_value', 'name', 'folder', 'tags', 'body_excerpt'] as const
