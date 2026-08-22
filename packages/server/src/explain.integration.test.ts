import { beforeAll, describe, expect, it } from 'vitest'
import { WireMockAdapter } from '@mock-knight/adapter-wiremock'
import type { LoggedRequest, MockBackendAdapter } from '@mock-knight/core'
import { seedWireMock } from './fixtures/dev-seed.js'

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
