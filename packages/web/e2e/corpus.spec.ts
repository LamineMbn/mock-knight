import { expect, test } from '@playwright/test'
import { resetToSeed } from './seed.js'

/**
 * End-to-end against the real stack: CLI → SQLite mirror → BFF → SPA, with a real WireMock
 * behind it. Nothing here is mocked, which is the point — every other tier can pass while the
 * app still fails to render.
 *
 * Needs the CLI running against a seeded WireMock; see CLAUDE.md for the two commands.
 * Both themes, because dark mode is where a debugging tool actually gets used.
 */

const ROW = '[role="row"][aria-rowindex]'

// Order-independent: every spec restores the shared corpus before it runs.
test.beforeEach(async ({ page }) => {
  await resetToSeed(page)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`corpus screen (${colorScheme})`, () => {
    test.use({ colorScheme })

    test('lists the mirrored corpus and opens a stub', async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })

      await page.goto('/')
      await expect(page.locator(ROW).first()).toBeVisible()

      // The row count the grid reports to assistive tech is the full result set, not the DOM.
      const total = await page.locator('[role="grid"]').getAttribute('aria-rowcount')
      expect(Number(total)).toBeGreaterThan(0)

      await page.locator(ROW).first().click()
      const detail = page.locator('aside').last()

      // WireMock Java has no disabled flag, and the detail pane must say that rather than
      // implying the stub is switched on.
      await expect(detail).toContainText('this server has no enabled/disabled concept')

      await detail.getByRole('tab', { name: 'Raw JSON' }).click()
      // An editable textarea where writes are allowed, a read-only block where they are not.
      await expect(detail.getByLabel('Raw JSON')).toHaveValue(/"request"/)

      expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
    })

    test('filters by a structured token and reflects it in the URL', async ({ page }) => {
      await page.goto('/')
      await expect(page.locator(ROW).first()).toBeVisible()

      await page.getByLabel('Search stubs').fill('method:GET')
      await page.getByLabel('Search stubs').press('Enter')

      await expect(page.locator(ROW)).toHaveCount(2)
      // Deep-linkable: the query lives in the URL so a view can be pasted into Slack.
      expect(new URL(page.url()).searchParams.get('q')).toBe('method:GET')
    })

    test('shows header matchers, which are the discriminator on a header-selected corpus', async ({
      page,
    }) => {
      await page.goto('/')
      await expect(page.locator(ROW).first()).toBeVisible()

      // The column appears only where the corpus actually matches on a header.
      await expect(page.getByRole('columnheader', { name: 'Header' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Matches on header' })).toBeVisible()

      await page.getByLabel('Search stubs').fill('header:X-Tenant=acme')
      await page.getByLabel('Search stubs').press('Enter')
      await expect(page.locator(ROW)).toHaveCount(1)

      await page.locator(ROW).first().click()
      await expect(page.locator('aside').last()).toContainText('X-Tenant')
    })

    test('colours every method chip and status code, in this theme', async ({ page }) => {
      await page.goto('/')
      await expect(page.locator(ROW).first()).toBeVisible()

      // Regression guard for a real bug: Tailwind v4's `@theme` tree-shakes variables it cannot
      // see referenced, and these are built at runtime as `var(--mk-method-${m}-text)`. They
      // were dropped from :root and every chip rendered unstyled — in light mode only, because
      // the dark values live in ordinary CSS blocks. Asserting the *computed* style is the only
      // way to catch that; the markup looks identical either way.
      const chips = await page.locator('[data-method]').evaluateAll((nodes) =>
        nodes.map((node) => ({
          method: node.getAttribute('data-method'),
          background: getComputedStyle(node).backgroundColor,
        })),
      )
      expect(chips.length).toBeGreaterThan(0)
      for (const chip of chips) {
        expect(chip.background, `${chip.method} chip has no fill`).not.toBe('rgba(0, 0, 0, 0)')
      }

      // The facet sidebar draws the same chip, so a plain-text POST never sits beside a green
      // one. Scoped explicitly, because the list-wide selector above would pass while the
      // sidebar rendered bare text.
      const sidebar = page.locator('nav[aria-label="Filters"]')
      const sidebarChips = await sidebar.locator('[data-method]').evaluateAll((nodes) =>
        nodes.map((node) => ({
          method: node.getAttribute('data-method'),
          background: getComputedStyle(node).backgroundColor,
        })),
      )
      expect(sidebarChips.length).toBeGreaterThan(0)
      for (const chip of sidebarChips) {
        expect(chip.background, `sidebar ${chip.method} chip has no fill`).not.toBe(
          'rgba(0, 0, 0, 0)',
        )
      }

      // Status classes take their colour from the same scale as an individual code, so `5xx`
      // in the sidebar and a `500` in the list agree.
      const classes = await sidebar.locator('[data-status-class]').evaluateAll((nodes) =>
        nodes.map((node) => ({
          value: node.getAttribute('data-status-class'),
          color: getComputedStyle(node).color,
        })),
      )
      expect(classes.length).toBeGreaterThan(0)
      const inherited = await sidebar.evaluate((node) => getComputedStyle(node).color)
      for (const entry of classes) {
        expect(entry.color, `${entry.value} is not coloured`).not.toBe(inherited)
      }
    })

    test('names a token this backend cannot answer instead of ignoring it', async ({ page }) => {
      await page.goto('/?q=disabled%3Atrue')
      await expect(page.locator(ROW).first()).toBeVisible()
      // A filter that silently does nothing is worse than an error.
      await expect(page.getByText('disabled:true — not supported here')).toBeVisible()
    })
  })
}
