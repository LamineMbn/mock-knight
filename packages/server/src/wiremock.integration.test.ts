import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import { openDatabase } from './db/database.js'
import { createProfile } from './profiles.js'
import { ConnectionRegistry } from './runtime.js'
import { createApp } from './app.js'
import { DEV_SEED, seedWireMock } from './fixtures/dev-seed.js'

/**
 * End-to-end against a real WireMock, not a fake.
 *
 * Recorded fixtures cannot prove this layer works — they only prove we still parse yesterday's
 * bytes (TECH-DESIGN §15, tier 2 vs tier 3). This tier is the one that catches an admin route
 * that moved, a response shape that changed, or a capability probe that reads a 404 wrongly.
 *
 * Excluded from `pnpm test`; run with `pnpm test:integration` and a WireMock on
 * `MOCK_KNIGHT_TEST_WIREMOCK_URL` (default http://localhost:18099). See CLAUDE.md.
 */

const WIREMOCK_URL = process.env['MOCK_KNIGHT_TEST_WIREMOCK_URL'] ?? 'http://localhost:18099'

let directory: string
let db: Db
let registry: ConnectionRegistry
let app: ReturnType<typeof createApp>
let profileId: string

async function admin(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${WIREMOCK_URL}/__admin${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeAll(async () => {
  const reachable = await admin('GET', '/version').catch(() => null)
  if (reachable === null || !reachable.ok) {
    throw new Error(
      `No WireMock at ${WIREMOCK_URL}. Start one with:\n` +
        `  docker run -d --name mk-dev-wiremock -p 18099:8080 wiremock/wiremock:3.13.1 --verbose`,
    )
  }

  // This suite owns the server it talks to: it replaces the corpus wholesale. Point it only at
  // a throwaway instance, never at a shared one.
  await seedWireMock(WIREMOCK_URL)

  directory = mkdtempSync(join(tmpdir(), 'mock-knight-int-'))
  db = openDatabase(join(directory, 'state.db'))
  registry = new ConnectionRegistry(db, 'local')
  app = createApp({ db, registry, mode: 'local', version: '0.0.0-test' })
  profileId = createProfile(db, {
    name: 'integration',
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
})

afterAll(async () => {
  await registry?.closeAll()
  db?.close()
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
})

// See writes.integration.test.ts for why `any` is the right call on the assertion side here.
const json = async (path: string, init?: RequestInit): Promise<any> => {
  const response = await app.request(path, init)
  return { status: response.status, body: await response.json() }
}

describe('connect', () => {
  it('reads the version and probes the routes outside the published spec', async () => {
    const { status, body } = await json(`/api/profiles/${profileId}/connect`, { method: 'POST' })
    expect(status).toBe(200)
    expect(body.version).toMatch(/^\d+\.\d+/)
    expect(body.capabilities).toContain('corpus.list')
    // Off for WireMock Java whatever the version: StubMapping has no enabled flag.
    expect(body.capabilities).not.toContain('mock.enableDisable')
    expect(body.capabilities).not.toContain('journal.stream')
  })

  it('turns diagnostics.unusedStubs on for a server that has the 3.13 route', async () => {
    const { body } = await json(`/api/profiles/${profileId}/capabilities`)
    const row = body.report.find((r: { bit: string }) => r.bit === 'diagnostics.unusedStubs')
    expect(row.on).toBe(true)
    expect(row.provenance).toBe('probed')
  })

  it('labels the one bit it had to infer from the version string', async () => {
    const { body } = await json(`/api/profiles/${profileId}/capabilities`)
    const row = body.report.find((r: { bit: string }) => r.bit === 'state.write')
    expect(row).toMatchObject({ on: true, provenance: 'version' })
  })

  it('withholds the filesystem bits’ opposite — local mode grants them', async () => {
    const { body } = await json(`/api/profiles/${profileId}/capabilities`)
    const row = body.report.find((r: { bit: string }) => r.bit === 'files.bindDirectory')
    expect(row).toMatchObject({ on: true, gate: 'environment' })
  })
})

describe('refresh', () => {
  it('ingests the whole corpus into the mirror', async () => {
    const { status, body } = await json(`/api/${profileId}/refresh`, { method: 'POST' })
    expect(status).toBe(200)
    expect(body.inserted).toBe(DEV_SEED.length)
    expect(body.count).toBe(DEV_SEED.length)
  })

  it('reports the mirror’s age so the UI can mark it stale', async () => {
    const { body } = await json(`/api/${profileId}/mirror`)
    expect(body.count).toBe(DEV_SEED.length)
    expect(body.ageSeconds).toBeGreaterThanOrEqual(0)
    expect(body.connected).toBe(true)
  })
})

describe('the corpus screen’s query', () => {
  it('lists stubs with the columns the row renders', async () => {
    const { body } = await json(`/api/${profileId}/mocks`)
    expect(body.total).toBe(DEV_SEED.length)
    const orders = body.items.find((i: { name: string }) => i.name === 'orders create 500')
    expect(orders).toMatchObject({
      method: 'POST',
      url: { kind: 'urlPath', value: '/v1/orders' },
      status: 500,
      priority: 3,
      scenario: 'checkout',
      folder: ['orders'],
      tags: ['legacy'],
      enabled: null,
    })
    expect(orders.serverId).toMatch(/[0-9a-f-]{36}/)
  })

  it('finds a stub by a substring of its path', async () => {
    const { body } = await json(`/api/${profileId}/mocks?q=custom`)
    expect(body.items.map((i: { name: string }) => i.name)).toEqual(['customers list'])
    expect(body.textStrategy).toBe('fts')
  })

  it('finds a stub by its response body', async () => {
    const { body } = await json(`/api/${profileId}/mocks?q=body:insufficient`)
    expect(body.items.map((i: { name: string }) => i.name)).toEqual(['orders create 500'])
  })

  it('filters and facets together', async () => {
    const { body } = await json(`/api/${profileId}/mocks?q=method:GET`)
    expect(body.total).toBe(2)
    expect(body.facets.method).toEqual(
      expect.arrayContaining([
        { value: 'GET', count: 2 },
        { value: 'POST', count: 1 },
      ]),
    )
  })

  it('detects the proxy and delay flags the facet sidebar offers', async () => {
    const { body } = await json(`/api/${profileId}/mocks`)
    expect(body.facets.isProxy).toBe(1)
    expect(body.facets.hasDelay).toBe(1)
  })

  it('rejects a token this backend cannot answer instead of ignoring it', async () => {
    const { body } = await json(`/api/${profileId}/mocks?q=disabled:true`)
    // WireMock Java has no disabled flag, so the filter cannot be honoured — and a filter that
    // silently does nothing is worse than an error.
    expect(body.plan.rejected).toHaveLength(1)
    expect(body.plan.rejected[0].capability).toBe('mock.enableDisable')
    expect(body.total).toBe(DEV_SEED.length)
  })

  it('serves a stub’s verbatim raw payload, including fields we do not model', async () => {
    const list = await json(`/api/${profileId}/mocks?q=method:DELETE`)
    const key = list.body.items[0].clientKey
    const { body } = await json(`/api/${profileId}/mocks/${key}`)
    expect(body.mock.raw.postServeActions).toEqual([
      { name: 'webhook', parameters: { url: 'http://x' } },
    ])
  })
})

describe('what the round trip proves', () => {
  it('re-serialises every stub on the server back to byte-identical vendor JSON', async () => {
    // The real test of invariant 3: not a fixture we wrote, but whatever this server holds.
    const response = await admin('GET', '/mappings')
    const { mappings } = (await response.json()) as { mappings: Record<string, unknown>[] }
    const { toCanonical, toVendor } = await import('@mock-knight/adapter-wiremock')
    const { canonicalJson } = await import('@mock-knight/core')
    for (const mapping of mappings) {
      expect(canonicalJson(toVendor(toCanonical(mapping as never)) as never)).toBe(
        canonicalJson(mapping as never),
      )
    }
  })

  it('reports meta.total as the unfiltered count, so the cheap freshness probe is viable', async () => {
    // TECH-DESIGN §17.8 left this unconfirmed and §18 hangs a risk on it.
    const response = await admin('GET', '/mappings?limit=1')
    const body = (await response.json()) as { mappings: unknown[]; meta: { total: number } }
    expect(body.mappings).toHaveLength(1)
    expect(body.meta.total).toBe(DEV_SEED.length)
  })
})

describe('an unreachable server explains itself', () => {
  /**
   * The failure a developer actually meets first — a hostname that does not resolve, a port
   * nothing listens on, a VPN they are not on. undici reports every one of these as
   * `TypeError: fetch failed`, which is the least useful sentence available. These check that
   * what reaches the browser names the host, the reason, and what to look at.
   */
  const connectTo = async (baseUrl: string) => {
    const created = await json('/api/profiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'unreachable', adapter: 'wiremock', baseUrl }),
    })
    return json(`/api/profiles/${created.body.profile.id as string}/connect`, { method: 'POST' })
  }

  it('says nothing is listening, and on which host', async () => {
    // Port 1 on loopback: reliably refused, no DNS involved, no network round trip.
    const result = await connectTo('http://127.0.0.1:1')
    expect(result.status).toBe(502)
    expect(result.body.error).toBe('upstream_unreachable')
    expect(result.body.message).toContain('127.0.0.1:1')
    expect(result.body.message).toContain('Nothing is listening')
  })

  it('hands the browser a disclosure with no invented status', async () => {
    const result = await connectTo('http://127.0.0.1:1')
    // `null`, not 0 or 500: nothing answered, and the UI has to be able to say so.
    expect(result.body.upstream.status).toBeNull()
    expect(result.body.upstream.method).toBe('GET')
    expect(result.body.upstream.url).toContain('/__admin')
    expect(result.body.upstream.code).toBe('ECONNREFUSED')
    // The raw reason survives for the copyable block, however undici phrased it.
    expect(String(result.body.upstream.body).length).toBeGreaterThan(0)
  })

  it('does not leave a half-connected profile behind', async () => {
    await connectTo('http://127.0.0.1:1')
    const caps = await json(
      `/api/profiles/${(await json('/api/profiles')).body.profiles.at(-1).id}/capabilities`,
    )
    expect(caps.body.connected).toBe(false)
  })
})
