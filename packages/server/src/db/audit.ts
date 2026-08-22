import { canonicalJson } from '@mock-knight/core'
import type { Json } from '@mock-knight/core'
import type { Database as Db } from 'better-sqlite3'

/**
 * The local audit trail — FR-EDIT-8.
 *
 * It is honest about its scope in two ways that the UI must repeat. It records only changes
 * made **through Mock Knight**; a `curl` against the same server leaves no trace here. And in
 * local mode the actor is a best-effort identity, not an authenticated one.
 *
 * The table deliberately has no foreign key to `profile` (TECH-DESIGN §6.2): the record of a
 * change has to outlive the profile it was made against, or deleting a profile becomes a way to
 * erase history.
 */

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'bulk',
  'import',
  'reset',
  'state',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export interface AuditEntry {
  readonly profileId: string
  readonly actor: string
  readonly action: AuditAction
  readonly clientKey: string | null
  readonly before: Json | null
  readonly after: Json | null
  readonly summary: string
  readonly at?: string
}

export function recordAudit(db: Db, entry: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit (profile_id, at, actor, action, client_key, before, after, summary)
     VALUES (@profile_id, @at, @actor, @action, @client_key, @before, @after, @summary)`,
  ).run({
    profile_id: entry.profileId,
    at: entry.at ?? new Date().toISOString(),
    actor: entry.actor,
    action: entry.action,
    client_key: entry.clientKey,
    // Canonical, so an audit diff shows what actually changed rather than reordered keys.
    before: entry.before === null ? null : canonicalJson(entry.before),
    after: entry.after === null ? null : canonicalJson(entry.after),
    summary: entry.summary,
  })
}

export interface AuditRow {
  id: number
  at: string
  actor: string
  action: string
  clientKey: string | null
  summary: string
  before: string | null
  after: string | null
}

export function listAudit(
  db: Db,
  profileId: string,
  options: { clientKey?: string; limit: number },
): AuditRow[] {
  const where = ['profile_id = ?']
  const params: unknown[] = [profileId]
  if (options.clientKey !== undefined) {
    where.push('client_key = ?')
    params.push(options.clientKey)
  }
  const rows = db
    .prepare(
      `SELECT id, at, actor, action, client_key, summary, before, after
       FROM audit WHERE ${where.join(' AND ')} ORDER BY at DESC, id DESC LIMIT ?`,
    )
    .all(...params, options.limit) as {
    id: number
    at: string
    actor: string
    action: string
    client_key: string | null
    summary: string
    before: string | null
    after: string | null
  }[]
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    actor: row.actor,
    action: row.action,
    clientKey: row.client_key,
    summary: row.summary,
    before: row.before,
    after: row.after,
  }))
}
