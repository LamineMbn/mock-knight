import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { authKindSchema } from '@mock-knight/core'
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
  adapter: z.literal('wiremock'),
  baseUrl: z.string().url(),
  adminPath: z.string().nullable().default(null),
  colour: profileColourSchema.default('indigo'),
  protected: z.boolean().default(false),
  readOnly: z.boolean().default(false),
  mappingsDir: z.string().nullable().default(null),
  authKind: authKindSchema.default('none'),
  /** Env-var NAME(s), never a value. */
  authRef: z.string().nullable().default(null),
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
  auth_ref: string | null
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
    adapter: 'wiremock',
    baseUrl: row.base_url,
    adminPath: row.admin_path,
    colour: (row.colour ?? 'indigo') as Profile['colour'],
    protected: row.protected === 1,
    readOnly: row.read_only === 1,
    mappingsDir: row.mappings_dir,
    authKind: (row.auth_kind ?? 'none') as Profile['authKind'],
    authRef: row.auth_ref,
    correlationHeader: row.correlation_header,
    redactHeaders: row.redact_headers === null ? [] : (JSON.parse(row.redact_headers) as string[]),
    capabilities: row.capabilities === null ? null : (JSON.parse(row.capabilities) as string[]),
    serverIdent: row.server_ident,
    origin: row.origin === 'config' ? 'config' : 'runtime',
    createdAt: row.created_at,
  }
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
                          mappings_dir, auth_kind, auth_ref, correlation_header, redact_headers,
                          origin, created_at)
     VALUES (@id, @name, @adapter, @base_url, @admin_path, @colour, @protected, @read_only,
             @mappings_dir, @auth_kind, @auth_ref, @correlation_header, @redact_headers,
             @origin, @created_at)`,
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
    auth_ref: input.authRef,
    correlation_header: input.correlationHeader,
    redact_headers: JSON.stringify(input.redactHeaders),
    origin: options.origin ?? 'runtime',
    created_at: createdAt,
  })
  return getProfile(db, id)!
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
