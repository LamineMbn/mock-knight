import { fileURLToPath } from 'node:url'

const resolve = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

/**
 * Workspace packages aliased to their **source**, so no build step stands between an edit and a
 * test run.
 *
 * One list, shared by all four vitest configs. Each used to keep its own, which meant adding a
 * package needed four edits and failed loudly in whichever was forgotten — adding the Mockoon
 * adapter broke the integration tier on CI while every other tier passed, because a package whose
 * `exports` point at `dist` cannot resolve until something builds it.
 *
 * More specific keys first: `@mock-knight/core/types` must not be swallowed by `@mock-knight/core`.
 */
export const workspaceAliases: Record<string, string> = {
  '@mock-knight/core/conformance': resolve('./packages/core/src/conformance.ts'),
  '@mock-knight/core/types': resolve('./packages/core/src/types.ts'),
  '@mock-knight/core': resolve('./packages/core/src/index.ts'),
  '@mock-knight/adapter-wiremock': resolve('./packages/adapter-wiremock/src/index.ts'),
  '@mock-knight/adapter-mockserver': resolve('./packages/adapter-mockserver/src/index.ts'),
  '@mock-knight/adapter-mockoon': resolve('./packages/adapter-mockoon/src/index.ts'),
  '@mock-knight/adapter-prism': resolve('./packages/adapter-prism/src/index.ts'),
}
