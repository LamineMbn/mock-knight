import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const schema = JSON.parse(
  readFileSync(new URL('../../../schema/mock-knight.schema.json', import.meta.url), 'utf8'),
) as { properties: Record<string, { description?: string }> }

/**
 * The point of generating this page is that it cannot describe a program that does not exist.
 * Asserting against the schema rather than against a fixed list is what makes that true: add a
 * field to the config and this test starts requiring the page to show it.
 */
test('every top-level config field appears on the page', async ({ page }) => {
  await page.goto('./config/')
  for (const name of Object.keys(schema.properties)) {
    await expect(page.getByRole('cell', { name, exact: true })).toBeVisible()
  }
})

test('the page carries the field descriptions from the schema', async ({ page }) => {
  await page.goto('./config/')
  const described = Object.entries(schema.properties).find(([, v]) => v.description !== undefined)
  expect(described, 'the schema has no descriptions to render').toBeDefined()
  await expect(page.getByText(described![1].description!, { exact: false })).toBeVisible()
})
