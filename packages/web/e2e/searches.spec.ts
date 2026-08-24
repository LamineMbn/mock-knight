import { expect, test } from '@playwright/test'
import { resetToSeed } from './seed.js'

/**
 * Saved searches — FR-FIND-6.
 *
 * A structured query is the fastest way to find one stub among thousands, and also the thing
 * nobody remembers the syntax of a week later.
 */

const ROW = '[role="row"][aria-rowindex]'

test.beforeEach(async ({ page }) => {
  await resetToSeed(page)
  // These outlive a spec — they are the one thing Mock Knight stores rather than mirrors — so
  // each run clears its own leavings rather than counting a previous run's.
  const profiles = (await (await page.request.get('/api/profiles')).json()) as {
    profiles: { id: string }[]
  }
  const id = profiles.profiles[0]!.id
  const existing = (await (await page.request.get(`/api/${id}/searches`)).json()) as {
    searches: { id: number }[]
  }
  for (const saved of existing.searches)
    await page.request.delete(`/api/${id}/searches/${saved.id}`)
})

test('a query can be named, recalled, and deleted', async ({ page }) => {
  await page.goto('/?q=method%3AGET')
  await expect(page.locator(ROW).first()).toBeVisible()

  await page.getByRole('button', { name: 'Save this search' }).click()
  await page.getByLabel('Name this search').fill('just the reads')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  // Saved: the control names it rather than offering to save it again.
  await expect(page.getByTitle(/This search is saved/)).toHaveText('just the reads')
  await expect(page.getByRole('button', { name: 'Save this search' })).toHaveCount(0)

  // Recall it from a different query.
  await page.goto('/?q=status%3A404')
  await page.getByLabel('Saved searches').selectOption({ label: 'just the reads' })
  await expect(page).toHaveURL(/q=method%3AGET/)
  await expect(page.getByLabel('Search stubs')).toHaveValue('method:GET')

  // And remove it. The saved chip is the way back into the panel — it used to be inert, which
  // left no route to delete a search once it existed.
  await page.getByTitle('This search is saved — click to manage saved searches').click()
  await page
    .getByRole('button', { name: /^Delete the saved search/ })
    .first()
    .click()
  await expect(page.getByLabel('Saved searches')).toHaveCount(0)
})

test('saving the same name twice updates rather than failing', async ({ page }) => {
  await page.goto('/?q=method%3AGET')
  await page.getByRole('button', { name: 'Save this search' }).click()
  await page.getByLabel('Name this search').fill('tenants')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTitle(/This search is saved/)).toHaveText('tenants')

  await page.goto('/?q=header%3AX-Tenant')
  await page.getByRole('button', { name: 'Save this search' }).click()
  await page.getByLabel('Name this search').fill('tenants')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  // One entry, holding the newer query — refining and re-saving means "update this".
  await page.goto('/?q=')
  await expect(page.getByLabel('Saved searches')).toContainText('Saved (1)')
  await page.getByLabel('Saved searches').selectOption({ label: 'tenants' })
  await expect(page).toHaveURL(/q=header%3AX-Tenant/)
})

test('is offered in the palette, with the query it will run', async ({ page }) => {
  await page.goto('/?q=method%3ADELETE')
  await page.getByRole('button', { name: 'Save this search' }).click()
  await page.getByLabel('Name this search').fill('deletes only')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTitle(/This search is saved/)).toHaveText('deletes only')

  await page.goto('/')
  await expect(page.getByRole('button', { name: /Profile: / })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  const row = page
    .getByRole('dialog', { name: 'Command palette' })
    .getByRole('option', { name: 'deletes only', exact: true })
  await expect(row).toBeVisible()
  await expect(row).toContainText('method:DELETE')
  await row.click()
  await expect(page).toHaveURL(/q=method%3ADELETE/)
})

test('an empty search is not offered a name', async ({ page }) => {
  // Saving "everything" is not worth a name.
  await page.goto('/')
  await expect(page.locator(ROW).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save this search' })).toHaveCount(0)
})

test('the search box can be cleared without selecting the text', async ({ page }) => {
  // Design brief §6.2 asks for this and it was missing. Clearing meant selecting a long
  // structured query and deleting it — worst on exactly the queries this box is for.
  await page.goto('/?q=method%3AGET+status%3A2xx')
  await expect(page.getByLabel('Search stubs')).toHaveValue('method:GET status:2xx')

  await page.getByRole('button', { name: 'Clear the search (esc)' }).click()
  await expect(page.getByLabel('Search stubs')).toHaveValue('')
  await expect(page).not.toHaveURL(/[?&]q=/)
  // The control goes away with nothing to clear.
  await expect(page.getByRole('button', { name: 'Clear the search (esc)' })).toHaveCount(0)
})

test('escape clears the search box too', async ({ page }) => {
  await page.goto('/?q=method%3AGET')
  await page.getByLabel('Search stubs').focus()
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Search stubs')).toHaveValue('')
})

test('an applied search can be updated in place, or saved as a new one', async ({ page }) => {
  await page.goto('/?q=method%3AGET')
  await page.getByRole('button', { name: 'Save this search' }).click()
  await page.getByLabel('Name this search').fill('reads')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTitle(/This search is saved/)).toHaveText('reads')

  // Apply it, then refine the query — the case that previously required retyping the name.
  await page.goto('/?q=')
  await page.getByLabel('Saved searches').selectOption({ label: 'reads' })
  await page.getByLabel('Search stubs').fill('method:GET status:404')
  await page.getByLabel('Search stubs').press('Enter')

  await expect(page.getByRole('button', { name: /^Update .reads./ })).toBeVisible()
  // And re-saving under a different name is still available, relabelled so the two are distinct.
  await expect(page.getByRole('button', { name: 'Save as a new search' })).toBeVisible()

  await page.getByRole('button', { name: /^Update .reads./ }).click()
  // Now it is the saved query, so the chip returns and Update has nothing to do.
  await expect(page.getByTitle(/This search is saved/)).toHaveText('reads')
  await expect(page.getByRole('button', { name: /^Update .reads./ })).toHaveCount(0)

  await page.goto('/?q=')
  await page.getByLabel('Saved searches').selectOption({ label: 'reads' })
  await expect(page.getByLabel('Search stubs')).toHaveValue('method:GET status:404')
})

test('Update is not offered for a query that was typed rather than recalled', async ({ page }) => {
  // It would have to guess which saved search the person meant, and guessing wrong overwrites
  // one they did not name.
  await page.goto('/?q=method%3APOST')
  await page.getByRole('button', { name: 'Save this search' }).click()
  await page.getByLabel('Name this search').fill('writes')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  await page.goto('/?q=method%3APUT')
  await expect(page.getByRole('button', { name: /^Update .*with the query/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save this search' })).toBeVisible()
})

test('a search you just saved can be updated straight away', async ({ page }) => {
  // The commonest flow: save a query, notice it needs one more filter, want to keep the name.
  // Without treating a save as an application, this offered only "Save search" and a name to
  // reinvent.
  await page.goto('/?q=method%3AGET')
  await page.getByRole('button', { name: 'Save this search' }).click()
  await page.getByLabel('Name this search').fill('reads again')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTitle(/This search is saved/)).toHaveText('reads again')

  await page.getByLabel('Search stubs').fill('method:GET status:404')
  await page.getByLabel('Search stubs').press('Enter')
  await expect(page.getByRole('button', { name: /^Update .reads again./ })).toBeVisible()
})
