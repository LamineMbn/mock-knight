import { defineConfig } from '@playwright/test'

/**
 * Tier 4 — the built SPA served by the CLI, against a real WireMock.
 *
 * Deliberately does not start the stack itself: it needs a WireMock this suite is allowed to
 * overwrite, and starting one implicitly makes it too easy to point at a shared server by
 * accident. See CLAUDE.md for the two commands.
 */
export default defineConfig({
  testDir: './packages/web/e2e',
  use: { baseURL: process.env.MOCK_KNIGHT_E2E_URL ?? 'http://127.0.0.1:7777' },
  reporter: [['list']],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
})
