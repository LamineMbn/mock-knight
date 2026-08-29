import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { ROUTES } from '../src/lib/routes.js'

/**
 * Every page, both themes. Dark mode is where a contrast regression hides: the palette redefines
 * its values there, so a pairing that passes in light can fail in dark and nothing else notices.
 *
 * `best-practice` is in the tag list alongside the WCAG tiers on purpose. `region` — which
 * catches content sitting outside a landmark — carries no WCAG tag of its own, so a WCAG-only
 * filter can never fire it; `landmark-one-main`, `heading-order` and others are the same. Naming
 * individual rules instead would mean remembering to add the next one, which is how a check set
 * quietly stops covering things. `best-practice` is the honest superset.
 */
for (const route of ROUTES) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`${route.path} has no accessibility violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await page.goto(route.path === '/' ? './' : `.${route.path}`)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
        .analyze()
      // `results.incomplete` is expected to carry exactly one entry here: `color-contrast` on the
      // `aria-hidden="true"` ✓/✗ glyph spans in CapabilityMatrix.astro and MatchHero.astro. Axe
      // cannot rasterise a non-BMP glyph to check its contrast (`messageKey: 'nonBmp'`), so it
      // marks those spans "needs manual review" rather than pass or fail. That is not a
      // suppressed failure: the glyphs are `aria-hidden` precisely because the adjacent visible
      // text ("Yes"/"No", "matched"/"failed") already carries the meaning, so nothing here is
      // left unasserted in practice. `violations` — asserted below — is unaffected either way.
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
