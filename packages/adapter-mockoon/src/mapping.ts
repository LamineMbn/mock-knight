import { applyEdits, modify } from 'jsonc-parser'
import { clientKeyFor, contentHash, setKey } from '@mock-knight/core'
import type {
  Json,
  JsonObject,
  Matcher,
  Mock,
  MockDraft,
  RequestMatcher,
  ResponseBody,
  ResponseSpec,
  ServeEvent,
} from '@mock-knight/core'

/**
 * Mockoon environments ↔ the canonical model.
 *
 * The third backend, and the first that is not an admin API. Mockoon's corpus lives in an
 * environment **JSON document** — `GET /mockoon-admin/environment` is a 404, verified against
 * `mockoon/cli` (TECH-DESIGN §17.31) — so the document is what is read here, and this module is
 * the whole read path rather than a translation layer over one.
 *
 * Four differences that mattered, none of them smoothed over:
 *
 *  1. **A route holds many responses.** Mockoon selects between them with per-response *rules*,
 *     falling back to the one flagged `default`. The canonical model is one matcher → one
 *     response, so a route with three responses becomes **three mocks**, keyed by the pair of
 *     uuids. This is the biggest shape difference of the three backends so far, and the model
 *     absorbed it without a new field.
 *  2. **Order decides, so order is the priority.** Mockoon has no priority number: the first
 *     response whose rules pass wins. Read as `priority = index + 1`, which is a faithful
 *     translation into canonical semantics (lower wins) rather than an invention — but it cannot
 *     be *written*, so `mock.priority` stays off.
 *  3. **Folders are real.** Mockoon states its tree in `folders` + `rootChildren`. Every other
 *     backend so far has forced Mock Knight to guess a folder from a URL prefix, so this is the
 *     first `folderSource: 'metadata'` that is genuinely the server talking.
 *  4. **Rules are richer than the canonical matcher vocabulary.** Anything without a canonical
 *     slot keeps Mockoon's own operator name — `matcherSchema.operator` is an open string for
 *     exactly this — with the knobs in `options`, so it round-trips and renders read-only
 *     instead of being dropped.
 */

const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/**
 * A Mockoon rule, as it appears in the document.
 *
 * Read permissively: the fields this reads are the ones it maps, and an environment written by a
 * newer Mockoon carries more. Everything survives in `raw` regardless.
 */
interface MockoonRule {
  target: string
  modifier: string
  value: string
  operator: string
  invert: boolean
}

function readRule(value: unknown): MockoonRule | null {
  if (!isObject(value)) return null
  const target = asString(value['target'])
  if (target === null) return null
  return {
    target,
    modifier: asString(value['modifier']) ?? '',
    value: asString(value['value']) ?? '',
    // `equals` is Mockoon's default when a rule omits the operator.
    operator: asString(value['operator']) ?? 'equals',
    invert: value['invert'] === true,
  }
}

/**
 * Mockoon's rule operators, in canonical vocabulary where one exists.
 *
 * Only these two have an equivalent every other backend also understands. The rest keep their
 * own name — see the note on rules above.
 */
const CANONICAL_OPERATOR: Readonly<Record<string, string>> = {
  equals: 'equalTo',
  regex: 'matches',
}

/**
 * One rule as a canonical matcher.
 *
 * `invert` has no canonical representation — no backend in the model has negation — so it lives
 * in `options` where it round-trips and the UI can show it. Collapsing an inverted rule to its
 * positive form would state the opposite of what the server does, which is worse than showing
 * an operator the form cannot edit.
 */
function ruleToMatcher(rule: MockoonRule): Matcher {
  /*
   * An inverted rule keeps Mockoon's own operator name, never the canonical one.
   *
   * Mapping `invert: true` to `equalTo` with the flag tucked into `options` read as
   * "x-tenant equalTo acme" on screen — the exact opposite of what the server does, since the
   * rule fires when the header is *not* acme. Anything that renders a canonical operator without
   * reading `options` states the reverse of the truth, and the matcher form and the match
   * explainer both do. A namespaced operator cannot be misread: it renders read-only.
   */
  const operator = rule.invert
    ? `mockoon:not-${rule.operator}`
    : (CANONICAL_OPERATOR[rule.operator] ?? `mockoon:${rule.operator}`)
  const options: JsonObject = {}
  if (rule.invert) options['invert'] = true
  // A body rule's modifier is a path into the document, not a field name.
  if (rule.target === 'body' && rule.modifier !== '') options['expression'] = rule.modifier
  return { operator, value: rule.value, options }
}

/** Where a rule's `modifier` names a key, that key is the slot it matches on. */
const KEYED_TARGETS: Readonly<Record<string, keyof RequestMatcher>> = {
  header: 'headers',
  query: 'queryParameters',
  cookie: 'cookies',
}

/**
 * Rules → a canonical request matcher, on top of the route's method and path.
 *
 * Targets with no canonical slot — `params`, `request_number`, `global_var`, `data_bucket` — are
 * deliberately not forced into one. They stay in `raw`, which the Raw JSON tab shows verbatim.
 * Inventing a header matcher for a rule about the third request would be a lie in the one screen
 * whose job is explaining why a request did not match.
 */
function rulesToMatcher(base: RequestMatcher, rules: readonly MockoonRule[]): RequestMatcher {
  const headers: Record<string, Matcher[]> = { ...base.headers }
  const queryParameters: Record<string, Matcher[]> = { ...base.queryParameters }
  const cookies: Record<string, Matcher[]> = { ...base.cookies }
  const bodyPatterns: Matcher[] = [...base.bodyPatterns]
  const slots = { headers, queryParameters, cookies }

  for (const rule of rules) {
    if (rule.target === 'body') {
      bodyPatterns.push(ruleToMatcher(rule))
      continue
    }
    const slot = KEYED_TARGETS[rule.target]
    if (slot === undefined || rule.modifier === '') continue
    const target = slots[slot as 'headers' | 'queryParameters' | 'cookies']
    const existing = target[rule.modifier] ?? []
    setKey(target, rule.modifier, [...existing, ruleToMatcher(rule)])
  }

  return { ...base, headers, queryParameters, cookies, bodyPatterns }
}

/**
 * A Mockoon endpoint as a canonical URL match.
 *
 * `endpoint` carries no leading slash and may hold Express route parameters (`users/:id`) or a
 * wildcard. A template is not a literal path, so it is read as `urlPathPattern` with the
 * parameters translated to a regex — calling it `urlPath` would make the corpus list claim a
 * stub answers on the literal string `/users/:id`.
 */
export function endpointToUrlMatch(endpoint: string): {
  kind: 'urlPath' | 'urlPathPattern'
  value: string
} {
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  if (!/[:*]/.test(path)) return { kind: 'urlPath', value: path }
  const pattern = path
    // Escape regex metacharacters that are legal in a path, before introducing any of our own.
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/:[A-Za-z0-9_]+/g, '[^/]+')
    .replace(/\*/g, '.*')
  return { kind: 'urlPathPattern', value: pattern }
}

/**
 * A response body, in the nearest canonical kind.
 *
 * `DATABUCKET` is read as `file`: its content lives outside the stub under a name, which is what
 * `file` means here and what WireMock's `bodyFileName` maps to. The alternative was `none`,
 * which would say there is no body when there is one. The bucket id stays in `raw`.
 */
function readBody(response: JsonObject): ResponseBody {
  const bodyType = asString(response['bodyType']) ?? 'INLINE'
  if (bodyType === 'FILE') return { kind: 'file', value: asString(response['filePath']) ?? '' }
  if (bodyType === 'DATABUCKET') {
    return { kind: 'file', value: `databucket:${asString(response['databucketID']) ?? ''}` }
  }
  const body = asString(response['body'])
  if (body === null || body === '') return { kind: 'none', value: null }
  try {
    return { kind: 'json', value: JSON.parse(body) as Json }
  } catch {
    // Not a failure: a Mockoon body is a template as often as it is JSON, and a template with
    // Handlebars in it is text.
    return { kind: 'text', value: body }
  }
}

function readResponseSpec(response: JsonObject): ResponseSpec {
  const headers: Record<string, string> = {}
  for (const entry of asArray(response['headers'])) {
    if (!isObject(entry)) continue
    const key = asString(entry['key'])
    if (key === null || key === '') continue
    setKey(headers, key, asString(entry['value']) ?? '')
  }

  const latency = typeof response['latency'] === 'number' ? response['latency'] : 0
  const status = typeof response['statusCode'] === 'number' ? response['statusCode'] : null

  return {
    status,
    statusMessage: null,
    headers,
    body: readBody(response),
    delay: latency > 0 ? { kind: 'fixed', milliseconds: latency, options: {} } : null,
    fault: null,
    proxy: null,
    // Mockoon templates every body by default; `disableTemplating` turns it off per response.
    // Named as the vendor names it, per the `transformers` contract.
    transformers: response['disableTemplating'] === true ? [] : ['mockoon:templating'],
  }
}

/**
 * The folder path for each route uuid, from Mockoon's own tree.
 *
 * `rootChildren` is an ordered list of `{type, uuid}`, and a folder's children live on the
 * folder. Walked iteratively with a seen-set: the document is user-editable JSON, and a cycle in
 * it must not hang the ingest of a corpus.
 */
export function folderPaths(environment: JsonObject): Map<string, string[]> {
  const folders = new Map<string, { name: string; children: unknown[] }>()
  for (const folder of asArray(environment['folders'])) {
    if (!isObject(folder)) continue
    const uuid = asString(folder['uuid'])
    if (uuid === null) continue
    folders.set(uuid, {
      name: asString(folder['name']) ?? uuid,
      children: asArray(folder['children']),
    })
  }

  const paths = new Map<string, string[]>()
  const seen = new Set<string>()
  const queue: { child: unknown; path: string[] }[] = asArray(environment['rootChildren']).map(
    (child) => ({ child, path: [] }),
  )

  while (queue.length > 0) {
    const { child, path } = queue.shift()!
    if (!isObject(child)) continue
    const uuid = asString(child['uuid'])
    if (uuid === null || seen.has(uuid)) continue
    seen.add(uuid)

    if (child['type'] === 'folder') {
      const folder = folders.get(uuid)
      if (folder === undefined) continue
      const nested = [...path, folder.name]
      for (const grandchild of folder.children) queue.push({ child: grandchild, path: nested })
    } else {
      paths.set(uuid, path)
    }
  }

  return paths
}

/**
 * Every (route, response) pair in an environment, as canonical mocks.
 *
 * `raw` for each is the route document narrowed to the one response it represents. That is a
 * valid Mockoon route rather than a synthetic shape, so patching it back is well defined: find
 * the route by uuid, find the response by uuid. Route-level fields are repeated across the
 * siblings, which duplicates but never loses (invariant 3).
 *
 * Routes Mock Knight cannot represent as request/response — WebSocket routes — are skipped
 * rather than flattened into something misleading. The count is returned so the caller can say
 * so out loud instead of silently showing a shorter corpus.
 */
export function environmentToMocks(environment: JsonObject): {
  mocks: Mock[]
  skipped: { uuid: string; reason: string }[]
} {
  const paths = folderPaths(environment)
  const mocks: Mock[] = []
  const skipped: { uuid: string; reason: string }[] = []

  for (const route of asArray(environment['routes'])) {
    if (!isObject(route)) continue
    /*
     * A uuid is Mockoon's own id and is normally present — but it is not required to read the
     * route, and requiring it was a bug the conformance suite caught: `render` produces a route
     * for a stub that does not exist yet, so it has no uuid, and `interpret(render(draft))` threw.
     * A hand-edited environment file can omit one too.
     *
     * Invariant 2 already says what identity means without a server id: hash the canonical form.
     * So a missing uuid means `id: null` and a hashed `clientKey`, not a skipped route.
     */
    const routeUuid = asString(route['uuid'])

    const type = asString(route['type']) ?? 'http'
    if (type === 'ws') {
      skipped.push({
        uuid: routeUuid ?? asString(route['endpoint']) ?? '(unnamed route)',
        reason: 'WebSocket route: not a request/response stub',
      })
      continue
    }

    const method = asString(route['method'])
    const endpoint = asString(route['endpoint']) ?? ''
    const documentation = asString(route['documentation'])
    const folder = routeUuid === null ? [] : (paths.get(routeUuid) ?? [])

    const base: RequestMatcher = {
      // Mockoon spells methods in lower case, and `all` means any.
      method: method === null || method === '' || method === 'all' ? null : method.toUpperCase(),
      url: endpointToUrlMatch(endpoint),
      headers: {},
      queryParameters: {},
      cookies: {},
      bodyPatterns: [],
    }

    const responses = asArray(route['responses'])
    responses.forEach((value, index) => {
      if (!isObject(value)) return
      const responseUuid = asString(value['uuid'])

      const rules = asArray(value['rules'])
        .map(readRule)
        .filter((rule): rule is MockoonRule => rule !== null)

      const raw: JsonObject = { ...route, responses: [value] }
      // Both uuids, because the pair is the unit this model shows and Mockoon keys both halves.
      // Either missing means there is no server id at all — never a half one like `uuid:null`,
      // which would look like an id and collide with every other half-identified sibling.
      const id = routeUuid !== null && responseUuid !== null ? `${routeUuid}:${responseUuid}` : null
      const label = asString(value['label'])

      mocks.push({
        id,
        clientKey: clientKeyFor(raw, id),
        name: label !== null && label !== '' ? label : (documentation ?? null),
        folder,
        // Mockoon states its own tree, so this is the server talking rather than a guess from a
        // URL prefix — the first backend of the three that can say so.
        folderSource: folder.length > 0 ? 'metadata' : 'none',
        tags: [],
        // Mockoon has no per-route disable, so `null` rather than a claim either way.
        enabled: null,
        /*
         * Order is the whole selection rule here — but only when there is something to order.
         *
         * A route with one response has no contest, so calling it "priority 1" implies a ranking
         * that does not exist and made a rendered stub fail to round-trip: the draft said "no
         * opinion" and reading it back said "first". Found by the conformance suite.
         */
        priority: responses.length > 1 ? index + 1 : null,
        request: rulesToMatcher(base, rules),
        response: readResponseSpec(value),
        // No named states. `responseMode: 'SEQUENTIAL'` cycles responses, which is not a state
        // machine any more than MockServer's `times` is.
        state: null,
        metadata: {},
        raw,
        contentHash: contentHash(raw),
      })
    })
  }

  return { mocks, skipped }
}

/**
 * A draft as a Mockoon route document.
 *
 * The inverse of the read path, and deliberately not a `toVendor` that patches: nothing calls it
 * with a retained document yet, because writes are off in this pass. It exists because the
 * contract requires `render` — the UI shows what *would* be written before writing it — and
 * because a round-trip test is the only way to know the read path is not lossy in one direction.
 *
 * Where a canonical field has no Mockoon home it is left out rather than approximated; a
 * `mockoon:`-prefixed operator is unprefixed back to its own name.
 */
/**
 * A draft's matchers as Mockoon rules.
 *
 * Shared by `render` and by the in-place patch so the two cannot drift: a rule written one way
 * on create and another on update is the kind of difference nobody notices until a stub stops
 * matching.
 */
function draftToRules(draft: MockDraft): JsonObject[] {
  const rules: JsonObject[] = []

  const pushRule = (target: string, modifier: string, matcher: Matcher): void => {
    const vendor = matcher.operator.startsWith('mockoon:')
      ? matcher.operator.slice('mockoon:'.length)
      : VENDOR_OPERATOR[matcher.operator]
    // `not-equals` is this module's own spelling of an inverted rule, not Mockoon's: the
    // operator on the wire is `equals` with `invert: true`.
    const operator = vendor?.startsWith('not-') === true ? vendor.slice('not-'.length) : vendor
    // An operator with no Mockoon spelling is dropped from the rendered rule rather than guessed
    // at. It is still in `raw` for anything that retained the original document.
    if (operator === undefined) return
    rules.push({
      target,
      modifier,
      value: typeof matcher.value === 'string' ? matcher.value : JSON.stringify(matcher.value),
      operator,
      invert: matcher.options['invert'] === true,
    })
  }

  for (const [name, matchers] of Object.entries(draft.request.headers)) {
    for (const matcher of matchers) pushRule('header', name, matcher)
  }
  for (const [name, matchers] of Object.entries(draft.request.queryParameters)) {
    for (const matcher of matchers) pushRule('query', name, matcher)
  }
  for (const [name, matchers] of Object.entries(draft.request.cookies)) {
    for (const matcher of matchers) pushRule('cookie', name, matcher)
  }
  for (const matcher of draft.request.bodyPatterns) {
    const expression = matcher.options['expression']
    pushRule('body', typeof expression === 'string' ? expression : '', matcher)
  }

  return rules
}

export function draftToRoute(draft: MockDraft): JsonObject {
  const url = draft.request.url
  // Mockoon endpoints carry no leading slash, and a pattern read from `:param` cannot be turned
  // back into the parameter name it came from — the literal is the honest rendering.
  const endpoint = (url?.value ?? '').replace(/^\//, '')

  const headers = Object.entries(draft.response.headers).map(([key, value]) => ({
    key,
    value: Array.isArray(value) ? (value[0] ?? '') : value,
  }))

  const rules = draftToRules(draft)

  const body = draft.response.body
  const isFile = body.kind === 'file'
  const bodyText =
    body.kind === 'json'
      ? JSON.stringify(body.value, null, 2)
      : body.kind === 'text' || body.kind === 'base64'
        ? String(body.value ?? '')
        : ''

  return {
    type: 'http',
    documentation: draft.name ?? '',
    // Mockoon spells methods in lower case, and a matcher with no method means any.
    method: draft.request.method === null ? 'all' : draft.request.method.toLowerCase(),
    endpoint,
    responses: [
      {
        body: bodyText,
        latency: draft.response.delay?.milliseconds ?? 0,
        statusCode: draft.response.status ?? 200,
        label: draft.name ?? '',
        headers,
        bodyType: isFile ? 'FILE' : 'INLINE',
        filePath: isFile ? String(body.value ?? '') : '',
        databucketID: '',
        sendFileAsBody: isFile,
        rules,
        rulesOperator: 'AND',
        // `transformers` carries Mockoon's own name for templating, so its absence is the signal.
        disableTemplating: !draft.response.transformers.includes('mockoon:templating'),
        fallbackTo404: false,
        default: rules.length === 0,
        crudKey: 'id',
        callbacks: [],
      },
    ],
    responseMode: null,
  }
}

/** The inverse of `CANONICAL_OPERATOR`, for the two predicates that translate both ways. */
const VENDOR_OPERATOR: Readonly<Record<string, string>> = {
  equalTo: 'equals',
  matches: 'regex',
}

/**
 * One Mockoon transaction log entry as a canonical serve event.
 *
 * The reason Mockoon gets a Traffic screen where MockServer does not: an entry carries
 * `routeUUID` and `routeResponseUUID`, which is the same pair this module keys mocks by — so a
 * served request can name the stub that served it instead of leaving the UI to guess.
 *
 * @param index position in the log, used only when an entry carries no uuid of its own.
 */
export function logToServeEvent(entry: unknown, index: number): ServeEvent | null {
  if (!isObject(entry)) return null
  const request = isObject(entry['request']) ? entry['request'] : null
  if (request === null) return null
  const response = isObject(entry['response']) ? entry['response'] : null

  const routeUuid = asString(entry['routeUUID'])
  const responseUuid = asString(entry['routeResponseUUID'])
  const timestamp = entry['timestampMs']

  const headers: Record<string, string> = {}
  for (const header of asArray(request['headers'])) {
    if (!isObject(header)) continue
    const key = asString(header['key'])
    if (key === null) continue
    setKey(headers, key, asString(header['value']) ?? '')
  }

  const queryParameters: Record<string, string[]> = {}
  const query = request['queryParams']
  if (isObject(query)) {
    for (const [name, value] of Object.entries(query)) {
      setKey(queryParameters, name, Array.isArray(value) ? value.map(String) : [String(value)])
    }
  }

  const path = asString(request['urlPath']) ?? asString(request['route']) ?? '/'
  const raw: JsonObject = entry

  return {
    id: asString(entry['uuid']) ?? `mockoon-${index}`,
    at:
      typeof timestamp === 'number' ? new Date(timestamp).toISOString() : new Date(0).toISOString(),
    // Mockoon reports no duration for a served request, and a fabricated zero would read as
    // "instant" in a column meant to show latency.
    timing: null,
    request: {
      method: (asString(request['method']) ?? 'GET').toUpperCase(),
      url: path,
      absoluteUrl: null,
      clientIp: null,
      headers,
      cookies: {},
      queryParameters,
      body: asString(request['body']),
      bodyTruncated: false,
    },
    response:
      response === null
        ? null
        : {
            status: typeof response['statusCode'] === 'number' ? response['statusCode'] : 0,
            headers: {},
            body: asString(response['body']),
            bodyTruncated: false,
          },
    // A route uuid is Mockoon saying which route answered. Without one, nothing served it.
    matched: routeUuid !== null,
    matchedClientKey:
      routeUuid !== null && responseUuid !== null ? `${routeUuid}:${responseUuid}` : null,
    matchedFingerprint: null,
    correlation: null,
    nearMisses: null,
    raw,
  }
}

/**
 * Patch one response inside the environment document, leaving the rest of the file alone.
 *
 * A **surgical edit**, not a rewrite. These documents live in version control and are edited by
 * hand and by Mockoon's own GUI, so reserialising the whole file would turn a one-field change
 * into a diff nobody can review — and would quietly restyle formatting the owner chose.
 * `jsonc-parser` rewrites only the span that changed.
 *
 * Patching rather than rebuilding is also invariant 3: the response written is the response that
 * was read, with the fields this model understands overwritten. Anything Mockoon supports that
 * the canonical model does not — callbacks, `fallbackTo404`, `crudKey`, a rule this mapping
 * cannot express — survives untouched because it is never regenerated.
 *
 * @returns the new document text, or `null` when the id names nothing in this document.
 */
export function patchResponseInDocument(
  text: string,
  document: JsonObject,
  id: string,
  draft: MockDraft,
): string | null {
  const [routeUuid, responseUuid] = id.split(':')
  if (routeUuid === undefined || responseUuid === undefined) return null

  const routes = asArray(document['routes'])
  const routeIndex = routes.findIndex(
    (route) => isObject(route) && asString(route['uuid']) === routeUuid,
  )
  if (routeIndex === -1) return null
  const route = routes[routeIndex] as JsonObject

  const responses = asArray(route['responses'])
  const responseIndex = responses.findIndex(
    (response) => isObject(response) && asString(response['uuid']) === responseUuid,
  )
  if (responseIndex === -1) return null
  const existing = responses[responseIndex] as JsonObject

  // Mockoon's own files are two-space JSON; matching that keeps an inserted object consistent
  // with its surroundings. Without explicit formattingOptions jsonc-parser writes it on one line.
  const formattingOptions = { tabSize: 2, insertSpaces: true }
  let patched = text

  const write = (path: (string | number)[], value: unknown): void => {
    patched = applyEdits(patched, modify(patched, path, value, { formattingOptions }))
  }

  write(['routes', routeIndex, 'responses', responseIndex], responseFrom(existing, draft))

  // Route-level fields the canonical model owns. Written only when they actually changed, so an
  // edit that touches the response alone leaves the route's own lines untouched in the diff.
  const method = draft.request.method === null ? 'all' : draft.request.method.toLowerCase()
  if (asString(route['method']) !== method) write(['routes', routeIndex, 'method'], method)

  const endpoint = (draft.request.url?.value ?? '').replace(/^\//, '')
  if (asString(route['endpoint']) !== endpoint) {
    write(['routes', routeIndex, 'endpoint'], endpoint)
  }

  return patched
}

/**
 * The vendor response to write: the one that was read, with the canonical fields overwritten.
 *
 * Spread-then-override rather than constructed fresh — see the note above about invariant 3.
 */
/**
 * The body string to write, keeping the author's own formatting when the content has not changed.
 *
 * Re-serialising unconditionally meant that editing a *status code* also rewrote the body —
 * `{"ok":true}` became a pretty-printed three-line string — so a one-field change produced a
 * diff touching a field nobody edited, and quietly discarded whichever layout the author chose.
 * Caught by the test asserting exactly one line moves.
 *
 * The comparison is on the parsed document, not the text: same content in different whitespace
 * is not a change. Anything that fails to parse falls through to being rewritten, which is the
 * safe direction — writing the edit matters more than preserving bytes.
 */
function bodyStringFor(existing: JsonObject, draft: MockDraft): string {
  const body = draft.response.body
  if (body.kind === 'file' || body.kind === 'none') return ''

  const rendered =
    body.kind === 'json' ? JSON.stringify(body.value, null, 2) : String(body.value ?? '')
  const current = asString(existing['body'])
  if (current === null) return rendered

  if (body.kind === 'json') {
    try {
      if (JSON.stringify(JSON.parse(current)) === JSON.stringify(body.value)) return current
    } catch {
      // Not JSON on disk, so there is nothing to preserve.
    }
    return rendered
  }
  return current === rendered ? current : rendered
}

function responseFrom(existing: JsonObject, draft: MockDraft): JsonObject {
  const body = draft.response.body
  const isFile = body.kind === 'file'

  return {
    ...existing,
    statusCode: draft.response.status ?? 200,
    label: draft.name ?? '',
    latency: draft.response.delay?.milliseconds ?? 0,
    headers: Object.entries(draft.response.headers).map(([key, value]) => ({
      key,
      value: Array.isArray(value) ? (value[0] ?? '') : value,
    })),
    bodyType: isFile ? 'FILE' : 'INLINE',
    filePath: isFile ? String(body.value ?? '') : '',
    body: bodyStringFor(existing, draft),
    // `transformers` carries Mockoon's own name for templating, so its absence is the signal.
    disableTemplating: !draft.response.transformers.includes('mockoon:templating'),
    rules: draftToRules(draft),
  }
}
