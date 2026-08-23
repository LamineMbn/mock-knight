import { setKey } from './set-key.js'
import type { LoggedRequest, Matcher, MockDraft } from './model.js'

/**
 * Build a stub from a request that was actually served — FR-TRAF-5.
 *
 * This is the exit from the match explainer: the developer has just learned why nothing
 * matched, and the next thing they want is a stub that would have. Everything here is a
 * *suggestion* — the result is shown as editable JSON before anything is written, because the
 * choices below are guesses about intent that no algorithm can make reliably.
 *
 * Browser-safe: no `node:` imports.
 */

/**
 * How closely the generated stub should pin the request down (design brief §6.4).
 *
 * `exact` reproduces the request as faithfully as it can, which is right when the point is
 * "this precise call should have matched". `path` is the loosest, for when the request was
 * merely an example of a shape. The middle is usually what people want.
 */
export const MATCHER_TIGHTNESS = ['exact', 'method-and-path', 'path'] as const
export type MatcherTightness = (typeof MATCHER_TIGHTNESS)[number]

/**
 * Headers every HTTP client sends, which describe the *transport* rather than the caller's
 * intent. Matching on them produces a stub that works from curl and mysteriously fails from
 * the application under test — the worst kind of mock bug, because it looks like the app.
 */
const TRANSPORT_HEADERS = new Set([
  'accept',
  'accept-charset',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'connection',
  'content-length',
  'cookie',
  'expect',
  'host',
  'origin',
  'pragma',
  'referer',
  'te',
  'transfer-encoding',
  'upgrade-insecure-requests',
  'user-agent',
  'postman-token',
])

/** Headers whose value is a secret or a nonce: never pinned, and never echoed into a stub. */
const SENSITIVE_HEADERS = new Set(['authorization', 'proxy-authorization', 'x-api-key', 'cookie'])

export interface FromRequestOptions {
  readonly tightness?: MatcherTightness
  /** Match on the request body as well. Off by default: bodies rarely repeat byte for byte. */
  readonly matchBody?: boolean
  readonly responseStatus?: number
}

export interface GeneratedStub {
  readonly draft: MockDraft
  /**
   * Choices worth showing the user, because each one is a guess. The screen lists these rather
   * than hiding them, so an unhelpful stub is obvious before it is written rather than after.
   */
  readonly notes: readonly string[]
}

function pathOf(url: string): string {
  const index = url.indexOf('?')
  return index === -1 ? url : url.slice(0, index)
}

function singleValue(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value
}

export function stubFromRequest(
  request: LoggedRequest,
  options: FromRequestOptions = {},
): GeneratedStub {
  const tightness = options.tightness ?? 'method-and-path'
  const notes: string[] = []

  const headers: Record<string, Matcher[]> = {}
  if (tightness === 'exact') {
    for (const [name, value] of Object.entries(request.headers)) {
      const lower = name.toLowerCase()
      if (TRANSPORT_HEADERS.has(lower)) continue
      if (SENSITIVE_HEADERS.has(lower)) {
        notes.push(`Left out ${name}: it carries a credential, which should not go into a stub.`)
        continue
      }
      setKey(headers, name, [{ operator: 'equalTo', value: singleValue(value), options: {} }])
    }
    const pinned = Object.keys(headers)
    if (pinned.length > 0) {
      notes.push(`Matching on ${pinned.join(', ')}. Remove any that should not be required.`)
    }
  }

  const queryParameters: Record<string, Matcher[]> = {}
  if (tightness === 'exact') {
    for (const [name, values] of Object.entries(request.queryParameters)) {
      const first = values[0]
      if (first !== undefined) {
        setKey(queryParameters, name, [{ operator: 'equalTo', value: first, options: {} }])
      }
    }
  }

  const bodyPatterns: Matcher[] = []
  if (options.matchBody === true && request.body !== null && request.body !== '') {
    // equalToJson where it parses, so key order and whitespace stop mattering.
    try {
      bodyPatterns.push({
        operator: 'equalToJson',
        value: JSON.parse(request.body) as never,
        options: { ignoreExtraElements: true },
      })
      notes.push('Body matched as JSON, ignoring extra fields and key order.')
    } catch {
      bodyPatterns.push({ operator: 'equalTo', value: request.body, options: {} })
      notes.push('Body matched as an exact string, because it is not JSON.')
    }
  }

  if (tightness === 'path') {
    notes.push('Matching any method on this path.')
  }
  if (tightness !== 'exact' && Object.keys(request.queryParameters).length > 0) {
    notes.push('Query parameters are ignored at this tightness.')
  }

  const draft: MockDraft = {
    name: `${request.method} ${pathOf(request.url)}`,
    folder: [],
    tags: [],
    enabled: null,
    priority: null,
    request: {
      method: tightness === 'path' ? null : request.method,
      // urlPath, not url: the query string is matched through queryParameters when it is
      // matched at all, and baking it into the path makes the matcher brittle for no gain.
      url: { kind: 'urlPath', value: pathOf(request.url) },
      headers,
      queryParameters,
      cookies: {},
      bodyPatterns,
    },
    response: {
      status: options.responseStatus ?? 200,
      statusMessage: null,
      headers: { 'Content-Type': 'application/json' },
      body: { kind: 'json', value: { TODO: 'replace with the response this stub should return' } },
      delay: null,
      fault: null,
      proxy: null,
      transformers: [],
    },
    state: null,
    metadata: {},
    // Empty: the vendor document is rendered from the canonical fields above, since there is no
    // prior document to patch.
    raw: {},
  }

  return { draft, notes }
}
