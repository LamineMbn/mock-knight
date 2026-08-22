import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'
import { MIGRATIONS, SCHEMA_VERSION } from './schema.js'

/**
 * The mirror connection — TECH-DESIGN §6.1 and §6.5.
 *
 * **One `Database` handle per thread.** better-sqlite3 compiles with `SQLITE_THREADSAFE=2`, so
 * a handle is neither cloneable nor transferable over `postMessage`; the ingest worker opens
 * its own. WAL plus `busy_timeout` is what lets the main thread keep reading while that worker
 * writes, so neither pragma is optional.
 */

export interface OpenDatabaseOptions {
  /** `false` skips WAL, for `:memory:` databases where it is not available. */
  readonly wal?: boolean
}

export function openDatabase(path: string, options: OpenDatabaseOptions = {}): Db {
  const inMemory = path === ':memory:'
  if (!inMemory) mkdirSync(dirname(path), { recursive: true })

  const db = new Database(path)

  if (options.wal ?? !inMemory) db.pragma('journal_mode = WAL')
  // NORMAL is safe here *because the mirror is disposable*: if the process is killed mid-ingest
  // the fix is a re-fetch, not data recovery. `audit` is the one table that is not disposable,
  // and it is written in small committed transactions.
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')

  migrate(db)
  return db
}

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current === SCHEMA_VERSION) return
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `This state database was written by a newer Mock Knight (schema v${current}, this build ` +
        `understands v${SCHEMA_VERSION}). Upgrade Mock Knight, or delete the state file — it is ` +
        `a disposable cache, though deleting it also discards the local audit trail.`,
    )
  }

  const pending = MIGRATIONS.filter((migration) => migration.version > current)
  db.transaction(() => {
    for (const migration of pending) {
      db.exec(migration.sql)
      // Pragmas cannot be parameterised, and the value is an integer literal from our own table.
      db.pragma(`user_version = ${migration.version}`)
    }
  })()
}
