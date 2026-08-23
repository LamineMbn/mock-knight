import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Copy the built SPA into the CLI's own `dist`, so the published tarball carries it.
 *
 * Without this the CLI only finds the UI through its development fallback — `../../web/dist`,
 * a path that exists in this repo and in no installed copy of the package. `npx mock-knight`
 * would start, print a URL, and serve a 404 at it.
 *
 * Failing loudly is the whole point. A silent skip here produces a tarball that passes every
 * test in the repo (where the fallback still resolves) and is broken for every user, which is
 * the worst shape a packaging bug can take.
 */

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '..', '..', 'web', 'dist')
const target = resolve(here, '..', 'dist', 'web')
const packageRoot = resolve(here, '..')
const repoRoot = resolve(here, '..', '..', '..')

if (!existsSync(join(source, 'index.html'))) {
  console.error(
    `bundle-web: no built SPA at ${source}.\n` +
      `Run \`pnpm --filter @mock-knight/web build\` first, or \`pnpm build\` from the repo root,\n` +
      `which builds the two in the right order.`,
  )
  process.exit(1)
}

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })

// Report what shipped. A tarball missing its JS bundle is not obvious from a green build.
const bytes = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (total, entry) =>
      total +
      (entry.isDirectory() ? bytes(join(dir, entry.name)) : statSync(join(dir, entry.name)).size),
    0,
  )
const files = readdirSync(target, { recursive: true }).length
console.log(`bundle-web: ${files} files, ${(bytes(target) / 1024 / 1024).toFixed(1)}MB → dist/web`)

/**
 * npm only picks up a README and LICENSE sitting in the package directory, and in a monorepo
 * both live at the repo root. Without this the npm page is blank and the tarball carries no
 * licence text — for an Apache-2.0 project the second one is the part that actually matters.
 *
 * Copied rather than symlinked (npm does not follow symlinks into a tarball) and gitignored
 * inside the package, so the root copies stay the only source.
 */
for (const name of ['README.md', 'LICENSE']) {
  const from = join(repoRoot, name)
  if (!existsSync(from)) {
    console.error(`bundle-web: ${name} is missing from the repo root; the tarball needs it.`)
    process.exit(1)
  }
  cpSync(from, join(packageRoot, name))
}
console.log('bundle-web: README.md and LICENSE copied into the package')
