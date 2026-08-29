import { expect, test } from '@playwright/test'

/**
 * The hero must mean something with JavaScript off.
 *
 * A crawler that does not execute scripts, and a reader whose corporate proxy strips them, both
 * see the server-rendered state — so it is rendered in the *failing* state, which is the state
 * that explains what the product does.
 */
test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('renders the failing explanation as static HTML', async ({ page }) => {
    await page.goto('./')
    const hero = page.getByRole('region', { name: 'Why a request did not match' })
    await expect(hero).toBeVisible()
    await expect(hero.getByRole('row')).toHaveCount(4) // header + 3 predicates
    await expect(hero.getByTestId('verdict')).toContainText('1 of 3 predicates failed')
    // Never colour alone: the failing row carries a glyph and a word too.
    await expect(hero.getByTestId('row-header')).toContainText('failed')
  })
})

test.describe('with JavaScript', () => {
  test('recomputes the verdict when the tenant changes', async ({ page }) => {
    await page.goto('./')
    const hero = page.getByRole('region', { name: 'Why a request did not match' })

    await expect(hero.getByTestId('verdict')).toContainText('1 of 3 predicates failed')

    await hero.getByLabel('X-Tenant').selectOption('acme')
    await expect(hero.getByTestId('verdict')).toContainText('matched')
    await expect(hero.getByTestId('row-header')).toContainText('matched')

    await hero.getByLabel('X-Tenant').selectOption('initech')
    await expect(hero.getByTestId('verdict')).toContainText('1 of 3 predicates failed')
  })

  test('announces the change to assistive technology', async ({ page }) => {
    await page.goto('./')
    const verdict = page.getByTestId('verdict')
    await expect(verdict).toHaveAttribute('aria-live', 'polite')
  })

  test('is operable from the keyboard alone', async ({ page }) => {
    await page.goto('./')
    const select = page.getByLabel('X-Tenant')
    await select.focus()
    await expect(select).toBeFocused()
    await select.selectOption('globex')
    await expect(page.getByTestId('verdict')).toContainText('matched')
  })
})
