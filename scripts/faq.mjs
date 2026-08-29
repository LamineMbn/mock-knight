#!/usr/bin/env node
/**
 * One FAQ, two renderings.
 *
 * `docs/faq.md` is the source. This writes it into README.md between two markers; the site
 * imports the same file. CI runs this and then `git diff --exit-code`, so a stale README fails
 * the build — the same guarantee `tokens.css` and `schema/mock-knight.schema.json` have.
 *
 * Heading levels differ between the two surfaces and that is the detail a naive injector gets
 * wrong. The source writes each question as `##`. In the README they sit beneath `## FAQ`, so
 * they are demoted to `###`. On the site they render unchanged beneath the page's own `<h1>`.
 * Both are correct outlines; neither is the source's literal level.
 *
 * Usage: node scripts/faq.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const START = '<!-- faq:start -->'
const END = '<!-- faq:end -->'

const source = readFileSync(join(root, 'docs', 'faq.md'), 'utf8').trim()
const readmePath = join(root, 'README.md')
const readme = readFileSync(readmePath, 'utf8')

const start = readme.indexOf(START)
const end = readme.indexOf(END)
if (start === -1 || end === -1) {
  console.error(`README.md has no ${START} / ${END} pair. Add them under the FAQ heading.`)
  process.exit(2)
}

// Only headings at the start of a line, so a `##` inside a fenced block is left alone.
const demoted = source.replace(/^## /gm, '### ')
const next = `${readme.slice(0, start + START.length)}\n\n${demoted}\n\n${readme.slice(end)}`

if (process.argv.includes('--check')) {
  if (next !== readme) {
    console.error('README.md’s FAQ is stale. Run `pnpm faq` and commit the result.')
    process.exit(1)
  }
  console.log('README.md’s FAQ matches docs/faq.md.')
} else {
  writeFileSync(readmePath, next)
  console.log('README.md’s FAQ updated from docs/faq.md.')
}
