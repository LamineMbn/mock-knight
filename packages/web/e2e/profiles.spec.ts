import { expect, test } from '@playwright/test'
import { WIREMOCK, resetToSeed } from './seed.js'

/**
 * Connection management — PRD FR-CONN-1..5, design brief §6.9 and §6.11.
 *
 * The claim under test is the product's positioning: Mock Knight can point at several
 * environments at once, which the WireMock GUI forks structurally cannot. That is only true if
 * a second server can be added and switched to from the UI.
 */

test.beforeEach(async ({ page }) => {
  await resetToSeed(page)
})

/**
 * Keep only the original profile, so runs stay independent.
 *
 * Keyed on creation order rather than URL: the profiles these tests add point at the *same*
 * WireMock, so a URL-based filter cleans up nothing and the switcher fills with duplicates.
 */
test.afterEach(async ({ page }) => {
  const listed = (await (await page.request.get('/api/profiles')).json()) as {
    profiles: { id: string; createdAt: string }[]
  }
  const [oldest] = [...listed.profiles].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const profile of listed.profiles) {
    if (profile.id !== oldest?.id) await page.request.delete(`/api/profiles/${profile.id}`)
  }
})

test('the active environment is always named, not just coloured', async ({ page }) => {
  await page.goto('/')
  // §6.1: colour is an accelerant, never the signal. The same destructive button means very
  // different things on localhost and on staging.
  const badge = page.getByRole('button', { name: /Profile: / })
  await expect(badge).toBeVisible()
  await expect(badge).toContainText('localhost:18099')
})

test('a second server can be added and switched to from the UI', async ({ page }) => {
  await page.goto('/?screen=profiles')

  await page.getByLabel('Base URL', { exact: true }).fill(WIREMOCK)
  await page.getByLabel('Name', { exact: true }).fill('second view')
  await page.getByRole('button', { name: 'Add and connect' }).click()

  // Switching carries the profile in the URL, so a pasted link reproduces the whole view
  // including *which server* it is of.
  await expect
    .poll(() => new URL(page.url()).searchParams.get('profile'), { timeout: 10_000 })
    .not.toBeNull()
  await expect(page.getByRole('button', { name: /Profile: / })).toContainText('second view')

  await page.getByRole('button', { name: /Profile: / }).click()
  await page.getByRole('option', { name: 'localhost:18099', exact: true }).click()
  await expect(page.getByRole('button', { name: /Profile: / })).toContainText('localhost:18099')
})

test('the capability report explains what is off, not just that it is', async ({ page }) => {
  await page.goto('/?screen=profiles')
  const table = page.getByRole('table')
  await expect(table).toBeVisible()

  // WireMock Java has no disabled flag; the report has to say what that costs.
  await expect(table).toContainText('mock.enableDisable')
  await expect(table).toContainText('no disabled flag')
  // And which gate decided it — the backend, or this runtime mode.
  await expect(table).toContainText('this server')

  await page.getByRole('button', { name: 'Show everything' }).click()
  await expect(table).toContainText('corpus.list')
})

test('the danger zone is absent on a protected profile, not merely disabled', async ({ page }) => {
  await page.goto('/?screen=profiles')
  // Unprotected: it is there.
  await expect(page.getByText('Danger zone')).toBeVisible()

  await page.getByLabel('Base URL', { exact: true }).fill(WIREMOCK)
  await page.getByLabel('Name', { exact: true }).fill('locked')
  await page.getByRole('checkbox').first().check()
  await page.getByRole('button', { name: 'Add and connect' }).click()
  await expect(page.getByRole('button', { name: /Profile: / })).toContainText('locked')

  // Protected: gone entirely (FR-CONN-5) — there is no in-session override to find.
  await expect(page.getByText('Danger zone')).toHaveCount(0)
})

test('a destructive operation needs the profile name typed back', async ({ page }) => {
  await page.goto('/?screen=profiles')
  await page.getByRole('button', { name: /Clear the request journal/ }).click()

  const confirm = page.getByRole('button', { name: 'Clear the request journal', exact: true })
  await expect(confirm).toBeDisabled()
  await page.getByLabel(/Type the profile name to confirm/).fill('localhost:18099')
  await expect(confirm).toBeEnabled()
})

test('shows the admin URL it will actually call, context path and all', async ({ page }) => {
  await page.goto('/?screen=profiles')

  // The composed URL is the thing that is wrong when a context path is missing, and it is not
  // obvious from the two fields that produce it. A base URL used to have its context silently
  // discarded, and the tool then reported whatever the load balancer said about a path nobody
  // had asked for.
  await page.getByLabel('Base URL', { exact: true }).fill('https://host/wcboo')
  await expect(page.getByTestId('admin-url-preview')).toContainText('https://host/wcboo/__admin')

  await page.getByLabel('Admin path', { exact: true }).fill('/mocks/__admin')
  await expect(page.getByTestId('admin-url-preview')).toContainText(
    'https://host/wcboo/mocks/__admin',
  )

  await page.getByLabel('Base URL', { exact: true }).fill('not a url')
  await expect(page.getByTestId('admin-url-preview')).toContainText('not a valid URL')
  await expect(page.getByRole('button', { name: 'Add and connect' })).toBeDisabled()
})

test('a server can be edited, and the form opens on that server', async ({ page }) => {
  await page.goto('/?screen=profiles')

  // Edit a profile this test owns. Renaming the shared one leaks into every other spec that
  // types the profile name to confirm a destructive action.
  await page.getByLabel('Base URL', { exact: true }).fill(WIREMOCK)
  await page.getByLabel('Name', { exact: true }).fill('to be renamed')
  await page.getByRole('button', { name: 'Add and connect' }).click()
  await expect(page.getByRole('button', { name: /Profile: / })).toContainText('to be renamed')

  // Leave something half-typed in the add form first: the edit form must not inherit it.
  await page.getByLabel('Base URL', { exact: true }).fill('http://half-typed')
  const row = page.locator('main li').filter({ hasText: 'to be renamed' })
  await row.getByRole('button', { name: 'Edit' }).click()

  await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue(WIREMOCK)
  await page.getByLabel('Name', { exact: true }).fill('renamed in the ui')
  await page.getByRole('button', { name: 'Save changes' }).click()

  await expect(page.getByRole('button', { name: /Profile: / })).toContainText('renamed in the ui')
})

/**
 * A connection that fails has to say why — design brief §6.11.
 *
 * "It does not work" was the actual report that led here: the server had already worked out the
 * status, the URL it called and the body it got back, and the browser threw all of it away one
 * step before the screen that needed it.
 */
test('a server that cannot be reached explains itself, in detail, copyably', async ({ page }) => {
  await page.goto('/?screen=profiles')
  // Port 1 on loopback: refused instantly, no DNS and no network round trip.
  await page.getByLabel('Base URL').first().fill('http://127.0.0.1:1')
  await page.getByLabel('Name', { exact: true }).first().fill('unreachable')
  await page.getByRole('button', { name: 'Add and connect' }).click()

  const alert = page.getByRole('alert').filter({ hasText: 'Nothing is listening' })
  // The sentence names the host and what to check — not "fetch failed", not "could not connect".
  await expect(alert).toContainText('127.0.0.1:1')
  await expect(alert).toContainText('may be down, or on a different port')

  // And the disclosure carries what a developer would paste into an issue.
  await alert.locator('summary').click()
  await expect(alert).toContainText('/__admin')
  await expect(alert).toContainText('ECONNREFUSED')
  // Not "What the mock server said": nothing answered, and the label must not imply otherwise.
  await expect(alert.locator('summary')).toHaveText('What happened on the wire')
  await expect(alert.getByRole('button', { name: 'Copy details' })).toBeVisible()

  // The failed profile was rolled back, so the list is unchanged.
  await expect(page.getByText('unreachable', { exact: true })).toHaveCount(0)
})
