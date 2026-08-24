import { createRequire } from 'node:module'
import { defineConfig } from 'tsup'

const pkg = createRequire(import.meta.url)('./package.json') as { version: string }

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  // Workspace packages are bundled so the tarball does not depend on unpublished packages.
  noExternal: [
    '@mock-knight/server',
    '@mock-knight/core',
    '@mock-knight/adapter-wiremock',
    '@mock-knight/adapter-mockserver',
    '@mock-knight/adapter-mockoon',
    '@mock-knight/adapter-prism',
  ],
  // Left external on purpose:
  //  - better-sqlite3 is a native module; its prebuilt binary must be resolved from disk.
  //  - undici is CJS and uses dynamic require(), which an ESM bundle cannot express. Bundling
  //    it produces a build that succeeds and then dies at startup on `Dynamic require of
  //    "assert" is not supported`.
  //  - yaml, for the same reason and found the same way: bundled, the CLI built cleanly and then
  //    died on `Dynamic require of "process" is not supported` the moment it was run. tsup only
  //    externalises *this* package's dependencies, so a dependency of an adapter is bundled
  //    unless it is named here.
  external: ['better-sqlite3', 'undici', 'yaml'],
  // The version is single-sourced from package.json and inlined at build time. It used to be a
  // literal in index.ts, which meant the published 0.1.0 answered `--version` with 0.0.0 —
  // and the release workflow's tag check compares against package.json, so nothing caught it.
  define: { __MOCK_KNIGHT_VERSION__: JSON.stringify(pkg.version) },
})
