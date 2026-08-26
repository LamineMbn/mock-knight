import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import { openDatabase } from './db/database.js'
import { createProfile } from './profiles.js'
import { ConnectionRegistry, missingAuthVariables } from './runtime.js'
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

const profileWith = (authKind: string, authRef: string | null, name: string): string =>
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
    authRef,
    correlationHeader: null,
    redactHeaders: [],
  }).id

describe('connecting to a server that requires credentials', () => {
  it('is refused, and says a credential is what is missing', async () => {
    const id = profileWith('none', null, 'no auth')
    const response = await app.request(`/api/profiles/${id}/connect`, { method: 'POST' })
    const body = (await response.json()) as { message: string; upstream: { status: number } }

    expect(response.status).toBe(502)
    expect(body.upstream.status).toBe(401)
    // "The mock server rejected GET /__admin/version" is true and useless: the fix is a
    // credential, and the sentence has to say so or the status sits unread in a disclosure.
    expect(body.message).toMatch(/requires credentials/)
  })

  it('succeeds with basic auth resolved from environment variables', async () => {
    const id = profileWith('basic', 'MK_TEST_USER:MK_TEST_PASS', 'basic')
    process.env['MK_TEST_USER'] = USER
    process.env['MK_TEST_PASS'] = PASS
    try {
      const response = await app.request(`/api/profiles/${id}/connect`, { method: 'POST' })
      const body = (await response.json()) as { connected: boolean; version: string | null }
      expect(response.status).toBe(200)
      expect(body.connected).toBe(true)
      expect(body.version).not.toBeNull()

      // And the corpus is actually readable, not just the version probe.
      const refresh = await app.request(`/api/${id}/refresh`, { method: 'POST' })
      expect(refresh.status).toBe(200)
    } finally {
      delete process.env['MK_TEST_USER']
      delete process.env['MK_TEST_PASS']
    }
  })

  it('names the variable that is not set, rather than sending an empty credential', async () => {
    const id = profileWith('basic', 'MK_TEST_USER:MK_ABSENT', 'unset')
    process.env['MK_TEST_USER'] = USER
    try {
      const response = await app.request(`/api/profiles/${id}/connect`, { method: 'POST' })
      const body = (await response.json()) as { error: string; message: string }

      // 400, not 502: nothing was sent and no server refused us, so blaming the mock server —
      // which `internal_error` and a 500 both did — points at the wrong thing entirely.
      expect(response.status).toBe(400)
      expect(body.error).toBe('profile_misconfigured')
      // This process is the only thing that can know the variable is unset. "MK_ABSENT is not
      // set" is a fix; "requires credentials" restates what the user just tried to configure.
      expect(body.message).toContain('MK_ABSENT')
      expect(body.message).toMatch(/not set in this process/)
    } finally {
      delete process.env['MK_TEST_USER']
    }
  })

  it('never returns the secret to the browser, only the variable name', async () => {
    const id = profileWith('basic', 'MK_TEST_USER:MK_TEST_PASS', 'secrecy')
    process.env['MK_TEST_USER'] = USER
    process.env['MK_TEST_PASS'] = PASS
    try {
      await app.request(`/api/profiles/${id}/connect`, { method: 'POST' })
      const listed = await (await app.request('/api/profiles')).text()
      // PRD §12: the resolved value lives in this process for the life of a request and nowhere
      // else — not the database, not a log line, not anything sent to the browser.
      expect(listed).not.toContain(PASS)
      expect(listed).toContain('MK_TEST_PASS')
    } finally {
      delete process.env['MK_TEST_USER']
      delete process.env['MK_TEST_PASS']
    }
  })
})

describe('missingAuthVariables', () => {
  it('names each referenced variable that this process does not have', () => {
    expect(
      missingAuthVariables(
        { authKind: 'basic', authRef: 'PRESENT_USER:ABSENT_PASS' },
        { PRESENT_USER: 'someone' },
      ),
    ).toEqual(['ABSENT_PASS'])
  })

  it('reads the variable out of a header pair, not the header name', () => {
    // `Authorization=WM_TOKEN` refers to WM_TOKEN. Reporting "Authorization is not set" would
    // send someone looking for an environment variable named after a header.
    expect(
      missingAuthVariables({ authKind: 'headers', authRef: 'Authorization=WM_TOKEN' }, {}),
    ).toEqual(['WM_TOKEN'])
  })

  it('treats an empty value as missing, because an empty credential is not one', () => {
    expect(missingAuthVariables({ authKind: 'bearer', authRef: 'TOKEN' }, { TOKEN: '' })).toEqual([
      'TOKEN',
    ])
  })

  it('has nothing to report when auth is off', () => {
    expect(missingAuthVariables({ authKind: 'none', authRef: null }, {})).toEqual([])
  })
})
