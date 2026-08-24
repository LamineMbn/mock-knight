import { defineConfig } from 'vitest/config'
import { workspaceAliases } from './vitest.aliases.js'

/**
 * The adapter conformance tier — TECH-DESIGN §15, PRD §8.
 *
 * The suite itself lives in `core` and is the same for every backend: an adapter is its subject,
 * not its author. This config only supplies the wiring, so adding a backend means adding one
 * `*.conformance.test.ts` that hands over a connected adapter — never editing the assertions.
 *
 * Separate from `pnpm test` because it needs a live server it is allowed to overwrite: every
 * test replaces the corpus.
 */
export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    include: ['packages/*/src/**/*.conformance.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // One backend at a time: each file owns the server it points at for the duration.
    fileParallelism: false,
  },
})
