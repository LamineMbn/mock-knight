import { beforeAll, describe, expect, it } from 'vitest'
import { WireMockAdapter } from '@mock-knight/adapter-wiremock'
import type { LoggedRequest, MockBackendAdapter } from '@mock-knight/core'
import { seedWireMock } from './fixtures/dev-seed.js'
import { readScenarios } from './test-support.js'

/**
 * The match explainer against a real WireMock, which is the only tier that can prove it.
 *
 * The whole feature rests on a claim about someone else's software — that WireMock ranks near
 * misses but never says which predicate failed. A fixture would only prove we still parse the
 * bytes we recorded; this proves the claim.
 */

const WIREMOCK_URL = process.env['MOCK_KNIGHT_TEST_WIREMOCK_URL'] ?? 'http://localhost:18099'

let adapter: MockBackendAdapter & {
  nearMissesForRequest?: (r: LoggedRequest) => Promise<unknown>
}

const NEARLY_MATCHING: LoggedRequest = {
  method: 'POST',
  url: '/v1/orders',
  absoluteUrl: `${WIREMOCK_URL}/v1/orders`,
  clientIp: null,
  // The seeded stub wants X-Tenant: acme. This says acme-corp — one header off.
  headers: { 'X-Tenant': 'acme-corp', 'Content-Type': 'application/json' },
  cookies: {},
  queryParameters: {},
  body: '{"sku":"AX-91","qty":2}',
  bodyTruncated: false,
}

beforeAll(async () => {
  const wiremock = new WireMockAdapter()
  await wiremock.connect({ baseUrl: WIREMOCK_URL })
  adapter = wiremock
  await seedWireMock(WIREMOCK_URL)
})

describe('nearMissesForRequest', () => {
  it('finds the closest candidate and names the one predicate that failed', async () => {
    const misses = await (
      adapter as never as {
        nearMissesForRequest: (r: LoggedRequest) => Promise<
          {
            stubName: string | null
            distance: number
            mismatchCount: number
            provenance: string
            predicateProvenance: string
            predicates: {
              field: string
              outcome: string
              expected: string | null
              actual: string | null
            }[]
          }[]
        >
      }
    ).nearMissesForRequest(NEARLY_MATCHING)

    expect(misses.length).toBeGreaterThan(0)
    const closest = misses[0]!
    expect(closest.stubName).toBe('orders create 500')

    // The point of the screen: exactly one predicate failed, and it is the header.
    expect(closest.mismatchCount).toBe(1)
    const failed = closest.predicates.filter((p) => p.outcome === 'fail')
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({
      field: 'headers.X-Tenant',
      expected: 'acme',
      actual: 'acme-corp',
    })

    // Method and url passed, and are shown as passes rather than omitted.
    expect(closest.predicates.find((p) => p.field === 'method')?.outcome).toBe('pass')
    expect(closest.predicates.find((p) => p.field === 'url')?.outcome).toBe('pass')
  })

  it('reports the ranking as the server’s and the table as our own', async () => {
    const misses = await (
      adapter as never as {
        nearMissesForRequest: (
          r: LoggedRequest,
        ) => Promise<{ provenance: string; predicateProvenance: string }[]>
      }
    ).nearMissesForRequest(NEARLY_MATCHING)
    // Not cosmetic: WireMock genuinely supplies one and not the other.
    expect(misses[0]).toMatchObject({ provenance: 'server', predicateProvenance: 'inferred' })
  })

  it('confirms WireMock itself supplies no per-predicate detail', async () => {
    // The premise of the whole feature, asserted rather than assumed. If a future WireMock
    // starts populating these, this test fails and we should prefer the server's answer.
    const response = await fetch(`${WIREMOCK_URL}/__admin/near-misses/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: '/v1/orders',
        method: 'POST',
        headers: { 'X-Tenant': 'acme-corp' },
        body: '{}',
      }),
    })
    const body = (await response.json()) as {
      nearMisses: { matchResult: { diffDescriptions?: unknown[]; subEvents?: unknown[] } }[]
    }
    // Asserted before the loop, because a loop over an empty list asserts nothing: if the fixture
    // ever drifts so that nothing nearly matches, this test would keep passing while no longer
    // checking the premise it exists to check.
    expect(body.nearMisses.length).toBeGreaterThan(0)
    for (const miss of body.nearMisses) {
      expect(miss.matchResult.diffDescriptions ?? []).toEqual([])
      expect(miss.matchResult.subEvents ?? []).toEqual([])
    }
  })
})

describe('the journal', () => {
  it('reads serve events and attributes the matched stub', async () => {
    await fetch(`${WIREMOCK_URL}/__admin/requests`, { method: 'DELETE' })
    await fetch(`${WIREMOCK_URL}/v1/orders`, {
      method: 'POST',
      headers: { 'X-Tenant': 'acme', 'content-type': 'application/json' },
      body: '{"sku":"AX-91"}',
    })
    await fetch(`${WIREMOCK_URL}/v1/nowhere`, { method: 'GET' })

    const page = await adapter.listServeEvents!({ limit: 20 })
    expect(page.items.length).toBeGreaterThanOrEqual(2)

    const matched = page.items.find((e) => e.matched)
    expect(matched?.matchedClientKey).toMatch(/[0-9a-f-]{36}/)
    expect(matched?.response?.status).toBe(500)

    const unmatched = page.items.find((e) => !e.matched)
    expect(unmatched?.matchedClientKey).toBeNull()
    expect(unmatched?.request.url).toBe('/v1/nowhere')
  })

  it('lists unmatched requests on their own', async () => {
    const unmatched = await adapter.listUnmatched!()
    expect(unmatched.every((e) => !e.matched)).toBe(true)
  })
})

describe('the BFF routes behind the screen', () => {
  it('serves the traffic log with its window attached', async () => {
    const { createApp } = await import('./app.js')
    const { openDatabase } = await import('./db/database.js')
    const { createProfile } = await import('./profiles.js')
    const { ConnectionRegistry } = await import('./runtime.js')

    const db = openDatabase(':memory:')
    const registry = new ConnectionRegistry(db, 'local')
    const app = createApp({ db, registry, mode: 'local', version: 'test' })
    const profile = createProfile(db, {
      name: 'explain',
      adapter: 'wiremock',
      baseUrl: WIREMOCK_URL,
      adminPath: null,
      colour: 'indigo',
      protected: false,
      readOnly: false,
      mappingsDir: null,
      authKind: 'none',
      authUsername: null,
      authSecret: null,
      correlationHeader: null,
      redactHeaders: [],
    })
    await app.request(`/api/profiles/${profile.id}/connect`, { method: 'POST' })

    await fetch(`${WIREMOCK_URL}/__admin/requests`, { method: 'DELETE' })
    // Reset scenario state first, so the *only* thing wrong with the request below is the
    // header. Without this an earlier test has already advanced `checkout` to `ordered` and the
    // explanation correctly reports two failures instead of one.
    await fetch(`${WIREMOCK_URL}/__admin/scenarios/reset`, { method: 'POST' })
    await fetch(`${WIREMOCK_URL}/v1/orders`, {
      method: 'POST',
      headers: { 'X-Tenant': 'acme-corp', 'content-type': 'application/json' },
      body: '{"sku":"AX-91"}',
    })

    const events = await app.request(`/api/${profile.id}/events`)
    const page = (await events.json()) as {
      items: { id: number; matched: boolean; url: string }[]
      window: { earliestAt: string | null; bounded: boolean }
    }
    expect(page.items.length).toBeGreaterThan(0)
    // A journal-derived view must never travel without the window it is derived from.
    expect(page.window.bounded).toBe(true)
    expect(page.window.earliestAt).not.toBeNull()

    const unmatched = page.items.find((e) => !e.matched)
    expect(unmatched).toBeDefined()

    const explained = await app.request(`/api/${profile.id}/explain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId: unmatched!.id }),
    })
    const result = (await explained.json()) as {
      nearMisses: {
        stubName: string | null
        mismatchCount: number
        predicateProvenance: string
        predicates: {
          field: string
          outcome: string
          expected: string | null
          actual: string | null
        }[]
      }[]
    }
    expect(result.nearMisses.length).toBeGreaterThan(0)
    const closest = result.nearMisses[0]!
    expect(closest.stubName).toBe('orders create 500')
    expect(closest.predicates.filter((p) => p.outcome === 'fail')).toEqual([
      expect.objectContaining({
        field: 'headers.X-Tenant',
        expected: 'acme',
        actual: 'acme-corp',
      }),
    ])
    // The scenario is in the state the stub needs, and the row says so rather than being absent.
    expect(closest.predicates.find((p) => p.field === 'scenario.checkout')).toMatchObject({
      outcome: 'pass',
      expected: 'Started',
      actual: 'Started',
    })
    expect(closest.predicateProvenance).toBe('inferred')

    await registry.closeAll()
    db.close()
  })
})

describe('scenarios', () => {
  const app = async () => {
    const { createApp } = await import('./app.js')
    const { openDatabase } = await import('./db/database.js')
    const { createProfile } = await import('./profiles.js')
    const { ConnectionRegistry } = await import('./runtime.js')
    const db = openDatabase(':memory:')
    const registry = new ConnectionRegistry(db, 'local')
    const instance = createApp({ db, registry, mode: 'local', version: 'test', actor: 'dana' })
    const profile = createProfile(db, {
      name: 'scenarios',
      adapter: 'wiremock',
      baseUrl: WIREMOCK_URL,
      adminPath: null,
      colour: 'indigo',
      protected: false,
      readOnly: false,
      mappingsDir: null,
      authKind: 'none',
      authUsername: null,
      authSecret: null,
      correlationHeader: null,
      redactHeaders: [],
    })
    await instance.request(`/api/profiles/${profile.id}/connect`, { method: 'POST' })
    await instance.request(`/api/${profile.id}/refresh`, { method: 'POST' })
    return { instance, id: profile.id, registry, db }
  }

  it('derives the scenario shape from the corpus, not just its name', async () => {
    const { instance, id, registry, db } = await app()
    const response = await instance.request(`/api/${id}/scenarios`)
    const body = (await response.json()) as {
      scenarios: {
        name: string
        currentState: string
        states: { name: string; isCurrent: boolean; terminal: boolean }[]
        transitions: { stubName: string | null; from: string | null; to: string | null }[]
        warnings: string[]
      }[]
      canSetState: boolean
    }

    const checkout = body.scenarios.find((s) => s.name === 'checkout')!
    expect(checkout.currentState).toBe('Started')
    // The seed's stub goes Started -> ordered, and nothing leaves `ordered`.
    expect(checkout.transitions).toEqual([
      expect.objectContaining({ from: 'Started', to: 'ordered' }),
    ])
    expect(checkout.states.find((s) => s.name === 'ordered')?.terminal).toBe(true)
    expect(checkout.warnings.some((w) => w.includes('only a reset'))).toBe(true)
    expect(body.canSetState).toBe(true)

    await registry.closeAll()
    db.close()
  })

  it('sets and resets one scenario, and records both in the audit', async () => {
    const { instance, id, registry, db } = await app()

    const set = await instance.request(`/api/${id}/scenarios/checkout/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'ordered' }),
    })
    expect(set.status).toBe(200)
    expect((await readScenarios(WIREMOCK_URL)).scenarios[0]?.state).toBe('ordered')

    // An empty body resets that one scenario — the same route, per FR-STATE-2.
    await instance.request(`/api/${id}/scenarios/checkout/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: null }),
    })
    expect((await readScenarios(WIREMOCK_URL)).scenarios[0]?.state).toBe('Started')

    const audit = (await (await instance.request(`/api/${id}/audit`)).json()) as {
      entries: { summary: string }[]
    }
    expect(audit.entries.map((e) => e.summary)).toEqual([
      'reset scenario checkout',
      'set scenario checkout to ordered',
    ])

    await registry.closeAll()
    db.close()
  })

  it('refuses to reset every scenario without the typed profile name', async () => {
    const { instance, id, registry, db } = await app()

    const unconfirmed = await instance.request(`/api/${id}/scenarios/reset-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'wrong' }),
    })
    // Validated server-side: the UI dialog is a convenience, this is the gate (§9.6).
    expect(unconfirmed.status).toBe(400)

    const confirmed = await instance.request(`/api/${id}/scenarios/reset-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'scenarios' }),
    })
    expect(confirmed.status).toBe(200)

    await registry.closeAll()
    db.close()
  })
})
