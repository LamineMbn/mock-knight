import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * The rules that are architecture, not style.
 *
 * Formatting is Prettier's job and nothing here duplicates it. What this file exists for is the
 * handful of invariants in CLAUDE.md that are cheap to break by accident and expensive to
 * notice: the layering rule, the browser-safety of `core`'s public surface, and the ban on a
 * literal colour inside a component. Each of those held by review alone until now, which works
 * right up until the day it doesn't.
 *
 * Deliberately **not** type-aware. The type-checked ruleset needs a program per package and
 * turns a two-second lint into a thirty-second one; every rule below works from syntax, and
 * `pnpm typecheck` already runs the compiler.
 */

/**
 * A layering rule for one package, stated as what it may **not** reach.
 *
 * Written as a denylist rather than "ban the workspace, then allow these back": `group`
 * negations do not lift a ban the way gitignore negations do, so the allowlist form silently
 * banned the very imports it was meant to permit.
 */
function layer({ exact = [], under = [] }, message) {
  return {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        // `paths` matches a specifier exactly; `patterns` uses gitignore semantics, where
        // `@mock-knight/core` also matches `@mock-knight/core/types`. Banning the bare entry
        // needs the former — the latter took the browser-safe subpath down with it.
        paths: exact.map((name) => ({ name, message })),
        patterns: under.length === 0 ? [] : [{ group: under, message }],
      },
    ],
  }
}

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'packages/web/src/styles/tokens.css',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // `unknown` plus a zod parse instead — CLAUDE.md, Conventions.
      '@typescript-eslint/no-explicit-any': 'error',
      // Vitest and Playwright both use bare `expect(...)`; the base rule flags those as unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ── Invariant 1: layering ────────────────────────────────────────────────────────────────
  //
  // core → nothing · adapter-* → core · server → core + adapters · web → core's browser-safe
  // surface only · cli → server + web's build output.
  {
    files: ['packages/core/**/*.ts'],
    rules: layer(
      { exact: ['mock-knight'], under: ['@mock-knight/**'] },
      'core is the bottom of the stack: it imports nothing from the workspace.',
    ),
  },
  {
    files: ['packages/adapter-*/**/*.ts'],
    rules: layer(
      { exact: ['mock-knight'], under: ['@mock-knight/server', '@mock-knight/web'] },
      'An adapter may import core and nothing else in the workspace. It is the subject of the ' +
        'conformance suite, not its author.',
    ),
  },
  {
    files: ['packages/server/**/*.ts'],
    rules: layer(
      { exact: ['mock-knight'], under: ['@mock-knight/web'] },
      'The server may import core and adapters. It must not reach into web.',
    ),
  },
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    rules: {
      ...layer(
        {
          exact: ['@mock-knight/core', 'mock-knight'],
          under: ['@mock-knight/server', '@mock-knight/adapter-*'],
        },
        'The browser gets `@mock-knight/core/types` and nothing else. The bare `@mock-knight/' +
          'core` entry pulls node:crypto into the bundle.',
      ),
      // Belt and braces. Scoped to `src`: vite.config.ts is build tooling and runs in Node.
      'no-restricted-imports': ['error', { patterns: ['node:*'] }],
    },
  },
  {
    files: ['packages/cli/**/*.ts'],
    rules: layer(
      { under: ['@mock-knight/adapter-*'] },
      'The CLI composes the server and the built SPA; adapters reach it through the server.',
    ),
  },

  /**
   * `core`'s browser-safe surface, kept browser-safe.
   *
   * Everything reachable from `types.ts` ends up in the web bundle. One `node:crypto` import
   * added to any of these files breaks the build with a message that points at Vite rather than
   * at the import, so the rule names the actual constraint instead. Files not listed here —
   * `canonical.ts`, `expose.ts` — are reachable only from `index.ts` and may use Node freely.
   */
  {
    files: [
      'packages/core/src/types.ts',
      'packages/core/src/{capabilities,model,query,explain,merge,from-request,scenarios,adapter,overlap}.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message:
                'This file is reachable from @mock-knight/core/types, which the browser imports. ' +
                'Node-only code belongs behind the index.ts entry point.',
            },
          ],
        },
      ],
    },
  },

  // ── Invariant 8: colour comes from tokens ────────────────────────────────────────────────
  //
  // A component that hardcodes a colour can never follow a theme switch, because switching
  // swaps token *values*. This caught four real cases: dialog scrims and shadows pinned to
  // their light-mode values in both themes, and white icon glyphs drawn on dark mode's light
  // danger/success discs.
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/(^|[^\\w-])(#[0-9a-fA-F]{3,8}\\b|(rgb|hsl)a?\\s*\\()/]',
          message:
            'No literal colour in a component (CLAUDE.md invariant 8). Add a --mk-* token in ' +
            'design/design-tokens.py, run `pnpm tokens:css`, and reference it with var().',
        },
      ],
    },
  },

  // ── React ────────────────────────────────────────────────────────────────────────────────
  {
    files: ['packages/web/src/**/*.tsx'],
    ...reactHooks.configs.flat['recommended-latest'],
  },
  {
    /**
     * The virtualised list is the one component the React Compiler cannot optimise:
     * `useVirtualizer` returns functions that cannot be memoized safely, so it reports
     * "Compilation Skipped" every run. That is true and permanent while we use TanStack
     * Virtual, and a warning that can never be actioned teaches people to skim warnings. Off
     * here, with the reason, rather than left to become noise.
     */
    files: ['packages/web/src/components/CorpusList.tsx'],
    rules: { 'react-hooks/incompatible-library': 'off' },
  },

  /**
   * Tests get three exemptions, each for a reason.
   *
   * Layering: a conformance test's whole job is to import the thing it checks.
   * Literal colour: an assertion about a rendered colour has to name one.
   * `any`: black-box tests walk into payloads from a dozen routes by path, and a union of route
   * shapes would need editing every time a route gains a field. Production code carries no
   * `any` at all — that is the half of the convention that matters.
   */
  {
    files: [
      '**/*.test.ts',
      '**/*.perf.test.ts',
      'packages/server/src/test-support.ts',
      'packages/web/e2e/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
