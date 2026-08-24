import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url))

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
    alias: {
      '@mock-knight/core/conformance': resolve('./packages/core/src/conformance.ts'),
      '@mock-knight/core/types': resolve('./packages/core/src/types.ts'),
      '@mock-knight/core': resolve('./packages/core/src/index.ts'),
      '@mock-knight/adapter-mockserver': resolve('./packages/adapter-mockserver/src/index.ts'),
      '@mock-knight/adapter-mockoon': resolve('./packages/adapter-mockoon/src/index.ts'),
      '@mock-knight/adapter-wiremock': resolve('./packages/adapter-wiremock/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.conformance.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // One backend at a time: each file owns the server it points at for the duration.
    fileParallelism: false,
  },
})
