import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // Test against source, not dist: the inner loop must not depend on a build step.
      '@mock-knight/core/conformance': resolve('./packages/core/src/conformance.ts'),
      '@mock-knight/core/types': resolve('./packages/core/src/types.ts'),
      '@mock-knight/core': resolve('./packages/core/src/index.ts'),
      '@mock-knight/adapter-mockserver': resolve('./packages/adapter-mockserver/src/index.ts'),
      '@mock-knight/adapter-wiremock': resolve('./packages/adapter-wiremock/src/index.ts'),
    },
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
