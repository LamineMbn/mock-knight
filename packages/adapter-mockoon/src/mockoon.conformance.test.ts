import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { afterAll, beforeAll } from 'vitest'
import { runAdapterConformance } from '@mock-knight/core/conformance'
import type { ConformanceOptions } from '@mock-knight/core/conformance'
import type { MockDraft } from '@mock-knight/core'
import { MockoonAdapter } from './adapter.js'
import { draftToRoute } from './mapping.js'

/**
 * Mockoon as a subject of the shared conformance suite.
 *
 * No assertions here, deliberately, exactly as for MockServer: whatever this backend fails is
 * either a bug in this adapter or a place where the canonical model describes WireMock rather
 * than mock servers. Bespoke expectations would hide the evidence this tier exists to produce.
 *
 * The fixture is the interesting part. `reset` cannot go through the adapter — Mockoon's writes
 * are off, and for good reason (§17.31) — so it writes **both** halves:
 *
 *  1. the environment file, which is where the adapter reads the corpus from, and
 *  2. `PUT /mockoon-admin/environment`, which is what the running server actually answers with.
 *
 * Writing only one would make the suite meaningless in opposite directions: only the file and
 * `send` observes a stale server; only the PUT and `listMocks` observes a stale file. That the
 * fixture has to do two unrelated writes to keep one backend self-consistent *is* the finding
 * about Mockoon, and it is why the adapter does not offer writes.
 *
 * Needs a Mockoon this suite may overwrite, pointed at a file it may rewrite:
 *   docker run -d --name mk-mockoon -p 13000:3000 -v <dir>:/data mockoon/cli:latest \
 *     -d /data/env.json -p 3000 --admin-api-token <token> --watch
 *
 * `--admin-api-token` sets the token rather than leaving it auto-generated into the server log,
 * and `--watch` makes the file authoritative — which is why writing it is enough for `listMocks`
 * *and* for what the server serves. The `PUT` below is kept anyway: it applies immediately, so the
 * fixture does not have to wait out a filesystem poll, and it keeps the suite working against a
 * server started without `--watch`.
 */

const BASE_URL = process.env['MOCK_KNIGHT_TEST_MOCKOON_URL'] ?? 'http://localhost:13000'
const TOKEN = process.env['MOCK_KNIGHT_TEST_MOCKOON_TOKEN'] ?? ''
/**
 * The environment file *as the adapter sees it*, which is not always the path the server was
 * started with: in Docker the server reads `/data/env.json` and this process writes the host path
 * bind-mounted there.
 */
const DOCUMENT = process.env['MOCK_KNIGHT_TEST_MOCKOON_FILE'] ?? ''

let adapter: MockoonAdapter
let documentPath: string

const adminHeaders = (): Record<string, string> => ({
  'content-type': 'application/json',
  ...(TOKEN === '' ? {} : { authorization: `Bearer ${TOKEN}` }),
})

function environmentDocument(routes: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    uuid: '00000000-0000-0000-0000-0000000000ff',
    lastMigration: 33,
    name: 'conformance',
    port: 3000,
    hostname: '',
    endpointPrefix: '',
    latency: 0,
    folders: [],
    routes,
    // Load-bearing: a route absent from here is silently not served, whatever else is right.
    rootChildren: routes.map((route) => ({ type: 'route', uuid: route['uuid'] })),
    proxyMode: false,
    proxyHost: '',
    proxyRemovePrefix: false,
    tlsOptions: {
      enabled: false,
      type: 'CERT',
      pfxPath: '',
      certPath: '',
      keyPath: '',
      caPath: '',
      passphrase: '',
    },
    cors: true,
    headers: [],
    proxyReqHeaders: [],
    proxyResHeaders: [],
    data: [],
    callbacks: [],
  }
}

beforeAll(async () => {
  if (DOCUMENT === '') {
    // A path is not optional here: without it there is no corpus at all, so a helpful failure
    // beats every test in the file failing on its own.
    throw new Error(
      'MOCK_KNIGHT_TEST_MOCKOON_FILE must name the environment file the Mockoon under test reads.',
    )
  }
  documentPath = DOCUMENT
  adapter = new MockoonAdapter()
  await adapter.connect({
    baseUrl: BASE_URL,
    documentPath,
    ...(TOKEN === '' ? {} : { auth: { kind: 'bearer' as const, token: TOKEN } }),
  })
})

afterAll(async () => {
  await adapter.close()
})

const reset: ConformanceOptions['reset'] = async (stubs: readonly MockDraft[]) => {
  const routes = stubs.map((draft) => ({
    ...draftToRoute(draft),
    uuid: randomUUID(),
    responses: (draftToRoute(draft)['responses'] as Record<string, unknown>[]).map((response) => ({
      ...response,
      uuid: randomUUID(),
    })),
  }))
  const document = environmentDocument(routes)

  writeFileSync(documentPath, JSON.stringify(document, null, 2))
  const applied = await fetch(`${BASE_URL}/mockoon-admin/environment`, {
    method: 'PUT',
    headers: adminHeaders(),
    body: JSON.stringify({ routes: document['routes'], rootChildren: document['rootChildren'] }),
  })
  if (!applied.ok) {
    throw new Error(
      `Mockoon refused the fixture (${applied.status}). ` +
        `Check MOCK_KNIGHT_TEST_MOCKOON_TOKEN: the admin API is token-protected by default.`,
    )
  }
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
