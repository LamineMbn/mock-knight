import { toCanonical } from '@mock-knight/adapter-wiremock'
import type { Mock } from '@mock-knight/core'
import type { JsonObject } from '@mock-knight/core'

/**
 * Benchmark corpora — TECH-DESIGN §14.
 *
 * These exist so the performance NFRs are asserted by CI rather than discovered in a bug
 * report, which means the corpus has to resemble a real one rather than being 10,000 copies of
 * the same stub. Shaped from an actual WireMock in use: a long tail of folders, a heavy skew
 * toward one or two HTTP methods, most stubs selected by a **header** whose value is their real
 * identity, and a body-size distribution where almost everything is small and a few are huge.
 *
 * Fully deterministic. `Math.random` would make a regression un-bisectable, so the generator
 * carries its own seeded PRNG and the same seed always produces byte-identical stubs.
 */

/** mulberry32 — small, fast, and good enough for fixture shape. */
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

const SERVICES = [
  'basket-api',
  'order-api',
  'order-spi-hs-acrs-v1',
  'order-spi-hs-tars-v1',
  'irma',
  'kafka-order-process-v1',
  'loyalty-api',
  'wc-offer-api-v1',
]
const RESOURCES = [
  'offers',
  'hotels',
  'reservations',
  'accountlogin',
  'transactions',
  'sessions',
  'customers',
  'payments',
  'catalog',
  'contacts',
]
const OUTCOMES = [
  'unparsable',
  'on-timeout',
  'wrong-access-code',
  'unknown-state',
  '500-error',
  'missing-field',
  'nominal',
  'partial',
  'rate-limited',
  'expired',
]
/** Weighted to match what real corpora look like, not a uniform spread. */
const METHODS = ['GET', 'GET', 'GET', 'POST', 'POST', 'POST', 'POST', 'PATCH', 'PUT', 'DELETE']
const STATUSES = [200, 200, 200, 200, 200, 201, 204, 400, 404, 409, 422, 500, 500, 503]

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!
}

/**
 * Body sizes with a realistic long tail: mostly a couple of hundred bytes, occasionally tens of
 * KB, and rarely large enough to exercise the 64KB index cap and the "5MB without freezing" NFR.
 */
function bodyFor(random: () => number, index: number): JsonObject {
  const roll = random()
  const rows = roll > 0.995 ? 20_000 : roll > 0.95 ? 400 : roll > 0.7 ? 30 : 3
  return {
    id: `id-${index}`,
    outcome: pick(random, OUTCOMES),
    items: Array.from({ length: rows }, (_, row) => ({
      sku: `SKU-${index}-${row}`,
      label: `line item ${row} for reservation ${index}`,
      qty: (row % 7) + 1,
      price: Number(((row * 13.7) % 500).toFixed(2)),
    })),
  }
}

/**
 * Where response bodies live. Both shapes are real and they stress different things.
 *
 * `inline` embeds the body in the mapping, so `raw` is large and the trigram index has real work
 * to do — this is the shape the "5MB bodies without freezing" NFR is about. `file` points at
 * `bodyFileName`, leaving mappings tiny; measured against a production WireMock, 430 of its 471
 * stubs did exactly that, so it is the *common* case rather than the interesting one.
 */
export type BodyStrategy = 'inline' | 'file'

export interface CorpusOptions {
  /** Fraction of stubs selected by an `X-Mock` header. Real corpora run around 0.9. */
  readonly headerRatio?: number
  readonly bodyStrategy?: BodyStrategy
  readonly seed?: number
}

/** Vendor-shaped stubs, so the fixture exercises the adapter mapping too, not just the mirror. */
export function generateVendorCorpus(count: number, options: CorpusOptions = {}): JsonObject[] {
  const random = prng(options.seed ?? 0x5eed)
  const headerRatio = options.headerRatio ?? 0.9
  const bodyStrategy = options.bodyStrategy ?? 'inline'
  const out: JsonObject[] = []

  for (let index = 0; index < count; index++) {
    const service = pick(random, SERVICES)
    const resource = pick(random, RESOURCES)
    const version = `v${1 + Math.floor(random() * 3)}`
    const outcome = pick(random, OUTCOMES)
    const method = pick(random, METHODS)
    const status = pick(random, STATUSES)

    const stub: JsonObject = {
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      name: `${service} ${method.toLowerCase()} ${resource} ${outcome}`,
      request: {
        method,
        urlPath: `/${service}/${resource}/${version}/${index % 97}`,
      },
      response: {
        status,
        headers: { 'Content-Type': 'application/json' },
        ...(bodyStrategy === 'inline'
          ? { jsonBody: bodyFor(random, index) }
          : { bodyFileName: `${service}/${resource}-${outcome}-${index}.json` }),
      },
      metadata: {
        'mock-knight': {
          folder: [service, `${resource}-${version}`],
          tags: random() > 0.8 ? ['legacy'] : [],
        },
      },
    }

    if (random() < headerRatio) {
      ;(stub['request'] as JsonObject)['headers'] = {
        'X-Mock': { equalTo: `${service}-${method.toLowerCase()}-${resource}-${outcome}-${index}` },
      }
    }
    if (random() > 0.93) {
      ;(stub['response'] as JsonObject)['fixedDelayMilliseconds'] = 50
    }
    if (random() > 0.9) {
      stub['scenarioName'] = `${resource}-flow`
      stub['requiredScenarioState'] = 'Started'
    }
    if (random() > 0.95) stub['priority'] = 1 + Math.floor(random() * 9)

    out.push(stub)
  }
  return out
}

export function generateCorpus(count: number, options: CorpusOptions = {}): Mock[] {
  return generateVendorCorpus(count, options).map(toCanonical)
}
