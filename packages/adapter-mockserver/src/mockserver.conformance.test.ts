import { afterAll, beforeAll, beforeEach } from 'vitest'
import { runAdapterConformance } from '@mock-knight/core/conformance'
import type { ConformanceOptions } from '@mock-knight/core/conformance'
import type { MockDraft } from '@mock-knight/core'
import { MockServerAdapter } from './adapter.js'

/**
 * MockServer as a subject of the shared conformance suite.
 *
 * No assertions here, and that is the whole point: this backend was not in mind when the
 * canonical model was written, so anything it fails is either a bug in this adapter or a place
 * where the model describes WireMock rather than mock servers. Adding bespoke expectations here
 * would hide exactly the evidence the tier exists to produce.
 *
 * Needs a MockServer this suite may overwrite:
 *   docker run -d --name mk-mockserver -p 11080:1080 mockserver/mockserver:5.15.0
 */

const BASE_URL = process.env['MOCK_KNIGHT_TEST_MOCKSERVER_URL'] ?? 'http://localhost:11080'

let adapter: MockServerAdapter

beforeAll(async () => {
  adapter = new MockServerAdapter()
  await adapter.connect({ baseUrl: BASE_URL })
})

afterAll(async () => {
  await adapter.close()
})

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
}

beforeEach(async () => {
  await reset([])
})

const send: ConformanceOptions['send'] = async (
  method: string,
  path: string,
  headers?: Record<string, string>,
) => {
  const response = await fetch(`${BASE_URL}${path}`, { method, ...(headers && { headers }) })
  return response.status
}

runAdapterConformance(() => ({ adapter, reset, send }))
