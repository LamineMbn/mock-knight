#!/usr/bin/env node
/**
 * Fail the build on an internal link that does not exist in `dist`.
 *
 * `astro dev` serves from the base path, so a hardcoded `/wiremock/` works locally and 404s in
 * production. Nothing catches that until someone clicks it on the live site. This walks the
 * built HTML and resolves every root-relative href and src against `dist`, which is exactly what
 * GitHub Pages will do.
 *
 * Scans only `href="..."` and `src="..."` attribute values. It does not scan `srcset` or
 * `content="..."` (e.g. `og:image`) — both are absolute today, so nothing is missed yet, but a
 * future contributor adding a root-relative link through either would not be checked.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '..', 'dist')
const BASE = '/mock-knight'

async function htmlFiles(directory) {
  const out = []
  for (const entry of await readdir(directory)) {
    const full = join(directory, entry)
    if ((await stat(full)).isDirectory()) out.push(...(await htmlFiles(full)))
    else if (entry.endsWith('.html')) out.push(full)
  }
  return out
}

// A path exists and is servable as a file — as opposed to merely being a directory, which
// GitHub Pages 404s on unless it holds an index.html of its own (checked separately below).
function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

const files = await htmlFiles(dist)
const failures = []

for (const file of files) {
  const html = await readFile(file, 'utf8')
  for (const match of html.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)) {
    const url = match[1]
    // Protocol-relative URL (`//example.com/...`) — a legitimate external link, not a base-path
    // mistake, even though it starts with a single `/` like every other pattern here does.
    if (url.startsWith('//')) continue
    if (!url.startsWith(`${BASE}/`)) {
      failures.push(
        `${file}: "${url}" does not start with ${BASE}/ — use href() from src/lib/href.ts`,
      )
      continue
    }
    const relative = url.slice(BASE.length + 1)
    const candidates = [
      join(dist, relative, 'index.html'),
      `${join(dist, relative.replace(/\/$/, ''))}.html`,
    ]
    if (!isFile(join(dist, relative)) && !candidates.some((candidate) => existsSync(candidate))) {
      failures.push(`${file}: "${url}" resolves to nothing in dist`)
    }
  }
}

if (failures.length > 0) {
  console.error(`check-links: ${failures.length} broken internal link(s)\n`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
console.log(`check-links: ${files.length} pages, every internal link resolves.`)
