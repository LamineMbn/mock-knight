import { clientKeyFor, contentHash, setKey } from '@mock-knight/core'
import type {
  Json,
  JsonObject,
  Matcher,
  Mock,
  RequestMatcher,
  ResponseBody,
  ResponseSpec,
} from '@mock-knight/core'

/**
 * OpenAPI documents ↔ the canonical model, as Prism serves them.
 *
 * The fourth backend and the third in a row whose corpus is a file — Prism has no control API at
 * all (`/__admin`, `/_prism`, `/health` are all 404), so the OpenAPI document *is* the corpus.
 *
 * What is different about this one:
 *
 *  1. **Nothing here was written as a mock.** WireMock, MockServer and Mockoon all store stubs
 *     somebody authored. An OpenAPI document describes an API, and Prism derives mock behaviour
 *     from it. So more of this mapping is *reading intent* than translating fields, and anything
 *     read that way is marked rather than presented as though the server said it.
 *  2. **The lowest 2xx wins, not the first response in the document.** Verified by putting `403`
 *     above `200` and watching Prism answer `200` — so response order in the file is not the
 *     precedence, and reading it as such would have produced a Priority column that was exactly
 *     backwards on a common document.
 *  3. **Most responses have no stored body.** Prism generates one from the schema per request.
 *     A body that does not exist is not an empty body, so it is `kind: 'none'` plus the
 *     `prism:dynamic` transformer — the same vendor-named marker Mockoon's templating uses.
 *  4. **Parameters are the matcher.** A required header or query parameter is what makes a
 *     request valid, and Prism answers 422 when one is missing. That is the closest thing any
 *     backend has to publishing its own near-miss rule.
 */

const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const emptyToNull = (value: string | null): string | null => (value === '' ? null : value)

/** The methods an OpenAPI path item may carry. Anything else on it is not an operation. */
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const

/**
 * A path template as a canonical URL match.
 *
 * `/pets/{petId}` is a template, not a path. Read as `urlPathPattern` for the same reason as
 * Mockoon's `:id`: calling it `urlPath` would have the corpus claim a stub answers on the literal
 * string `/pets/{petId}`, which nothing ever requests.
 */
export function templateToUrlMatch(template: string): {
  kind: 'urlPath' | 'urlPathPattern'
  value: string
} {
  const path = template.startsWith('/') ? template : `/${template}`
  if (!path.includes('{')) return { kind: 'urlPath', value: path }
  const pattern = path
    // Escape what is regex in a path before introducing any of our own. `{` and `}` are escaped
    // too and then replaced, so a brace that is not part of a parameter stays literal.
    .replace(/[.+^$()|[\]\\]/g, '\\$&')
    .replace(/\{[^}]+\}/g, '[^/]+')
    .replace(/[{}]/g, '\\$&')
    .replace(/\*/g, '.*')
  return { kind: 'urlPathPattern', value: pattern }
}

/**
 * Parameters as matchers, by where they live.
 *
 * Only *required* parameters become matchers. An optional one does not constrain whether a
 * request matches — Prism serves the operation without it — so listing it as a predicate would
 * make the match explainer report a failure that never happens.
 */
function parametersToMatcher(base: RequestMatcher, parameters: readonly unknown[]): RequestMatcher {
  const headers: Record<string, Matcher[]> = { ...base.headers }
  const queryParameters: Record<string, Matcher[]> = { ...base.queryParameters }
  const cookies: Record<string, Matcher[]> = { ...base.cookies }

  for (const parameter of parameters) {
    if (!isObject(parameter)) continue
    if (parameter['required'] !== true) continue
    const name = asString(parameter['name'])
    const location = asString(parameter['in'])
    if (name === null || location === null) continue

    /*
     * `prism:required` rather than `equalTo`: the document says the parameter must be *present*
     * and conform to a schema, never that it equals some value. `equalTo` with an invented value
     * would be a predicate the server does not have, in the one screen whose job is explaining
     * why a request did not match.
     */
    const matcher: Matcher = {
      operator: 'prism:required',
      value: null,
      options: isObject(parameter['schema']) ? { schema: parameter['schema'] } : {},
    }

    if (location === 'header') setKey(headers, name, [matcher])
    else if (location === 'query') setKey(queryParameters, name, [matcher])
    else if (location === 'cookie') setKey(cookies, name, [matcher])
    // `in: path` is already expressed by the URL pattern, so it is not repeated as a predicate.
  }

  return { ...base, headers, queryParameters, cookies }
}

/** The first example a media-type object offers, by whichever of the two spellings it uses. */
function exampleOf(media: JsonObject): { found: boolean; value: Json } {
  if ('example' in media) return { found: true, value: media['example'] as Json }
  const examples = media['examples']
  if (isObject(examples)) {
    for (const candidate of Object.values(examples)) {
      // Each entry is an Example Object; the payload is under `value`.
      if (isObject(candidate) && 'value' in candidate) {
        return { found: true, value: candidate['value'] as Json }
      }
    }
  }
  return { found: false, value: null }
}

function readResponse(response: JsonObject, status: number): ResponseSpec {
  const content = isObject(response['content']) ? response['content'] : null
  const mediaTypes = content === null ? [] : Object.entries(content)
  const first = mediaTypes[0]
  const mediaType = first?.[0] ?? null
  const media = isObject(first?.[1]) ? (first[1] as JsonObject) : null

  const headers: Record<string, string> = {}
  if (mediaType !== null) setKey(headers, 'Content-Type', mediaType)

  let body: ResponseBody = { kind: 'none', value: null }
  const transformers: string[] = []
  if (media !== null) {
    const example = exampleOf(media)
    if (example.found) {
      body =
        typeof example.value === 'string'
          ? { kind: 'text', value: example.value }
          : { kind: 'json', value: example.value }
    } else if (isObject(media['schema'])) {
      /*
       * No stored body, and that is not the same as an empty one: Prism builds a response from
       * the schema on every request. Named the way Mockoon's templating is, so the Response tab
       * says "generated" rather than showing a blank and implying there is nothing to return.
       */
      transformers.push('prism:dynamic')
    }
  }

  return {
    status,
    /*
     * An empty description is not a description.
     *
     * OpenAPI *requires* `description` on a Response Object, so `render` has to write one, and a
     * draft with no status message produced `description: ''` — which then read back as `''`
     * rather than `null` and broke the render/interpret round-trip. Caught by the conformance
     * suite, and it is the honest reading anyway: the key is mandatory, so an empty one states
     * nothing.
     */
    statusMessage: emptyToNull(asString(response['description'])),
    headers,
    body,
    delay: null,
    fault: null,
    proxy: null,
    transformers,
  }
}

/**
 * Which response Prism actually serves when the request does not ask for one.
 *
 * The **lowest 2xx**, verified by running it: a document listing `403` before `200` still answers
 * `200`. Document order is not the rule, and reading it as one would have made the Priority
 * column exactly backwards on any document that lists errors first.
 *
 * Falls back to the lowest status of any class, which is what Prism does for an operation that
 * declares no success response at all.
 */
export function defaultStatusOf(statuses: readonly number[]): number | null {
  const ordered = [...statuses].sort((a, b) => a - b)
  return ordered.find((status) => status >= 200 && status < 300) ?? ordered[0] ?? null
}

/**
 * Every (operation, response) pair in an OpenAPI document, as canonical mocks.
 *
 * `raw` is the operation narrowed to the one response it represents, plus the path and method it
 * was found under — an OpenAPI operation does not carry those, and without them the document
 * could not be found again from the stub.
 */
export function documentToMocks(document: JsonObject): {
  mocks: Mock[]
  skipped: { path: string; reason: string }[]
} {
  const mocks: Mock[] = []
  const skipped: { path: string; reason: string }[] = []
  const paths = isObject(document['paths']) ? document['paths'] : {}

  for (const [template, item] of Object.entries(paths)) {
    if (!isObject(item)) continue
    // Parameters declared on the path item apply to every operation under it.
    const shared = Array.isArray(item['parameters']) ? item['parameters'] : []

    for (const method of METHODS) {
      const operation = item[method]
      if (!isObject(operation)) continue

      const responses = isObject(operation['responses']) ? operation['responses'] : {}
      const entries = Object.entries(responses).filter(([, value]) => isObject(value))
      if (entries.length === 0) {
        skipped.push({
          path: `${method.toUpperCase()} ${template}`,
          reason: 'the operation declares no responses, so Prism has nothing to serve',
        })
        continue
      }

      const own = Array.isArray(operation['parameters']) ? operation['parameters'] : []
      const base: RequestMatcher = {
        method: method.toUpperCase(),
        url: templateToUrlMatch(template),
        headers: {},
        queryParameters: {},
        cookies: {},
        bodyPatterns: [],
      }
      const request = parametersToMatcher(base, [...shared, ...own])

      const numeric = entries
        .map(([status]) => Number.parseInt(status, 10))
        .filter((status) => Number.isInteger(status))
      const winner = defaultStatusOf(numeric)

      const operationId = asString(operation['operationId'])
      const summary = asString(operation['summary'])

      for (const [status, value] of entries) {
        const response = value as JsonObject
        const code = Number.parseInt(status, 10)
        // `default` and `2XX` are legal keys and are not a status Prism can be asked for by code.
        if (!Number.isInteger(code)) {
          skipped.push({
            path: `${method.toUpperCase()} ${template}`,
            reason: `response "${status}" is a range or default, which has no single status code`,
          })
          continue
        }

        const raw: JsonObject = {
          // The operation cannot say where it lives, and a stub that cannot be found again in
          // the document it came from is not much use.
          'x-mock-knight-path': template,
          'x-mock-knight-method': method,
          ...operation,
          responses: { [status]: response },
        }
        const id = `${operationId ?? `${method} ${template}`}:${status}`

        mocks.push({
          id,
          clientKey: clientKeyFor(raw, id),
          name: summary ?? operationId,
          // OpenAPI tags are the document's own grouping, so this is the server talking rather
          // than a folder guessed from a URL prefix.
          folder: Array.isArray(operation['tags'])
            ? operation['tags'].filter((tag): tag is string => typeof tag === 'string').slice(0, 1)
            : [],
          folderSource:
            Array.isArray(operation['tags']) && operation['tags'].length > 0 ? 'metadata' : 'none',
          tags: Array.isArray(operation['tags'])
            ? operation['tags'].filter((tag): tag is string => typeof tag === 'string')
            : [],
          // OpenAPI has no notion of a disabled operation.
          enabled: null,
          /*
           * Only ranked when the operation has more than one response, for the same reason as
           * Mockoon: a lone response has nothing to outrank, and calling it "priority 1" implies
           * a contest that does not exist.
           */
          priority: entries.length > 1 ? (code === winner ? 1 : 2) : null,
          request,
          response: readResponse(response, code),
          // Prism has no scenarios; `Prefer` selects a response per request rather than moving a
          // server-side state machine.
          state: null,
          metadata: {},
          raw,
          contentHash: contentHash(raw),
        })
      }
    }
  }

  return { mocks, skipped }
}
