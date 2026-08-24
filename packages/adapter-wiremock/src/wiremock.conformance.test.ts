import { afterAll, beforeAll, beforeEach } from 'vitest'
import { runAdapterConformance } from '@mock-knight/core/conformance'
import type { ConformanceOptions } from '@mock-knight/core/conformance'
import type { MockDraft } from '@mock-knight/core'
import { WireMockAdapter } from './adapter.js'

/**
 * WireMock as a subject of the shared conformance suite.
 *
 * There are no assertions in this file on purpose. Everything asserted lives in
 * `@mock-knight/core/conformance` and is identical for every backend — an adapter that needed
 * its own bespoke expectations would be evidence that the canonical model had bent around it,
 * which is the risk this tier exists to catch (TECH-DESIGN §18).
 *
 * Needs a WireMock this suite may overwrite. Every test replaces the corpus.
 */

const BASE_URL = process.env['MOCK_KNIGHT_TEST_WIREMOCK_URL'] ?? 'http://localhost:18099'

let adapter: WireMockAdapter

beforeAll(async () => {
  adapter = new WireMockAdapter()
  await adapter.connect({ baseUrl: BASE_URL })
})

afterAll(async () => {
  await adapter.close?.()
})

/** Exactly these stubs and nothing else, expressed through the adapter under test. */
const reset = async (stubs: readonly MockDraft[]): Promise<void> => {
  await adapter.replaceAll(
    stubs.map((draft) => ({
      ...adapter.interpret(adapter.render(draft)),
      id: null,
      clientKey: '',
      contentHash: '',
      folderSource: 'none' as const,
    })),
  )
  await adapter.resetAllScenarios?.()
}

beforeEach(async () => {
  await reset([])
})

/** Through the mock server's own port, so traffic assertions see what it actually served. */
const send: ConformanceOptions['send'] = async (
  method: string,
  path: string,
  headers?: Record<string, string>,
) => {
  const response = await fetch(`${BASE_URL}${path}`, { method, ...(headers && { headers }) })
  return response.status
}

runAdapterConformance(() => ({ adapter, reset, send }))
