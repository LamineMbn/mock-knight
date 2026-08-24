import { defineConfig } from 'vitest/config'
import { workspaceAliases } from './vitest.aliases.js'

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.conformance.test.ts',
      '**/*.integration.test.ts',
      '**/*.perf.test.ts',
    ],
  },
})
