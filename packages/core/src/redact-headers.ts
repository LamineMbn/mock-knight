import { setKey } from './set-key.js'
import type { Json, JsonObject } from './types.js'

/**
 * What a redacted value is replaced by, everywhere.
 *
 * One constant rather than two literals, because the journal redacts a header in two places —
 * the canonical `request.headers` and the retained vendor `raw` — and a reader comparing them
 * has to see the same marker or conclude one of them leaked.
 */
export const REDACTION_MARKER = '«redacted»'

/**
 * Strip configured request headers out of a retained vendor payload.
 *
 * `raw` is the mock server's own JSON, kept verbatim so the match explainer and
 * create-from-request have the server's own words to work from (invariant 3). That makes it the
 * one place a secret survives redaction of the canonical model — and the mirror must not become
 * a secret store.
 *
 * The walk is deliberately generic rather than per-adapter. An adapter-contract method would be
 * more precise and would silently store secrets the first time a new backend forgot to implement
 * it; keying on `headers` costs nothing and covers a backend nobody has written yet.
 *
 * Three shapes occur in practice, all under a key literally named `headers`:
 *
 *  - WireMock — `{ "X-Api-Key": "secret" }`, occasionally `{ "X-Api-Key": { values: [...] } }`
 *  - MockServer — `{ "X-Api-Key": ["secret"] }`
 *  - Mockoon — `[{ key: "x-api-key", value: "secret" }]`
 *
 * Anything else found under that key is replaced whole. Over-redaction shows someone a marker
 * where a header used to be; under-redaction writes their credential to disk.
 *
 * Pure: the input is never mutated. Browser-safe: no `node:` imports.
 */
export function redactRawHeaders(raw: JsonObject, names: readonly string[]): JsonObject {
  // Nothing configured means nothing to guess at, so the fail-safe rules below stay dormant and
  // `raw` is returned exactly as the server sent it.
  if (names.length === 0) return raw
  return walkObject(raw, new Set(names.map((name) => name.toLowerCase())))
}

/** Field names an entry-per-header list uses for the header's name. Mockoon writes `key`. */
const NAME_FIELDS = ['key', 'name', 'header', 'headerName'] as const

function isObject(value: Json): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function walkObject(value: JsonObject, wanted: ReadonlySet<string>): JsonObject {
  const out: JsonObject = {}
  for (const [key, child] of Object.entries(value)) {
    // setKey: a payload whose own key is `__proto__` must land as a property, not as a
    // prototype — see set-key.ts.
    setKey(
      out,
      key,
      key.toLowerCase() === 'headers' ? redactContainer(child, wanted) : walk(child, wanted),
    )
  }
  return out
}

function walk(value: Json, wanted: ReadonlySet<string>): Json {
  if (Array.isArray(value)) return value.map((item) => walk(item, wanted))
  if (isObject(value)) return walkObject(value, wanted)
  return value
}

/** The value of a key named `headers`, whatever shape this backend chose for it. */
function redactContainer(value: Json, wanted: ReadonlySet<string>): Json {
  if (Array.isArray(value)) return value.map((entry) => redactEntry(entry, wanted))
  if (isObject(value)) {
    const out: JsonObject = {}
    for (const [name, child] of Object.entries(value)) {
      setKey(out, name, wanted.has(name.toLowerCase()) ? marker(child) : walk(child, wanted))
    }
    return out
  }
  // Neither a map nor a list: there is no way to tell a header name from a header value here,
  // so the whole thing goes.
  return REDACTION_MARKER
}

/** One element of a `headers` list — Mockoon's `{ key, value }` and anything resembling it. */
function redactEntry(entry: Json, wanted: ReadonlySet<string>): Json {
  if (!isObject(entry)) return REDACTION_MARKER

  let field: string | null = null
  let named: string | null = null
  for (const candidate of NAME_FIELDS) {
    const value = entry[candidate]
    if (typeof value === 'string') {
      field = candidate
      named = value
      break
    }
  }
  // An entry we cannot read a name from could be the configured header, and we would never know.
  if (field === null || named === null) return REDACTION_MARKER

  if (!wanted.has(named.toLowerCase())) return walkObject(entry, wanted)

  const out: JsonObject = {}
  for (const [key, child] of Object.entries(entry)) {
    // The name stays: "X-Api-Key: «redacted»" is the useful thing to show. Every other field of
    // the entry is a candidate for holding the value, so every other field goes.
    setKey(out, key, key === field ? child : marker(child))
  }
  return out
}

/**
 * Redact a header value, keeping a list a list.
 *
 * MockServer's headers are `{ name: [value] }` and the explainer parses them back out of `raw`;
 * collapsing that array to a string would change the shape of a payload for readers that have
 * nothing to do with the secret.
 */
function marker(value: Json): Json {
  return Array.isArray(value) ? value.map(() => REDACTION_MARKER) : REDACTION_MARKER
}
