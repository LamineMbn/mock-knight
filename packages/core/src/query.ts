import { CAPABILITY_REGISTRY, type CapabilityBit, type CapabilitySet } from './capabilities.js'

/**
 * The search query language — TECH-DESIGN §11.
 *
 * Hand-written rather than generated, for one reason: it has to **degrade gracefully**. A
 * developer types into this box mid-debug, half-finished, with a stray colon in a path. A
 * generated parser's answer to that is a syntax error; the right answer is to search for what
 * they typed. So there are only three outcomes for any token, and none of them is "dropped":
 *
 *  - **applied**   — recognised field, usable value, capability on
 *  - **rejected**  — recognised field, but the backend cannot answer it. Named, never ignored:
 *                    a filter that silently does nothing is worse than an error.
 *  - **literal**   — everything else, searched as text
 *
 * The plan is returned alongside results so the UI can render exactly what was applied as pills
 * (design brief §6.2), which is what makes an empty result set explicable.
 *
 * Browser-safe: no `node:` imports. The BFF and the SPA parse with the same code.
 */

/**
 * `header:` is the eleventh token, added after TECH-DESIGN §11 was written — see amendment A6.
 * It exists because header-selected stubs are not a corner case: on a real corpus 90% of stubs
 * were distinguished only by one header, which made path search almost useless there.
 */
export const QUERY_FIELDS = [
  'method',
  'url',
  'status',
  'scenario',
  'tag',
  'body',
  'priority',
  'folder',
  'unused',
  'disabled',
  'header',
] as const
export type QueryField = (typeof QUERY_FIELDS)[number]

/**
 * The three tokens backed by data a backend can withhold.
 *
 * The rest are answered from columns the mirror always has, so they need no gate: `scenario`
 * is a field on the stub itself, not the scenario API, and `folder`/`tag` fall back to derived
 * values when the server stores no metadata.
 */
export const QUERY_FIELD_CAPABILITY = {
  unused: 'journal.read',
  disabled: 'mock.enableDisable',
  priority: 'mock.priority',
} as const satisfies Partial<Record<QueryField, CapabilityBit>>

export interface Span {
  readonly start: number
  readonly end: number
}

export type StringOp = 'eq' | 'contains' | 'glob'
export type NumberOp = 'eq' | 'lt' | 'lte' | 'gt' | 'gte'

export type QueryFilter =
  | { readonly field: 'method'; readonly op: 'eq'; readonly value: string; readonly span: Span }
  | {
      readonly field: 'url' | 'body' | 'scenario' | 'tag' | 'folder'
      readonly op: StringOp
      readonly value: string
      readonly span: Span
    }
  | {
      readonly field: 'status'
      readonly op: 'eq' | 'class'
      readonly value: number
      readonly span: Span
    }
  | {
      readonly field: 'priority'
      readonly op: NumberOp
      readonly value: number
      readonly span: Span
    }
  | {
      readonly field: 'unused' | 'disabled'
      readonly op: 'is'
      readonly value: boolean
      readonly span: Span
    }
  | {
      readonly field: 'header'
      /** `present` when only a name was given; the stub matches on that header at all. */
      readonly op: 'present' | 'contains' | 'glob'
      /** Lower-cased: HTTP header names are case-insensitive. */
      readonly name: string
      /** Case preserved — header *values* are case-sensitive. Null for `present`. */
      readonly value: string | null
      readonly span: Span
    }

export interface FreeTextTerm {
  readonly text: string
  readonly span: Span
  /** True when the user quoted it, so the search should treat it as one phrase. */
  readonly phrase: boolean
}

export interface RejectedToken {
  readonly field: QueryField
  readonly span: Span
  readonly text: string
  readonly capability: CapabilityBit
  /** Plain-language copy for the warning pill's tooltip. */
  readonly reason: string
}

/** Filters on one field, which are ORed together. Groups are ANDed with each other. */
export interface QueryFilterGroup {
  readonly field: QueryField
  readonly filters: readonly QueryFilter[]
}

export interface QueryPlan {
  readonly raw: string
  readonly filters: readonly QueryFilter[]
  readonly groups: readonly QueryFilterGroup[]
  readonly terms: readonly FreeTextTerm[]
  readonly rejected: readonly RejectedToken[]
  readonly isEmpty: boolean
}

export interface ParseQueryOptions {
  readonly capabilities: CapabilitySet
}

interface RawToken {
  readonly text: string
  readonly start: number
  readonly end: number
}

const QUERY_FIELD_SET = new Set<string>(QUERY_FIELDS)
const WILDCARD = /[*?]/

/**
 * Split on whitespace, except inside double quotes. An unterminated quote runs to end of input
 * rather than failing — a half-typed query is the normal case, not an error case.
 */
function tokenise(input: string): RawToken[] {
  const tokens: RawToken[] = []
  let index = 0
  while (index < input.length) {
    if (/\s/.test(input[index]!)) {
      index += 1
      continue
    }
    const start = index
    let quoted = false
    while (index < input.length) {
      const char = input[index]!
      if (char === '"') {
        quoted = !quoted
        index += 1
        continue
      }
      if (!quoted && /\s/.test(char)) break
      index += 1
    }
    tokens.push({ text: input.slice(start, index), start, end: index })
  }
  return tokens
}

function unquote(value: string): { text: string; quoted: boolean } {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return { text: value.slice(1, -1), quoted: true }
  }
  if (value.startsWith('"')) return { text: value.slice(1), quoted: true } // unterminated
  return { text: value, quoted: false }
}

function stringOpFor(
  field: 'url' | 'body' | 'scenario' | 'tag' | 'folder',
  value: string,
): StringOp {
  if (WILDCARD.test(value)) return 'glob'
  return field === 'url' || field === 'body' ? 'contains' : 'eq'
}

function parseBoolean(value: string): boolean | null {
  const normalised = value.toLowerCase()
  if (normalised === 'true' || normalised === 'yes' || normalised === '1') return true
  if (normalised === 'false' || normalised === 'no' || normalised === '0') return false
  return null
}

function parseStatus(value: string, span: Span): QueryFilter | null {
  const classMatch = /^([1-5])xx$/i.exec(value)
  if (classMatch) return { field: 'status', op: 'class', value: Number(classMatch[1]), span }
  if (/^\d{3}$/.test(value)) return { field: 'status', op: 'eq', value: Number(value), span }
  return null
}

function parsePriority(value: string, span: Span): QueryFilter | null {
  const match = /^(<=|>=|<|>)?(-?\d+)$/.exec(value)
  if (!match) return null
  const op: NumberOp =
    match[1] === '<'
      ? 'lt'
      : match[1] === '<='
        ? 'lte'
        : match[1] === '>'
          ? 'gt'
          : match[1] === '>='
            ? 'gte'
            : 'eq'
  return { field: 'priority', op, value: Number(match[2]), span }
}

/**
 * `header:Name` or `header:Name=value`. Split on the **first** `=` only, so a value that itself
 * contains one (a signature, a base64 blob) survives intact.
 */
function parseHeader(raw: string, span: Span): QueryFilter | null {
  const separator = raw.indexOf('=')
  const name = (separator === -1 ? raw : raw.slice(0, separator)).trim().toLowerCase()
  if (name === '') return null
  if (separator === -1) return { field: 'header', op: 'present', name, value: null, span }

  const { text: value } = unquote(raw.slice(separator + 1))
  if (value === '') return { field: 'header', op: 'present', name, value: null, span }
  return {
    field: 'header',
    op: WILDCARD.test(value) ? 'glob' : 'contains',
    name,
    value,
    span,
  }
}

function buildFilter(field: QueryField, value: string, span: Span): QueryFilter | null {
  if (value === '') return null
  switch (field) {
    case 'method':
      return { field, op: 'eq', value: value.toUpperCase(), span }
    case 'url':
    case 'body':
    case 'scenario':
    case 'tag':
    case 'folder':
      return { field, op: stringOpFor(field, value), value, span }
    case 'status':
      return parseStatus(value, span)
    case 'priority':
      return parsePriority(value, span)
    case 'unused':
    case 'disabled': {
      const parsed = parseBoolean(value)
      return parsed === null ? null : { field, op: 'is', value: parsed, span }
    }
    case 'header':
      return parseHeader(value, span)
  }
}

function rejectionFor(
  field: QueryField,
  token: RawToken,
  capability: CapabilityBit,
): RejectedToken {
  const entry = CAPABILITY_REGISTRY[capability]
  return {
    field,
    span: { start: token.start, end: token.end },
    text: token.text,
    capability,
    reason: `\`${field}:\` needs the “${entry.label}” capability, which is off for this profile. ${entry.whenOff}`,
  }
}

export function parseQuery(input: string, options: ParseQueryOptions): QueryPlan {
  const filters: QueryFilter[] = []
  const terms: FreeTextTerm[] = []
  const rejected: RejectedToken[] = []

  for (const token of tokenise(input)) {
    const span: Span = { start: token.start, end: token.end }
    const colon = token.text.indexOf(':')
    const maybeField = colon > 0 ? token.text.slice(0, colon).toLowerCase() : null

    if (maybeField !== null && QUERY_FIELD_SET.has(maybeField)) {
      const field = maybeField as QueryField
      const capability = (QUERY_FIELD_CAPABILITY as Partial<Record<QueryField, CapabilityBit>>)[
        field
      ]

      // Capability is checked before the value: the user's intent is already unambiguous, and
      // "this server cannot answer that" is a more useful message than "that value looks odd".
      if (capability !== undefined && !options.capabilities.has(capability)) {
        rejected.push(rejectionFor(field, token, capability))
        continue
      }

      const { text: value } = unquote(token.text.slice(colon + 1))
      const filter = buildFilter(field, value, span)
      if (filter !== null) {
        filters.push(filter)
        continue
      }
      // Recognised field, unusable value: fall through and search for what they typed.
    }

    const { text, quoted } = unquote(token.text)
    if (text !== '') terms.push({ text, span, phrase: quoted })
  }

  const groups: QueryFilterGroup[] = []
  for (const filter of filters) {
    const existing = groups.find((group) => group.field === filter.field)
    if (existing) (existing.filters as QueryFilter[]).push(filter)
    else groups.push({ field: filter.field, filters: [filter] })
  }

  return {
    raw: input,
    filters,
    groups,
    terms,
    rejected,
    isEmpty: filters.length === 0 && terms.length === 0 && rejected.length === 0,
  }
}

/**
 * A filter as a short phrase, for the pills under the search box.
 *
 * Those pills exist so someone can see what the app *actually applied*, which the raw query text
 * cannot show once it has been parsed (design brief §6.11). They were rendering
 * `` `${field}: ${value}` ``, which dropped the operator and, for headers, the name — so
 * `header:X-Tenant` read as "header: null" and `priority:<5` read as "priority: 5", both of
 * which describe a filter that was not applied. A pill that misreports the filter is worse than
 * no pill: it is a wrong answer to the exact question it was added to answer.
 */
export function describeFilter(filter: QueryFilter): string {
  switch (filter.field) {
    case 'method':
      return `method: ${filter.value}`
    case 'url':
    case 'body':
    case 'scenario':
    case 'tag':
    case 'folder':
      switch (filter.op) {
        case 'contains':
          return `${filter.field} contains ${filter.value}`
        case 'glob':
          return `${filter.field} matches ${filter.value}`
        default:
          return `${filter.field}: ${filter.value}`
      }
    case 'status':
      // `class` means a leading digit, and "status: 5" is not what was asked for.
      return filter.op === 'class' ? `status: ${filter.value}xx` : `status: ${filter.value}`
    case 'priority': {
      const symbol = { eq: ':', lt: ' <', lte: ' ≤', gt: ' >', gte: ' ≥' }[filter.op]
      return `priority${symbol} ${filter.value}`
    }
    case 'unused':
    case 'disabled':
      // The negative case is a real query and reads as nonsense rendered as "unused: false".
      return filter.value ? filter.field : `not ${filter.field}`
    case 'header':
      switch (filter.op) {
        case 'present':
          return `header: ${filter.name} (any value)`
        case 'glob':
          return `header: ${filter.name} matches ${filter.value}`
        default:
          return `header: ${filter.name} = ${filter.value}`
      }
  }
}
