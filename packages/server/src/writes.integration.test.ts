import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { contentHash } from '@mock-knight/core'
import type { JsonObject } from '@mock-knight/core'
import type { Database as Db } from 'better-sqlite3'
import { readMappings } from './test-support.js'
import { createApp } from './app.js'
import { openDatabase } from './db/database.js'
import { createProfile } from './profiles.js'
import { ConnectionRegistry } from './runtime.js'
import { seedWireMock } from './fixtures/dev-seed.js'

/**
 * Writes against a real WireMock — M2's exit criterion.
 *
 * "Two browsers editing the same stub produce a conflict diff, not a lost update." That cannot
 * be shown with a fake: the whole mechanism is a race against another writer on a real server,
 * and a stub is only truly lost if the *server* ends up holding the wrong document. So every
 * assertion below reads back from WireMock rather than from our mirror.
 */

const WIREMOCK_URL = process.env['MOCK_KNIGHT_TEST_WIREMOCK_URL'] ?? 'http://localhost:18099'

let db: Db
let registry: ConnectionRegistry
let app: ReturnType<typeof createApp>
let profileId: string

/**
 * A parsed BFF response, read by path.
 *
 * `any` on purpose, and only here: these tests walk into payloads from a dozen different routes
 * and the alternative is a union of route shapes that has to be edited every time a route gains
 * a field. Typing the *server* is what matters; this is the assertion side of a black-box test.
 * The lint rule is off for test files for exactly this reason, not by oversight.
 */
type JsonBody = any

const json = async (path: string, init?: RequestInit) => {
  const response = await app.request(path, init)
  return { status: response.status, body: (await response.json()) as JsonBody }
}

const post = (path: string, body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const put = (path: string, body: unknown) => ({ ...post(path, body), method: 'PUT' })
const del = (body: unknown) => ({ ...post('', body), method: 'DELETE' })

async function firstStub(): Promise<{ key: string; hash: string; raw: JsonObject }> {
  const list = await json(`/api/${profileId}/mocks?q=url:/v1/customers`)
  const key = list.body.items[0].clientKey as string
  const detail = await json(`/api/${profileId}/mocks/${key}`)
  return { key, hash: detail.body.mock.contentHash as string, raw: detail.body.mock.raw }
}

beforeEach(async () => {
  await seedWireMock(WIREMOCK_URL)
  db = openDatabase(':memory:')
  registry = new ConnectionRegistry(db, 'local')
  app = createApp({ db, registry, mode: 'local', version: 'test', actor: 'dana@example.com' })
  profileId = createProfile(db, {
    name: 'writes',
    adapter: 'wiremock',
    baseUrl: WIREMOCK_URL,
    adminPath: null,
    colour: 'indigo',
    protected: false,
    readOnly: false,
    mappingsDir: null,
    authKind: 'none',
    authRef: null,
    correlationHeader: null,
    redactHeaders: [],
  }).id
  await app.request(`/api/profiles/${profileId}/connect`, { method: 'POST' })
  await app.request(`/api/${profileId}/refresh`, { method: 'POST' })
})

afterEach(async () => {
  await registry.closeAll()
  db.close()
})

describe('update', () => {
  it('writes the edit through to the server', async () => {
    const { key, hash, raw } = await firstStub()
    const edited = { ...raw, response: { ...(raw['response'] as JsonObject), status: 503 } }

    const result = await json(
      `/api/${profileId}/mocks/${key}`,
      put('', { raw: edited, baseHash: hash }),
    )
    expect(result.status).toBe(200)

    // Read back from WireMock, not from our mirror: the mirror agreeing with us proves nothing.
    const upstream = await readMappings(WIREMOCK_URL)
    const served = upstream.mappings.find((m) => m.name === 'customers list')
    expect(served!.response!.status).toBe(503)
  })

  it('preserves fields the canonical model never modelled', async () => {
    const list = await json(`/api/${profileId}/mocks?q=method:DELETE`)
    const key = list.body.items[0].clientKey as string
    const detail = await json(`/api/${profileId}/mocks/${key}`)
    const raw = detail.body.mock.raw as JsonObject

    const edited = { ...raw, response: { ...(raw['response'] as JsonObject), status: 205 } }
    const result = await json(
      `/api/${profileId}/mocks/${key}`,
      put('', { raw: edited, baseHash: detail.body.mock.contentHash }),
    )
    expect(result.status).toBe(200)

    const upstream = await readMappings(WIREMOCK_URL)
    const served = upstream.mappings.find((m) => m.request?.url === '/v1/carts/9')
    // postServeActions is not in the canonical model. A write must not be able to delete it.
    expect(served!.postServeActions).toEqual([{ name: 'webhook', parameters: { url: 'http://x' } }])
    expect(served!.response!.status).toBe(205)
  })

  it('refuses a stale write and hands back what the server now holds', async () => {
    const { key, hash, raw } = await firstStub()

    // Someone else edits the same stub directly against the server.
    const serverSide = { ...raw, response: { ...(raw['response'] as JsonObject), status: 418 } }
    const id = (raw['id'] ?? raw['uuid']) as string
    await fetch(`${WIREMOCK_URL}/__admin/mappings/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(serverSide),
    })

    // Our edit was composed against the old version.
    const mine = { ...raw, response: { ...(raw['response'] as JsonObject), status: 500 } }
    const result = await json(
      `/api/${profileId}/mocks/${key}`,
      put('', { raw: mine, baseHash: hash }),
    )

    expect(result.status).toBe(409)
    expect(result.body.error).toBe('conflict')
    expect(result.body.message).toContain('changed on writes')
    // The third input a three-way merge needs, so the UI does not have to go and fetch it.
    expect(result.body.current.response.status).toBe(418)
    expect(result.body.currentHash).not.toBe(hash)

    // And the crucial part: the other writer's change is still there.
    const upstream = await readMappings(WIREMOCK_URL)
    const served = upstream.mappings.find((m) => m.name === 'customers list')
    expect(served!.response!.status).toBe(418)
  })

  it('lets the same edit through once it is rebased on the current version', async () => {
    const { key, hash, raw } = await firstStub()
    const id = (raw['id'] ?? raw['uuid']) as string
    await fetch(`${WIREMOCK_URL}/__admin/mappings/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...raw,
        response: { ...(raw['response'] as JsonObject), status: 418 },
      }),
    })

    const conflict = await json(`/api/${profileId}/mocks/${key}`, put('', { raw, baseHash: hash }))
    expect(conflict.status).toBe(409)

    // Resolve by taking the server's version and applying the edit on top.
    const rebased = {
      ...(conflict.body.current as JsonObject),
      response: { ...(conflict.body.current!['response'] as JsonObject), status: 500 },
    }
    const retry = await json(
      `/api/${profileId}/mocks/${key}`,
      put('', { raw: rebased, baseHash: conflict.body.currentHash }),
    )
    expect(retry.status).toBe(200)
  })

  it('treats a stub deleted underneath us as gone, not as a write', async () => {
    const { key, hash, raw } = await firstStub()
    const id = (raw['id'] ?? raw['uuid']) as string
    await fetch(`${WIREMOCK_URL}/__admin/mappings/${id}`, { method: 'DELETE' })

    const result = await json(`/api/${profileId}/mocks/${key}`, put('', { raw, baseHash: hash }))
    expect(result.status).toBe(404)
  })
})

describe('create and delete', () => {
  it('creates a stub and mirrors it', async () => {
    const created = await json(
      `/api/${profileId}/mocks`,
      post('', {
        raw: {
          name: 'made here',
          request: { method: 'GET', urlPath: '/v1/new' },
          response: { status: 201 },
        },
      }),
    )
    expect(created.status).toBe(201)
    expect(created.body.mock.serverId ?? created.body.mock.id).toBeTruthy()

    const found = await json(`/api/${profileId}/mocks?q=url:/v1/new`)
    expect(found.body.total).toBe(1)
  })

  it('deletes only after the same freshness check', async () => {
    const { key, hash } = await firstStub()
    const stale = await json(`/api/${profileId}/mocks/${key}`, del({ baseHash: 'not-the-hash' }))
    expect(stale.status).toBe(409)

    const ok = await json(`/api/${profileId}/mocks/${key}`, del({ baseHash: hash }))
    expect(ok.status).toBe(200)

    const upstream = await readMappings(WIREMOCK_URL)
    expect(upstream.mappings.find((m) => m.name === 'customers list')).toBeUndefined()
  })
})

describe('audit', () => {
  it('records who changed what, with a readable summary', async () => {
    const { key, hash, raw } = await firstStub()
    await json(
      `/api/${profileId}/mocks/${key}`,
      put('', {
        raw: { ...raw, response: { ...(raw['response'] as JsonObject), status: 503 } },
        baseHash: hash,
      }),
    )

    const audit = await json(`/api/${profileId}/audit?key=${key}`)
    expect(audit.body.entries).toHaveLength(1)
    expect(audit.body.entries[0]).toMatchObject({ actor: 'dana@example.com', action: 'update' })
    expect(audit.body.entries[0].summary).toContain('response.status')
    // The UI has to repeat this, so the API states it rather than leaving it to be remembered.
    expect(audit.body.scope).toContain('through Mock Knight')
  })

  it('records nothing for a refused write', async () => {
    const { key, raw } = await firstStub()
    await json(`/api/${profileId}/mocks/${key}`, put('', { raw, baseHash: 'stale' }))
    const audit = await json(`/api/${profileId}/audit`)
    expect(audit.body.entries).toHaveLength(0)
  })
})

describe('profiles that must not be written to', () => {
  it('makes the route absent on a read-only profile rather than refusing it', async () => {
    const readOnly = createProfile(db, {
      name: 'read only',
      adapter: 'wiremock',
      baseUrl: WIREMOCK_URL,
      adminPath: null,
      colour: 'slate',
      protected: false,
      readOnly: true,
      mappingsDir: null,
      authKind: 'none',
      authRef: null,
      correlationHeader: null,
      redactHeaders: [],
    })
    const result = await json(
      `/api/${readOnly.id}/mocks/anything`,
      put('', { raw: {}, baseHash: contentHash({}) }),
    )
    // 404, not 403: the route does not exist for this profile, which is what the UI models.
    expect(result.status).toBe(404)
  })
})
