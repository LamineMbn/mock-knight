import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

interface SchemaNode {
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  description?: string
}

const schema = JSON.parse(
  readFileSync(new URL('../../../schema/mock-knight.schema.json', import.meta.url), 'utf8'),
) as SchemaNode

/**
 * Every field name reachable from the schema root, flattened — top level, and recursively
 * through any array's `items` (that is how `profiles`' own thirteen fields are reached; a
 * config field that is itself an array of objects would be reached the same way).
 *
 * The point of generating this page is that it cannot describe a program that does not exist.
 * Asserting against the schema rather than against a fixed list is what makes that true: add a
 * field to the config and these tests start requiring the page to show it.
 */
function collectFields(
  node: SchemaNode,
  into: Record<string, SchemaNode> = {},
): Record<string, SchemaNode> {
  if (node.properties !== undefined) {
    for (const [name, field] of Object.entries(node.properties)) {
      into[name] = field
      collectFields(field, into)
    }
  }
  if (node.items !== undefined) collectFields(node.items, into)
  return into
}

/**
 * One rendered `<table class="schema">` per property group the page draws a `SchemaTable` for:
 * the document root, then — generically, not by naming `profiles` specifically — the item
 * schema of every array among the root's own properties. Matches `config.astro`'s "Top level"
 * table followed by its "Profiles" table, in that order.
 */
function tableSections(root: SchemaNode): Record<string, SchemaNode>[] {
  const sections = [root.properties ?? {}]
  for (const field of Object.values(root.properties ?? {})) {
    if (field.items?.properties !== undefined) sections.push(field.items.properties)
  }
  return sections
}

const fields = collectFields(schema)
const sections = tableSections(schema)

test('every config field, top level and nested, appears on the page', async ({ page }) => {
  await page.goto('./config/')
  for (const name of Object.keys(fields)) {
    await expect(page.getByRole('cell', { name, exact: true })).toBeVisible()
  }
})

/**
 * The regression this guards against: `at="profiles"` once resolved to the array node rather
 * than its item schema, so the profiles table rendered a header with zero rows while every name
 * check above kept passing against the *other* table. A per-table row count catches that shape
 * of failure without needing to know which names anyone thought to check.
 */
test('each schema table has one row per field it documents', async ({ page }) => {
  await page.goto('./config/')
  const tables = page.locator('table.schema')
  await expect(tables).toHaveCount(sections.length)
  for (const [index, section] of sections.entries()) {
    await expect(tables.nth(index).locator('tbody tr')).toHaveCount(Object.keys(section).length)
  }
})

test('the page carries the field descriptions from the schema, on the right row', async ({
  page,
}) => {
  await page.goto('./config/')
  const described = Object.entries(fields).find(([, field]) => field.description !== undefined)
  expect(described, 'the schema has no descriptions to render').toBeDefined()
  const [name, field] = described!

  const row = page.locator('tr').filter({ has: page.getByRole('cell', { name, exact: true }) })
  await expect(row.getByText(field.description!, { exact: false })).toBeVisible()
})

/**
 * Step 0 of this task added a `.describe()` to every field, precisely so this table would never
 * fall back to a dash. This is the assertion that keeps that true: it fails the day a field is
 * added to the config without a description, not just the day this task happened to check one.
 */
test('no schema table cell falls back to the missing-description placeholder', async ({ page }) => {
  await page.goto('./config/')
  await expect(page.locator('table.schema').getByText('—', { exact: true })).toHaveCount(0)
})
