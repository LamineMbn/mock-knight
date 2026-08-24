import { defineConfig } from 'vitest/config'
import { workspaceAliases } from './vitest.aliases.js'

/**
 * Tier 3 — against a real mock server in Docker, never a fake.
 *
 * Separate from `pnpm test` because it needs a running WireMock that this suite is allowed to
 * overwrite. It replaces the target's corpus wholesale, so it must only ever be pointed at a
 * throwaway instance.
 */
export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    include: ['packages/*/src/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
