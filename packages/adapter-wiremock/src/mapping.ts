import {
  MOCK_KNIGHT_METADATA_KEY,
  canonicalJson,
  clientKeyFor,
  contentHash,
  setKey,
} from '@mock-knight/core'
import type {
  Json,
  JsonObject,
  Matcher,
  Mock,
  ResponseBody,
  ResponseDelay,
  ResponseSpec,
  RequestMatcher,
  StateBinding,
  UrlMatch,
  UrlMatchKind,
} from '@mock-knight/core'

/**
 * WireMock ⇄ canonical mapping.
 *
 * `toVendor` **patches the retained raw payload**; it never rebuilds it (CLAUDE.md invariant 3).
 * Concretely: it re-derives what the canonical model looked like when the stub was read, and
 * writes back only the fields that actually differ. A stub with `postServeActions`, a WireMock
 * 4 field we have never heard of, or a matcher operator added last week therefore survives an
 * edit to its status code untouched — which is the difference between a tool a team can trust
 * with a shared server and one that quietly eats configuration.
 */

const URL_KEYS: readonly UrlMatchKind[] = ['url', 'urlPattern', 'urlPath', 'urlPathPattern']
const BODY_KEYS = ['body', 'jsonBody', 'base64Body', 'bodyFileName'] as const
const DELAY_KEYS = ['fixedDelayMilliseconds', 'delayDistribution'] as const

/**
 * Predicate names, checked in order so the operator is picked deterministically when a matcher
 * object carries both a predicate and its options. Anything not listed still round-trips: an
 * unrecognised object falls back to its first key as the operator.
 */
const PREDICATE_KEYS = [
  'equalTo',
  'binaryEqualTo',
  'equalToJson',
  'equalToXml',
  'matchesJsonPath',
  'matchesJsonSchema',
  'matchesXPath',
  'matches',
  'doesNotMatch',
  'contains',
  'doesNotContain',
  'absent',
  'before',
  'after',
  'equalToDateTime',
  'hasExactly',
  'includes',
  'and',
  'or',
  'anything',
] as const

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asObject(value: Json | undefined): JsonObject {
  return isObject(value) ? value : {}
}

function asString(value: Json | undefined): string | null {
  return typeof value === 'string' ? value : null
}

function asStringArray(value: Json | undefined): string[] | null {
  if (!Array.isArray(value)) return null
  return value.every((entry) => typeof entry === 'string') ? (value as string[]) : null
}

function asInteger(value: Json | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function same(a: Json, b: Json): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

// ---------------------------------------------------------------------------- read

function readMatcher(raw: Json): Matcher {
  if (!isObject(raw)) return { operator: 'equalTo', value: raw, options: {} }
  const keys = Object.keys(raw)
  const operator = PREDICATE_KEYS.find((key) => keys.includes(key)) ?? keys[0]
  if (operator === undefined) return { operator: 'anything', value: null, options: {} }
  const options: JsonObject = {}
  for (const key of keys) if (key !== operator) setKey(options, key, raw[key]!)
  return { operator, value: raw[operator] ?? null, options }
}

function readMatcherList(raw: Json | undefined): Matcher[] {
  if (raw === undefined) return []
  if (Array.isArray(raw)) return raw.map(readMatcher)
  return [readMatcher(raw)]
}

function readMatcherMap(raw: Json | undefined): Record<string, Matcher[]> {
  const source = asObject(raw)
  const out: Record<string, Matcher[]> = {}
  for (const [key, value] of Object.entries(source)) setKey(out, key, readMatcherList(value))
  return out
}

function readUrl(request: JsonObject): UrlMatch | null {
  for (const kind of URL_KEYS) {
    const value = asString(request[kind])
    if (value !== null) return { kind, value }
  }
  return null
}

function readBody(response: JsonObject): ResponseBody {
  if (response['jsonBody'] !== undefined) return { kind: 'json', value: response['jsonBody']! }
  if (typeof response['base64Body'] === 'string') {
    return { kind: 'base64', value: response['base64Body'] }
  }
  if (typeof response['bodyFileName'] === 'string') {
    return { kind: 'file', value: response['bodyFileName'] }
  }
  if (typeof response['body'] === 'string') return { kind: 'text', value: response['body'] }
  return { kind: 'none', value: null }
}

function readDelay(response: JsonObject): ResponseDelay | null {
  const fixed = asInteger(response['fixedDelayMilliseconds'])
  if (fixed !== null) return { kind: 'fixed', milliseconds: fixed, options: {} }
  const distribution = response['delayDistribution']
  if (isObject(distribution)) {
    const { type, ...rest } = distribution
    return {
      kind: asString(type) ?? 'unknown',
      milliseconds: null,
      options: rest as JsonObject,
    }
  }
  return null
}

function readState(raw: JsonObject): StateBinding | null {
  const scenario = asString(raw['scenarioName'])
  if (scenario === null) return null
  return {
    scenario,
    requiredState: asString(raw['requiredScenarioState']),
    newState: asString(raw['newScenarioState']),
  }
}

const TEMPLATED_SEGMENT = /[{}()[\]*?^$|\\]/

/**
 * Folder from a URL path, used only when the server stated none. Everything after the first
 * templated segment is dropped, and so is the leaf: `/v1/customers/{id}` groups under
 * `v1/customers`, not under a folder per customer id. This is a guess, and `folderSource`
 * records that it is one.
 */
function folderFromUrl(url: UrlMatch | null): string[] {
  if (url === null) return []
  const path = url.value.split('?')[0] ?? ''
  const segments = path.split('/').filter((segment) => segment.length > 0)
  const leafDropped = segments.slice(0, -1)
  const cut = leafDropped.findIndex((segment) => TEMPLATED_SEGMENT.test(segment))
  return cut === -1 ? leafDropped : leafDropped.slice(0, cut)
}

export function toCanonical(raw: JsonObject): Mock {
  const request = asObject(raw['request'])
  const response = asObject(raw['response'])
  const metadata = asObject(raw['metadata'])
  const ours = asObject(metadata[MOCK_KNIGHT_METADATA_KEY])

  const url = readUrl(request)
  const statedFolder = asStringArray(ours['folder'])
  const derivedFolder = folderFromUrl(url)
  const folder = statedFolder ?? derivedFolder
  const folderSource =
    statedFolder !== null ? 'metadata' : derivedFolder.length > 0 ? 'path' : 'none'

  const method = asString(request['method'])

  const requestMatcher: RequestMatcher = {
    // WireMock spells "any method" as ANY; the canonical model spells it null, because a
    // backend without the concept should not have to invent the word.
    method: method === null || method === 'ANY' ? null : method,
    url,
    headers: readMatcherMap(request['headers']),
    queryParameters: readMatcherMap(request['queryParameters']),
    cookies: readMatcherMap(request['cookies']),
    bodyPatterns: readMatcherList(request['bodyPatterns']),
  }

  const proxyBaseUrl = asString(response['proxyBaseUrl'])
  const responseSpec: ResponseSpec = {
    status: asInteger(response['status']),
    statusMessage: asString(response['statusMessage']),
    headers: asObject(response['headers']) as ResponseSpec['headers'],
    body: readBody(response),
    delay: readDelay(response),
    fault: asString(response['fault']),
    proxy:
      proxyBaseUrl === null
        ? null
        : {
            baseUrl: proxyBaseUrl,
            additionalHeaders: asObject(response['additionalProxyRequestHeaders']) as Record<
              string,
              string
            >,
          },
    transformers: asStringArray(response['transformers']) ?? [],
  }

  const id = asString(raw['id']) ?? asString(raw['uuid'])

  return {
    id,
    clientKey: clientKeyFor(raw, id),
    name: asString(raw['name']),
    folder,
    folderSource,
    tags: asStringArray(ours['tags']) ?? [],
    // WireMock Java has no disabled flag and its schema rejects unknown properties, so this is
    // null rather than true: "we do not know" and "it is on" are different statements.
    enabled: null,
    priority: asInteger(raw['priority']),
    request: requestMatcher,
    response: responseSpec,
    state: readState(raw),
    metadata,
    raw,
    contentHash: contentHash(raw),
  }
}

// --------------------------------------------------------------------------- write

function writeMatcher(matcher: Matcher): Json {
  return { [matcher.operator]: matcher.value, ...matcher.options }
}

function writeMatcherList(matchers: readonly Matcher[]): Json {
  // One matcher writes as an object, several as an array: both shapes read back identically,
  // and the single-object form is what a hand-written mapping file looks like.
  return matchers.length === 1 ? writeMatcher(matchers[0]!) : matchers.map(writeMatcher)
}

function writeMatcherMap(target: JsonObject, key: string, map: Record<string, Matcher[]>): void {
  const entries = Object.entries(map).filter(([, matchers]) => matchers.length > 0)
  if (entries.length === 0) {
    delete target[key]
    return
  }
  const out: JsonObject = {}
  for (const [name, matchers] of entries) setKey(out, name, writeMatcherList(matchers))
  setKey(target, key, out)
}

/** Write a value, or remove the key entirely — WireMock treats absent and null differently. */
function writeOrDelete(target: JsonObject, key: string, value: Json | null): void {
  if (value === null) delete target[key]
  else setKey(target, key, value)
}

function ensureObject(target: JsonObject, key: string): JsonObject {
  const existing = target[key]
  if (isObject(existing)) return existing
  const created: JsonObject = {}
  setKey(target, key, created)
  return created
}

function writeUrl(request: JsonObject, url: UrlMatch | null): void {
  for (const key of URL_KEYS) delete request[key]
  if (url !== null) request[url.kind] = url.value
}

function writeBody(response: JsonObject, body: ResponseBody): void {
  for (const key of BODY_KEYS) delete response[key]
  switch (body.kind) {
    case 'none':
      return
    case 'json':
      response['jsonBody'] = body.value
      return
    case 'text':
      response['body'] = body.value
      return
    case 'base64':
      response['base64Body'] = body.value
      return
    case 'file':
      response['bodyFileName'] = body.value
      return
  }
}

function writeDelay(response: JsonObject, delay: ResponseDelay | null): void {
  for (const key of DELAY_KEYS) delete response[key]
  if (delay === null) return
  if (delay.kind === 'fixed') {
    if (delay.milliseconds !== null) response['fixedDelayMilliseconds'] = delay.milliseconds
    return
  }
  response['delayDistribution'] = { type: delay.kind, ...delay.options }
}

function writeState(raw: JsonObject, state: StateBinding | null): void {
  if (state === null) {
    delete raw['scenarioName']
    delete raw['requiredScenarioState']
    delete raw['newScenarioState']
    return
  }
  raw['scenarioName'] = state.scenario
  writeOrDelete(raw, 'requiredScenarioState', state.requiredState)
  writeOrDelete(raw, 'newScenarioState', state.newState)
}

function writeOrganisation(raw: JsonObject, mock: Mock, before: Mock): void {
  const metadataChanged = !same(before.metadata, mock.metadata)
  const folderChanged = !same(before.folder, mock.folder)
  const tagsChanged = !same(before.tags, mock.tags)
  if (!metadataChanged && !folderChanged && !tagsChanged) return

  const metadata: JsonObject = metadataChanged
    ? { ...mock.metadata }
    : { ...asObject(raw['metadata']) }

  if (folderChanged || tagsChanged) {
    const ours = { ...asObject(metadata[MOCK_KNIGHT_METADATA_KEY]) }
    if (folderChanged) ours['folder'] = [...mock.folder]
    if (tagsChanged) ours['tags'] = [...mock.tags]
    metadata[MOCK_KNIGHT_METADATA_KEY] = ours
  }

  if (Object.keys(metadata).length === 0) delete raw['metadata']
  else raw['metadata'] = metadata
}

/**
 * Patch the retained vendor payload with whatever the canonical model changed.
 *
 * `before` is what this stub looked like when it was read. Comparing against it — rather than
 * writing every canonical field unconditionally — is what stops a save from normalising a
 * representation the user never touched: a `body` that WireMock would also accept as `jsonBody`
 * stays exactly as the author wrote it.
 */
export function toVendor(mock: Mock): JsonObject {
  const raw = structuredClone(mock.raw)
  const before = toCanonical(mock.raw)

  if (before.name !== mock.name) writeOrDelete(raw, 'name', mock.name)
  if (before.priority !== mock.priority) writeOrDelete(raw, 'priority', mock.priority)
  if (!same(before.state, mock.state)) writeState(raw, mock.state)
  writeOrganisation(raw, mock, before)
  // `enabled` is deliberately never written: WireMock Java has no such field and its mapping
  // schema rejects additional properties, so writing one would make every save a 422.

  if (!same(before.request, mock.request)) {
    const request = ensureObject(raw, 'request')
    if (before.request.method !== mock.request.method) {
      writeOrDelete(request, 'method', mock.request.method)
    }
    if (!same(before.request.url, mock.request.url)) writeUrl(request, mock.request.url)
    if (!same(before.request.headers, mock.request.headers)) {
      writeMatcherMap(request, 'headers', mock.request.headers)
    }
    if (!same(before.request.queryParameters, mock.request.queryParameters)) {
      writeMatcherMap(request, 'queryParameters', mock.request.queryParameters)
    }
    if (!same(before.request.cookies, mock.request.cookies)) {
      writeMatcherMap(request, 'cookies', mock.request.cookies)
    }
    if (!same(before.request.bodyPatterns, mock.request.bodyPatterns)) {
      if (mock.request.bodyPatterns.length === 0) delete request['bodyPatterns']
      else request['bodyPatterns'] = mock.request.bodyPatterns.map(writeMatcher)
    }
  }

  if (!same(before.response, mock.response)) {
    const response = ensureObject(raw, 'response')
    if (before.response.status !== mock.response.status) {
      writeOrDelete(response, 'status', mock.response.status)
    }
    if (before.response.statusMessage !== mock.response.statusMessage) {
      writeOrDelete(response, 'statusMessage', mock.response.statusMessage)
    }
    if (!same(before.response.headers, mock.response.headers)) {
      if (Object.keys(mock.response.headers).length === 0) delete response['headers']
      else response['headers'] = mock.response.headers
    }
    if (!same(before.response.body, mock.response.body)) writeBody(response, mock.response.body)
    if (!same(before.response.delay, mock.response.delay)) writeDelay(response, mock.response.delay)
    if (before.response.fault !== mock.response.fault) {
      writeOrDelete(response, 'fault', mock.response.fault)
    }
    if (!same(before.response.proxy, mock.response.proxy)) {
      delete response['proxyBaseUrl']
      delete response['additionalProxyRequestHeaders']
      if (mock.response.proxy !== null) {
        response['proxyBaseUrl'] = mock.response.proxy.baseUrl
        if (Object.keys(mock.response.proxy.additionalHeaders).length > 0) {
          response['additionalProxyRequestHeaders'] = mock.response.proxy.additionalHeaders
        }
      }
    }
    if (!same(before.response.transformers, mock.response.transformers)) {
      if (mock.response.transformers.length === 0) delete response['transformers']
      else response['transformers'] = [...mock.response.transformers]
    }
  }

  return raw
}
