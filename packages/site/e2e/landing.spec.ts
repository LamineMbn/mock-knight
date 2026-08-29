import { expect, test } from '@playwright/test'

test('the landing page carries the four screens with real alt text', async ({ page }) => {
  await page.goto('./')
  const figures = page.locator('figure img')
  await expect(figures).toHaveCount(4)

  // An empty alt on a screenshot is a decorative-image claim that is not true here: these are
  // the only evidence on the page that the UI exists.
  for (const alt of await figures.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('alt')))) {
    expect(alt ?? '').not.toBe('')
    expect((alt ?? '').length).toBeGreaterThan(40)
  }
})

test('links to each backend page', async ({ page }) => {
  await page.goto('./')
  for (const slug of ['wiremock', 'mockserver', 'mockoon', 'prism']) {
    await expect(page.locator(`a[href$="/${slug}/"]`).first()).toBeVisible()
  }
})

test('shows the install command', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('npx mock-knight --url').first()).toBeVisible()
})
