import { expect, test } from '@playwright/test'
import { ROUTES } from '../src/lib/routes.js'

/**
 * The whole reason this site exists is that a README is one page trying to rank for six query
 * clusters. That only works if every page carries its own title, description and canonical —
 * and if no two pages claim the same one.
 */
for (const route of ROUTES) {
  test(`${route.path} carries a complete head`, async ({ page }) => {
    const response = await page.goto(route.path === '/' ? './' : `.${route.path}`)
    expect(response?.status(), `${route.path} did not return 200`).toBe(200)

    await expect(page).toHaveTitle(route.title)

    const description = page.locator('head meta[name="description"]')
    await expect(description).toHaveAttribute('content', route.description)

    const canonical = page.locator('head link[rel="canonical"]')
    await expect(canonical).toHaveAttribute(
      'href',
      `https://laminembn.github.io/mock-knight${route.path}`,
    )

    await expect(page.locator('head meta[property="og:title"]')).toHaveAttribute(
      'content',
      route.title,
    )
    await expect(page.locator('head meta[property="og:image"]')).toHaveCount(1)
    await expect(page.locator('head script[type="application/ld+json"]')).toHaveCount(1)

    // Exactly one h1. Two is the commonest way a page stops being about one thing.
    await expect(page.locator('h1')).toHaveCount(1)
  })
}
