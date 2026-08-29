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

/**
 * Demote only heading lines that are outside a fenced code block. A naive `/^## /gm` replace
 * has no fence state at all — it would demote a `## ` line whether or not it sits inside a
 * ``` or ~~~ block, which is exactly the kind of content a CLI-tool FAQ tends to grow.
 *
 * This tracks fence state with a *simple toggle*: a line that opens with three or more of the
 * same fence character (optionally indented up to 3 spaces, optionally followed by an info
 * string such as ```bash) flips the state; a later line opening with three or more of that same
 * character flips it back. That is a narrower guarantee than full CommonMark, which also
 * requires a closing fence to be at least as long as its opener — a fence closed with fewer
 * backticks than it opened with is not itself closed here, and the toggle does not track fence
 * *length* at all, only which character (` or ~) is open. Good enough for this file, which only
 * needs "don't touch a heading-shaped line inside a fence," not a full Markdown parser.
 */
function demoteHeadings(markdown) {
  let fenceChar = null
  return markdown
    .split('\n')
    .map((line) => {
      const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (fence !== null) {
        const marker = fence[1][0]
        fenceChar = fenceChar === marker ? null : (fenceChar ?? marker)
        return line
      }
      if (fenceChar === null && line.startsWith('## ')) {
        return `#${line}`
      }
      return line
    })
    .join('\n')
}

const source = readFileSync(join(root, 'docs', 'faq.md'), 'utf8').trim()
const readmePath = join(root, 'README.md')
const readme = readFileSync(readmePath, 'utf8')

const start = readme.indexOf(START)
const end = readme.indexOf(END)
if (start === -1 || end === -1) {
  console.error(`README.md has no ${START} / ${END} pair. Add them under the FAQ heading.`)
  process.exit(2)
}
if (end < start + START.length) {
  console.error(`README.md has ${END} before ${START}. Check for a bad merge and fix the order.`)
  process.exit(2)
}

const demoted = demoteHeadings(source)
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
