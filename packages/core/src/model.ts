import { z } from 'zod'
import type { Json } from './types.js'

/**
 * The canonical domain model — PRD §7.
 *
 * It is deliberately thin. The rule that keeps it thin is PRD §14's design pressure: a field
 * that cannot be expressed for at least two backends is suspect, because the failure mode for
 * this project is the model quietly becoming "WireMock's JSON with different names".
 *
 * Anything a backend expresses that this model does not is preserved verbatim in `raw`, and
 * `toVendor` patches `raw` rather than rebuilding it (CLAUDE.md invariant 3). Every schema here
 * is therefore permissive about what it does *not* model and strict about what it does.
 *
 * Browser-safe: no `node:` imports.
 */

export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
)

export const jsonObjectSchema = z.record(z.string(), jsonSchema)

/**
 * One predicate, kept as an open `operator` string rather than an enum.
 *
 * WireMock alone ships a dozen operators and adds more between minors; MockServer and Hoverfly
 * name theirs differently again. Closing this to an enum would mean an unrecognised matcher
 * either crashes the parse or is silently dropped, and dropping is the worst bug this app can
 * have. Unknown operators round-trip and the UI renders them read-only.
 */
export const matcherSchema = z.object({
  operator: z.string().min(1),
  value: jsonSchema.nullable().default(null),
  /** Operator-specific knobs (ignoreArrayOrder, caseInsensitive, expression, …), preserved. */
  options: jsonObjectSchema.default({}),
})
export type Matcher = z.infer<typeof matcherSchema>

export const URL_MATCH_KINDS = ['url', 'urlPattern', 'urlPath', 'urlPathPattern'] as const
export const urlMatchKindSchema = z.enum(URL_MATCH_KINDS)
export type UrlMatchKind = (typeof URL_MATCH_KINDS)[number]

export const urlMatchSchema = z.object({
  kind: urlMatchKindSchema,
  value: z.string(),
})
export type UrlMatch = z.infer<typeof urlMatchSchema>

export const requestMatcherSchema = z.object({
  /** `null` means the stub matches any method. */
  method: z.string().nullable().default(null),
  url: urlMatchSchema.nullable().default(null),
  headers: z.record(z.string(), z.array(matcherSchema)).default({}),
  queryParameters: z.record(z.string(), z.array(matcherSchema)).default({}),
  cookies: z.record(z.string(), z.array(matcherSchema)).default({}),
  bodyPatterns: z.array(matcherSchema).default([]),
})
export type RequestMatcher = z.infer<typeof requestMatcherSchema>

export const RESPONSE_BODY_KINDS = ['none', 'text', 'json', 'base64', 'file'] as const
export const responseBodyKindSchema = z.enum(RESPONSE_BODY_KINDS)
export type ResponseBodyKind = (typeof RESPONSE_BODY_KINDS)[number]

export const responseBodySchema = z.object({
  kind: responseBodyKindSchema,
  /** Text for `text`/`base64`, the parsed document for `json`, the filename for `file`. */
  value: jsonSchema.nullable().default(null),
})
export type ResponseBody = z.infer<typeof responseBodySchema>

export const responseDelaySchema = z.object({
  /** Open string for the same reason as `Matcher.operator`: backends disagree on the vocabulary. */
  kind: z.string().min(1),
  milliseconds: z.number().nullable().default(null),
  options: jsonObjectSchema.default({}),
})
export type ResponseDelay = z.infer<typeof responseDelaySchema>

export const proxySpecSchema = z.object({
  baseUrl: z.string(),
  additionalHeaders: z.record(z.string(), z.string()).default({}),
})
export type ProxySpec = z.infer<typeof proxySpecSchema>

export const responseSpecSchema = z.object({
  status: z.number().int().nullable().default(null),
  statusMessage: z.string().nullable().default(null),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
  body: responseBodySchema.default({ kind: 'none', value: null }),
  delay: responseDelaySchema.nullable().default(null),
  /** Connection-level fault injection; the vendor's own name for it, preserved. */
  fault: z.string().nullable().default(null),
  proxy: proxySpecSchema.nullable().default(null),
  transformers: z.array(z.string()).default([]),
})
export type ResponseSpec = z.infer<typeof responseSpecSchema>

export const stateBindingSchema = z.object({
  scenario: z.string(),
  requiredState: z.string().nullable().default(null),
  newState: z.string().nullable().default(null),
})
export type StateBinding = z.infer<typeof stateBindingSchema>

/** The key Mock Knight namespaces its own metadata under, so a round-trip preserves it. */
export const MOCK_KNIGHT_METADATA_KEY = 'mock-knight'

export const mockKnightMetadataSchema = z.object({
  folder: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  notes: z.string().nullable().default(null),
  owner: z.string().nullable().default(null),
})
export type MockKnightMetadata = z.infer<typeof mockKnightMetadataSchema>

export const mockSchema = z.object({
  /** Server-assigned where the backend has one. Never key the UI on this — see `clientKey`. */
  id: z.string().nullable(),
  /** `id ?? hash(canonical(raw))`. The only identity the UI is allowed to use. */
  clientKey: z.string().min(1),
  name: z.string().nullable(),
  /** Derived: metadata, else file path, else URL-prefix clustering. */
  folder: z.array(z.string()),
  /**
   * Where `folder` came from. A folder the server stated and one Mock Knight guessed from a URL
   * are different strengths of claim, and design brief §7.4 forbids rendering them alike — so
   * the provenance travels with the value rather than being re-derived at render time.
   */
  folderSource: z.enum(['metadata', 'path', 'none']),
  tags: z.array(z.string()),
  /** `null` where the backend has no concept of a disabled stub — WireMock Java, for one. */
  enabled: z.boolean().nullable(),
  priority: z.number().int().nullable(),
  request: requestMatcherSchema,
  response: responseSpecSchema,
  state: stateBindingSchema.nullable(),
  metadata: jsonObjectSchema,
  /** The verbatim vendor payload. Never rebuilt, only patched. */
  raw: jsonObjectSchema,
  contentHash: z.string().min(1),
})
export type Mock = z.infer<typeof mockSchema>

/** What a caller supplies to create or update a stub: no server id, no hash yet. */
export const mockDraftSchema = mockSchema.omit({
  id: true,
  clientKey: true,
  contentHash: true,
  folderSource: true,
})
export type MockDraft = z.infer<typeof mockDraftSchema>

export const loggedRequestSchema = z.object({
  method: z.string(),
  url: z.string(),
  absoluteUrl: z.string().nullable().default(null),
  clientIp: z.string().nullable().default(null),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
  cookies: z.record(z.string(), z.string()).default({}),
  queryParameters: z.record(z.string(), z.array(z.string())).default({}),
  body: z.string().nullable().default(null),
  bodyTruncated: z.boolean().default(false),
})
export type LoggedRequest = z.infer<typeof loggedRequestSchema>

export const loggedResponseSchema = z.object({
  status: z.number().int(),
  headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
  body: z.string().nullable().default(null),
  bodyTruncated: z.boolean().default(false),
})
export type LoggedResponse = z.infer<typeof loggedResponseSchema>

/**
 * Three outcomes, not two.
 *
 * `unknown` is the honest answer for a matcher we cannot evaluate — an operator we do not
 * implement, a JSONPath too complex for our reader, a regex whose Java semantics differ from
 * JavaScript's. Collapsing that into `pass` would quietly assert something false in the one
 * screen whose whole job is telling a developer the truth about why a request did not match.
 */
export const PREDICATE_OUTCOMES = ['pass', 'fail', 'unknown'] as const
export const predicateOutcomeSchema = z.enum(PREDICATE_OUTCOMES)
export type PredicateOutcome = (typeof PREDICATE_OUTCOMES)[number]

export const predicateResultSchema = z.object({
  /** Dotted field path: `url`, `method`, `headers.x-tenant`, `body`. Drives the §6.4 table. */
  field: z.string(),
  outcome: predicateOutcomeSchema,
  expected: z.string().nullable().default(null),
  actual: z.string().nullable().default(null),
  operator: z.string().nullable().default(null),
  /** Why we could not decide. Present only when `outcome` is `unknown`. */
  note: z.string().nullable().default(null),
})
export type PredicateResult = z.infer<typeof predicateResultSchema>

/**
 * Where a near miss came from. The match explainer must look different for a server-computed
 * result and one Mock Knight worked out itself (design brief §7.4) — so the provenance travels
 * with the data rather than being decided at render time.
 */
export const PROVENANCE = ['server', 'inferred'] as const
export const provenanceSchema = z.enum(PROVENANCE)
export type Provenance = (typeof PROVENANCE)[number]

export const nearMissSchema = z.object({
  clientKey: z.string().nullable(),
  stubName: z.string().nullable().default(null),
  /** 0 = identical. Rendered as a bar, never as a number (design brief §6.4 rule 4). */
  distance: z.number(),
  mismatchCount: z.number().int().nonnegative(),
  /** How many predicates we could not evaluate — surfaced, never hidden. */
  unknownCount: z.number().int().nonnegative().default(0),
  predicates: z.array(predicateResultSchema),
  /**
   * Where the *candidate and its ranking* came from. On WireMock this is `server`: it selects
   * the near misses and scores the distance.
   */
  provenance: provenanceSchema,
  /**
   * Where the *per-field table* came from — separately, because on WireMock they differ.
   * `matchResult` carries only a scalar distance; `diffDescriptions` is empty in every response
   * observed (§17.20), so the field-by-field breakdown is always Mock Knight's own work even
   * when the ranking beside it is the server's. One provenance flag for both would have to lie
   * about one of them.
   */
  predicateProvenance: provenanceSchema,
})
export type NearMiss = z.infer<typeof nearMissSchema>

/**
 * How long the server took, and how much of that it was told to take.
 *
 * Both, because reporting only the total is misleading on the one tool where a slow response is
 * usually deliberate: a 2,000ms mock is not a performance problem when 2,000ms of it is the
 * fixed delay someone configured. `addedDelayMs` is what lets the UI say so.
 */
export const serveTimingSchema = z.object({
  totalMs: z.number().nullable().default(null),
  addedDelayMs: z.number().nullable().default(null),
})
export type ServeTiming = z.infer<typeof serveTimingSchema>

export const serveEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  /** `null` where the backend does not report it; never a fabricated zero. */
  timing: serveTimingSchema.nullable().default(null),
  request: loggedRequestSchema,
  response: loggedResponseSchema.nullable(),
  matched: z.boolean(),
  /** `clientKey` of the serving stub — null when the backend offers no attribution. */
  matchedClientKey: z.string().nullable(),
  correlation: z.string().nullable().default(null),
  nearMisses: z.array(nearMissSchema).nullable().default(null),
  raw: jsonObjectSchema,
})
export type ServeEvent = z.infer<typeof serveEventSchema>

export const scenarioSchema = z.object({
  name: z.string(),
  currentState: z.string(),
  possibleStates: z.array(z.string()),
})
export type Scenario = z.infer<typeof scenarioSchema>

export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}
