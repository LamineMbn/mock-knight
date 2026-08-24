#!/usr/bin/env node
/**
 * Print one version's section of CHANGELOG.md, for use as a GitHub Release body.
 *
 * The release workflow used `gh release create --generate-notes`, which summarises the merged
 * pull requests since the last tag. This repository has none — work lands as commits on main —
 * so the generated body was a single "Full Changelog" compare link, and the notes that had
 * actually been written sat in CHANGELOG.md where nobody arriving at the Release would see them.
 *
 * Exits 1 when the version has no section, so a release cannot ship with an empty body. That
 * check runs in preflight, before the tag has cost anyone ten minutes of CI.
 *
 * Usage: node scripts/changelog-section.mjs 0.5.0 [--check]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const version = process.argv[2]
if (version === undefined) {
  console.error('usage: changelog-section.mjs <version> [--check]')
  process.exit(2)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')

/**
 * Headings are matched exactly, not by prefix: `## 0.5.0` must not be found by a search for
 * `## 0.5`, and `## 0.5.0` must not match `## 0.5.0-rc.1`.
 */
const lines = changelog.split('\n')
const start = lines.findIndex((line) => line.trim() === `## ${version}`)
if (start === -1) {
  console.error(`CHANGELOG.md has no "## ${version}" section.`)
  process.exit(1)
}

let end = lines.length
for (let index = start + 1; index < lines.length; index += 1) {
  if (lines[index].startsWith('## ')) {
    end = index
    break
  }
}

const body = lines
  .slice(start + 1, end)
  .join('\n')
  .trim()
if (body === '') {
  console.error(`The "## ${version}" section of CHANGELOG.md is empty.`)
  process.exit(1)
}

// --check answers "would this produce a body?" without printing it, so preflight logs stay short.
if (process.argv.includes('--check')) {
  console.log(`CHANGELOG.md has ${body.split('\n').length} lines of notes for ${version}.`)
} else {
  console.log(body)
}
