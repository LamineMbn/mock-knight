import { expect, test } from '@playwright/test'
import { BACKENDS } from '../src/lib/backends.js'

for (const backend of BACKENDS) {
  test(`${backend.slug} page states every capability it lacks`, async ({ page }) => {
    await page.goto(`./${backend.slug}/`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(backend.h1)

    for (const capability of backend.capabilities) {
      if (capability.state === 'off') {
        // The reason must be on the page, not just in the data.
        await expect(page.getByText(capability.note!, { exact: false })).toBeVisible()
      }
    }
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
