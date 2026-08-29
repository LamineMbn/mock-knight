import { setKey } from './set-key.js'
import type { Json, JsonObject } from './types.js'

/**
 * What a redacted value is replaced by, everywhere.
 *
 * One constant rather than several literals, because the journal redacts a header in more than
 * one place — the canonical `request.headers` and the retained vendor `raw` — and a reader
 * comparing them has to see the same marker or conclude one of them leaked.
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
 * **Two passes, because a header value does not only live under a header key.**
 *
 * *Pass one* is a generic walk keyed on any object key literally named `headers`, and it is
 * deliberately not per-adapter: an adapter-contract method would be more precise and would
 * silently store secrets the first time a new backend forgot to implement it. Three encodings
 * occur in practice, all under that key:
 *
 *  - WireMock — `{ "X-Api-Key": "secret" }`, occasionally `{ "X-Api-Key": { values: [...] } }`
 *  - MockServer — `{ "X-Api-Key": ["secret"] }`
 *  - Mockoon — `[{ key: "x-api-key", value: "secret" }]`
 *
 * Anything else found under that key is replaced whole. Over-redaction shows someone a marker
 * where a header used to be; under-redaction writes their credential to disk.
 *
 * *Pass two* takes the values pass one actually replaced and scrubs them out of every string in
 * the payload, by substring. WireMock's near-miss diff (`subEvents[].data.report`) quotes the
 * request's header value inline in a free-text table — `X-Api-Key: secret … <<<<< Header does
 * not match` — and that is the unmatched path, the one a developer debugging a 404 hits most.
 * No key-scoped walk can reach it.
 *
 * **The over-redaction in pass two is intended, not tolerated.** A value declared sensitive is
 * scrubbed everywhere it appears, whatever it happens to be embedded in; a near-miss report
 * with a marker in the middle of a sentence is correct output, not a bug to file. There is
 * deliberately no minimum-length guard to stop a short value mangling prose — a guard like that
 * is a hole, and a hole is the thing being closed here.
 *
 * Only values redacted *because their name matched* are collected. A container pass one could
 * not parse is scrubbed in place but never propagated: we do not know it was the configured
 * header, and substituting an unrelated `* / *` across the payload helps nobody.
 *
 * Pure: the input is never mutated. Browser-safe: no `node:` imports.
 */
export function redactRawHeaders(raw: JsonObject, names: readonly string[]): JsonObject {
  // Nothing configured means nothing to guess at, so the fail-safe rules below stay dormant and
  // `raw` is returned exactly as the server sent it.
  if (names.length === 0) return raw

  const wanted = new Set(names.map((name) => name.toLowerCase()))
  const secrets = new Set<string>()
  const scoped = walkObject(raw, wanted, secrets)
  if (secrets.size === 0) return scoped

  // Longest first: a short value must not fragment a longer one that contains it before the
  // longer one has had its turn.
  const ordered = [...secrets].sort((a, b) => b.length - a.length)
  return scrubObject(scoped, ordered)
}

/** Field names an entry-per-header list uses for the header's name. Mockoon writes `key`. */
const NAME_FIELDS = ['key', 'name', 'header', 'headerName'] as const

function isObject(value: Json): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ── Pass one: the scoped walk ───────────────────────────────────────────────────────────────

function walkObject(value: JsonObject, wanted: ReadonlySet<string>, secrets: Set<string>) {
  const out: JsonObject = {}
  for (const [key, child] of Object.entries(value)) {
    // setKey: a payload whose own key is `__proto__` must land as a property, not as a
    // prototype — see set-key.ts.
    setKey(
      out,
      key,
      key.toLowerCase() === 'headers'
        ? redactContainer(child, wanted, secrets)
        : walk(child, wanted, secrets),
    )
  }
  return out
}

function walk(value: Json, wanted: ReadonlySet<string>, secrets: Set<string>): Json {
  if (Array.isArray(value)) return value.map((item) => walk(item, wanted, secrets))
  if (isObject(value)) return walkObject(value, wanted, secrets)
  return value
}

/** The value of a key named `headers`, whatever shape this backend chose for it. */
function redactContainer(value: Json, wanted: ReadonlySet<string>, secrets: Set<string>): Json {
  if (Array.isArray(value)) return value.map((entry) => redactEntry(entry, wanted, secrets))
  if (isObject(value)) {
    const out: JsonObject = {}
    for (const [name, child] of Object.entries(value)) {
      setKey(
        out,
        name,
        wanted.has(name.toLowerCase()) ? marker(child, secrets) : walk(child, wanted, secrets),
      )
    }
    return out
  }
  // Neither a map nor a list: there is no way to tell a header name from a header value here,
  // so the whole thing goes — and nothing is collected from it, because nothing in it has been
  // shown to be the configured header.
  return REDACTION_MARKER
}

/** One element of a `headers` list — Mockoon's `{ key, value }` and anything resembling it. */
function redactEntry(entry: Json, wanted: ReadonlySet<string>, secrets: Set<string>): Json {
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

  if (!wanted.has(named.toLowerCase())) return walkObject(entry, wanted, secrets)

  const out: JsonObject = {}
  for (const [key, child] of Object.entries(entry)) {
    // The name stays: "X-Api-Key: «redacted»" is the useful thing to show. Every other field of
    // the entry is a candidate for holding the value, so every other field goes.
    setKey(out, key, key === field ? child : marker(child, secrets))
  }
  return out
}

/**
 * Redact a header value, keeping a list a list, and remember what was in it.
 *
 * MockServer's headers are `{ name: [value] }` and the explainer parses them back out of `raw`;
 * collapsing that array to a string would change the shape of a payload for readers that have
 * nothing to do with the secret.
 */
function marker(value: Json, secrets: Set<string>): Json {
  collect(value, secrets)
  return Array.isArray(value) ? value.map(() => REDACTION_MARKER) : REDACTION_MARKER
}

function collect(value: Json, secrets: Set<string>): void {
  if (typeof value === 'string') {
    // An empty or blank value substitutes into every string in the payload; and the marker is
    // what pass one has just written, so re-substituting it is a scan that can only corrupt.
    if (value.trim() === '' || value === REDACTION_MARKER) return
    secrets.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, secrets)
    return
  }
  if (isObject(value)) {
    for (const item of Object.values(value)) collect(item, secrets)
  }
}

// ── Pass two: the value sweep ───────────────────────────────────────────────────────────────

function scrubObject(value: JsonObject, secrets: readonly string[]): JsonObject {
  const out: JsonObject = {}
  for (const [key, child] of Object.entries(value)) setKey(out, key, scrub(child, secrets))
  return out
}

function scrub(value: Json, secrets: readonly string[]): Json {
  if (typeof value === 'string') {
    let out = value
    // split/join rather than a regex: the value is arbitrary text and escaping it for a pattern
    // is a way to get this subtly wrong.
    for (const secret of secrets) {
      if (out.includes(secret)) out = out.split(secret).join(REDACTION_MARKER)
    }
    return out
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item, secrets))
  if (isObject(value)) return scrubObject(value, secrets)
  return value
}
