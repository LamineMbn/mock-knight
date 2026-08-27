import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import { openDatabase } from './db/database.js'
import { createProfile, listProfiles, redactProfile } from './profiles.js'
import { CredentialStore } from './credentials.js'
import { ConnectionRegistry } from './runtime.js'
import { createApp } from './app.js'

/**
 * Credentials are held for this run unless the user asks otherwise.
 *
 * The property worth protecting: a password nobody asked to keep must not reach the database,
 * because a file is what gets copied into a backup, a synced home directory, a support bundle or
 * a screen share. These assert against the stored row rather than the API's own reporting, so a
 * bug in `redactProfile` cannot make them pass.
 */

let directory: string
let db: Db
let credentials: CredentialStore
let app: ReturnType<typeof createApp>

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mk-cred-'))
  db = openDatabase(join(directory, 'state.db'))
  credentials = new CredentialStore()
  app = createApp({
    db,
    registry: new ConnectionRegistry(db, 'local', undefined, credentials),
    mode: 'local',
    version: 'test',
    credentials,
  })
})

afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

const save = (body: Record<string, unknown>) =>
  app.request('/api/profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'p',
      adapter: 'wiremock',
      baseUrl: 'http://localhost:18099',
      authKind: 'basic',
      authUsername: 'ci',
      ...body,
    }),
  })

const storedSecret = (): string | null => listProfiles(db)[0]?.authSecret ?? null

describe('a credential the user did not ask to keep', () => {
  it('is never written to the database', async () => {
    await save({ authSecret: 'hunter2' })
    expect(storedSecret()).toBeNull()
  })

  it('is still usable for this run', async () => {
    const created = (await (await save({ authSecret: 'hunter2' })).json()) as {
      profile: { id: string; authSecretSet: boolean; authSecretRemembered: boolean }
    }
    expect(credentials.get(created.profile.id)?.secret).toBe('hunter2')
    // The form needs to know a credential exists without being given it, and needs to know it
    // is *not* remembered so the box reflects reality.
    expect(created.profile.authSecretSet).toBe(true)
    expect(created.profile.authSecretRemembered).toBe(false)
  })

  it('is written only when remembering is asked for', async () => {
    await save({ authSecret: 'hunter2', rememberSecret: true })
    expect(storedSecret()).toBe('hunter2')
  })
})

describe('editing a profile', () => {
  const create = async (over: Record<string, unknown>) =>
    ((await (await save(over)).json()) as { profile: { id: string } }).profile.id

  const patch = (id: string, body: Record<string, unknown>) =>
    app.request(`/api/profiles/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'renamed',
        adapter: 'wiremock',
        baseUrl: 'http://localhost:18099',
        authKind: 'basic',
        authUsername: 'ci',
        ...body,
      }),
    })

  it('keeps a stored credential when the password is not retyped', async () => {
    // The browser was never given the password, so it has nothing to resend. Without this,
    // renaming a server would silently wipe its credential.
    const id = await create({ authSecret: 'hunter2', rememberSecret: true })
    await patch(id, { rememberSecret: true })
    expect(storedSecret()).toBe('hunter2')
  })

  it('moves a stored credential into memory when remembering is turned off', async () => {
    const id = await create({ authSecret: 'hunter2', rememberSecret: true })
    await patch(id, { rememberSecret: false })
    expect(storedSecret()).toBeNull()
    // Not lost — the user asked for it to stop being written, not to stop working.
    expect(credentials.get(id)?.secret).toBe('hunter2')
  })

  it('clears both when authentication is switched off', async () => {
    const id = await create({ authSecret: 'hunter2', rememberSecret: true })
    await patch(id, { authKind: 'none', authUsername: null })
    expect(storedSecret()).toBeNull()
    // This is the only way to remove a stored credential, so it has to actually remove it.
    expect(credentials.has(id)).toBe(false)
  })

  it('forgets the held credential when the profile is deleted', async () => {
    const id = await create({ authSecret: 'hunter2' })
    expect(credentials.has(id)).toBe(true)
    await app.request(`/api/profiles/${id}`, { method: 'DELETE' })
    expect(credentials.has(id)).toBe(false)
  })
})

describe('redactProfile', () => {
  it('never carries the secret, whichever way it is held', () => {
    const profile = createProfile(db, {
      name: 'p',
      adapter: 'wiremock',
      baseUrl: 'http://x',
      adminPath: null,
      colour: 'indigo',
      protected: false,
      readOnly: false,
      mappingsDir: null,
      authKind: 'basic',
      authUsername: 'ci',
      authSecret: 'hunter2',
      correlationHeader: null,
      redactHeaders: [],
    })
    expect(JSON.stringify(redactProfile(profile))).not.toContain('hunter2')
    // The username is not secret, and blanking it on an edit would be a different bug.
    expect(redactProfile(profile).authUsername).toBe('ci')
  })
})
