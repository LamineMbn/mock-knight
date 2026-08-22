import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/**
 * Tier 3 — against a real mock server in Docker, never a fake.
 *
 * Separate from `pnpm test` because it needs a running WireMock that this suite is allowed to
 * overwrite. It replaces the target's corpus wholesale, so it must only ever be pointed at a
 * throwaway instance.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@mock-knight/core/types': resolve('./packages/core/src/types.ts'),
      '@mock-knight/core': resolve('./packages/core/src/index.ts'),
      '@mock-knight/adapter-wiremock': resolve('./packages/adapter-wiremock/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
