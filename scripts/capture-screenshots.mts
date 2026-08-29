/**
 * Regenerate the README screenshots.
 *
 * A UI tool whose README shows no UI asks the reader to take its word for everything, so these
 * images are part of the documentation rather than decoration — and being generated rather than
 * hand-cropped, they can be redone after a redesign instead of quietly going stale.
 *
 * It needs the full stack, because a screenshot of a mocked screen would be exactly the lie
 * this project refuses to tell elsewhere:
 *
 *   docker run -d --name mk-dev-wiremock -p 18099:8080 wiremock/wiremock:3.13.1 --verbose
 *   pnpm build && pnpm dev:server --url http://localhost:18099
 *   pnpm tsx scripts/capture-screenshots.mts
 *
 * It REPLACES the target WireMock's corpus wholesale and clears its journal. Point it at a
 * throwaway instance only.
 */
import { chromium, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const WIREMOCK = process.env['MOCK_KNIGHT_SHOTS_WIREMOCK'] ?? 'http://localhost:18099'
const APP = process.env['MOCK_KNIGHT_SHOTS_URL'] ?? 'http://127.0.0.1:7777'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'images')

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

    await context.close()
  }

  await browser.close()
  console.log(`\nwrote ${OUT}`)
}

await main()
