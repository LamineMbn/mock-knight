import type { JsonObject } from '@mock-knight/core'

/**
 * The small corpus the integration and end-to-end tiers run against.
 *
 * Shared by every suite that seeds a WireMock, because each one replaces the target's corpus
 * wholesale: if two suites seeded different sets, whichever ran last would silently invalidate
 * the other's expectations, and the failure would look like a product bug.
 *
 * Deliberately covers the awkward shapes rather than the tidy ones — a header-selected stub, a
 * regex path, a proxy, a delay, and a stub carrying fields the canonical model does not model.
 */
export const DEV_SEED: JsonObject[] = [
  {
    name: 'orders create 500',
    priority: 3,
    scenarioName: 'checkout',
    requiredScenarioState: 'Started',
    newScenarioState: 'ordered',
    metadata: { 'mock-knight': { folder: ['orders'], tags: ['legacy'] } },
    request: {
      method: 'POST',
      urlPath: '/v1/orders',
      headers: { 'X-Tenant': { equalTo: 'acme' } },
    },
    response: { status: 500, jsonBody: { error: 'insufficient funds' } },
  },
  {
    name: 'orders read',
    request: { method: 'GET', urlPathPattern: '/v1/orders/[0-9]+' },
    response: { status: 200, body: '{"id":1}', headers: { 'Content-Type': 'application/json' } },
  },
  {
    name: 'customers list',
    request: { method: 'GET', urlPath: '/v1/customers' },
    response: { status: 404, body: 'not found', fixedDelayMilliseconds: 50 },
  },
  {
    name: 'payments proxy',
    request: { method: 'ANY', urlPattern: '/v1/payments/.*' },
    response: { proxyBaseUrl: 'http://upstream.example' },
  },
  {
    request: { method: 'DELETE', url: '/v1/carts/9' },
    response: { status: 204 },
    postServeActions: [{ name: 'webhook', parameters: { url: 'http://x' } }],
  },
]

/** Replace a throwaway WireMock's corpus with the shared seed. Never point this at a real one. */
export async function seedWireMock(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/__admin/mappings/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mappings: DEV_SEED,
      // Without deleteAllNotInImport this silently becomes a merge and the corpus grows on
      // every run (PRD Appendix A).
      importOptions: { duplicatePolicy: 'OVERWRITE', deleteAllNotInImport: true },
    }),
  })
  if (!response.ok) throw new Error(`Seeding ${baseUrl} failed with ${response.status}`)
}
