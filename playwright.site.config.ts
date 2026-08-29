import { defineConfig } from '@playwright/test'

/**
 * The documentation site, served from its own build output.
 *
 * Deliberately not part of `playwright.config.ts`. That tier drives the application: it needs a
 * WireMock container, the CLI, and a built SPA. Making a static-page assertion depend on Docker
 * is how a suite becomes one people skip, so this one starts a preview server and nothing else.
 */
const BASE = 'http://127.0.0.1:4321/mock-knight/'

export default defineConfig({
  testDir: './packages/site/e2e',
  use: { baseURL: BASE },
  webServer: {
    command: 'pnpm --filter @mock-knight/site preview --port 4321 --host 127.0.0.1',
    url: BASE,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
  reporter: [['list']],
  forbidOnly: !!process.env['CI'],
})
