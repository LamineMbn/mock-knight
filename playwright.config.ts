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
  /**
   * One worker, not just serial-within-a-file.
   *
   * `fullyParallel: false` only orders tests inside a file; separate spec files still run in
   * parallel workers by default. Every spec here reseeds the same WireMock and refreshes the
   * same mirror, so two files running at once redefine each other's corpus mid-test. The
   * symptom was a suite that passed file-by-file and failed as a whole, which reads like a
   * product bug and is not one.
   */
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
})
