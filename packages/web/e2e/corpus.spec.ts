import { expect, test } from '@playwright/test'
import { WIREMOCK, resetToSeed } from './seed.js'

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

/**
 * Priority standing — FR-FIND-7.
 *
 * The corpus this is for has several stubs on one method and path, told apart by a request
 * header, with `priority` deciding which one actually answers. In a flat list that is invisible:
 * the stub you are reading may never be reached and nothing on the row says so.
 *
 * These stubs are added on top of the shared seed rather than into it, so the counts every
 * other spec asserts stay where they were.
 */
const CONTENDERS = [
  {
    name: 'rates gold',
    priority: 1,
    request: { method: 'GET', urlPath: '/v1/rates', headers: { 'X-Tier': { equalTo: 'gold' } } },
    response: { status: 200, body: 'gold' },
  },
  {
    name: 'rates standard',
    priority: 3,
    request: { method: 'GET', urlPath: '/v1/rates', headers: { 'X-Tier': { equalTo: 'std' } } },
    response: { status: 200, body: 'std' },
  },
  // No priority at all — judged at the default 5, so it loses to both of the above.
  {
    name: 'rates fallback',
    request: { method: 'GET', urlPath: '/v1/rates' },
    response: { status: 200, body: 'fallback' },
  },
]

async function seedContenders(page: import('@playwright/test').Page) {
  for (const mapping of CONTENDERS) {
    const created = await fetch(`${WIREMOCK}/__admin/mappings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mapping),
    })
    if (!created.ok) throw new Error(`Seeding a contender failed with ${created.status}`)
  }
  const profiles = (await (await page.request.get('/api/profiles')).json()) as {
    profiles: { id: string }[]
  }
  await page.request.post(`/api/${profiles.profiles[0]!.id}/refresh`)
}

test.describe('priority standing', () => {
  test('shows which stub on a path actually answers, and which are shadowed', async ({ page }) => {
    await seedContenders(page)
    await page.goto('/?q=%2Fv1%2Frates')
    await expect(page.locator(ROW)).toHaveCount(3)

    const labels = await page
      .locator(`${ROW} [role="gridcell"][aria-label^="Priority"]`)
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))

    // The winner is named as such, not merely left unflagged.
    expect(labels).toContainEqual(expect.stringContaining('Priority 1'))
    expect(labels.find((l) => l?.startsWith('Priority 1'))).toContain('Answers first')

    // The loser says how many beat it, and by how the default got there.
    const last = labels.find((l) => l?.startsWith('Priority 5'))
    expect(last).toContain('by default')
    expect(last).toContain('Shadowed by 2 higher-priority stubs')

    // The middle one is shadowed by exactly one.
    expect(labels.find((l) => l?.startsWith('Priority 3'))).toContain(
      'Shadowed by 1 higher-priority stub',
    )
  })

  test('says nothing on a stub with no contenders', async ({ page }) => {
    await page.goto('/?q=%2Fv1%2Fcustomers')
    const cell = page.locator(`${ROW} [role="gridcell"][aria-label^="Priority"]`).first()
    // A flag on every row would mean nothing; silence here is what makes the flag readable.
    await expect(cell).toHaveAttribute('aria-label', 'Priority 5 by default')
    await expect(cell.getByText(/of \d/)).toHaveCount(0)
  })

  test('the standing is the corpus, not the current search', async ({ page }) => {
    await seedContenders(page)
    // Filtering down to the shadowed stub alone must not make it look uncontested: a warning
    // that vanishes when you look straight at it is worse than no warning.
    await page.goto('/?q=fallback')
    await expect(page.locator(ROW)).toHaveCount(1)
    await expect(
      page.locator(`${ROW} [role="gridcell"][aria-label^="Priority"]`).first(),
    ).toHaveAttribute('aria-label', /Shadowed by 2 higher-priority stubs/)
  })
})

/**
 * The path column must never collapse.
 *
 * It did: adding the priority column pushed the fixed columns past the pane at a 1280px window,
 * and a flex column with `minWidth: 0` yields rather than pushing anything out — so every row
 * rendered as a bare `/`. The list looked populated and told you nothing, which is the worst
 * available failure for the screen whose whole job is finding one stub among thousands.
 */
test.describe('the list fits the pane it is given', () => {
  const headers = (page: import('@playwright/test').Page) =>
    page.locator('[role="columnheader"]').allTextContents()

  test('keeps the path readable at a laptop width, and the columns that identify a row', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 700 })
    await page.goto('/')
    await expect(page.locator(ROW).first()).toBeVisible()

    const path = page.locator(`${ROW} [role="gridcell"]`).nth(1)
    await expect(path).toContainText('/v1/')
    expect(
      await path.evaluate((node) => node.getBoundingClientRect().width),
    ).toBeGreaterThanOrEqual(180)

    // Header and priority both survive here: on a header-selected corpus one is the row's
    // identity and the other decides which row answers.
    expect(await headers(page)).toEqual(['Method', 'Path', 'Header', 'Status', 'Priority'])
  })

  test('gives up the least diagnostic columns first, and header last', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 })
    await page.goto('/')
    await expect(page.locator(ROW).first()).toBeVisible()
    // Method, path and status are never dropped, whatever the width.
    const narrow = await headers(page)
    expect(narrow).toContain('Method')
    expect(narrow).toContain('Path')
    expect(narrow).toContain('Status')
    expect(narrow).not.toContain('Last served')

    await page.setViewportSize({ width: 1600, height: 700 })
    // Widening restores them without a reload — the set follows the pane, not the page load.
    await expect.poll(async () => (await headers(page)).length, { timeout: 4000 }).toBe(7)
    expect(await headers(page)).toContain('Last served')
  })
})
