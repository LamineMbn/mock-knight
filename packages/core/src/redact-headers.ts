import { setKey } from './set-key.js'
import type { Json, JsonObject } from './types.js'

/**
 * What a redacted value is replaced by, everywhere.
 *
 * One constant rather than several literals, because a journal entry is redacted in more than
 * one place — the canonical record, the retained vendor payload, and the columns derived from
 * both — and a reader comparing them has to see the same marker or conclude one of them leaked.
 */
export const REDACTION_MARKER = '«redacted»'

/**
 * How deep the walk will go before it gives up and replaces the subtree.
 *
 * `JSON.parse` accepts far deeper nesting than a recursive walk survives, and MockServer stores
 * request bodies as parsed JSON — so a hostile or merely silly body could put a `RangeError`
 * inside `db.transaction` and leave the Traffic screen dead for that profile until the upstream
 * journal was cleared. Past the limit the subtree becomes a marker: unreadable beats both
 * throwing and passing through.
 */
const MAX_DEPTH = 400

export interface PayloadRedaction {
  /** The payload, with every declared header value replaced. */
  readonly payload: JsonObject
  /**
   * The values that were replaced, longest first — so that anything else derived from the same
   * event (a URL, a correlation id, a column) can be run through `scrubSecrets` and land in the
   * database already redacted.
   */
  readonly values: readonly string[]
}

/**
 * Strip configured request headers, and their values, out of a retained vendor payload.
 *
 * `raw` is the mock server's own JSON, kept verbatim so the match explainer and
 * create-from-request have the server's own words to work from (invariant 3). That makes it the
 * place a secret survives redaction of the canonical model — and the mirror must not become a
 * secret store.
 *
 * **The input must be parsed JSON.** It is walked recursively with no cycle detection, so a
 * hand-built object containing a reference to itself will not terminate. Anything that came out
 * of `JSON.parse` or off an adapter is by construction a tree.
 *
 * ## Pass one — the scoped walk
 *
 * Generic and keyed on the container name, deliberately not per-adapter: an adapter-contract
 * method would be more precise and would silently store secrets the first time a new backend
 * forgot to implement it. Two key names are containers, both case-insensitively:
 *
 *  - **`headers`** — `{ "X-Api-Key": "secret" }` (WireMock), `{ "X-Api-Key": ["secret"] }`
 *    (MockServer), `[{ key: "x-api-key", value: "secret" }]` (Mockoon), and WireMock's
 *    occasional `{ "X-Api-Key": { values: [...] } }`.
 *  - **`cookies`** — the `Cookie` header decomposed, and a *sibling* of `headers` rather than a
 *    child of it. Both WireMock (`request.cookies`) and MockServer (`httpRequest.cookies`) write
 *    it. Declaring `Cookie` sensitive and leaving `{ "sid": "secret" }` beside it was a leak
 *    reachable with one curl and one line of config.
 *
 * Anything else found under either key is replaced whole. Over-redaction shows someone a marker
 * where a header used to be; under-redaction writes their credential to disk.
 *
 * ## Pass two — the value sweep
 *
 * Pass one keeps the values it replaced; pass two substitutes them out of every *other* string
 * in the payload. It exists because a header value does not only live under a header key:
 * WireMock's near-miss diff (`subEvents[].data.report`) quotes it inline in a free-text table,
 * on the unmatched path — the one the match explainer exists for and the one a developer
 * debugging a 404 hits most. A `body` repeats it, a `url` repeats it, and `bodyAsBase64` repeats
 * it in a form no substring search can see (`encodesSecret`).
 *
 * **The sweep is blunt on purpose.** A value declared sensitive is replaced everywhere it
 * occurs, whatever text it is embedded in, and there is deliberately no minimum-length guard to
 * protect prose — a guard like that is a hole, and a hole is what this closes. A near-miss
 * report reading `«redacted»` mid-sentence is correct output.
 *
 * Both passes read the *original* payload; pass one's markers are written by the second walk
 * rather than swept by it, so a declared value that happens to be a substring of the marker
 * cannot rewrite the markers themselves.
 *
 * Pure: the input is never mutated. Browser-safe: no `node:` imports, no `atob`.
 */
export function redactRawHeaders(raw: JsonObject, names: readonly string[]): PayloadRedaction {
  // Nothing configured means nothing to guess at, so the fail-safe rules below stay dormant and
  // `raw` is returned exactly as the server sent it.
  if (names.length === 0) return { payload: raw, values: [] }

  const wanted = new Set(names.map((name) => name.toLowerCase()))
  const found = new Set<string>()
  collectObject(raw, wanted, found, 0)

  // Longest first: a short value must not fragment a longer one that contains it before the
  // longer one has had its turn.
  const values = [...found].sort((a, b) => b.length - a.length)
  return { payload: renderObject(raw, wanted, prepareSecrets(values), 0), values }
}

/** Field names an entry-per-header list uses for the header's name. Mockoon writes `key`. */
const NAME_FIELDS = ['key', 'name', 'header', 'headerName'] as const

/** `cookies` is the `Cookie` header decomposed, so the name that governs it is `cookie`. */
type Container = 'headers' | 'cookies'

function containerOf(key: string): Container | null {
  const lower = key.toLowerCase()
  return lower === 'headers' ? 'headers' : lower === 'cookies' ? 'cookies' : null
}

/** Is this entry of a container one the profile declared sensitive? */
function declared(container: Container, name: string, wanted: ReadonlySet<string>): boolean {
  // Every cookie is part of the `Cookie` header's value, so declaring that header covers all of
  // them. A cookie whose own name matches a declared header is covered too.
  if (container === 'cookies' && wanted.has('cookie')) return true
  return wanted.has(name.toLowerCase())
}

function isObject(value: Json): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ── Pass one, part one: what are we replacing? ───────────────────────────────────────────────

function collectObject(
  value: JsonObject,
  wanted: ReadonlySet<string>,
  found: Set<string>,
  depth: number,
): void {
  if (depth >= MAX_DEPTH) return
  for (const [key, child] of Object.entries(value)) {
    const container = containerOf(key)
    if (container === null) collect(child, wanted, found, depth + 1)
    else collectContainer(child, container, wanted, found, depth + 1)
  }
}

function collect(
  value: Json,
  wanted: ReadonlySet<string>,
  found: Set<string>,
  depth: number,
): void {
  if (depth >= MAX_DEPTH) return
  if (Array.isArray(value)) {
    for (const item of value) collect(item, wanted, found, depth + 1)
    return
  }
  if (isObject(value)) collectObject(value, wanted, found, depth)
}

function collectContainer(
  value: Json,
  container: Container,
  wanted: ReadonlySet<string>,
  found: Set<string>,
  depth: number,
): void {
  if (depth >= MAX_DEPTH) return
  if (Array.isArray(value)) {
    for (const entry of value) {
      const named = entryName(entry)
      // A container entry with no readable name is scrubbed in place but never propagated:
      // nothing in it has been shown to be the configured header, and sweeping an unrelated
      // `*/*` across the whole payload helps nobody.
      if (named === null || !isObject(entry)) continue
      if (!declared(container, named.name, wanted)) {
        collectObject(entry, wanted, found, depth)
        continue
      }
      for (const [key, child] of Object.entries(entry)) {
        if (key !== named.field) harvest(child, named.name, found, depth)
      }
    }
    return
  }
  if (isObject(value)) {
    for (const [name, child] of Object.entries(value)) {
      if (declared(container, name, wanted)) harvest(child, name, found, depth)
      else collect(child, wanted, found, depth)
    }
  }
}

/** Every string inside a value we are about to replace becomes something to sweep for. */
function harvest(value: Json, name: string, found: Set<string>, depth: number): void {
  if (depth >= MAX_DEPTH) return
  if (typeof value === 'string') {
    remember(value, found)
    // A `Cookie` header's value is a list of `name=value` pairs, and it is the individual value
    // that a near-miss report or a log line quotes — the whole header string never appears
    // there. Same blank/marker guards as anything else.
    if (name.toLowerCase() === 'cookie') {
      for (const pair of value.split(';')) {
        const at = pair.indexOf('=')
        if (at !== -1) remember(pair.slice(at + 1).trim(), found)
      }
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) harvest(item, name, found, depth + 1)
    return
  }
  if (isObject(value)) {
    for (const item of Object.values(value)) harvest(item, name, found, depth + 1)
  }
}

function remember(value: string, found: Set<string>): void {
  // An empty or blank value substitutes into every string in the payload; and the marker is what
  // pass one writes, so treating it as a secret is a scan that can only corrupt.
  if (value.trim() === '' || value === REDACTION_MARKER) return
  found.add(value)
}

// ── Pass one, part two, and pass two: build the redacted payload ─────────────────────────────

function renderObject(
  value: JsonObject,
  wanted: ReadonlySet<string>,
  secrets: Secrets,
  depth: number,
): JsonObject {
  if (depth >= MAX_DEPTH) return {}
  const out: JsonObject = {}
  for (const [key, child] of Object.entries(value)) {
    const container = containerOf(key)
    // setKey: a payload whose own key is `__proto__` must land as a property, not as a
    // prototype — see set-key.ts.
    setKey(
      out,
      key,
      container === null
        ? render(child, wanted, secrets, depth + 1)
        : renderContainer(child, container, wanted, secrets, depth + 1),
    )
  }
  return out
}

function render(value: Json, wanted: ReadonlySet<string>, secrets: Secrets, depth: number): Json {
  if (depth >= MAX_DEPTH) return REDACTION_MARKER
  if (typeof value === 'string') return scrubWith(value, secrets)
  if (Array.isArray(value)) return value.map((item) => render(item, wanted, secrets, depth + 1))
  if (isObject(value)) return renderObject(value, wanted, secrets, depth)
  return value
}

function renderContainer(
  value: Json,
  container: Container,
  wanted: ReadonlySet<string>,
  secrets: Secrets,
  depth: number,
): Json {
  if (depth >= MAX_DEPTH) return REDACTION_MARKER
  if (Array.isArray(value))
    return value.map((entry) => renderEntry(entry, container, wanted, secrets, depth + 1))
  if (isObject(value)) {
    const out: JsonObject = {}
    for (const [name, child] of Object.entries(value)) {
      setKey(
        out,
        name,
        declared(container, name, wanted)
          ? marker(child)
          : render(child, wanted, secrets, depth + 1),
      )
    }
    return out
  }
  // Neither a map nor a list: there is no way to tell a name from a value here, so the whole
  // thing goes.
  return REDACTION_MARKER
}

function renderEntry(
  entry: Json,
  container: Container,
  wanted: ReadonlySet<string>,
  secrets: Secrets,
  depth: number,
): Json {
  const named = entryName(entry)
  // An entry we cannot read a name from could be the configured header, and we would never know.
  if (named === null || !isObject(entry)) return REDACTION_MARKER
  if (!declared(container, named.name, wanted)) return renderObject(entry, wanted, secrets, depth)

  const out: JsonObject = {}
  for (const [key, child] of Object.entries(entry)) {
    // The name stays: "X-Api-Key: «redacted»" is the useful thing to show. Every other field of
    // the entry is a candidate for holding the value, so every other field goes.
    setKey(out, key, key === named.field ? child : marker(child))
  }
  return out
}

function entryName(entry: Json): { field: string; name: string } | null {
  if (!isObject(entry)) return null
  for (const field of NAME_FIELDS) {
    const value = entry[field]
    if (typeof value === 'string') return { field, name: value }
  }
  return null
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

// ── The sweep ────────────────────────────────────────────────────────────────────────────────

interface Secrets {
  /** Forms to look for in the text itself, longest first. */
  readonly literals: readonly string[]
  /** Forms to look for once a base64 blob has been decoded. */
  readonly binary: readonly string[]
}

function prepareSecrets(values: readonly string[]): Secrets {
  const literals = new Set<string>()
  const binary = new Set<string>()
  for (const value of values) {
    literals.add(value)
    // A query string carries the value percent-encoded. Adding the encoded form as another
    // literal keeps the surrounding URL readable, which replacing the whole string would not.
    // Only this one encoding is covered: an encoder that differs (a `+` for a space, say) is
    // not, and a caller who needs that should declare the encoded value too.
    literals.add(encodeURIComponent(value))
    binary.add(value)
    binary.add(toUtf8Latin1(value))
  }
  return {
    literals: [...literals].filter((v) => v !== '').sort((a, b) => b.length - a.length),
    binary: [...binary].filter((v) => v !== ''),
  }
}

/**
 * Replace every declared value in one string.
 *
 * Exported so the server can put a URL, a correlation id, or anything else derived from the same
 * event through the identical treatment before it becomes a column.
 */
export function scrubSecrets(text: string, values: readonly string[]): string {
  if (values.length === 0) return text
  return scrubWith(text, prepareSecrets(values))
}

function scrubWith(text: string, secrets: Secrets): string {
  // A blob that encodes a secret cannot also contain it in the clear, so this is checked first
  // and answers the whole string.
  if (encodesSecret(text, secrets)) return REDACTION_MARKER
  let out = text
  for (const secret of secrets.literals) {
    // split/join rather than a regex: the value is arbitrary text and escaping it for a pattern
    // is a way to get this subtly wrong.
    if (out.includes(secret)) out = out.split(secret).join(REDACTION_MARKER)
  }
  return out
}

const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/

/**
 * Does this string decode, as base64, to something holding a declared value?
 *
 * WireMock writes `bodyAsBase64` beside every `body` and MockServer writes `body.rawBytes`
 * beside `body.json`, so a scrubbed body ships with an unscrubbed twin one decode away — a
 * stored row that passes a plaintext grep while still holding the secret.
 *
 * The whole string is replaced rather than spliced. base64 encodes in three-byte groups, so the
 * encoding of a substring depends on its offset and a splice would have to cover all three
 * alignments to be sure of itself; replacing the blob is simpler, provably complete, and
 * consistent with the over-redaction the sweep already accepts.
 */
function encodesSecret(text: string, secrets: Secrets): boolean {
  // Cheap rejections first: this runs against every string in the payload, including bodies
  // measured in megabytes, and the regex fails on the first character a body actually contains.
  if (text.length < 8 || text.length % 4 === 1 || !BASE64.test(text)) return false
  const decoded = decodeBase64(text)
  if (decoded === null) return false
  return secrets.binary.some((secret) => decoded.includes(secret))
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * base64 → the decoded bytes as a Latin-1 string, or `null` if it is not base64 after all.
 *
 * Hand-rolled because `atob` is a host global that `core`'s ES2023 lib does not declare, and
 * this module has to stay browser-safe without reaching for `node:buffer`.
 */
function decodeBase64(text: string): string | null {
  let bits = 0
  let width = 0
  let out = ''
  for (const character of text) {
    if (character === '=') break
    // base64url is the same alphabet with two characters swapped.
    const value = ALPHABET.indexOf(character === '-' ? '+' : character === '_' ? '/' : character)
    if (value === -1) return null
    bits = (bits << 6) | value
    width += 6
    if (width >= 8) {
      width -= 8
      out += String.fromCharCode((bits >> width) & 0xff)
    }
  }
  return out
}

/** A string's UTF-8 bytes, as a Latin-1 string, so it can be searched for in a decoded blob. */
function toUtf8Latin1(value: string): string {
  let out = ''
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0
    if (point < 0x80) out += character
    else if (point < 0x800) out += String.fromCharCode(0xc0 | (point >> 6), 0x80 | (point & 0x3f))
    else if (point < 0x10000)
      out += String.fromCharCode(
        0xe0 | (point >> 12),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      )
    else
      out += String.fromCharCode(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      )
  }
  return out
}
