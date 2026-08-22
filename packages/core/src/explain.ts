import type { Json, JsonObject } from './types.js'
import type {
  LoggedRequest,
  Matcher,
  PredicateOutcome,
  PredicateResult,
  RequestMatcher,
} from './model.js'

/**
 * The matcher explainer — the engine behind design brief §6.4, the signature screen.
 *
 * **Why this exists at all.** WireMock's near-miss API returns a candidate stub and a scalar
 * `distance`, and nothing else: `diffDescriptions` and `subEvents` came back empty in every
 * response observed against 3.13.1 (§17.20). So the server can rank candidates but cannot say
 * *which predicate* failed — and the per-field table is the entire point of the screen. Mock
 * Knight computes it here, and the result is labelled as inference wherever it is shown.
 *
 * **Why `unknown` is a first-class outcome.** This module reimplements another system's matching
 * semantics, and it will not always agree: an operator we have not implemented, a JSONPath
 * beyond our reader, a Java regex whose meaning differs in JavaScript. Every one of those
 * returns `unknown` with a reason rather than a guess. A debugging tool that confidently says
 * "this header matched" when it did not is worse than one that says "I could not tell" — the
 * developer loses hours trusting it, once, and never trusts it again.
 *
 * Browser-safe: no `node:` imports.
 */

export interface MatchExplanation {
  readonly predicates: readonly PredicateResult[]
  readonly mismatchCount: number
  readonly unknownCount: number
  /** One plain sentence naming the closest failure — the hero line of §6.4. */
  readonly summary: string
}

function stringify(value: Json | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Anchored, because a matcher is a whole-value test, not a search. */
function fullMatch(pattern: string, actual: string): PredicateOutcome | 'bad-regex' {
  let regex: RegExp
  try {
    regex = new RegExp(`^(?:${pattern})$`, 's')
  } catch {
    return 'bad-regex'
  }
  return regex.test(actual) ? 'pass' : 'fail'
}

function canonicalForCompare(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalForCompare).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalForCompare(value[key] as Json)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** `ignoreExtraElements`: every key the expectation names must match; extras are tolerated. */
function jsonSubsetOf(expected: Json, actual: Json): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false
    return expected.every((entry, index) => jsonSubsetOf(entry, actual[index] as Json))
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false
    return Object.keys(expected).every((key) =>
      jsonSubsetOf(expected[key] as Json, (actual as JsonObject)[key] as Json),
    )
  }
  return canonicalForCompare(expected) === canonicalForCompare(actual)
}

/**
 * A deliberately small JSONPath reader: `$`, `.key`, `['key']`, and `[0]`.
 *
 * Anything with a filter, a wildcard, or a recursive descent returns `undefined` and the caller
 * reports `unknown`. Half-implementing JSONPath would produce confident wrong answers on
 * exactly the expressions that are hard enough to be worth checking.
 */
const SIMPLE_JSONPATH = /^\$(\.[A-Za-z_][\w-]*|\['[^']*'\]|\[\d+\])*$/

function readJsonPath(document: Json, path: string): { found: boolean } | null {
  if (!SIMPLE_JSONPATH.test(path)) return null
  let current: Json | undefined = document
  const steps = path.slice(1).match(/\.[A-Za-z_][\w-]*|\['[^']*'\]|\[\d+\]/g) ?? []
  for (const step of steps) {
    if (current === null || current === undefined) return { found: false }
    if (step.startsWith('.')) {
      if (typeof current !== 'object' || Array.isArray(current)) return { found: false }
      current = (current as JsonObject)[step.slice(1)]
    } else if (step.startsWith("['")) {
      if (typeof current !== 'object' || Array.isArray(current)) return { found: false }
      current = (current as JsonObject)[step.slice(2, -2)]
    } else {
      const index = Number(step.slice(1, -1))
      if (!Array.isArray(current)) return { found: false }
      current = current[index]
    }
  }
  return { found: current !== undefined }
}

function parseJson(text: string | null): Json | undefined {
  if (text === null) return undefined
  try {
    return JSON.parse(text) as Json
  } catch {
    return undefined
  }
}

interface Verdict {
  outcome: PredicateOutcome
  note?: string
}

function evaluate(matcher: Matcher, actual: string | null): Verdict {
  const options = matcher.options
  const caseInsensitive = options['caseInsensitive'] === true
  const fold = (value: string): string => (caseInsensitive ? value.toLowerCase() : value)
  const expected = stringify(matcher.value)

  switch (matcher.operator) {
    case 'anything':
      return { outcome: 'pass' }

    case 'absent': {
      // `absent: false` is WireMock's way of saying "must be present".
      const wantAbsent = matcher.value !== false
      return { outcome: (actual === null) === wantAbsent ? 'pass' : 'fail' }
    }

    case 'equalTo':
      if (actual === null || expected === null) return { outcome: 'fail' }
      return { outcome: fold(actual) === fold(expected) ? 'pass' : 'fail' }

    case 'contains':
      if (actual === null || expected === null) return { outcome: 'fail' }
      return { outcome: fold(actual).includes(fold(expected)) ? 'pass' : 'fail' }

    case 'doesNotContain':
      if (actual === null || expected === null) return { outcome: 'pass' }
      return { outcome: fold(actual).includes(fold(expected)) ? 'fail' : 'pass' }

    case 'matches':
    case 'doesNotMatch': {
      if (actual === null || expected === null) {
        return { outcome: matcher.operator === 'matches' ? 'fail' : 'pass' }
      }
      const verdict = fullMatch(expected, actual)
      if (verdict === 'bad-regex') {
        return {
          outcome: 'unknown',
          note: `Mock Knight could not read this regex: ${expected}`,
        }
      }
      const matched = verdict === 'pass'
      return { outcome: (matcher.operator === 'matches') === matched ? 'pass' : 'fail' }
    }

    case 'equalToJson': {
      const actualJson = parseJson(actual)
      if (actualJson === undefined) return { outcome: 'fail' }
      const expectedJson = matcher.value
      if (expectedJson === null) return { outcome: 'fail' }
      if (options['ignoreArrayOrder'] === true) {
        return {
          outcome: 'unknown',
          note: 'ignoreArrayOrder is not implemented by Mock Knight’s explainer.',
        }
      }
      const passed =
        options['ignoreExtraElements'] === true
          ? jsonSubsetOf(expectedJson, actualJson)
          : canonicalForCompare(expectedJson) === canonicalForCompare(actualJson)
      return { outcome: passed ? 'pass' : 'fail' }
    }

    case 'matchesJsonPath': {
      const actualJson = parseJson(actual)
      if (actualJson === undefined) return { outcome: 'fail' }
      // WireMock also allows an object form with sub-matchers; only the plain string is read.
      if (typeof matcher.value !== 'string') {
        return { outcome: 'unknown', note: 'Only a plain JSONPath string is evaluated here.' }
      }
      const read = readJsonPath(actualJson, matcher.value)
      if (read === null) {
        return {
          outcome: 'unknown',
          note: `Mock Knight’s JSONPath reader handles simple paths only: ${matcher.value}`,
        }
      }
      return { outcome: read.found ? 'pass' : 'fail' }
    }

    case 'and':
    case 'or': {
      const branches = Array.isArray(matcher.value) ? matcher.value : []
      if (branches.length === 0) return { outcome: 'unknown', note: 'Empty logical matcher.' }
      const verdicts = branches.map((branch) => evaluate(readNestedMatcher(branch), actual))
      if (verdicts.some((v) => v.outcome === 'unknown')) {
        return { outcome: 'unknown', note: 'A branch of this matcher could not be evaluated.' }
      }
      const passes = verdicts.filter((v) => v.outcome === 'pass').length
      const passed = matcher.operator === 'and' ? passes === verdicts.length : passes > 0
      return { outcome: passed ? 'pass' : 'fail' }
    }

    default:
      return {
        outcome: 'unknown',
        note: `Mock Knight does not evaluate the "${matcher.operator}" operator.`,
      }
  }
}

/** Sub-matchers inside `and`/`or` arrive as raw vendor objects, not canonical matchers. */
function readNestedMatcher(raw: Json): Matcher {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { operator: 'equalTo', value: raw, options: {} }
  }
  const keys = Object.keys(raw)
  const operator = keys.find((key) => key !== 'caseInsensitive') ?? 'anything'
  const options: JsonObject = {}
  for (const key of keys) if (key !== operator) options[key] = raw[key]!
  return { operator, value: raw[operator] ?? null, options }
}

/** HTTP header names are case-insensitive, so the lookup has to be too. */
function headerValue(request: LoggedRequest, name: string): string | null {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? (value[0] ?? null) : value
  }
  return null
}

function pathOf(url: string): string {
  const index = url.indexOf('?')
  return index === -1 ? url : url.slice(0, index)
}

function urlPredicate(matcher: RequestMatcher, request: LoggedRequest): PredicateResult | null {
  const url = matcher.url
  if (url === null) return null
  const actual =
    url.kind === 'urlPath' || url.kind === 'urlPathPattern' ? pathOf(request.url) : request.url
  const isPattern = url.kind === 'urlPattern' || url.kind === 'urlPathPattern'

  if (!isPattern) {
    return {
      field: 'url',
      outcome: actual === url.value ? 'pass' : 'fail',
      operator: url.kind,
      expected: url.value,
      actual,
      note: null,
    }
  }
  const verdict = fullMatch(url.value, actual)
  return {
    field: 'url',
    outcome: verdict === 'bad-regex' ? 'unknown' : verdict,
    operator: url.kind,
    expected: url.value,
    actual,
    note: verdict === 'bad-regex' ? `Mock Knight could not read this regex: ${url.value}` : null,
  }
}

function describe(field: string, matcher: Matcher, actual: string | null): PredicateResult {
  const verdict = evaluate(matcher, actual)
  return {
    field,
    outcome: verdict.outcome,
    operator: matcher.operator,
    expected: stringify(matcher.value),
    actual,
    note: verdict.note ?? null,
  }
}

function summarise(predicates: readonly PredicateResult[]): string {
  const failures = predicates.filter((p) => p.outcome === 'fail')
  const unknowns = predicates.filter((p) => p.outcome === 'unknown')

  if (failures.length === 0) {
    if (unknowns.length > 0) {
      return `Every predicate Mock Knight could evaluate matches; ${unknowns.length} could not be checked.`
    }
    return 'Every predicate on this stub matches.'
  }
  if (failures.length === 1) {
    const only = failures[0]!
    // Naming the *kind* of thing that differs reads better than the raw field path, and this
    // sentence is the one most developers will read instead of the table below it.
    if (only.field.startsWith('headers.')) {
      return `Closest stub differs on one header: ${only.field.slice('headers.'.length)}`
    }
    if (only.field.startsWith('queryParameters.')) {
      return `Closest stub differs on one query parameter: ${only.field.slice('queryParameters.'.length)}`
    }
    if (only.field.startsWith('body')) return 'Closest stub differs on the request body.'
    return `Closest stub differs on the ${only.field}.`
  }
  return `Differs on ${failures.length} predicates: ${failures.map((f) => f.field).join(', ')}`
}

export function explainMatch(matcher: RequestMatcher, request: LoggedRequest): MatchExplanation {
  const predicates: PredicateResult[] = []

  if (matcher.method !== null) {
    predicates.push({
      field: 'method',
      outcome: matcher.method.toUpperCase() === request.method.toUpperCase() ? 'pass' : 'fail',
      operator: 'equalTo',
      expected: matcher.method,
      actual: request.method,
      note: null,
    })
  }

  const url = urlPredicate(matcher, request)
  if (url !== null) predicates.push(url)

  for (const [name, matchers] of Object.entries(matcher.headers)) {
    for (const entry of matchers) {
      predicates.push(describe(`headers.${name}`, entry, headerValue(request, name)))
    }
  }

  for (const [name, matchers] of Object.entries(matcher.queryParameters)) {
    const values = request.queryParameters[name]
    for (const entry of matchers) {
      predicates.push(describe(`queryParameters.${name}`, entry, values?.[0] ?? null))
    }
  }

  for (const [name, matchers] of Object.entries(matcher.cookies)) {
    for (const entry of matchers) {
      predicates.push(describe(`cookies.${name}`, entry, request.cookies[name] ?? null))
    }
  }

  matcher.bodyPatterns.forEach((entry, index) => {
    const field = matcher.bodyPatterns.length === 1 ? 'body' : `body[${index}]`
    predicates.push(describe(field, entry, request.body))
  })

  return {
    predicates,
    mismatchCount: predicates.filter((p) => p.outcome === 'fail').length,
    unknownCount: predicates.filter((p) => p.outcome === 'unknown').length,
    summary: summarise(predicates),
  }
}
