import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { authKindSchema, composeAdminUrl } from '@mock-knight/core'
import { ADAPTER_IDS } from './adapters.js'
import type { Database as Db } from 'better-sqlite3'

/**
 * The profile store.
 *
 * A profile never holds a secret — only the **name** of the environment variable a secret
 * lives in (`authRef`). The resolved value exists in the server process for the lifetime of a
 * request and nowhere else: not in the database, not in a log line, not in a URL, and not in
 * anything sent to the browser (PRD §12, TECH-DESIGN §13).
 */

export const PROFILE_COLOURS = ['slate', 'indigo', 'cyan', 'violet', 'rose', 'olive'] as const
export const profileColourSchema = z.enum(PROFILE_COLOURS)

export const profileInputSchema = z.object({
  name: z.string().min(1).max(60),
  /**
   * Which backend this profile talks to. An enum built from the adapters this build actually
   * has, so a profile can never name one that cannot be constructed.
   */
  adapter: z.enum(ADAPTER_IDS),
  baseUrl: z.string().url(),
  adminPath: z.string().nullable().default(null),
  colour: profileColourSchema.default('indigo'),
  protected: z.boolean().default(false),
  readOnly: z.boolean().default(false),
  mappingsDir: z.string().nullable().default(null),
  authKind: authKindSchema.default('none'),
  /**
   * The credential itself, entered once and stored in the state database.
   *
   * This replaced an environment-variable *name*, which could only be set by restarting the
   * process with the variable exported — impossible to offer from a UI. Stored in plain text,
   * which is what the field says where it is offered; see migration 6.
   *
   * `authSecret` never leaves the server: the profile API strips it on the way out, so editing a
   * profile does not round-trip the password through the browser.
   */
  authUsername: z.string().nullable().default(null),
  authSecret: z.string().nullable().default(null),
  correlationHeader: z.string().nullable().default(null),
  redactHeaders: z.array(z.string()).default([]),
})
export type ProfileInput = z.infer<typeof profileInputSchema>

export interface Profile extends ProfileInput {
  id: string
  origin: 'config' | 'runtime'
  createdAt: string
  capabilities: string[] | null
  serverIdent: string | null
}

interface ProfileRow {
  id: string
  name: string
  adapter: string
  base_url: string
  admin_path: string | null
  colour: string | null
  protected: number
  read_only: number
  mappings_dir: string | null
  auth_kind: string | null
  auth_username: string | null
  auth_secret: string | null
  correlation_header: string | null
  redact_headers: string | null
  capabilities: string | null
  server_ident: string | null
  origin: string
  created_at: string
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    adapter: row.adapter,
    baseUrl: row.base_url,
    adminPath: row.admin_path,
    colour: (row.colour ?? 'indigo') as Profile['colour'],
    protected: row.protected === 1,
    readOnly: row.read_only === 1,
    mappingsDir: row.mappings_dir,
    authKind: (row.auth_kind ?? 'none') as Profile['authKind'],
    authUsername: row.auth_username,
    authSecret: row.auth_secret,
    correlationHeader: row.correlation_header,
    redactHeaders: row.redact_headers === null ? [] : (JSON.parse(row.redact_headers) as string[]),
    capabilities: row.capabilities === null ? null : (JSON.parse(row.capabilities) as string[]),
    serverIdent: row.server_ident,
    origin: row.origin === 'config' ? 'config' : 'runtime',
    createdAt: row.created_at,
  }
}

/**
 * The address a profile actually talks to — base URL, context path and admin path composed.
 *
 * This, not the base URL, is what makes two profiles the same server. `http://host:8080` and
 * `http://host:8080/` reach the same admin API, as do one profile leaving `adminPath` unset and
 * another spelling out `/__admin`. Comparing the raw strings would call those different and let
 * a duplicate through, which is the shape of the bug this exists to prevent.
 *
 * Returns `null` for a base URL that will not parse: an unusable profile cannot collide with
 * anything, and refusing to save it is the URL validator's job rather than this one's.
 */
export function adminUrlFor(profile: Pick<ProfileInput, 'baseUrl' | 'adminPath'>): string | null {
  try {
    return composeAdminUrl(profile.baseUrl, profile.adminPath)
  } catch {
    return null
  }
}

/**
 * The profile already pointing at that address, if any.
 *
 * @param exceptId a profile to ignore, so editing one does not report it as colliding with
 *   itself.
 */
export function findProfileByAdminUrl(
  db: Db,
  target: Pick<ProfileInput, 'baseUrl' | 'adminPath'>,
  exceptId?: string,
): Profile | null {
  const wanted = adminUrlFor(target)
  if (wanted === null) return null
  return (
    listProfiles(db).find(
      (profile) => profile.id !== exceptId && adminUrlFor(profile) === wanted,
    ) ?? null
  )
}

/**
 * A profile as the browser may see it: everything except the credential.
 *
 * The one place that decides this, so a new route cannot forget. `authSecret` is replaced by a
 * boolean — the form needs to know a password is *set* in order to show "leave blank to keep it",
 * and that is the only fact about it the browser is entitled to.
 *
 * The username is not secret and is returned, so an edit does not silently blank it.
 */
export type PublicProfile = Omit<Profile, 'authSecret'> & {
  /** A credential is available — stored, or typed in during this run. */
  authSecretSet: boolean
  /** It is on disk, so it survives a restart. Drives the "remember" box on the form. */
  authSecretRemembered: boolean
}

export function redactProfile(profile: Profile, heldForSession = false): PublicProfile {
  const { authSecret, ...rest } = profile
  const stored = (authSecret ?? '') !== ''
  return { ...rest, authSecretSet: stored || heldForSession, authSecretRemembered: stored }
}

export function listProfiles(db: Db): Profile[] {
  const rows = db.prepare(`SELECT * FROM profile ORDER BY created_at, name`).all() as ProfileRow[]
  return rows.map(toProfile)
}

export function getProfile(db: Db, id: string): Profile | null {
  const row = db.prepare(`SELECT * FROM profile WHERE id = ?`).get(id) as ProfileRow | undefined
  return row === undefined ? null : toProfile(row)
}

export function createProfile(
  db: Db,
  input: ProfileInput,
  options: { id?: string; origin?: 'config' | 'runtime'; now?: Date } = {},
): Profile {
  const id = options.id ?? randomUUID()
  const createdAt = (options.now ?? new Date()).toISOString()
  db.prepare(
    `INSERT INTO profile (id, name, adapter, base_url, admin_path, colour, protected, read_only,
                          mappings_dir, auth_kind, auth_username, auth_secret,
                          correlation_header, redact_headers, origin, created_at)
     VALUES (@id, @name, @adapter, @base_url, @admin_path, @colour, @protected, @read_only,
             @mappings_dir, @auth_kind, @auth_username, @auth_secret,
             @correlation_header, @redact_headers, @origin, @created_at)`,
  ).run({
    id,
    name: input.name,
    adapter: input.adapter,
    base_url: input.baseUrl,
    admin_path: input.adminPath,
    colour: input.colour,
    protected: input.protected ? 1 : 0,
    read_only: input.readOnly ? 1 : 0,
    mappings_dir: input.mappingsDir,
    auth_kind: input.authKind,
    auth_username: input.authUsername,
    auth_secret: input.authSecret,
    correlation_header: input.correlationHeader,
    redact_headers: JSON.stringify(input.redactHeaders),
    origin: options.origin ?? 'runtime',
    created_at: createdAt,
  })
  return getProfile(db, id)!
}

/**
 * Edit a profile in place.
 *
 * The id is stable across edits on purpose: it keys the mirror, the audit trail, and any URL
 * someone has pasted into Slack. Correcting a typo in a URL must not orphan all of that.
 *
 * Changing where a profile points invalidates the mirror — the stubs on the new server are not
 * the stubs we cached from the old one — so the caller is expected to drop it. `updateProfile`
 * reports whether that happened rather than deciding silently.
 */
export function updateProfile(
  db: Db,
  id: string,
  input: ProfileInput,
): { profile: Profile; targetChanged: boolean } | null {
  const existing = getProfile(db, id)
  if (existing === null) return null

  // The document counts as the target for a document-backed backend: it *is* where the corpus
  // comes from, so pointing at a different file is pointing at a different corpus.
  const targetChanged =
    existing.baseUrl !== input.baseUrl ||
    existing.adminPath !== input.adminPath ||
    existing.mappingsDir !== input.mappingsDir

  db.prepare(
    `UPDATE profile SET name = @name, base_url = @base_url, admin_path = @admin_path,
       colour = @colour, protected = @protected, read_only = @read_only,
       mappings_dir = @mappings_dir,
       auth_kind = @auth_kind, auth_username = @auth_username, auth_secret = @auth_secret,
       correlation_header = @correlation_header,
       redact_headers = @redact_headers
     WHERE id = @id`,
  ).run({
    id,
    name: input.name,
    base_url: input.baseUrl,
    admin_path: input.adminPath,
    colour: input.colour,
    protected: input.protected ? 1 : 0,
    read_only: input.readOnly ? 1 : 0,
    mappings_dir: input.mappingsDir,
    auth_kind: input.authKind,
    auth_username: input.authUsername,
    auth_secret: input.authSecret,
    correlation_header: input.correlationHeader,
    redact_headers: JSON.stringify(input.redactHeaders),
  })

  if (targetChanged) {
    // Anything derived from the old server is now a lie about the new one.
    db.prepare(`DELETE FROM mock WHERE profile_id = ?`).run(id)
    db.prepare(`DELETE FROM serve_event WHERE profile_id = ?`).run(id)
    db.prepare(`DELETE FROM journal_window WHERE profile_id = ?`).run(id)
    db.prepare(`UPDATE profile SET capabilities = NULL, server_ident = NULL WHERE id = ?`).run(id)
  }

  return { profile: getProfile(db, id)!, targetChanged }
}

export function recordConnection(
  db: Db,
  id: string,
  capabilities: readonly string[],
  fingerprint: string,
): void {
  db.prepare(`UPDATE profile SET capabilities = ?, server_ident = ? WHERE id = ?`).run(
    JSON.stringify(capabilities),
    fingerprint,
    id,
  )
}

export function deleteProfile(db: Db, id: string): boolean {
  return db.prepare(`DELETE FROM profile WHERE id = ?`).run(id).changes > 0
}
