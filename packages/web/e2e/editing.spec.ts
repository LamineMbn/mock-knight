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
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  await expect
    .poll(async () => customers(await mappings())?.response?.status, { timeout: 5000 })
    .toBe(503)
})

test('an unsaved edit is marked, and discard restores the loaded document', async ({ page }) => {
  const editor = await openRawEditor(page)
  const original = await editor.inputValue()
  await editor.fill(original.replace(/"status":\s*404/, '"status": 503'))

  await expect(page.getByLabel('unsaved changes', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Discard unsaved changes (esc)' }).click()

  expect(await editor.inputValue()).toBe(original)
  await expect(page.getByLabel('unsaved changes', { exact: true })).toHaveCount(0)
  // Nothing reached the server.
  expect(customers(await mappings())?.response?.status).toBe(404)
})

test('invalid JSON is refused locally rather than sent', async ({ page }) => {
  const editor = await openRawEditor(page)
  await editor.fill('{ this is not json')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

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
  await page.getByRole('button', { name: 'Save', exact: true }).click()

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
  await page.getByRole('button', { name: /^Delete .*…$/ }).click()

  const confirm = page.getByRole('button', { name: 'Delete', exact: true })
  await expect(confirm).toBeDisabled()

  await page.getByLabel('Type the stub name to confirm deletion').fill('wrong name')
  await expect(confirm).toBeDisabled()

  await page.getByLabel('Type the stub name to confirm deletion').fill('customers list')
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expect.poll(async () => customers(await mappings()), { timeout: 5000 }).toBeUndefined()
})

test('a stub created from an unmatched request makes that request match', async ({ page }) => {
  // The loop this closes: a request fails, the explainer says why, and the fix is one dialog
  // away. Success is not "a stub appeared" — it is that replaying the request now matches.
  await fetch(`${WIREMOCK}/__admin/requests`, { method: 'DELETE' })
  await fetch(`${WIREMOCK}/v1/somewhere-new`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Mock': 'brand-new-case' },
    body: '{"hello":"world"}',
  })

  await page.goto('/?screen=traffic')
  const row = page.locator('tbody tr').filter({ hasText: '/v1/somewhere-new' }).first()
  await row.getByRole('button', { name: /^Why didn't / }).click()

  const explainer = page.getByRole('dialog', { name: "Why didn't this match?" })
  await expect(explainer).toBeVisible()
  await explainer.getByRole('button', { name: 'Create stub from this request' }).click()

  const create = page.getByRole('dialog', { name: 'Create a stub from this request' })
  await expect(create).toBeVisible()

  // Every choice is shown with its consequence rather than buried in a default.
  await expect(create).toContainText('Matches any call to this path with this method.')
  await expect(create).toContainText('composed by Mock Knight')

  const generated = create.getByLabel('Generated stub')
  await expect(generated).toHaveValue(/somewhere-new/)
  // A placeholder body the author is meant to replace, not a fabricated response.
  await expect(generated).toHaveValue(/TODO/)

  await create.getByRole('button', { name: 'Create stub' }).click()
  await expect(create).toHaveCount(0, { timeout: 8000 })

  // The proof: replay the request and it is served rather than rejected.
  await expect
    .poll(
      async () => {
        const response = await fetch(`${WIREMOCK}/v1/somewhere-new`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"hello":"world"}',
        })
        return response.status
      },
      { timeout: 8000 },
    )
    .toBe(200)
})

test('the tightest setting pins the discriminating header but never a credential', async ({
  page,
}) => {
  await fetch(`${WIREMOCK}/__admin/requests`, { method: 'DELETE' })
  await fetch(`${WIREMOCK}/v1/secured`, {
    method: 'GET',
    headers: { 'X-Mock': 'the-discriminator', Authorization: 'Bearer super-secret' },
  })

  await page.goto('/?screen=traffic')
  await page
    .locator('tbody tr')
    .filter({ hasText: '/v1/secured' })
    .first()
    .getByRole('button', { name: /^Why didn't / })
    .click()
  await page
    .getByRole('dialog', { name: "Why didn't this match?" })
    .getByRole('button', { name: 'Create stub from this request' })
    .click()

  const create = page.getByRole('dialog', { name: 'Create a stub from this request' })
  await create.getByRole('button', { name: 'Exact' }).click()

  // Changing a setting must not tear the dialog down. It did: the explainer behind it closed on
  // *bubbled* clicks, so every control in here dismissed the thing it was rendered inside.
  await expect(create).toBeVisible()

  const generated = create.getByLabel('Generated stub')
  await expect(generated).toHaveValue(/the-discriminator/)
  // A token must never be copied into a stub, and the reason is stated rather than silent.
  await expect(generated).not.toHaveValue(/super-secret/)
  await expect(create).toContainText('credential')
})

/**
 * The Matcher tab — FR-EDIT-1, FR-EDIT-2.
 *
 * Until this existed, changing a stub meant hand-writing WireMock JSON. These drive the form
 * and read the result back off WireMock, because a form that updates our own mirror and not the
 * server is the failure that would look most like success.
 */
async function openMatcher(page: import('@playwright/test').Page, query: string) {
  await page.goto(`/?q=${encodeURIComponent(query)}`)
  await expect(page.locator(ROW).first()).toBeVisible()
  await page.locator(ROW).first().click()
  await expect(page.getByRole('tab', { name: 'Matcher' })).toBeVisible()
  await page.getByRole('tab', { name: 'Matcher' }).click()
}

test('the form shows the matcher as fields, not as JSON', async ({ page }) => {
  await openMatcher(page, 'url:/v1/customers')
  await expect(page.getByLabel('Method')).toHaveValue('GET')
  await expect(page.getByLabel('URL match kind')).toHaveValue('urlPath')
  await expect(page.getByLabel('URL', { exact: true })).toHaveValue('/v1/customers')
})

test('editing a header matcher in the form reaches the mock server', async ({ page }) => {
  // The case this corpus actually has: stubs told apart by a request header, three levels down
  // in the JSON where a misplaced brace is a 422 rather than a caught mistake.
  await openMatcher(page, 'header:X-Tenant')
  await expect(page.getByLabel('Request headers name')).toHaveValue('X-Tenant')
  await expect(page.getByLabel('Value')).toHaveValue('acme')

  await page.getByLabel('Value').fill('globex')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)

  const all = await mappings()
  const edited = all.find((m) => m.name === 'orders create 500') as
    (Mapping & { request?: { headers?: Record<string, { equalTo?: string }> } }) | undefined
  expect(edited?.request?.headers?.['X-Tenant']?.equalTo).toBe('globex')
})

test('a form edit keeps fields the form cannot show', async ({ page }) => {
  // `postServeActions` is not in the canonical model, so no form can render it. WireMock
  // replaces a mapping wholesale on PUT, so a rebuild rather than a patch would delete it.
  await openMatcher(page, 'method:DELETE')
  await page.getByLabel('URL', { exact: true }).fill('/v1/carts/10')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)

  const all = (await mappings()) as (Mapping & { postServeActions?: unknown })[]
  const edited = all.find((m) => m.request?.url === '/v1/carts/10')
  expect(edited).toBeDefined()
  expect(edited?.postServeActions).toEqual([{ name: 'webhook', parameters: { url: 'http://x' } }])
})

test('the two edit channels lock each other rather than disagreeing silently', async ({ page }) => {
  // The form edits a canonical draft and Raw edits the vendor document; the browser cannot
  // convert between them. Showing both live would mean two documents that disagree and a
  // silent choice on save.
  await openMatcher(page, 'url:/v1/customers')
  await page.getByLabel('URL', { exact: true }).fill('/v1/customers-changed')

  await page.getByRole('tab', { name: 'Raw JSON' }).click()
  await expect(page.getByText(/unsaved edits on the Matcher tab/)).toBeVisible()
  await expect(page.getByLabel('Raw JSON')).toHaveAttribute('readonly', '')

  // Discarding releases the lock.
  await page.getByRole('button', { name: 'Discard unsaved changes (esc)' }).click()
  await expect(page.getByLabel('Raw JSON')).not.toHaveAttribute('readonly', '')
})

test('an operator the form cannot edit is shown, not hidden', async ({ page }) => {
  // The operator vocabulary is open by design — backends add matchers between minors — so an
  // unrecognised one must round-trip visibly rather than vanish from a form that ignored it.
  await fetch(`${WIREMOCK}/__admin/mappings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'exotic matcher',
      request: {
        method: 'GET',
        urlPath: '/v1/exotic',
        headers: { 'X-Odd': { matchesXPath: '//a' } },
      },
      response: { status: 200 },
    }),
  })
  const profiles = (await (await page.request.get('/api/profiles')).json()) as {
    profiles: { id: string }[]
  }
  await page.request.post(`/api/${profiles.profiles[0]!.id}/refresh`)

  await openMatcher(page, 'url:/v1/exotic')
  await expect(page.getByText('matchesXPath')).toBeVisible()
  // Rendered as a chip rather than a dropdown, so it cannot be silently replaced.
  await expect(page.getByLabel('Operator')).toHaveCount(0)
})

/** The Response tab — same draft plumbing, different half of the stub. */
async function openResponse(page: import('@playwright/test').Page, query: string) {
  await page.goto(`/?q=${encodeURIComponent(query)}`)
  await expect(page.locator(ROW).first()).toBeVisible()
  await page.locator(ROW).first().click()
  await expect(page.getByRole('tab', { name: 'Response' })).toBeVisible()
  await page.getByRole('tab', { name: 'Response' }).click()
}

test('editing the status in the form reaches the mock server', async ({ page }) => {
  await openResponse(page, 'url:/v1/customers')
  await expect(page.getByLabel('Status code')).toHaveValue('404')

  await page.getByLabel('Status code').fill('410')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)

  expect(customers(await mappings())?.response?.status).toBe(410)
})

test('a JSON body is stored as a document, not as a quoted string', async ({ page }) => {
  // The body is held as text while typing so a half-written document survives a keystroke.
  // Saving that string would serve valid JSON of entirely the wrong shape — a failure that
  // looks exactly like the mock working.
  await openResponse(page, 'url:/v1/orders')
  await expect(page.getByLabel('Body kind')).toHaveValue('json')
  await page.getByLabel('Body', { exact: true }).fill('{"error":"rewritten"}')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)

  const all = (await mappings()) as (Mapping & { response?: { jsonBody?: unknown } })[]
  const orders = all.find((m) => m.name === 'orders create 500')
  expect(orders?.response?.jsonBody).toEqual({ error: 'rewritten' })
})

test('an unparseable JSON body is refused locally rather than sent', async ({ page }) => {
  await openResponse(page, 'url:/v1/orders')
  const before = ((await mappings()) as (Mapping & { response?: { jsonBody?: unknown } })[]).find(
    (m) => m.name === 'orders create 500',
  )?.response?.jsonBody

  await page.getByLabel('Body', { exact: true }).fill('{"error": ')
  await expect(page.getByText(/not valid JSON yet/)).toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('not valid JSON')

  const after = ((await mappings()) as (Mapping & { response?: { jsonBody?: unknown } })[]).find(
    (m) => m.name === 'orders create 500',
  )?.response?.jsonBody
  expect(after).toEqual(before)
})

test('warns when a fault makes the body unreachable', async ({ page }) => {
  // A fault closes the connection instead of replying, so a stub with both returns none of its
  // carefully written body — and looks entirely correct in every list.
  await openResponse(page, 'url:/v1/orders')
  await page.getByLabel('Fault', { exact: true }).selectOption('EMPTY_RESPONSE')
  await expect(page.getByText(/fault closes the connection instead of replying/)).toBeVisible()
})

test('the unsaved dot marks the tab that actually changed', async ({ page }) => {
  // The draft spans both form tabs, so marking both would send someone to Matcher to look for
  // a change that is on Response.
  await openResponse(page, 'url:/v1/customers')
  await page.getByLabel('Status code').fill('418')

  const dot = (name: string) =>
    page.getByRole('tab', { name }).getByLabel('unsaved changes', { exact: true })
  await expect(dot('Response')).toBeVisible()
  await expect(dot('Matcher')).toHaveCount(0)

  // And typing a change then undoing it is not an unsaved change.
  await page.getByLabel('Status code').fill('404')
  await expect(dot('Response')).toHaveCount(0)
})

/**
 * Writing a stub by hand, and copying one — FR-EDIT-5, FR-EDIT-7.
 *
 * Before these, capturing an unmatched request was the only route to a new stub, so an empty
 * server was a dead end.
 */
test('a stub can be written from scratch and answers immediately', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator(ROW).first()).toBeVisible()
  await page.getByRole('button', { name: 'New stub' }).click()

  const dialog = page.getByRole('dialog', { name: 'New stub' })
  await dialog.getByLabel('Name').fill('written by hand')
  await dialog.getByLabel('URL', { exact: true }).fill('/v1/handwritten')
  await dialog.getByRole('tab', { name: 'Response' }).click()
  await dialog.getByLabel('Status code').fill('201')
  await dialog.getByLabel('Body', { exact: true }).fill('{"created":true}')
  await dialog.getByRole('button', { name: 'Create stub' }).click()
  await expect(dialog).toHaveCount(0)

  // The only assertion that matters: the mock server now answers it.
  const served = await fetch(`${WIREMOCK}/v1/handwritten`)
  expect(served.status).toBe(201)
  expect(await served.json()).toEqual({ created: true })
})

test('duplicating keeps fields no form can show, and warns about the contest it creates', async ({
  page,
}) => {
  await page.goto('/?q=method%3ADELETE')
  await expect(page.locator(ROW)).toHaveCount(1)
  await page.locator(ROW).first().click()
  await expect(page.getByRole('button', { name: 'Duplicate this stub' })).toBeVisible()
  await page.getByRole('button', { name: 'Duplicate this stub' }).click()

  const dialog = page.getByRole('dialog', { name: 'Duplicate this stub' })
  // A copy matches the same requests by definition, so it lands in a priority contest at once.
  await expect(dialog.getByText(/one of them will shadow the other/)).toBeVisible()
  await expect(dialog.getByLabel('Name')).toHaveValue(/\(copy\)$/)

  await dialog.getByLabel('URL', { exact: true }).fill('/v1/carts/99')
  await dialog.getByRole('button', { name: 'Create copy' }).click()
  await expect(dialog).toHaveCount(0)

  const all = (await mappings()) as (Mapping & { postServeActions?: unknown })[]
  const copy = all.find((m) => m.request?.url === '/v1/carts/99')
  expect(copy).toBeDefined()
  // The point of copying the retained document rather than rebuilding from canonical fields.
  expect(copy?.postServeActions).toEqual([{ name: 'webhook', parameters: { url: 'http://x' } }])
  // And the original is untouched — a reused vendor id would have overwritten it.
  expect(all.find((m) => m.request?.url === '/v1/carts/9')).toBeDefined()
})
