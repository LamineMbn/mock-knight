import { expect, test } from '@playwright/test'
import { WIREMOCK, resetToSeed } from './seed.js'

/**
 * The traffic log's row affordance — design brief §6.5, as amended.
 *
 * These guard a decision rather than a widget. The action is a small button in a fixed column,
 * not a whole-row click, *because* the list auto-follows: a click that lands mid-drift on a
 * whole-row target succeeds on the neighbouring request and renders a correct, plausible
 * explanation for the wrong one. Holding arrivals while the pointer is over the list removes
 * the drift; these tests are what stop that quietly regressing.
 */

const ROW = 'tbody tr'

async function traffic(page: import('@playwright/test').Page, count = 5) {
  await fetch(`${WIREMOCK}/__admin/requests`, { method: 'DELETE' })
  for (let index = 0; index < count; index++) {
    await fetch(`${WIREMOCK}/v1/nothing-matches-${index}`)
  }
  await page.goto('/?screen=traffic')
  await expect(page.locator(ROW).first()).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await resetToSeed(page)
})

test('the row action is a quiet button, not a filled primary on every row', async ({ page }) => {
  await traffic(page)
  const button = page.getByRole('button', { name: 'Why?' }).first()
  const style = await button.evaluate((node) => {
    const computed = getComputedStyle(node)
    return { background: computed.backgroundColor, height: node.getBoundingClientRect().height }
  })
  // Filled primary on ~30 unmatched rows is a column of solid indigo fighting the red stripes.
  expect(style.background).toBe('rgba(0, 0, 0, 0)')
  // Still a real target at the 32px row density (§8: ≥24×24).
  expect(style.height).toBeGreaterThanOrEqual(24)
})

test('each row action names its own request, not just "Why?"', async ({ page }) => {
  await traffic(page)
  const titles = await page
    .getByRole('button', { name: 'Why?' })
    .evaluateAll((nodes) => nodes.slice(0, 5).map((node) => node.getAttribute('title')))

  // Thirty buttons all called "Why?" tell a screen-reader user nothing about which is which,
  // so each carries its request *and its time* — two calls to one path are different events.
  for (const title of titles) {
    expect(title).toMatch(/^Why didn't [A-Z]+ \/\S+ at .+ match\?$/)
  }
  expect(new Set(titles).size).toBe(titles.length)
  expect(titles[0]).toContain('/v1/nothing-matches-')
})

test('arrivals are held while the pointer is over the list, and counted', async ({ page }) => {
  await traffic(page)
  const before = await page.locator(ROW).count()
  const firstRowTop = await page
    .locator(ROW)
    .first()
    .evaluate((n) => n.getBoundingClientRect().top)

  await page.locator('tbody').hover()
  for (let index = 0; index < 3; index++) await fetch(`${WIREMOCK}/v1/arrived-${index}`)
  // Long enough for two poll cycles to have landed.
  await page.waitForTimeout(3000)

  // Nothing moved under the cursor, and the held rows are visible as a count rather than lost.
  expect(await page.locator(ROW).count()).toBe(before)
  expect(
    await page
      .locator(ROW)
      .first()
      .evaluate((n) => n.getBoundingClientRect().top),
  ).toBe(firstRowTop)
  await expect(page.getByRole('button', { name: /\d+ new/ })).toBeVisible()

  // Moving away releases them.
  await page.mouse.move(2, 2)
  await expect
    .poll(async () => page.locator(ROW).count(), { timeout: 6000 })
    .toBeGreaterThan(before)
})

test('j and k move a roving focus, and Enter opens the explainer', async ({ page }) => {
  await traffic(page)
  await page.locator(ROW).first().focus()
  const firstLabel = await page.locator(ROW).first().getAttribute('aria-label')

  await page.keyboard.press('j')
  const moved = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
  expect(moved).not.toBe(firstLabel)

  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: "Why didn't this match?" })
  await expect(dialog).toBeVisible()
  // The explainer opened for the row that had focus, not for the one at the top.
  await expect(dialog).toContainText(
    String(moved)
      .replace(/^Unmatched \w+ /, '')
      .split(' at ')[0]!,
  )
})

test('only one row is in the tab order at a time', async ({ page }) => {
  await traffic(page)
  const tabbable = await page
    .locator(`${ROW}[tabindex="0"]`)
    .count()
    .catch(() => 0)
  // A roving tabindex (§8): the list is one tab stop, arrows move within it.
  expect(tabbable).toBeLessThanOrEqual(1)
})

/**
 * Clearing — two different actions that must not be confused for each other.
 *
 * "Clear view" is the everyday one: the developer wants to see their *next* call and the noise
 * above it is in the way. It deletes nothing, so it is safe to press repeatedly on a server a
 * whole team shares. "Clear journal" really does empty the journal, for everyone pointed at
 * that server, which is why FR-TRAF-7 makes it a §9.6 destructive operation with the profile
 * name typed back. The tests below exist to stop the cheap one quietly acquiring the
 * expensive one's consequences.
 */

async function journalSize(): Promise<number> {
  const body = (await (await fetch(`${WIREMOCK}/__admin/requests`)).json()) as {
    requests: unknown[]
  }
  return body.requests.length
}

test('Clear view empties the list without touching the server journal', async ({ page }) => {
  await traffic(page)
  const before = await page.locator(ROW).count()
  expect(before).toBeGreaterThan(0)
  // Not compared against the row count: the local mirror keeps its own bounded history, so it
  // legitimately holds events this WireMock's journal has already been asked to forget.
  const onServer = await journalSize()
  expect(onServer).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Clear view' }).click()

  await expect(page.locator(ROW)).toHaveCount(0)
  await expect(page.getByText('Waiting for the next request.')).toBeVisible()
  // The load-bearing assertion: the server still has every one of them.
  expect(await journalSize()).toBe(onServer)

  // The next call arrives on an otherwise empty screen — the whole point of the button.
  await fetch(`${WIREMOCK}/v1/after-the-clear`)
  await expect(page.locator(ROW)).toHaveCount(1, { timeout: 8000 })
  await expect(page.locator(ROW).first()).toContainText('/v1/after-the-clear')

  // And hiding is reversible, because nothing was destroyed.
  await page.getByRole('button', { name: `Show ${before} hidden` }).click()
  await expect(page.locator(ROW)).toHaveCount(before + 1)
})

test('Clear journal needs the profile name typed, then empties the server too', async ({
  page,
}) => {
  await traffic(page)
  expect(await journalSize()).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Clear journal…' }).click()
  const confirm = page.getByRole('button', { name: 'Clear journal', exact: true })
  await expect(confirm).toBeDisabled()

  // A near miss is still a miss — this is the guard, not a formality.
  await page.getByLabel(/Type the profile name to confirm clearing the journal/).fill('localhost')
  await expect(confirm).toBeDisabled()

  await page
    .getByLabel(/Type the profile name to confirm clearing the journal/)
    .fill('localhost:18099')
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expect(page.locator(ROW)).toHaveCount(0)
  expect(await journalSize()).toBe(0)
  // Not the "hidden from this view" copy: there is genuinely nothing left to unhide.
  await expect(page.getByText('No requests recorded yet.')).toBeVisible()
  await expect(page.getByRole('button', { name: /hidden/ })).toHaveCount(0)
})

/**
 * Journal filters — FR-TRAF-2.
 *
 * "All / Unmatched / Matched" is a halving, not a filter. On a server a team shares, finding
 * the one call you care about needs method, path, status — and the correlation id, which the
 * journal has stored since it existed and never showed.
 */
test.describe('filtering the log', () => {
  /**
   * Clears **both** journals, then sends three known requests.
   *
   * `DELETE /__admin/requests` only empties WireMock's. Our mirror keeps its own bounded
   * history, so a spec that cleared only the upstream one counted whatever the previous spec
   * happened to leave behind — which is exactly the asymmetry the Clear journal button exists
   * to resolve, so the fixture uses it.
   */
  const seedTraffic = async (page: import('@playwright/test').Page) => {
    const profiles = (await (await page.request.get('/api/profiles')).json()) as {
      profiles: { id: string; name: string }[]
    }
    const profile = profiles.profiles[0]!
    await page.request.post(`/api/${profile.id}/danger/clear-journal`, {
      data: { confirm: profile.name },
    })
    await fetch(`${WIREMOCK}/__admin/requests`, { method: 'DELETE' })
    await fetch(`${WIREMOCK}/v1/customers`) // matched, 404 per the seed
    await fetch(`${WIREMOCK}/v1/nothing-here`) // unmatched, 404
    await fetch(`${WIREMOCK}/v1/orders`, {
      method: 'POST',
      headers: { 'X-Tenant': 'acme', 'content-type': 'application/json' },
      body: '{}',
    }) // matched, 500
  }

  test('narrows by method, status class and path, and counts the filtered set', async ({
    page,
  }) => {
    await seedTraffic(page)
    await page.goto('/?screen=traffic')
    await expect(page.locator(ROW)).toHaveCount(3)

    await page.getByLabel('Filter by method').selectOption('POST')
    await expect(page.locator(ROW)).toHaveCount(1)
    await expect(page.locator(ROW).first()).toContainText('/v1/orders')

    await page.getByLabel('Filter by method').selectOption('')
    await page.getByLabel('Filter by status class').selectOption('5')
    await expect(page.locator(ROW)).toHaveCount(1)

    await page.getByLabel('Filter by status class').selectOption('')
    await page.getByLabel('Filter by path').fill('customers')
    await expect(page.locator(ROW)).toHaveCount(1)

    // Clearing restores everything, and the control disappears when nothing is narrowed.
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(page.locator(ROW)).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0)
  })

  test('says nothing matches the filters, which is not the same as an empty journal', async ({
    page,
  }) => {
    await seedTraffic(page)
    await page.goto('/?screen=traffic')
    await page.getByLabel('Filter by path').fill('definitely-not-a-path')
    await expect(page.getByText('No requests match these filters.')).toBeVisible()
    // Not the "send a request and it will appear" copy: the journal is not empty.
    await expect(page.getByText('No requests recorded yet.')).toHaveCount(0)
  })

  test('filters combine rather than replacing each other', async ({ page }) => {
    await seedTraffic(page)
    await page.goto('/?screen=traffic')
    await page.getByLabel('Filter by path').fill('v1')
    await page.getByLabel('Filter by method').selectOption('GET')
    await expect(page.locator(ROW)).toHaveCount(2)
    await page.getByRole('button', { name: 'Unmatched' }).click()
    await expect(page.locator(ROW)).toHaveCount(1)
    await expect(page.locator(ROW).first()).toContainText('/v1/nothing-here')
  })
})

/**
 * Data the journal captured and never showed.
 *
 * Both of these were stored end to end and then thrown away at the last step — the pattern this
 * whole pass exists to close. `duration_ms` was a column written as `null` on every row while
 * WireMock reported the timing, and the "stub ↗" affordance was inert text with an arrow on it.
 */
test.describe('what the journal already knew', () => {
  test('shows how long the server took, and says when the delay was configured', async ({
    page,
  }) => {
    await fetch(`${WIREMOCK}/__admin/requests`, { method: 'DELETE' })
    // The seed's customers stub carries fixedDelayMilliseconds: 50.
    await fetch(`${WIREMOCK}/v1/customers`)
    await page.goto('/?screen=traffic')

    const row = page.locator(ROW).filter({ hasText: '/v1/customers' }).first()
    await expect(row).toContainText(/\d+ms/)
    // The number is real, not a fabricated zero, and the configured part is disclosed.
    await expect(row).toContainText('including 50ms of configured delay')
  })

  test('the stub link opens the stub that answered', async ({ page }) => {
    await fetch(`${WIREMOCK}/__admin/requests`, { method: 'DELETE' })
    await fetch(`${WIREMOCK}/v1/customers`)
    await page.goto('/?screen=traffic')

    const link = page
      .locator(ROW)
      .filter({ hasText: '/v1/customers' })
      .getByRole('button', { name: 'stub ↗' })
      .first()
    await expect(link).toBeVisible()
    await link.click()

    // Lands on the corpus with that stub open, rather than doing nothing at all. The param is
    // `stub`, and `screen` is omitted when it is the default — so assert on what the URL says,
    // not on what the state is called.
    await expect(page).toHaveURL(/[?&]stub=/)
    await expect(page).not.toHaveURL(/screen=traffic/)
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible()
    await expect(page.locator('aside').last()).toContainText('/v1/customers')
  })
})
