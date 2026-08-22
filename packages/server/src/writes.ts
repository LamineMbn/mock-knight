import diff from 'microdiff'
import type { Json, JsonObject, Mock } from '@mock-knight/core'
import type { Database as Db } from 'better-sqlite3'
import { recordAudit } from './db/audit.js'
import { replaceOne } from './db/mirror.js'
import type { Connection } from './runtime.js'
import type { Profile } from './profiles.js'

/**
 * Every write to a mock server goes through here.
 *
 * **The rule this file exists to enforce** (CLAUDE.md invariant 5): re-read the stub from the
 * *server* and compare its content hash immediately before writing. Not from the mirror — the
 * mirror is exactly as stale as the thing we are guarding against. Without this, two developers
 * on one shared server silently overwrite each other, and the loser never finds out.
 *
 * **What it does not promise.** A few milliseconds pass between the re-read and the write, and
 * WireMock offers no compare-and-swap, so that window cannot be closed. It is narrowed as far
 * as it can be, and every write is recorded in `audit` with before and after, so a lost update
 * is recoverable rather than invisible. That is the honest guarantee, and it is the one stated
 * in the docs (TECH-DESIGN §7.2).
 */

export type WriteOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'unsupported' }
  | { ok: false; reason: 'not_found' }
  | {
      ok: false
      reason: 'conflict'
      /** What the server holds right now, so the UI can render a three-way merge. */
      current: JsonObject
      currentHash: string
      /** What the caller believed it was editing. */
      baseHash: string
      /** A human sentence naming what moved underneath them. */
      summary: string
    }

export interface WriteContext {
  readonly db: Db
  readonly profile: Profile
  readonly connection: Connection
  readonly actor: string
}

/** Plain-language description of a change, from a structural diff (TECH-DESIGN §2, Diff). */
export function describeChange(before: Json, after: Json): string {
  const changes = diff(
    (before ?? {}) as Record<string, unknown>,
    (after ?? {}) as Record<string, unknown>,
  )
  if (changes.length === 0) return 'no change'

  const describe = (entry: (typeof changes)[number]): string => {
    const path = entry.path.join('.')
    if (entry.type === 'CREATE') return `added ${path}`
    if (entry.type === 'REMOVE') return `removed ${path}`
    return `changed ${path}`
  }
  const first = changes.slice(0, 3).map(describe)
  return changes.length <= 3
    ? first.join(', ')
    : `${first.join(', ')} and ${changes.length - 3} more`
}

/**
 * Re-read one stub from the server and confirm it still hashes to what the caller edited.
 *
 * `mock.read` being off is not a reason to skip the check — it is a reason to refuse the write.
 * Writing blind on a shared server is the failure this guard exists to prevent, so a backend
 * that cannot support the guard does not get the write.
 */
async function verifyUnchanged(
  context: WriteContext,
  serverId: string,
  baseHash: string,
): Promise<{ ok: true; current: Mock } | Extract<WriteOutcome<never>, { ok: false }>> {
  const { connection } = context
  if (connection.adapter.getMock === undefined) return { ok: false, reason: 'unsupported' }

  let current: Mock
  try {
    current = await connection.adapter.getMock(serverId)
  } catch {
    // Gone from the server between our mirror and now — a delete by someone else is itself a
    // conflict, not a missing route.
    return { ok: false, reason: 'not_found' }
  }

  if (current.contentHash !== baseHash) {
    return {
      ok: false,
      reason: 'conflict',
      current: current.raw,
      currentHash: current.contentHash,
      baseHash,
      summary: `This stub changed on ${context.profile.name} while you were editing it.`,
    }
  }
  return { ok: true, current }
}

export interface UpdateRequest {
  readonly clientKey: string
  readonly serverId: string
  readonly raw: JsonObject
  readonly baseHash: string
}

export async function updateMock(
  context: WriteContext,
  request: UpdateRequest,
): Promise<WriteOutcome<Mock>> {
  const { connection, db, profile, actor } = context
  if (connection.adapter.updateMock === undefined) return { ok: false, reason: 'unsupported' }

  const verified = await verifyUnchanged(context, request.serverId, request.baseHash)
  if (!verified.ok) return verified

  // Derive the canonical view from the document being written, not from the one that was read.
  // Mixing the two makes `toVendor` treat the user's edit as a field to patch back out — which
  // it did: the write succeeded, the server was unchanged, and the audit summary said
  // "no change".
  const written = await connection.adapter.updateMock(
    request.serverId,
    connection.adapter.interpret(request.raw),
  )

  replaceOne(db, profile.id, written, new Date().toISOString())
  recordAudit(db, {
    profileId: profile.id,
    actor,
    action: 'update',
    clientKey: written.clientKey,
    before: verified.current.raw,
    after: written.raw,
    summary: describeChange(verified.current.raw, written.raw),
  })
  return { ok: true, value: written }
}

export async function createMock(
  context: WriteContext,
  raw: JsonObject,
): Promise<WriteOutcome<Mock>> {
  const { connection, db, profile, actor } = context
  if (connection.adapter.createMock === undefined) return { ok: false, reason: 'unsupported' }

  const written = await connection.adapter.createMock(connection.adapter.interpret(raw))

  replaceOne(db, profile.id, written, new Date().toISOString())
  recordAudit(db, {
    profileId: profile.id,
    actor,
    action: 'create',
    clientKey: written.clientKey,
    before: null,
    after: written.raw,
    summary: `created ${written.name ?? written.request.url?.value ?? 'a stub'}`,
  })
  return { ok: true, value: written }
}

export async function deleteMock(
  context: WriteContext,
  request: { clientKey: string; serverId: string; baseHash: string },
): Promise<WriteOutcome<null>> {
  const { connection, db, profile, actor } = context
  if (connection.adapter.deleteMock === undefined) return { ok: false, reason: 'unsupported' }

  // A delete is checked exactly as hard as an update. Deleting someone else's edit is worse
  // than overwriting it, because there is nothing left on screen to notice.
  const verified = await verifyUnchanged(context, request.serverId, request.baseHash)
  if (!verified.ok) return verified

  await connection.adapter.deleteMock(request.serverId)
  db.prepare(`DELETE FROM mock WHERE profile_id = ? AND client_key = ?`).run(
    profile.id,
    request.clientKey,
  )
  recordAudit(db, {
    profileId: profile.id,
    actor,
    action: 'delete',
    clientKey: request.clientKey,
    before: verified.current.raw,
    after: null,
    summary: `deleted ${verified.current.name ?? verified.current.request.url?.value ?? 'a stub'}`,
  })
  return { ok: true, value: null }
}
