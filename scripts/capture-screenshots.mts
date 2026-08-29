/**
 * Regenerate the README and site screenshots.
 *
 * A UI tool whose docs show no UI asks the reader to take its word for everything, so these
 * images are part of the documentation rather than decoration — and being generated rather than
 * hand-cropped, they can be redone after a redesign instead of quietly going stale.
 *
 * It needs the full stack, because a screenshot of a mocked screen would be exactly the lie
 * this project refuses to tell elsewhere:
 *
 *   docker run -d --name mk-dev-wiremock -p 18099:8080 wiremock/wiremock:3.13.1 --verbose
 *   docker run -d --name mk-dev-mockserver -p 11080:1080 mockserver/mockserver:5.15.0
 *   mkdir -p .mockoon && cat > .mockoon/env.json <<'JSON'
 *   {"uuid":"00000000-0000-0000-0000-0000000000ff","lastMigration":33,"name":"mock-knight",
 *    "port":3000,"hostname":"","endpointPrefix":"","latency":0,"folders":[],"routes":[],
 *    "rootChildren":[],"proxyMode":false,"proxyHost":"","proxyRemovePrefix":false,
 *    "tlsOptions":{"enabled":false,"type":"CERT","pfxPath":"","certPath":"","keyPath":"",
 *    "caPath":"","passphrase":""},"cors":true,"headers":[],"proxyReqHeaders":[],
 *    "proxyResHeaders":[],"data":[],"callbacks":[]}
 *   JSON
 *   docker run -d --name mk-dev-mockoon -p 13000:3000 -v "$(pwd)/.mockoon":/data \
 *     mockoon/cli:latest -d /data/env.json -p 3000 --admin-api-token mk-shots-token --watch
 *   pnpm build && pnpm dev:server --url http://localhost:18099
 *   pnpm tsx scripts/capture-screenshots.mts
 *
 * Prism needs no precondition: it has no persistent corpus of its own to preserve between runs
 * (its "corpus" is a document this script writes), so the script starts and stops its own
 * `prism-cli` rather than asking for one already running, the way it does not for the other
 * three.
 *
 * It REPLACES the target WireMock's corpus wholesale and clears its journal, and likewise
 * overwrites whatever MockServer and Mockoon are holding. Point all three at throwaway instances
 * only. It also creates one BFF profile per non-WireMock backend for the run and deletes them
 * again once their screenshot is captured — see `captureBackendScreenshots`.
 */
import { chromium, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const WIREMOCK = process.env['MOCK_KNIGHT_SHOTS_WIREMOCK'] ?? 'http://localhost:18099'
const APP = process.env['MOCK_KNIGHT_SHOTS_URL'] ?? 'http://127.0.0.1:7777'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'images')
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const MOCKSERVER = process.env['MOCK_KNIGHT_SHOTS_MOCKSERVER'] ?? 'http://localhost:11080'
const MOCKOON = process.env['MOCK_KNIGHT_SHOTS_MOCKOON'] ?? 'http://localhost:13000'
const MOCKOON_TOKEN = process.env['MOCK_KNIGHT_SHOTS_MOCKOON_TOKEN'] ?? 'mk-shots-token'
const MOCKOON_FILE =
  process.env['MOCK_KNIGHT_SHOTS_MOCKOON_FILE'] ?? join(REPO_ROOT, '.mockoon', 'env.json')
/** 4010/4011 are taken elsewhere on a developer machine; 4321/4322 by this site's own test tiers. */
const PRISM_PORT = Number(process.env['MOCK_KNIGHT_SHOTS_PRISM_PORT'] ?? 4013)
const PRISM = `http://127.0.0.1:${PRISM_PORT}`
const PRISM_DOC = join(tmpdir(), 'mock-knight-shots-prism.json')

/**
 * Where the profile ids this run creates are recorded as they are created, not just at the end.
 *
 * The three per-backend profiles are named by host:port — `localhost:11080`, the same
 * convention the CLI itself uses (`--name` defaults to "the URL's host") — precisely so the
 * screenshot they end up in looks like an ordinary profile a developer added, not a script
 * artifact leaking into shipped documentation. That rules out finding-by-name-prefix as the
 * safety net for a crashed run, so this file is the alternative: written to on every create,
 * read back and cleared at the start of the next run, so an interrupted run's profiles get
 * removed even though nothing about their name marks them as this script's.
 */
const CAPTURE_STATE_FILE = join(tmpdir(), 'mock-knight-shots-profiles.json')

/** mulberry32 — the corpus must be byte-identical run to run, or every capture is a diff. */
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Json = Record<string, unknown>

/**
 * A corpus shaped like one a team actually shares: a handful of services, a long tail of
 * folders, most stubs selected by a header whose value is their real identity, a skew toward
 * GET and POST, and a few deliberate overlaps. Deliberately generic — the point of the shot is
 * the tool, not the API.
 */
const SERVICES = [
  'checkout-api',
  'catalog-api',
  'payments-api',
  'identity-api',
  'shipping-api',
  'notifications-api',
]
const RESOURCES: Record<string, string[]> = {
  'checkout-api': ['carts', 'orders', 'promotions'],
  'catalog-api': ['products', 'inventory', 'categories'],
  'payments-api': ['charges', 'refunds', 'methods'],
  'identity-api': ['sessions', 'tokens', 'accounts'],
  'shipping-api': ['shipments', 'rates', 'addresses'],
  'notifications-api': ['emails', 'webhooks'],
}
const OUTCOMES = [
  'nominal',
  'not-found',
  'validation-error',
  'rate-limited',
  'upstream-timeout',
  'expired-token',
  'partial',
  'conflict',
]
const METHODS = ['GET', 'GET', 'GET', 'GET', 'POST', 'POST', 'POST', 'PUT', 'PATCH', 'DELETE']
const STATUSES = [200, 200, 200, 200, 201, 204, 400, 401, 404, 409, 422, 429, 500, 503]

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!
}

function id(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function generated(count: number): Json[] {
  const random = prng(0x5107)
  const out: Json[] = []

  for (let index = 0; index < count; index++) {
    const service = pick(random, SERVICES)
    const resource = pick(random, RESOURCES[service]!)
    const version = `v${1 + Math.floor(random() * 2)}`
    const outcome = pick(random, OUTCOMES)
    const method = pick(random, METHODS)
    const status = pick(random, STATUSES)

    const stub: Json = {
      id: id(index),
      name: `${service} ${method.toLowerCase()} ${resource} ${outcome}`,
      request: {
        method,
        urlPath: `/${service}/${version}/${resource}/${index % 43}`,
      },
      response: {
        status,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: {
          id: `${resource}-${index}`,
          outcome,
          updatedAt: '2026-03-11T09:24:00Z',
          items: Array.from({ length: (index % 4) + 1 }, (_, row) => ({
            sku: `SKU-${index}-${row}`,
            label: `${resource} line ${row}`,
            qty: (row % 5) + 1,
            price: Number(((row * 13.7) % 400).toFixed(2)),
          })),
        },
      },
      metadata: {
        'mock-knight': {
          folder: [service, `${resource}-${version}`],
          tags: random() > 0.82 ? ['legacy'] : [],
        },
      },
    }

    // Most stubs in a real corpus are selected by a header, not by their path.
    if (random() < 0.72) {
      ;(stub['request'] as Json)['headers'] = {
        'X-Mock': { equalTo: `${service}-${resource}-${outcome}-${index}` },
      }
    }
    if (random() > 0.94) (stub['response'] as Json)['fixedDelayMilliseconds'] = 250
    if (random() > 0.93) stub['priority'] = 1 + Math.floor(random() * 8)

    out.push(stub)
  }
  return out
}

/**
 * Four stubs on one path differing only by a header, one of them shadowed by a better-priority
 * twin. This is the case the corpus screen's priority column exists for, and it is invisible in
 * a flat list — so it has to be in the shot.
 */
function overlapping(): Json[] {
  const base = (index: number, tenant: string, priority: number, status: number): Json => ({
    id: id(900 + index),
    name: `payments-api authorise charge — ${tenant}`,
    priority,
    request: {
      method: 'POST',
      urlPath: '/payments-api/v2/charges',
      headers: { 'X-Tenant': { equalTo: tenant } },
    },
    response: {
      status,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: {
        chargeId: `ch_${tenant}_0${index}`,
        tenant,
        status: status === 201 ? 'authorised' : 'declined',
      },
    },
    metadata: { 'mock-knight': { folder: ['payments-api', 'charges-v2'], tags: ['overlap'] } },
  })
  return [
    base(1, 'acme', 1, 201),
    base(2, 'globex', 1, 201),
    base(3, 'umbrella', 5, 402),
    // Same matcher as acme, worse priority: it can never win.
    { ...base(4, 'acme', 10, 500), name: 'payments-api authorise charge — acme (legacy)' },
  ]
}

/**
 * A stateful checkout, with both faults the scenario screen is meant to surface: a state
 * nothing ever transitions into, and a terminal state nothing leaves.
 */
function scenario(): Json[] {
  const step = (
    index: number,
    name: string,
    method: string,
    path: string,
    from: string,
    to: string | null,
    status: number,
  ): Json => ({
    id: id(950 + index),
    name,
    scenarioName: 'checkout',
    requiredScenarioState: from,
    ...(to === null ? {} : { newScenarioState: to }),
    request: { method, urlPath: path },
    response: {
      status,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: { state: to ?? from },
    },
    metadata: { 'mock-knight': { folder: ['checkout-api', 'checkout-flow'], tags: ['scenario'] } },
  })
  return [
    step(1, 'create cart', 'POST', '/checkout-api/v1/carts', 'Started', 'cart-created', 201),
    step(2, 'add item', 'POST', '/checkout-api/v1/carts/items', 'cart-created', 'items-added', 200),
    step(3, 'authorise payment', 'POST', '/payments-api/v1/charges', 'items-added', 'paid', 201),
    step(4, 'confirm order', 'POST', '/checkout-api/v1/orders/confirm', 'paid', 'confirmed', 201),
    // Terminal: nothing advances out of `confirmed`.
    step(
      5,
      'read confirmed order',
      'GET',
      '/checkout-api/v1/orders/latest',
      'confirmed',
      null,
      200,
    ),
    // Unreachable: no stub ever sets `payment-declined`.
    step(
      6,
      'declined retry',
      'POST',
      '/payments-api/v1/charges/retry',
      'payment-declined',
      'items-added',
      402,
    ),
  ]
}

async function seed(): Promise<void> {
  const mappings = [...generated(148), ...overlapping(), ...scenario()]
  const response = await fetch(`${WIREMOCK}/__admin/mappings/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Without `deleteAllNotInImport` this endpoint MERGES, and the shot picks up whatever was
    // already there.
    body: JSON.stringify({
      mappings,
      importOptions: { duplicatePolicy: 'OVERWRITE', deleteAllNotInImport: true },
    }),
  })
  if (!response.ok) throw new Error(`seeding ${WIREMOCK} failed: ${response.status}`)
  await fetch(`${WIREMOCK}/__admin/scenarios/reset`, { method: 'POST' })
  await fetch(`${WIREMOCK}/__admin/requests`, { method: 'DELETE' })
  console.log(`seeded ${mappings.length} stubs into ${WIREMOCK}`)
}

/**
 * Traffic with a deliberate mix. The unmatched requests are *near* misses — right path, wrong
 * header — because a miss that is nowhere near anything makes for a boring explainer.
 */
async function traffic(): Promise<void> {
  const hit = async (method: string, path: string, headers: Record<string, string> = {}) => {
    await fetch(`${WIREMOCK}${path}`, { method, headers }).catch(() => undefined)
  }

  await hit('POST', '/checkout-api/v1/carts')
  await hit('POST', '/checkout-api/v1/carts/items')
  await hit('POST', '/payments-api/v2/charges', { 'X-Tenant': 'acme' })
  await hit('POST', '/payments-api/v2/charges', { 'X-Tenant': 'globex' })
  await hit('GET', '/catalog-api/v1/products/12')
  await hit('GET', '/identity-api/v1/sessions/7')
  await hit('GET', '/shipping-api/v1/rates/19')
  await hit('DELETE', '/checkout-api/v1/carts/3')
  await hit('GET', '/catalog-api/v2/inventory/31')
  await hit('PUT', '/notifications-api/v1/webhooks/8')

  // The one the explainer gets pointed at: a tenant no stub declares.
  await hit('POST', '/payments-api/v2/charges', {
    'X-Tenant': 'initech',
    'X-Request-Id': 'req-8f21c4',
  })
  await hit('GET', '/catalog-api/v1/products/12', { 'X-Mock': 'catalog-api-products-nominal-999' })
  await hit('GET', '/shipping-api/v3/rates/4')
  console.log('journal populated')
}

/**
 * A MockServer corpus in the same generic shape as `generated()`, so the two look like the same
 * team's stubs rather than a smaller demo bolted on. Reused rather than re-imagined: same
 * services, resources, methods and statuses, reshaped into `httpRequest`/`httpResponse` because
 * that is the one thing that actually differs (TECH-DESIGN's mapping notes on this adapter).
 */
function mockServerExpectations(count: number): Json[] {
  const random = prng(0x5f19)
  const out: Json[] = []

  for (let index = 0; index < count; index++) {
    const service = pick(random, SERVICES)
    const resource = pick(random, RESOURCES[service]!)
    const version = `v${1 + Math.floor(random() * 2)}`
    const method = pick(random, METHODS)
    const status = pick(random, STATUSES)

    const httpRequest: Json = {
      method,
      path: `/${service}/${version}/${resource}/${index % 43}`,
    }
    // MockServer holds header values as arrays even for a single value (mapping.ts's note 1).
    if (random() < 0.6) {
      httpRequest['headers'] = { 'X-Mock': [`${service}-${resource}-${index}`] }
    }

    out.push({
      id: `mockserver-${id(index)}`,
      priority: random() > 0.9 ? 1 + Math.floor(random() * 5) : 0,
      httpRequest,
      httpResponse: {
        statusCode: status,
        headers: { 'content-type': ['application/json'] },
        body: {
          type: 'JSON',
          json: {
            id: `${resource}-${index}`,
            service,
            resource,
            updatedAt: '2026-03-11T09:24:00Z',
          },
        },
      },
    })
  }
  return out
}

/** MockServer's own corpus, replaced wholesale — same reasoning as `seed()` for WireMock. */
async function seedMockServer(): Promise<void> {
  await fetch(`${MOCKSERVER}/mockserver/reset`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  const expectations = mockServerExpectations(70)
  const response = await fetch(`${MOCKSERVER}/mockserver/expectation`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(expectations),
  })
  if (!response.ok) throw new Error(`seeding ${MOCKSERVER} failed: ${response.status}`)
  console.log(`seeded ${expectations.length} expectations into ${MOCKSERVER}`)
}

/** A deterministic uuid-shaped string, distinguishable per kind so a Mockoon document's route,
 * response and folder ids never collide with each other. */
function shotUuid(kind: string, index: number): string {
  return `00000000-0000-4000-a000-${kind.padEnd(6, '0').slice(0, 6)}${String(index).padStart(6, '0')}`
}

/**
 * A Mockoon environment document in the same generic shape as the WireMock corpus: one folder
 * per service, a handful of routes each. Mockoon's admin API cannot read routes at all (§17.31),
 * so this is written straight to the file the running `mockoon-cli --watch` is watching rather
 * than reaching it over HTTP.
 */
function mockoonEnvironment(): Json {
  const random = prng(0x6d02)
  const folders: Json[] = []
  const routes: Json[] = []
  const rootChildren: Json[] = []

  SERVICES.forEach((service, serviceIndex) => {
    const resources = RESOURCES[service]!
    const children: Json[] = []

    for (let routeIndex = 0; routeIndex < 4; routeIndex++) {
      const resource = pick(random, resources)
      const method = pick(random, METHODS).toLowerCase()
      const status = pick(random, STATUSES)
      const routeUuid = shotUuid(`rt${serviceIndex}`, routeIndex)
      const responseUuid = shotUuid(`rs${serviceIndex}`, routeIndex)

      routes.push({
        type: 'http',
        documentation: `${service} ${method} ${resource}`,
        method,
        // No leading slash: Mockoon's `endpoint` is Express-route-shaped, not a canonical path.
        endpoint: `${service}/v1/${resource}/:id`,
        responses: [
          {
            body: JSON.stringify(
              { id: `${resource}-${routeIndex}`, service, resource, status },
              null,
              2,
            ),
            latency: 0,
            statusCode: status,
            label: `${resource} ${status}`,
            headers: [{ key: 'Content-Type', value: 'application/json' }],
            bodyType: 'INLINE',
            filePath: '',
            databucketID: '',
            sendFileAsBody: false,
            rules: [],
            rulesOperator: 'AND',
            disableTemplating: true,
            fallbackTo404: false,
            default: true,
            crudKey: 'id',
            callbacks: [],
            uuid: responseUuid,
          },
        ],
        responseMode: null,
        uuid: routeUuid,
      })
      children.push({ type: 'route', uuid: routeUuid })
    }

    const folderUuid = shotUuid(`fd${serviceIndex}`, 0)
    folders.push({ uuid: folderUuid, name: service, children, collapsed: false })
    rootChildren.push({ type: 'folder', uuid: folderUuid })
  })

  return {
    uuid: '00000000-0000-4000-a000-env000000001',
    lastMigration: 33,
    name: 'mock-knight screenshots',
    port: 3000,
    hostname: '',
    endpointPrefix: '',
    latency: 0,
    folders,
    routes,
    rootChildren,
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

/**
 * Overwrites the document `mk-mockoon --watch` is holding open. That flag is what makes this
 * take effect without restarting the container — the same mechanism the adapter's own
 * `updateMock` relies on.
 */
async function seedMockoon(): Promise<void> {
  await mkdir(dirname(MOCKOON_FILE), { recursive: true })
  await writeFile(MOCKOON_FILE, JSON.stringify(mockoonEnvironment(), null, 2))
  console.log(`seeded Mockoon environment at ${MOCKOON_FILE}`)
  // --watch debounces before it notices the write; connecting immediately can race it.
  await new Promise((resolve) => setTimeout(resolve, 800))
}

/**
 * An OpenAPI document sized like a real corpus — a dozen-plus operations across a few tags —
 * because Prism's corpus *is* the document: there is no admin API to seed through, so the
 * document has to already look like something a team would actually serve.
 */
function prismDocument(): Json {
  const tags = ['checkout', 'catalog', 'payments', 'identity'] as const
  const resourcesByTag: Record<(typeof tags)[number], readonly string[]> = {
    checkout: ['carts', 'orders', 'promotions'],
    catalog: ['products', 'inventory'],
    payments: ['charges', 'refunds'],
    identity: ['sessions', 'accounts'],
  }
  const paths: Json = {}

  for (const tag of tags) {
    for (const resource of resourcesByTag[tag]) {
      paths[`/${tag}-api/v1/${resource}`] = {
        get: {
          operationId: `${tag}_${resource}_list`,
          tags: [tag],
          responses: {
            '200': {
              description: `${resource} for ${tag}`,
              content: {
                'application/json': {
                  schema: { type: 'array', items: { type: 'object' } },
                  example: [{ id: `${resource}-1` }, { id: `${resource}-2` }],
                },
              },
            },
            '404': { description: 'not found' },
          },
        },
        post: {
          operationId: `${tag}_${resource}_create`,
          tags: [tag],
          responses: {
            '201': {
              description: 'created',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                  example: { id: `${resource}-new` },
                },
              },
            },
            '422': { description: 'validation failed' },
          },
        },
      }
    }
  }

  return {
    openapi: '3.0.0',
    info: { title: 'mock-knight-screenshots', version: '1.4.0' },
    paths,
  }
}

let prismProcess: ChildProcess | null = null

/** Prism has no persistent server to seed — it serves whatever document it was started with, so
 * "seeding" it means writing that document and launching the CLI against it. */
async function startPrism(): Promise<void> {
  await writeFile(PRISM_DOC, JSON.stringify(prismDocument(), null, 2))
  // Pinned for the same reason as CI's Prism step: 5.16 requires Node >= 24.18, and this repo's
  // floor is 22.
  //
  // `detached: true` puts the child in its own process group — `npx` itself forks a child
  // process for the CLI it fetches rather than exec-ing into it, so killing only `npx`'s own pid
  // at teardown would leave the actual `prism-cli` process (and the port) behind.
  prismProcess = spawn(
    'npx',
    ['-y', '@stoplight/prism-cli@5.14.2', 'mock', '-p', String(PRISM_PORT), '-d', PRISM_DOC],
    { stdio: 'ignore', detached: true },
  )
  // As generous as CI's own wait: a cold `npx` fetch of the pinned version can take a while.
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      // Any response at all means Prism is listening; a 4xx still counts, same as CI's check.
      await fetch(`${PRISM}/checkout-api/v1/carts`)
      console.log(`Prism serving ${PRISM_DOC} on ${PRISM}`)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }
  throw new Error(`Prism never became healthy on ${PRISM}`)
}

function stopPrism(): void {
  // Negative pid: kill the whole process group `detached: true` created, not just `npx`'s own.
  if (prismProcess?.pid !== undefined) {
    try {
      process.kill(-prismProcess.pid)
    } catch {
      // Already gone.
    }
  }
  prismProcess = null
}

interface ApiProfile {
  id: string
  name: string
  adapter: string
  baseUrl: string
}

async function apiProfiles(): Promise<ApiProfile[]> {
  const body = (await (await fetch(`${APP}/api/profiles`)).json()) as { profiles: ApiProfile[] }
  return body.profiles
}

async function deleteApiProfile(id: string): Promise<void> {
  await fetch(`${APP}/api/profiles/${id}`, { method: 'DELETE' })
}

async function readCaptureState(): Promise<string[]> {
  try {
    return JSON.parse(await readFile(CAPTURE_STATE_FILE, 'utf8')) as string[]
  } catch {
    return []
  }
}

async function writeCaptureState(ids: readonly string[]): Promise<void> {
  await writeFile(CAPTURE_STATE_FILE, JSON.stringify(ids))
}

/** Removes any profile a previous, interrupted run of this script left behind, so a crash never
 * turns into a "duplicate_server" 409 on the next run. */
async function forgetCaptureProfiles(): Promise<void> {
  for (const profileId of await readCaptureState()) await deleteApiProfile(profileId)
  await writeCaptureState([])
}

/**
 * Creates the profile this run needs, or reuses one that already points at the same server —
 * which only happens if something *other* than this script already has a profile there. Only a
 * profile this call actually created gets torn down afterwards; one that already existed for
 * some other reason is left alone.
 */
async function ensureProfile(input: Json): Promise<{ profile: ApiProfile; created: boolean }> {
  const response = await fetch(`${APP}/api/profiles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (response.status === 409) {
    const body = (await response.json()) as { existingProfileId: string }
    const existing = (await apiProfiles()).find((p) => p.id === body.existingProfileId)
    if (existing === undefined) {
      throw new Error(`profile clash reported for ${String(input['name'])} but not found by id`)
    }
    console.log(`  reusing existing profile "${existing.name}" (not created by this run)`)
    return { profile: existing, created: false }
  }
  if (!response.ok) {
    throw new Error(`creating profile ${String(input['name'])} failed: ${response.status}`)
  }
  return { profile: ((await response.json()) as { profile: ApiProfile }).profile, created: true }
}

/**
 * The three backend screenshots WireMock's own capture cannot produce: MockServer, Mockoon and
 * Prism, each seeded with its own corpus, connected through a BFF profile created for this run,
 * and cleaned up again once its screenshot is captured — leaving no trace in the maintainer's
 * dev BFF beyond the screenshot itself.
 */
async function captureBackendScreenshots(
  page: Page,
  shot: (name: string, height?: number) => Promise<void>,
): Promise<void> {
  await forgetCaptureProfiles()
  const created: string[] = []
  const remember = async (profileId: string) => {
    created.push(profileId)
    // Written immediately, not just at the end — so a crash midway through this function still
    // leaves an accurate list for the next run's `forgetCaptureProfiles` to clean up.
    await writeCaptureState(created)
  }

  try {
    await seedMockServer()
    const mockserver = await ensureProfile({
      // Named by host:port, the CLI's own default naming — so the badge this ends up in reads
      // like an ordinary profile, not a script artifact baked into shipped documentation.
      name: new URL(MOCKSERVER).host,
      adapter: 'mockserver',
      baseUrl: MOCKSERVER,
      colour: 'cyan',
    })
    if (mockserver.created) await remember(mockserver.profile.id)
    await fetch(`${APP}/api/${mockserver.profile.id}/refresh`, { method: 'POST' })
    await page.goto(`${APP}/?profile=${mockserver.profile.id}`)
    await page.locator(GRID_ROW).first().waitFor()
    await settle(page)
    await page.locator(GRID_ROW).first().click()
    await settle(page)
    await shot('corpus-mockserver')

    await seedMockoon()
    const mockoon = await ensureProfile({
      name: new URL(MOCKOON).host,
      adapter: 'mockoon',
      baseUrl: MOCKOON,
      mappingsDir: MOCKOON_FILE,
      // The traffic-log probe the adapter makes on connect needs this to succeed — see
      // MockoonAdapter.connect(). Set the way the adapter expects: authKind + authSecret, not a
      // bespoke field.
      authKind: 'bearer',
      authSecret: MOCKOON_TOKEN,
      colour: 'violet',
    })
    if (mockoon.created) await remember(mockoon.profile.id)
    await fetch(`${APP}/api/${mockoon.profile.id}/refresh`, { method: 'POST' })
    await page.goto(`${APP}/?profile=${mockoon.profile.id}`)
    await page.locator(GRID_ROW).first().waitFor()
    await settle(page)
    await page.locator(GRID_ROW).first().click()
    await settle(page)
    await shot('corpus-mockoon')

    await startPrism()
    const prism = await ensureProfile({
      name: new URL(PRISM).host,
      adapter: 'prism',
      baseUrl: PRISM,
      mappingsDir: PRISM_DOC,
      colour: 'rose',
    })
    if (prism.created) await remember(prism.profile.id)
    await fetch(`${APP}/api/${prism.profile.id}/refresh`, { method: 'POST' })
    await page.goto(`${APP}/?profile=${prism.profile.id}`)
    await page.locator(GRID_ROW).first().waitFor()
    await settle(page)
    await page.locator(GRID_ROW).first().click()
    await settle(page)
    await shot('corpus-prism')
  } finally {
    for (const profileId of created) await deleteApiProfile(profileId)
    await writeCaptureState([])
    stopPrism()
  }
}

async function refreshMirror(): Promise<string> {
  const profiles = (await (await fetch(`${APP}/api/profiles`)).json()) as {
    profiles: { id: string; name: string }[]
  }
  const profile = profiles.profiles[0]
  if (profile === undefined)
    throw new Error(`${APP} has no profile connected — start the CLI with --url`)
  await fetch(`${APP}/api/${profile.id}/refresh`, { method: 'POST' })
  console.log(`mirror refreshed for ${profile.name}`)
  return profile.id
}

const GRID_ROW = '[role="row"][aria-rowindex]'
/** The traffic log is an ordinary table; only the corpus list is a virtualised grid. */
const TABLE_ROW = 'tbody tr'

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
  // The virtualised list measures before it paints; one frame is not enough.
  await page.waitForTimeout(600)
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true })
  await seed()
  await traffic()
  await refreshMirror()

  const browser = await chromium.launch()

  /**
   * Dark mode gets one shot rather than a full set. It is a real feature and the README should
   * show it, but a second copy of every screen is four megabytes of near-duplicate PNG in a
   * repository people clone.
   */
  for (const scheme of ['light', 'dark'] as const) {
    const heroOnly = scheme === 'dark'

    const context = await browser.newContext({
      viewport: { width: 1440, height: 880 },
      deviceScaleFactor: 2,
      colorScheme: scheme,
    })
    const page = await context.newPage()
    const suffix = scheme === 'dark' ? '-dark' : ''
    const shot = async (name: string, height?: number) => {
      await page.screenshot({
        path: join(OUT, `${name}${suffix}.png`),
        // Screens that do not fill the viewport are clipped, so the README is not paying for a
        // third of a page of empty background.
        ...(height === undefined ? {} : { clip: { x: 0, y: 0, width: 1440, height } }),
      })
      console.log(`  ${name}${suffix}.png`)
    }

    // 1 — corpus, the hero. A stub is selected on purpose: the empty detail pane is a third of
    // the window, and a hero shot of the app should show the app rather than a placeholder.
    await page.goto(APP)
    await page.locator(GRID_ROW).first().waitFor()
    await settle(page)
    await page.locator(GRID_ROW).first().click()
    await settle(page)
    await shot('corpus')
    // The backend pages' own hero shot: identical state, saved under the per-backend name they
    // read from `backends.ts` instead of the shared `corpus` one. Light mode only — the dark
    // pass below never reaches this line.
    if (!heroOnly) await shot('corpus-wiremock')

    if (heroOnly) {
      await context.close()
      continue
    }

    // 2 — the same screen driven by a structured query, with the facet counts following it.
    await page.getByLabel('Search stubs').fill('method:POST status:5xx')
    await page.getByLabel('Search stubs').press('Enter')
    await settle(page)
    await page.locator(GRID_ROW).first().click()
    await settle(page)
    await shot('search')

    // 3 — traffic, matched and unmatched side by side. A plain table, not the corpus grid.
    await page.goto(`${APP}/?screen=traffic`)
    await page.locator(TABLE_ROW).first().waitFor({ timeout: 15_000 })
    await settle(page)
    await shot('traffic')

    // 4 — the match explainer, which is the thing no admin API gives you.
    const why = page.getByRole('button', { name: /^Why didn't / }).first()
    if ((await why.count()) > 0) {
      await why.click()
      await page.getByRole('dialog').waitFor()
      await settle(page)
      await shot('match-explainer')
      await page.keyboard.press('Escape')
    } else {
      console.warn('  no unmatched request in the journal — skipping match-explainer')
    }

    // 5 — scenarios, with the unreachable state and the dead end flagged.
    await page.goto(`${APP}/?screen=scenarios`)
    await settle(page)
    await shot('scenarios', 600)

    // 6 — the other three backend pages' own hero shots: MockServer, Mockoon and Prism, each
    // actually connected to, not borrowed from WireMock's.
    await captureBackendScreenshots(page, shot)

    await context.close()
  }

  await browser.close()
  console.log(`\nwrote ${OUT}`)
}

await main()
