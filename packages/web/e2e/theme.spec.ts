import { expect, test } from '@playwright/test'
import { resetToSeed } from './seed.js'

/**
 * Light and dark — FR-UX-2.
 *
 * The tokens and the brand mark already honoured `[data-theme]`; only the control was missing,
 * so these check the three states, that the choice survives a reload, and that "system" keeps
 * following the machine rather than latching onto whatever it saw first.
 */

test.beforeEach(async ({ page }) => {
  await resetToSeed(page)
})

const canvas = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)

test.describe('with a light machine', () => {
  test.use({ colorScheme: 'light' })

  test('follows the OS until told otherwise, then holds the choice', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Follow this machine theme' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const lightCanvas = await canvas(page)

    await page.getByRole('button', { name: 'Dark theme' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const darkCanvas = await canvas(page)
    expect(darkCanvas).not.toBe(lightCanvas)

    // Survives a reload, and without a flash of the wrong theme: the attribute is applied by an
    // inline script before the bundle runs, so it is already correct on the very first paint.
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByRole('button', { name: 'Dark theme' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(await canvas(page)).toBe(darkCanvas)
  })

  test('back to system removes the attribute rather than pinning a colour', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Dark theme' }).click()
    await page.getByRole('button', { name: 'Follow this machine theme' }).click()
    // Writing data-theme="light" here would pin a dark machine to light, which is the opposite
    // of following the OS.
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/)
  })
})

test.describe('with a dark machine', () => {
  test.use({ colorScheme: 'dark' })

  test('system means dark here, and light can still be forced', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Follow this machine theme' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const systemCanvas = await canvas(page)

    await page.getByRole('button', { name: 'Light theme' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(await canvas(page)).not.toBe(systemCanvas)
  })

  test('the brand mark swaps with the chosen theme, not only with the OS', async ({ page }) => {
    // CLAUDE.md: the mark is picked by theme and never recoloured with a filter, so the two
    // variants are separate images and exactly one is shown.
    await page.goto('/')
    // Wait for the shell: querying computed styles before React has mounted finds no images at
    // all, which looks identical to "both are hidden".
    await expect(page.getByRole('group', { name: 'Theme' })).toBeVisible()
    const shown = async () =>
      page
        .locator('header img')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => getComputedStyle(node).display !== 'none')
            .map((node) => (node as HTMLImageElement).getAttribute('src')),
        )
    expect(await shown()).toEqual(['/brand/mock-knight-mark-dark.svg'])

    await page.getByRole('button', { name: 'Light theme' }).click()
    expect(await shown()).toEqual(['/brand/mock-knight-mark.svg'])
  })
})

test('the palette offers the themes it is not already on', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Profile: / })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')

  const palette = page.getByRole('dialog', { name: 'Command palette' })
  // Not the current one: an option that does nothing is noise in a list meant to be scanned.
  await expect(palette.getByRole('option', { name: 'Theme: system' })).toHaveCount(0)
  await palette.getByRole('option', { name: 'Theme: dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
