import { clientKeyFor, contentHash, setKey } from '@mock-knight/core'
import type { Json, JsonObject, Matcher, Mock, MockDraft } from '@mock-knight/core'

/**
 * MockServer expectations ↔ the canonical model.
 *
 * Written second, against a model shaped by WireMock, which makes it the real test of whether
 * that model describes mock servers or describes WireMock. Where the two disagree it is noted
 * here rather than smoothed over, because a note is evidence and a smoothing is a lie.
 *
 * Three differences that mattered:
 *
 *  1. **Headers are values, not matchers.** WireMock says `{"X-Tenant": {"equalTo": "acme"}}`;
 *     MockServer says `{"X-Tenant": ["acme"]}` and expresses anything else through a separate
 *     syntax inside the string. So every header read here becomes an `equalTo` matcher, and only
 *     `equalTo` can be written back. Anything else round-trips through `raw` untouched.
 *  2. **One URL, no kinds.** There is `path`, and a path is a regex if it looks like one. The
 *     canonical `urlPath` is the honest reading; `url`/`urlPattern` have no equivalent.
 *  3. **No scenarios.** MockServer sequences with `times`, which is a different idea — a stub
 *     that answers twice and then stops is not a state machine. `state` is always null, and the
 *     adapter declares no scenario capability rather than pretending.
 */

const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** MockServer holds every header and query value as a list, even when there is one. */
function firstValue(value: unknown): string | null {
  if (Array.isArray(value)) return asString(value[0])
  return asString(value)
}

/** `{name: [value]}` → `{name: [equalTo matcher]}`. */
function toMatchers(source: unknown): Record<string, Matcher[]> {
  const out: Record<string, Matcher[]> = {}
  if (!isObject(source)) return out
  for (const [name, value] of Object.entries(source)) {
    const first = firstValue(value)
    if (first !== null) setKey(out, name, [{ operator: 'equalTo', value: first, options: {} }])
  }
  return out
}

/** The inverse, for the matchers this backend can express. */
function fromMatchers(source: Record<string, Matcher[]>): JsonObject {
  const out: JsonObject = {}
  for (const [name, matchers] of Object.entries(source)) {
    const first = matchers[0]
    // Only `equalTo` survives the trip. Anything else stays in `raw`, which `toVendor` patches
    // rather than rebuilds, so an unsupported matcher is preserved rather than downgraded.
    if (first !== undefined && first.operator === 'equalTo' && typeof first.value === 'string') {
      setKey(out, name, [first.value])
    }
  }
  return out
}

function readBody(body: unknown): Mock['response']['body'] {
  if (body === null || body === undefined) return { kind: 'none', value: null }
  if (typeof body === 'string') return { kind: 'text', value: body }
  if (isObject(body)) {
    // On the way in MockServer echoes a JSON body bare; on the way out it wants
    // `{type: 'JSON', json: …}`. Both shapes appear, so both are read.
    if (asString(body['type']) === 'JSON' && 'json' in body) {
      return { kind: 'json', value: body['json'] as Json }
    }
    if (asString(body['type']) === 'STRING' && typeof body['string'] === 'string') {
      return { kind: 'text', value: body['string'] }
    }
    return { kind: 'json', value: body as Json }
  }
  return { kind: 'json', value: body as Json }
}

export function toCanonical(raw: JsonObject): Mock {
  const httpRequest = isObject(raw['httpRequest']) ? raw['httpRequest'] : {}
  const httpResponse = isObject(raw['httpResponse']) ? raw['httpResponse'] : {}
  const id = asString(raw['id'])
  const path = asString(httpRequest['path'])
  const delayRaw = isObject(httpResponse['delay']) ? httpResponse['delay'] : null

  const draft: Omit<Mock, 'clientKey' | 'contentHash'> = {
    id,
    // MockServer has no name for an expectation. Leaving it null is right — inventing one from
    // the path would put a value in a field the user could then "edit" into nothing.
    name: null,
    folder: [],
    folderSource: 'none',
    tags: [],
    enabled: null,
    priority: typeof raw['priority'] === 'number' ? raw['priority'] : null,
    request: {
      method: asString(httpRequest['method']),
      url: path === null ? null : { kind: 'urlPath', value: path },
      headers: toMatchers(httpRequest['headers']),
      queryParameters: toMatchers(httpRequest['queryStringParameters']),
      cookies: toMatchers(httpRequest['cookies']),
      bodyPatterns: [],
    },
    response: {
      status: typeof httpResponse['statusCode'] === 'number' ? httpResponse['statusCode'] : null,
      statusMessage: asString(httpResponse['reasonPhrase']),
      headers: Object.fromEntries(
        Object.entries(isObject(httpResponse['headers']) ? httpResponse['headers'] : {}).flatMap(
          ([name, value]) => {
            const first = firstValue(value)
            return first === null ? [] : [[name, first] as const]
          },
        ),
      ),
      body: readBody(httpResponse['body']),
      delay:
        delayRaw === null
          ? null
          : {
              kind: asString(delayRaw['timeUnit']) ?? 'MILLISECONDS',
              milliseconds: typeof delayRaw['value'] === 'number' ? delayRaw['value'] : null,
              options: {},
            },
      fault: null,
      proxy: null,
      transformers: [],
    },
    // No equivalent: `times` sequences, it does not name states. Claiming a scenario here would
    // put a state machine on screen that the server cannot be asked about.
    state: null,
    metadata: {},
    raw,
  }

  return {
    ...draft,
    clientKey: clientKeyFor(raw, id),
    contentHash: contentHash(raw),
  }
}

/**
 * Patch the retained expectation with the canonical fields that changed.
 *
 * Patches rather than rebuilds, for the same reason as every other adapter: `times`,
 * `timeToLive`, and any matcher syntax this model cannot express live only in `raw`, and
 * MockServer replaces an expectation wholesale on write.
 */
export function toVendor(mock: MockDraft): JsonObject {
  const out: JsonObject = { ...mock.raw }
  const httpRequest: JsonObject = isObject(out['httpRequest']) ? { ...out['httpRequest'] } : {}
  const httpResponse: JsonObject = isObject(out['httpResponse']) ? { ...out['httpResponse'] } : {}

  if (mock.request.method === null) delete httpRequest['method']
  else httpRequest['method'] = mock.request.method

  if (mock.request.url === null) delete httpRequest['path']
  else httpRequest['path'] = mock.request.url.value

  for (const [key, source] of [
    ['headers', mock.request.headers],
    ['queryStringParameters', mock.request.queryParameters],
    ['cookies', mock.request.cookies],
  ] as const) {
    const rendered = fromMatchers(source)
    if (Object.keys(rendered).length === 0) delete httpRequest[key]
    else httpRequest[key] = rendered
  }

  if (mock.response.status === null) delete httpResponse['statusCode']
  else httpResponse['statusCode'] = mock.response.status

  if (mock.response.statusMessage === null) delete httpResponse['reasonPhrase']
  else httpResponse['reasonPhrase'] = mock.response.statusMessage

  const headers: JsonObject = {}
  for (const [name, value] of Object.entries(mock.response.headers)) {
    setKey(headers, name, Array.isArray(value) ? value : [value])
  }
  if (Object.keys(headers).length === 0) delete httpResponse['headers']
  else httpResponse['headers'] = headers

  switch (mock.response.body.kind) {
    case 'none':
      delete httpResponse['body']
      break
    case 'json':
      httpResponse['body'] = { type: 'JSON', json: mock.response.body.value }
      break
    default:
      httpResponse['body'] = { type: 'STRING', string: String(mock.response.body.value ?? '') }
  }

  if (mock.response.delay === null) delete httpResponse['delay']
  else {
    httpResponse['delay'] = {
      timeUnit: mock.response.delay.kind,
      value: mock.response.delay.milliseconds ?? 0,
    }
  }

  if (mock.priority === null) delete out['priority']
  else out['priority'] = mock.priority

  out['httpRequest'] = httpRequest
  out['httpResponse'] = httpResponse
  return out
}
