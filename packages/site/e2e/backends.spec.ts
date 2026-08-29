import { expect, test } from '@playwright/test'
import { BACKENDS } from '../src/lib/backends.js'

for (const backend of BACKENDS) {
  test(`${backend.slug} page states every capability it lacks, or grants only conditionally`, async ({
    page,
  }) => {
    await page.goto(`./${backend.slug}/`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(backend.h1)

    for (const capability of backend.capabilities) {
      // A note exists for `off` (why not) and for `on` with `onIf` (why only conditionally) —
      // either way, the reason must be on the page, not just in the data. Checking `off` alone
      // let a capability that is on but conditional (Mockoon's traffic log) render its "Yes"
      // with the reason silently missing from the page.
      if (capability.note !== null) {
        await expect(page.getByText(capability.note, { exact: false })).toBeVisible()
      }
    }
  })

  /**
   * The defect this suite exists to catch: all four pages rendered `corpus.png` — WireMock's
   * screenshot — regardless of which backend the page was about. Twelve reviews missed it
   * because they checked the alt text's wording against README.md and never checked it against
   * the picture. This does the check no review did: the image's own filename has to name this
   * page's backend, and the alt text has to say so too.
   */
  test(`${backend.slug} page's screenshot is its own, not a borrowed one`, async ({ page }) => {
    await page.goto(`./${backend.slug}/`)
    const screenshot = page.locator('figure img').first()
    await expect(screenshot).toHaveAttribute(
      'src',
      new RegExp(`/images/${backend.screenshot}\\.png$`),
    )
    await expect(screenshot).not.toHaveAttribute('src', /\/images\/corpus\.png$/)
    const alt = (await screenshot.getAttribute('alt')) ?? ''
    expect(alt).toContain(backend.name)
  })
}

/**
 * Mockoon ships its own desktop application. A page that implies otherwise loses the only
 * readers it has in one line, so the caveat is above the fold and asserted.
 */
test('the Mockoon page does not pretend Mockoon has no UI', async ({ page }) => {
  await page.goto('./mockoon/')
  await expect(page.getByText('Mockoon has its own desktop app', { exact: false })).toBeVisible()
  await expect(page.locator('a[href="https://mockoon.com/"]')).toBeVisible()
})

test('the Prism page says read-only above the fold', async ({ page }) => {
  await page.goto('./prism/')
  await expect(page.getByText('Read-only', { exact: false })).toBeVisible()
})

/**
 * Mockoon's traffic log is `onIf`, not `on`: present only once the admin API token is
 * configured. Rendering it identically to an unconditional yes — same state, same glyph, same
 * "Yes" — left only the prose note disagreeing, and the note inherited the same success green
 * regardless. The cell itself has to disagree, not just the paragraph below it.
 */
test('the Mockoon traffic-log cell reads as conditional, not a plain yes', async ({ page }) => {
  await page.goto('./mockoon/')
  const row = page.locator('tr', { has: page.getByRole('rowheader', { name: 'Traffic log' }) })
  const cell = row.locator('td')
  await expect(cell).toHaveAttribute('data-state', 'conditional')
  await expect(cell).toContainText('Yes, with setup')
  await expect(cell).not.toHaveAttribute('data-state', 'on')
})
