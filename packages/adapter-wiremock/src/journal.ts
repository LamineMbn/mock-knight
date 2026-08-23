import { clientKeyFor, explainMatch, setKey } from '@mock-knight/core'
import type {
  Json,
  JsonObject,
  LoggedRequest,
  LoggedResponse,
  NearMiss,
  ServeEvent,
} from '@mock-knight/core'
import { toCanonical } from './mapping.js'

/**
 * WireMock's journal and near-miss payloads → the canonical model.
 *
 * The near-miss mapping is where this adapter has to be most careful about what it claims.
 * WireMock returns `{ request, stubMapping, matchResult: { distance, subEvents,
 * diffDescriptions } }` — and against 3.13.1 `subEvents` and `diffDescriptions` were empty on
 * every response, for both the unmatched-near-misses feed and the per-request endpoint. So the
 * *candidate* and the *distance* are the server's word, and the per-predicate table is
 * Mock Knight's own reasoning. They are tagged separately for exactly that reason.
 */

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asObject(value: Json | undefined): JsonObject {
  return isObject(value) ? value : {}
}

function asString(value: Json | undefined): string | null {
  return typeof value === 'string' ? value : null
}

function headerMap(raw: Json | undefined): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(asObject(raw))) {
    if (typeof value === 'string') setKey(out, key, value)
    else if (Array.isArray(value))
      setKey(
        out,
        key,
        value.filter((v): v is string => typeof v === 'string'),
      )
  }
  return out
}

export function toLoggedRequest(raw: JsonObject): LoggedRequest {
  const queryParameters: Record<string, string[]> = {}
  // WireMock reports query params as `{ name: { key, values: [...] } }`.
  for (const [name, entry] of Object.entries(asObject(raw['queryParams']))) {
    const values = isObject(entry) ? entry['values'] : undefined
    if (Array.isArray(values)) {
      setKey(
        queryParameters,
        name,
        values.filter((v): v is string => typeof v === 'string'),
      )
    }
  }
  const cookies: Record<string, string> = {}
  for (const [name, value] of Object.entries(asObject(raw['cookies']))) {
    if (typeof value === 'string') setKey(cookies, name, value)
  }

  return {
    method: asString(raw['method']) ?? 'GET',
    url: asString(raw['url']) ?? '/',
    absoluteUrl: asString(raw['absoluteUrl']),
    clientIp: asString(raw['clientIp']),
    headers: headerMap(raw['headers']),
    cookies,
    queryParameters,
    body: asString(raw['body']),
    bodyTruncated: false,
  }
}

function toLoggedResponse(raw: Json | undefined): LoggedResponse | null {
  if (!isObject(raw)) return null
  const status = raw['status']
  if (typeof status !== 'number') return null
  return {
    status,
    headers: headerMap(raw['headers']),
    body: asString(raw['body']),
    bodyTruncated: false,
  }
}

/**
 * @param correlationHeader per-profile header name that groups a test run's traffic (FR-TRAF-8).
 */
export function toServeEvent(raw: JsonObject, correlationHeader: string | null): ServeEvent {
  const request = toLoggedRequest(asObject(raw['request']))
  const stub = raw['stubMapping']
  const matchedClientKey = isObject(stub) ? toCanonical(stub).clientKey : null

  let correlation: string | null = null
  if (correlationHeader !== null) {
    const wanted = correlationHeader.toLowerCase()
    for (const [key, value] of Object.entries(request.headers)) {
      if (key.toLowerCase() === wanted)
        correlation = Array.isArray(value) ? (value[0] ?? null) : value
    }
  }

  return {
    id: asString(raw['id']) ?? clientKeyFor(raw, null),
    // WireMock stamps the time on the request, not on the event.
    at: asString(asObject(raw['request'])['loggedDateString']) ?? new Date(0).toISOString(),
    request,
    response: toLoggedResponse(raw['response']),
    matched: raw['wasMatched'] === true,
    matchedClientKey: raw['wasMatched'] === true ? matchedClientKey : null,
    correlation,
    nearMisses: null,
    raw,
  }
}

/**
 * One near miss: the server's candidate and distance, plus our own per-field comparison.
 *
 * `distance` is passed through untouched and rendered as a bar rather than a number — 0.0121
 * means nothing to a developer, "one mismatch" does (design brief §6.4 rule 4).
 */
export function toNearMiss(
  raw: JsonObject,
  scenarioStates: Readonly<Record<string, string>> = {},
): NearMiss {
  const stubRaw = raw['stubMapping']
  const stub = isObject(stubRaw) ? toCanonical(stubRaw) : null
  const request = toLoggedRequest(asObject(raw['request']))
  const matchResult = asObject(raw['matchResult'])
  const distance = typeof matchResult['distance'] === 'number' ? matchResult['distance'] : 1

  const explanation =
    stub === null
      ? { predicates: [], mismatchCount: 0, unknownCount: 0 }
      : explainMatch(stub.request, request, { state: stub.state, scenarioStates })

  return {
    clientKey: stub?.clientKey ?? null,
    stubName: stub?.name ?? null,
    distance,
    mismatchCount: explanation.mismatchCount,
    unknownCount: explanation.unknownCount,
    predicates: [...explanation.predicates],
    // The candidate and its ranking are the server's.
    provenance: 'server',
    // The table beside them is not: WireMock never sends one.
    predicateProvenance: 'inferred',
  }
}
