import { expect, test } from '@playwright/test'
import { resetToSeed } from './seed.js'

/**
 * The command palette — design brief §6.10, FR-UX-1, FR-CONN-2.
 *
 * Four screens and a growing set of actions, each previously reachable only by knowing where it
 * lives. These check the two things that make a palette trustworthy rather than merely present:
 * that it filters instead of listing everything, and that a destructive row does not act.
 */

test.beforeEach(async ({ page }) => {
  await resetToSeed(page)
})

const palette = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog', { name: 'Command palette' })

/**
 * The listener is bound on mount, so pressing before the app has rendered does nothing and the
 * failure looks like a broken shortcut rather than a race.
 */
async function openPalette(page: import('@playwright/test').Page) {
  await expect(page.getByRole('button', { name: /Profile: / })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette(page)).toBeVisible()
}

test('opens on the keyboard, closes on escape, and returns focus', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[role="row"][aria-rowindex]').first()).toBeVisible()

  const search = page.getByLabel('Search stubs')
  await search.focus()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette(page)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(palette(page)).toHaveCount(0)
  // §8: the palette returns focus to where it came from.
  await expect(search).toBeFocused()
})

test('navigates between screens', async ({ page }) => {
  await page.goto('/')
  await openPalette(page)
  await palette(page)
    .getByRole('option', { name: /^Traffic/ })
    .click()
  await expect(palette(page)).toHaveCount(0)
  await expect(page).toHaveURL(/screen=traffic/)
})

test('filters by subsequence, and says so when nothing matches', async ({ page }) => {
  await page.goto('/')
  await openPalette(page)

  // A subsequence of "Scenarios", not a prefix.
  await palette(page).getByLabel('Search commands and stubs').fill('scnr')
  await expect(palette(page).getByRole('option', { name: /Scenarios/ })).toBeVisible()
  await expect(palette(page).getByRole('option', { name: 'Corpus', exact: true })).toHaveCount(0)

  await palette(page).getByLabel('Search commands and stubs').fill('zzzzz')
  await expect(palette(page).getByText(/Nothing matches/)).toBeVisible()
})

test('finds a stub and opens it', async ({ page }) => {
  await page.goto('/')
  await openPalette(page)
  await palette(page).getByLabel('Search commands and stubs').fill('customers')
  const stub = palette(page).getByRole('option', { name: /\/v1\/customers/ })
  await expect(stub).toBeVisible()
  await stub.click()
  // Selecting a stub opens it in the detail pane rather than merely filtering the list.
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible()
})

test('a destructive action navigates to its confirmation instead of running', async ({ page }) => {
  await page.goto('/')
  await openPalette(page)
  const row = palette(page).getByRole('option', { name: /Clear the request journal/ })
  // Marked as destructive, per §6.10. Compared against the resolved token rather than a
  // literal, so this survives a palette change and holds in both themes.
  const danger = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mk-danger-text').trim(),
  )
  const asRgb = await page.evaluate((hex) => {
    const probe = document.createElement('span')
    probe.style.color = hex
    document.body.append(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    return resolved
  }, danger)
  await expect(row).toHaveCSS('color', asRgb)
  await row.click()

  // On Traffic, with the control present and *not* yet triggered — the palette is a way to
  // reach the action, not a way around its typed confirmation.
  await expect(page).toHaveURL(/screen=traffic/)
  await expect(page.getByRole('button', { name: 'Clear the request journal…' })).toBeVisible()
  await expect(page.getByLabel(/Type the profile name/)).toHaveCount(0)
})

test('switches server, and does not offer the one already active', async ({ page }) => {
  // A name no other spec uses. Profiles live in the state database and outlive a spec file, so
  // a shared name here matched a leftover from profiles.spec and the assertion read as a bug.
  const name = 'palette target'
  // Profiles live in the state database and outlive both the spec and the *run*, so a previous
  // execution's copy was still there and the assertion below read as a product bug.
  const existing = (await (await page.request.get('/api/profiles')).json()) as {
    profiles: { id: string; name: string }[]
  }
  for (const stale of existing.profiles.filter((candidate) => candidate.name === name)) {
    await page.request.delete(`/api/profiles/${stale.id}`)
  }

  await page.goto('/?screen=profiles')
  await page.getByLabel('Base URL').first().fill('http://localhost:18099')
  await page.getByLabel('Name', { exact: true }).first().fill(name)
  await page.getByRole('button', { name: 'Add and connect' }).click()
  await expect(page.getByRole('button', { name: /Profile: / })).toContainText(name)

  await openPalette(page)
  // The active server is not offered as somewhere to switch to.
  await expect(palette(page).getByRole('option', { name })).toHaveCount(0)
  // Named by the action, not by the action plus its hint — see the aria-label in the palette.
  await palette(page).getByRole('option', { name: 'localhost:18099', exact: true }).click()
  await expect(page.getByRole('button', { name: /Profile: / })).toContainText('localhost:18099')
})

/**
 * Telling people the shortcuts exist — design brief §6.1 and §8.
 *
 * ⌘K is only useful to someone who already knows about it, which is nobody on a first run. A
 * keyboard-first tool that never says so is a mouse-driven tool with extra steps.
 */
test.describe('discoverability', () => {
  test('the top bar advertises the palette and opens it', async ({ page }) => {
    await page.goto('/')
    const control = page.getByRole('button', { name: /Command palette/ }).first()
    await expect(control).toBeVisible()
    // Names a modifier that works on this platform. Printing the wrong one would send someone
    // to a key combination that does nothing on the machine in front of them.
    await expect(control).toContainText(process.platform === 'darwin' ? '⌘K' : 'CtrlK')
    await control.click()
    await expect(palette(page)).toBeVisible()
  })

  test('? publishes the whole keymap', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /Profile: / })).toBeVisible()
    await page.keyboard.press('?')

    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(sheet).toBeVisible()
    for (const entry of ['Command palette', 'Focus the search box', 'Save']) {
      await expect(sheet.getByText(entry, { exact: false }).first()).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
  })

  test('? does not fire while typing, so a question mark can be typed', async ({ page }) => {
    await page.goto('/')
    const search = page.getByLabel('Search stubs')
    await search.fill('why?')
    await expect(search).toHaveValue('why?')
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0)
  })
})
