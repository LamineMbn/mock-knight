import { expect, test } from '@playwright/test'
import { WIREMOCK, resetToSeed } from './seed.js'

/**
 * Editing, conflict, and merge — M2's exit criterion, driven through the real UI.
 *
 * "Two browsers editing the same stub produce a conflict diff, not a lost update." The second
 * writer here is a direct call to WireMock's admin API, which is exactly what a colleague's
 * `curl` or another Mock Knight instance looks like from this one's point of view.
 *
 * Every assertion about the outcome reads back from **WireMock**, not from our own mirror: the
 * mirror agreeing with the UI proves only that they share a bug.
 */

const ROW = '[role="row"][aria-rowindex]'

interface Mapping {
  id: string
  name?: string
  request?: { urlPath?: string; url?: string }
  response?: { status?: number; fixedDelayMilliseconds?: number }
}

async function mappings(): Promise<Mapping[]> {
  const response = await fetch(`${WIREMOCK}/__admin/mappings`)
  return ((await response.json()) as { mappings: Mapping[] }).mappings
}

const customers = (all: Mapping[]): Mapping | undefined =>
  all.find((m) => (m.request?.urlPath ?? m.request?.url) === '/v1/customers')

test.beforeEach(async ({ page }) => {
  await resetToSeed(page)
})

async function openRawEditor(page: import('@playwright/test').Page) {
  await page.goto('/?q=url%3A%2Fv1%2Fcustomers')
  await expect(page.locator(ROW)).toHaveCount(1)
  await page.locator(ROW).first().click()
  // Wait for the detail to finish loading: while it is pending the pane renders a skeleton with
  // no tabs, and clicking straight through races the very first run of the suite.
  await expect(page.getByRole('tab', { name: 'Raw JSON' })).toBeVisible()
  await page.getByRole('tab', { name: 'Raw JSON' }).click()
  const editor = page.getByLabel('Raw JSON')
  await expect(editor).toHaveValue(/"response"/)
  return editor
}

test('an edit saves through to the mock server', async ({ page }) => {
  const editor = await openRawEditor(page)
  await editor.fill((await editor.inputValue()).replace(/"status":\s*404/, '"status": 503'))
  await page.getByRole('button', { name: 'Save' }).click()

  await expect
    .poll(async () => customers(await mappings())?.response?.status, { timeout: 5000 })
    .toBe(503)
})

test('an unsaved edit is marked, and discard restores the loaded document', async ({ page }) => {
  const editor = await openRawEditor(page)
  const original = await editor.inputValue()
  await editor.fill(original.replace(/"status":\s*404/, '"status": 503'))

  await expect(page.getByLabel('unsaved changes')).toBeVisible()
  await page.getByRole('button', { name: 'Discard' }).click()

  expect(await editor.inputValue()).toBe(original)
  await expect(page.getByLabel('unsaved changes')).toHaveCount(0)
  // Nothing reached the server.
  expect(customers(await mappings())?.response?.status).toBe(404)
})

test('invalid JSON is refused locally rather than sent', async ({ page }) => {
  const editor = await openRawEditor(page)
  await editor.fill('{ this is not json')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByRole('alert')).toContainText('not valid JSON')
  expect(customers(await mappings())?.response?.status).toBe(404)
})

test('a concurrent edit produces a merge, not a lost update', async ({ page }) => {
  const editor = await openRawEditor(page)

  // Someone else changes the same stub — a different field, plus the same one.
  const before = customers(await mappings())!
  await fetch(`${WIREMOCK}/__admin/mappings/${before.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...before,
      name: 'renamed upstream',
      response: { ...before.response, status: 418 },
    }),
  })

  await editor.fill((await editor.inputValue()).replace(/"status":\s*404/, '"status": 500'))
  await page.getByRole('button', { name: 'Save' }).click()

  const dialog = page.getByRole('dialog', { name: 'Resolve conflicting edits' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('while you were editing it')
  // The rename is not a conflict — only one side touched it — so it must not be asked about.
  await expect(dialog).toContainText('1 other change merged automatically')

  await dialog.getByRole('button', { name: /Your edit/ }).click()
  await dialog.getByRole('button', { name: 'Save merged' }).click()
  await expect(dialog).toHaveCount(0, { timeout: 8000 })

  await expect
    .poll(async () => customers(await mappings())?.response?.status, { timeout: 8000 })
    .toBe(500)

  const merged = customers(await mappings())!
  // Their change survived, and so did a field neither of us touched.
  expect(merged.name).toBe('renamed upstream')
  expect(merged.response?.fixedDelayMilliseconds).toBe(50)
})

test('deleting needs the stub named back', async ({ page }) => {
  await openRawEditor(page)
  await page.getByRole('button', { name: 'Delete…' }).click()

  const confirm = page.getByRole('button', { name: 'Delete', exact: true })
  await expect(confirm).toBeDisabled()

  await page.getByLabel('Type the stub name to confirm deletion').fill('wrong name')
  await expect(confirm).toBeDisabled()

  await page.getByLabel('Type the stub name to confirm deletion').fill('customers list')
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expect.poll(async () => customers(await mappings()), { timeout: 5000 }).toBeUndefined()
})
