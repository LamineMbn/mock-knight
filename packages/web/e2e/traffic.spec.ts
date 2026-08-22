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
