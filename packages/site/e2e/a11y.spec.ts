import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { ROUTES } from '../src/lib/routes.js'

/**
 * Every page, both themes. Dark mode is where a contrast regression hides: the palette redefines
 * its values there, so a pairing that passes in light can fail in dark and nothing else notices.
 */
for (const route of ROUTES) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`${route.path} has no accessibility violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await page.goto(route.path === '/' ? './' : `.${route.path}`)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
      expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual(
        [],
      )
    })
  }
}

/**
 * Spec §5.5 promises 360px. A table or a code block that overflows must scroll inside its own
 * box — `table { overflow-x: auto }` and `img { max-width: 100% }` in site.css — never the body.
 */
for (const route of ROUTES) {
  test(`${route.path} fits a 360px viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await page.goto(route.path === '/' ? './' : `.${route.path}`)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, 'the page scrolls horizontally at 360px').toBeLessThanOrEqual(1)
  })
}
