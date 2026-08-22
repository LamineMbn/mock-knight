import { expect, test } from '@playwright/test'
import { WIREMOCK, resetToSeed } from './seed.js'
import seed from '../../../fixtures/wiremock-seed.json' with { type: 'json' }

/**
 * Scenarios — FR-STATE-1/2/4, design brief §6.6.
 *
 * The scenario shape is not something WireMock reports; it exists only as a property of the
 * stubs that reference it. So the tests that matter are the ones about *derived* facts: an
 * unreachable state, a dead end. Those are invisible without reading every stub together, which
 * is the reason the screen exists.
 */

/** The seed plus one stub whose `requiredScenarioState` is a typo — `orderd`, not `ordered`. */
async function seedWithBrokenChain(page: import('@playwright/test').Page) {
  await fetch(`${WIREMOCK}/__admin/mappings/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mappings: [
        ...seed,
        {
          name: 'ship it',
          scenarioName: 'checkout',
          requiredScenarioState: 'orderd',
          newScenarioState: 'shipped',
          request: { method: 'POST', urlPath: '/v1/orders/ship' },
          response: { status: 200 },
        },
      ],
      importOptions: { duplicatePolicy: 'OVERWRITE', deleteAllNotInImport: true },
    }),
  })
  await fetch(`${WIREMOCK}/__admin/scenarios/reset`, { method: 'POST' })
  const profiles = (await (await page.request.get('/api/profiles')).json()) as {
    profiles: { id: string }[]
  }
  await page.request.post(`/api/${profiles.profiles[0]!.id}/refresh`)
}

async function scenarioState(): Promise<string> {
  const body = (await (await fetch(`${WIREMOCK}/__admin/scenarios`)).json()) as {
    scenarios: { name: string; state: string }[]
  }
  return body.scenarios.find((s) => s.name === 'checkout')!.state
}

test.beforeEach(async ({ page }) => {
  await resetToSeed(page)
})

test('names the states and the stubs that move between them', async ({ page }) => {
  await page.goto('/?screen=scenarios')
  await expect(page.getByText('checkout')).toBeVisible()

  // The transition table is the substance: from → which stub → to.
  await expect(page.getByRole('table')).toContainText('orders create 500')
  await expect(page.getByRole('table')).toContainText('ordered')
})

test('catches a one-character typo that silently orphans the rest of the chain', async ({
  page,
}) => {
  await seedWithBrokenChain(page)
  await page.goto('/?screen=scenarios')
  await expect(page.getByText('checkout')).toBeVisible()

  // `orderd` is reachable from nothing, and `shipped` only from `orderd` — so both are dead
  // configuration. Nothing in WireMock's own output says this.
  await expect(page.getByText(/cannot be reached from/)).toContainText('orderd')
  await expect(page.getByText(/cannot be reached from/)).toContainText('shipped')
  await expect(page.getByText(/Nothing advances out of/)).toBeVisible()
})

test('setting a state reaches the server', async ({ page }) => {
  await page.goto('/?screen=scenarios')
  await expect(page.getByText('checkout')).toBeVisible()
  expect(await scenarioState()).toBe('Started')

  await page.getByRole('button', { name: /^ordered/ }).click()
  await expect.poll(scenarioState, { timeout: 5000 }).toBe('ordered')

  // The same route resets one scenario when no state is given (FR-STATE-2).
  await page.getByRole('button', { name: 'Reset to Started' }).click()
  await expect.poll(scenarioState, { timeout: 5000 }).toBe('Started')
})

test('resetting every scenario needs the profile name typed back', async ({ page }) => {
  await page.goto('/?screen=scenarios')
  await expect(page.getByText('checkout')).toBeVisible()

  const confirm = page.getByRole('button', { name: 'Reset all scenarios' })
  await expect(confirm).toBeDisabled()

  await page.getByLabel('Type the profile name to confirm').fill('not the name')
  await expect(confirm).toBeDisabled()

  // The button is a convenience; the server re-validates the same string (§9.6).
  await page.getByLabel('Type the profile name to confirm').fill('localhost:18099')
  await expect(confirm).toBeEnabled()
})
