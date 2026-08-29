#!/usr/bin/env node
/**
 * Copy the two things this package renders from but does not own.
 *
 * `tokens.css` is generated into the *web* package by `pnpm tokens:css`, and `docs/images/`
 * sits at the repository root where the README needs it. Both are copied rather than
 * symlinked: a symlink survives a local build and does not survive `upload-pages-artifact`,
 * which is a failure that only appears in production.
 *
 * Both copies are gitignored. The originals stay the single committed home.
 */
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')

const TOKENS_SOURCE = join(root, 'packages', 'web', 'src', 'styles', 'tokens.css')
const TOKENS_TARGET = join(here, '..', 'src', 'styles', 'tokens.generated.css')
const IMAGES_SOURCE = join(root, 'docs', 'images')
const IMAGES_TARGET = join(here, '..', 'public', 'images')

await mkdir(dirname(TOKENS_TARGET), { recursive: true })
await copyFile(TOKENS_SOURCE, TOKENS_TARGET)

// Removed first, so a screenshot deleted upstream does not linger in the published site.
await rm(IMAGES_TARGET, { recursive: true, force: true })
await mkdir(IMAGES_TARGET, { recursive: true })
const images = (await readdir(IMAGES_SOURCE)).filter((name) => name.endsWith('.png'))
for (const name of images) {
  await copyFile(join(IMAGES_SOURCE, name), join(IMAGES_TARGET, name))
}

console.log(`prepare-assets: tokens.css and ${images.length} screenshots copied in`)
