import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import { openDatabase } from './db/database.js'
import { createProfile } from './profiles.js'
import { ConnectionRegistry, incompleteAuth } from './runtime.js'
import { createApp } from './app.js'

/**
 * Authentication, against a WireMock that actually requires it.
 *
 * Every other tier runs against an open server, so the whole auth path — env-var resolution,
 * header construction, the 401 that comes back without it — had never once been executed against
 * something that refuses. An auth implementation nothing has authenticated with is a guess.
 *
 * Needs a second WireMock, secured:
 *   docker run -d --name mk-wiremock-auth -p 18097:8080 wiremock/wiremock:3.13.1 \
 *     --admin-api-basic-auth mkuser:mkpass
 */

const URL_ = process.env['MOCK_KNIGHT_TEST_WIREMOCK_AUTH_URL'] ?? 'http://localhost:18097'
const USER = 'mkuser'
const PASS = 'mkpass'

let directory: string
let db: Db
let registry: ConnectionRegistry
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  const probe = await fetch(`${URL_}/__admin/version`).catch(() => null)
  if (probe === null) {
    throw new Error(
      `No WireMock at ${URL_}. Start a secured one with:\n` +
        `  docker run -d --name mk-wiremock-auth -p 18097:8080 wiremock/wiremock:3.13.1 ` +
        `--admin-api-basic-auth ${USER}:${PASS}`,
    )
  }
  // The premise of the file. If this ever returns 200 the server is not secured and every
  // assertion below becomes meaningless.
  expect(probe.status).toBe(401)

  directory = mkdtempSync(join(tmpdir(), 'mk-auth-'))
  db = openDatabase(join(directory, 'state.db'))
  registry = new ConnectionRegistry(db, 'local')
  app = createApp({ db, registry, mode: 'local', version: 'test' })
})

afterAll(async () => {
  await registry.closeAll()
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

const profileWith = (
  authKind: string,
  credential: { username?: string; secret?: string },
  name: string,
): string =>
  createProfile(db, {
    name,
    adapter: 'wiremock',
    baseUrl: URL_,
    adminPath: null,
    colour: 'indigo',
    protected: false,
    readOnly: false,
    mappingsDir: null,
    authKind: authKind as 'basic',
    authUsername: credential.username ?? null,
    authSecret: credential.secret ?? null,
    correlationHeader: null,
    redactHeaders: [],
  }).id

describe('connecting to a server that requires credentials', () => {
  it('is refused, and says a credential is what is missing', async () => {
    const id = profileWith('none', {}, 'no auth')
    const response = await app.request(`/api/profiles/${id}/connect`, { method: 'POST' })
    const body = (await response.json()) as { message: string; upstream: { status: number } }

    expect(response.status).toBe(502)
    expect(body.upstream.status).toBe(401)
    // "The mock server rejected GET /__admin/version" is true and useless: the fix is a
    // credential, and the sentence has to say so or the status sits unread in a disclosure.
    expect(body.message).toMatch(/requires credentials/)
  })

  it('succeeds with a username and password entered directly', async () => {
    const id = profileWith('basic', { username: USER, secret: PASS }, 'basic')
    const response = await app.request(`/api/profiles/${id}/connect`, { method: 'POST' })
    const body = (await response.json()) as { connected: boolean; version: string | null }
    expect(response.status).toBe(200)
    expect(body.connected).toBe(true)
    expect(body.version).not.toBeNull()

    // And the corpus is actually readable, not just the version probe.
    expect((await app.request(`/api/${id}/refresh`, { method: 'POST' })).status).toBe(200)
  })

  it('says which half of the credential is missing, before sending anything', async () => {
    const id = profileWith('basic', { username: USER }, 'no password')
    const response = await app.request(`/api/profiles/${id}/connect`, { method: 'POST' })
    const body = (await response.json()) as { error: string; message: string }

    // 400, not 502: nothing was sent and no server refused us, so blaming the mock server — as
    // `internal_error` and a 500 both did — points at the wrong thing entirely.
    expect(response.status).toBe(400)
    expect(body.error).toBe('profile_misconfigured')
    expect(body.message).toMatch(/no a password/)
  })

  it('never sends the stored password to the browser', async () => {
    const id = profileWith('basic', { username: USER, secret: PASS }, 'secrecy')
    await app.request(`/api/profiles/${id}/connect`, { method: 'POST' })

    const listed = await (await app.request('/api/profiles')).text()
    // The credential is stored now rather than referenced, which makes this the load-bearing
    // assertion: it must not cross the socket, or every browser tab and every screenshot has it.
    expect(listed).not.toContain(PASS)
    // The username is not secret and does come back, so an edit does not silently blank it, and
    // the form learns that a password exists without being given it.
    expect(listed).toContain(USER)
    expect(listed).toContain('"authSecretSet":true')
  })
})

describe('incompleteAuth', () => {
  it('names the half that is missing', () => {
    expect(incompleteAuth({ authKind: 'basic', authUsername: 'ci', authSecret: null })).toBe(
      'a password',
    )
  })

  it('has nothing to say once both halves are there', () => {
    expect(incompleteAuth({ authKind: 'basic', authUsername: 'ci', authSecret: 'p' })).toBeNull()
  })
})
