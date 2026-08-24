import { defineConfig } from 'vitest/config'
import { workspaceAliases } from './vitest.aliases.js'

/**
 * Performance budgets. Separate from `pnpm test` because they build 10,000-stub corpora and
 * write real SQLite files, and because a machine under load should not fail the unit suite.
 * Single-threaded and serial: two suites competing for disk would measure the scheduler.
 */
export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    include: ['packages/*/src/**/*.perf.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
