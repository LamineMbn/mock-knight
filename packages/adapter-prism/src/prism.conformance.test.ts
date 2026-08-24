import { writeFileSync } from 'node:fs'
import { afterAll, beforeAll } from 'vitest'
import { runAdapterConformance } from '@mock-knight/core/conformance'
import type { ConformanceOptions } from '@mock-knight/core/conformance'
import type { MockDraft } from '@mock-knight/core'
import { PrismAdapter } from './adapter.js'

/**
 * Prism as a subject of the shared conformance suite.
 *
 * No assertions here, as for the other two: whatever this backend fails is either a bug in this
 * adapter or a place where the canonical model describes stub stores rather than mock servers.
 * Prism is the strongest version of that question, because nothing in its corpus was written as a
 * mock — an OpenAPI document describes an API and Prism derives mocking from it.
 *
 * The fixture writes the OpenAPI document and waits for Prism to pick it up, which is the only
 * channel there is: Prism has no control API to push a corpus through (§17.32). It **always**
 * watches the document — there is no `--watch` flag because there is nothing to switch on — and
 * the reload lands about a second later. `reset` therefore waits for the server to actually serve
 * the new document before returning; without that, `send` raced the reload and a test failed on
 * timing while looking like a contract failure.
 *
 * Needs a Prism this suite may overwrite, started on a document it may rewrite:
 *   npx @stoplight/prism-cli mock -p 13002 -d <file>
 */

const BASE_URL = process.env['MOCK_KNIGHT_TEST_PRISM_URL'] ?? 'http://127.0.0.1:13002'
const DOCUMENT = process.env['MOCK_KNIGHT_TEST_PRISM_FILE'] ?? ''

let adapter: PrismAdapter

/**
 * Kept in every fixture so Prism always has something to serve.
 *
 * Prism refuses to start, and refuses a reload, with **"No operations found in the current
 * file"** — so a document expressing zero stubs kills the server the suite is testing against.
 * An operation with no responses satisfies it, and the adapter skips exactly that shape, so the
 * placeholder never reaches `listMocks` and cannot distort a count.
 */
const PLACEHOLDER = {
  '/__mock-knight-conformance': { get: { operationId: 'mkConformance', responses: {} } },
}

/** An OpenAPI document expressing exactly these stubs. */
function specFor(stubs: readonly MockDraft[]): string {
  const paths: Record<string, Record<string, unknown>> = { ...PLACEHOLDER }
  stubs.forEach((draft, index) => {
    const path = draft.request.url?.value ?? `/stub-${index}`
    const method = (draft.request.method ?? 'GET').toLowerCase()
    const status = String(draft.response.status ?? 200)
    const body = draft.response.body
    const example = body.kind === 'json' || body.kind === 'text' ? body.value : undefined

    paths[path] ??= {}
    paths[path]![method] = {
      operationId: `${method}${path.replace(/[^a-zA-Z0-9]/g, '')}${status}`,
      ...(draft.name === null ? {} : { summary: draft.name }),
      responses: {
        [status]: {
          description: draft.response.statusMessage ?? 'conformance',
          ...(example === undefined ? {} : { content: { 'application/json': { example } } }),
        },
      },
    }
  })

  return JSON.stringify({ openapi: '3.0.0', info: { title: 'conformance', version: '1.0' }, paths })
}

beforeAll(async () => {
  if (DOCUMENT === '') {
    throw new Error(
      'MOCK_KNIGHT_TEST_PRISM_FILE must name the OpenAPI document the Prism under test reads.',
    )
  }
  adapter = new PrismAdapter()
  await adapter.connect({ baseUrl: BASE_URL, documentPath: DOCUMENT })
})

afterAll(() => {
  // Nothing to close: there is no connection, only a file that was read.
})

const reset: ConformanceOptions['reset'] = async (stubs: readonly MockDraft[]) => {
  writeFileSync(DOCUMENT, specFor(stubs))

  /*
   * Wait for the reload rather than assuming it.
   *
   * `--watch` is a filesystem poll, so the server answers the *previous* document for a moment
   * after the write. Returning immediately made `send` race it, and a traffic test would fail on
   * timing while looking like a contract failure.
   */
  const expected = stubs[0]?.request.url?.value ?? null
  if (expected === null) return
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${BASE_URL}${expected}`, {
      method: stubs[0]?.request.method ?? 'GET',
    })
    // Any answer other than "no such path" means this document is the one being served.
    if (response.status !== 404) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Prism never picked up the fixture. Is it running on ${DOCUMENT}?`)
}

const send: ConformanceOptions['send'] = async (
  method: string,
  path: string,
  headers?: Record<string, string>,
) => {
  const response = await fetch(`${BASE_URL}${path}`, { method, ...(headers && { headers }) })
  return response.status
}

runAdapterConformance(() => ({ adapter, reset, send }))
