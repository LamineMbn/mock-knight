import { expect, test } from '@playwright/test'
import { WIREMOCK, resetToSeed } from './seed.js'

/**
 * A second address for the same machine.
 *
 * One server now means one profile, so a spec that adds another cannot reuse WIREMOCK's URL.
 * Identity is the composed address, not the host it resolves to, so this is a legitimate second
 * profile that also happens to connect.
 */
const ALT_WIREMOCK = WIREMOCK.replace('localhost', '127.0.0.1')

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

  await page.getByLabel('Base URL', { exact: true }).fill(ALT_WIREMOCK)
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

  await page.getByLabel('Base URL', { exact: true }).fill(ALT_WIREMOCK)
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
  await page.getByLabel('Base URL', { exact: true }).fill(ALT_WIREMOCK)
  await page.getByLabel('Name', { exact: true }).fill('to be renamed')
  await page.getByRole('button', { name: 'Add and connect' }).click()
  await expect(page.getByRole('button', { name: /Profile: / })).toContainText('to be renamed')

  // Leave something half-typed in the add form first: the edit form must not inherit it.
  await page.getByLabel('Base URL', { exact: true }).fill('http://half-typed')
  const row = page.locator('main li').filter({ hasText: 'to be renamed' })
  await row.getByRole('button', { name: /^Edit / }).click()

  await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue(ALT_WIREMOCK)
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

test('opens the server the command line named, not the oldest one it holds', async ({ page }) => {
  // Profiles live in a state database shared by every run, and the fallback used to be the
  // first profile — which is the *oldest*. Running against a local WireMock last week and then
  // naming a staging URL today opened the local one, so `--url` did not decide what you saw.
  //
  // Asserted as the rule rather than against a fixed name, since which profiles exist depends
  // on what the rest of the suite has created.
  const health = (await (await page.request.get('/api/health')).json()) as {
    launchProfileId: string | null
  }
  expect(health.launchProfileId).not.toBeNull()

  const profiles = (await (await page.request.get('/api/profiles')).json()) as {
    profiles: { id: string; name: string }[]
  }
  const launched = profiles.profiles.find((p) => p.id === health.launchProfileId)
  expect(launched).toBeDefined()

  // No ?profile= in the URL, so the fallback decides.
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Profile: / })).toContainText(launched!.name)
})

test('refuses a second server for the same address, and says which one has it', async ({
  page,
}) => {
  // Two profiles pointing at one server both mirror the same corpus, and the switcher then
  // offers a choice that changes nothing.
  await page.goto('/?screen=profiles')
  const before = (
    (await (await page.request.get('/api/profiles')).json()) as {
      profiles: unknown[]
    }
  ).profiles.length

  // The address the suite is already connected to, spelled differently.
  await page.getByLabel('Base URL').first().fill('http://localhost:18099/')
  await page.getByLabel('Admin path').first().fill('/__admin')
  await page.getByLabel('Name', { exact: true }).first().fill('a duplicate')
  await page.getByRole('button', { name: 'Add and connect' }).click()

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('already points at')
  // Names the profile that has it, so the answer is switch-or-edit rather than a dead end.
  await expect(alert).toContainText('localhost:18099')

  // Nothing was created.
  const profiles = (await (await page.request.get('/api/profiles')).json()) as {
    profiles: { name: string }[]
  }
  expect(profiles.profiles).toHaveLength(before)
  expect(profiles.profiles.filter((p) => p.name === 'a duplicate')).toHaveLength(0)
})

test('each server is marked with the backend it is, beside its name', async ({ page }) => {
  // With two backends in one list, an address says nothing about what is on the other end —
  // and the two differ enough to matter: one has a traffic log and scenarios, the other does not.
  await page.goto('/?screen=profiles')
  const row = page.locator('main li').filter({ hasText: WIREMOCK }).first()
  await expect(row.getByRole('img', { name: /WireMock/ })).toBeVisible()

  // On the **closed** switcher, which is what is on screen the rest of the time. It carried no
  // mark at first: the badge was only drawn in the open list, which is the one moment you
  // already know which server you picked.
  const trigger = page.getByRole('button', { name: /Profile: / })
  await expect(trigger.getByRole('img', { name: /WireMock/ })).toBeVisible()

  // And in the open list, where servers are actually chosen between.
  await trigger.click()
  await expect(
    page
      .getByRole('listbox')
      .getByRole('img', { name: /WireMock/ })
      .first(),
  ).toBeVisible()
})

test('the backend mark is a logo where one exists, and never a broken image', async ({ page }) => {
  // The badge used to request `/backends/<id>.svg` and fall back on the 404. Badges live in
  // lists that remount on every keystroke, so that showed a broken-image glyph and re-requested
  // a known-missing file on every render. The server decides now, so the browser only ever asks
  // for a file that is there.
  const missed: string[] = []
  page.on('response', (response) => {
    if (response.url().includes('/backends/') && response.status() === 404) {
      missed.push(response.url())
    }
  })

  await page.goto('/?screen=profiles')
  const mark = page
    .locator('main li')
    .filter({ hasText: WIREMOCK })
    .first()
    .getByRole('img', { name: /WireMock/ })
  await expect(mark).toBeVisible()
  // A logo that failed to load reports naturalWidth 0, which is exactly the broken glyph.
  expect(await mark.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  expect(missed).toEqual([])
})

test('a missing asset is a 404, not the app shell with a 200', async ({ page }) => {
  // The SPA catch-all used to answer every unmatched path with index.html, so a missing image
  // came back as HTML and the browser complained about the file rather than about the 404.
  const logo = await page.request.get('/backends/no-such-backend.svg')
  expect(logo.status()).toBe(404)
  // A client-side route still gets the shell — it has no extension, a file does.
  const route = await page.request.get('/some/deep/route')
  expect(route.status()).toBe(200)
})

test('an unreachable server says so, and never claims to be an empty one', async ({ page }) => {
  // "reconnecting…" used to sit on the badge indefinitely while nothing reconnected — a
  // connection was only ever opened at startup or by clicking Refresh, so a status badge had
  // quietly become a control. The corpus underneath was worse: it read "This server has no
  // stubs yet" and offered "Create the first stub", stating something nobody had checked and
  // offering a button that could only fail.
  // Created through the API rather than the form: the form connects as it saves and rolls back
  // a server it cannot reach, which is the right behaviour there and the wrong fixture here. A
  // profile that exists but has never connected is what this is about — the state you land in
  // after a restart, or when the VPN is not up yet.
  const created = await page.request.post('/api/profiles', {
    // Port 9 is the discard port: reserved, and nothing listens on it.
    data: { name: 'nowhere', adapter: 'wiremock', baseUrl: 'http://127.0.0.1:9' },
  })
  expect(created.ok()).toBe(true)

  await page.goto('/')
  await page.getByRole('button', { name: /Profile: / }).click()
  await page.getByRole('option', { name: /nowhere/ }).click()

  const badge = page.getByText('unreachable', { exact: true })
  await expect(badge).toBeVisible()
  // The reason, not a spinner: ECONNREFUSED and a bad hostname need different fixes.
  await expect(badge).toHaveAttribute('title', /Retrying automatically/)

  await expect(page.getByText(/Cannot reach http:\/\/127\.0\.0\.1:9/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create the first stub' })).toHaveCount(0)
})

test('a backend that reads a file asks for it, and will not save without it', async ({ page }) => {
  // The gap this closes: the path reached the API but no field ever asked for it, so adding a
  // Mockoon server from the UI saved a profile that then failed to connect with "a Mockoon server
  // needs the path to its environment JSON file" — an error naming something the form never asked
  // for. The field is driven by the adapter's own `corpusDocument`, not by its id.
  await page.goto('/?screen=profiles')

  // WireMock reads its corpus over the admin API, so there is nothing to point at.
  await expect(page.getByLabel('Environment file')).toHaveCount(0)

  await page.locator('select').first().selectOption('mockoon')
  await expect(page.getByLabel('Environment file')).toBeVisible()
  // Disabled rather than absent: unlike a capability the backend lacks, this is a field someone
  // can fill in, and the label says which.
  await expect(page.getByRole('button', { name: 'Add and connect' })).toBeDisabled()

  await page.getByLabel('Environment file').fill('/tmp/does-not-matter.json')
  await expect(page.getByRole('button', { name: 'Add and connect' })).toBeEnabled()

  // And it goes away again for a backend that does not read one.
  await page.locator('select').first().selectOption('wiremock')
  await expect(page.getByLabel('Environment file')).toHaveCount(0)
})
