import type { JsonObject } from '@mock-knight/core'
import seed from '../../../../fixtures/wiremock-seed.json' with { type: 'json' }

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
/**
 * The one seed every suite shares — integration, end-to-end, and any manual poke at the dev
 * server. It lives in `fixtures/wiremock-seed.json` rather than in code because the e2e specs
 * cannot import from this package, and a duplicated copy is exactly how the suites started
 * invalidating each other: each one replaces the target corpus wholesale, so whichever ran last
 * silently redefined what the others were asserting against.
 */
export const DEV_SEED = seed as unknown as JsonObject[]

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

  // Importing mappings does **not** reset scenario state, and the seed contains a stateful stub.
  // Without this, one matched request advances `checkout` to `ordered` and every later run finds
  // that stub no longer matches — a suite that passes once and then fails for reasons nothing in
  // the test can see. (Which is precisely the bug this product exists to make visible.)
  const reset = await fetch(`${baseUrl}/__admin/scenarios/reset`, { method: 'POST' })
  if (!reset.ok) throw new Error(`Resetting scenarios on ${baseUrl} failed with ${reset.status}`)
}
