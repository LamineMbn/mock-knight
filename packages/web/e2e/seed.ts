import type { Page } from '@playwright/test'
import seed from '../../../fixtures/wiremock-seed.json' with { type: 'json' }

/**
 * Reset the dev WireMock and this app's mirror to a known corpus.
 *
 * Every spec does this in `beforeEach`, because seeding replaces the target corpus wholesale:
 * without it, whichever spec ran last decided what the others were asserting against, and the
 * resulting failures look like product bugs rather than ordering.
 *
 * Reads the same `fixtures/wiremock-seed.json` the server-side suites use, so there is one
 * definition rather than two that drift.
 */
export const WIREMOCK = process.env.MOCK_KNIGHT_E2E_WIREMOCK ?? 'http://localhost:18099'

export async function resetToSeed(page: Page): Promise<void> {
  const imported = await fetch(`${WIREMOCK}/__admin/mappings/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mappings: seed,
      importOptions: { duplicatePolicy: 'OVERWRITE', deleteAllNotInImport: true },
    }),
  })
  if (!imported.ok) throw new Error(`Seeding ${WIREMOCK} failed with ${imported.status}`)

  // Importing mappings does not reset scenario state, and the seed contains a stateful stub.
  await fetch(`${WIREMOCK}/__admin/scenarios/reset`, { method: 'POST' })

  const profiles = (await (await page.request.get('/api/profiles')).json()) as {
    profiles: { id: string }[]
  }
  await page.request.post(`/api/${profiles.profiles[0]!.id}/refresh`)
}
