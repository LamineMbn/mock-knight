import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  // Workspace packages are bundled so the tarball does not depend on unpublished packages.
  noExternal: ['@mock-knight/server', '@mock-knight/core', '@mock-knight/adapter-wiremock'],
  // Left external on purpose:
  //  - better-sqlite3 is a native module; its prebuilt binary must be resolved from disk.
  //  - undici is CJS and uses dynamic require(), which an ESM bundle cannot express. Bundling
  //    it produces a build that succeeds and then dies at startup on `Dynamic require of
  //    "assert" is not supported`.
  external: ['better-sqlite3', 'undici'],
})
