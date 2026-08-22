import { createHash } from 'node:crypto'
import type { Json, JsonObject } from './types.js'

/**
 * Canonical serialisation.
 *
 * Three things in this codebase rest on this module being deterministic:
 *
 *  - `client_key = server_id ?? hash(canonical(raw))` — the identity rule. A backend with no
 *    stable id (Hoverfly pairs, Prism operations) gets a content-addressed key instead, and
 *    that key has to survive a re-fetch that returns the same object with different key order.
 *  - `content_hash`, which is the whole of the optimistic-concurrency check (PRD FR-EDIT-4).
 *    A hash that wobbles would raise phantom conflicts; one that collides would lose an edit.
 *  - Deterministic file output (PRD FR-SYNC-4), so a repo round-trip leaves an empty git diff.
 *
 * Determinism therefore means *byte*-stability, not merely equal-JSON, which is why key order
 * is imposed rather than inherited from insertion order.
 */

const HASH_ALGORITHM = 'sha256'

/** Marks a content-addressed client key so it cannot be mistaken for a server-assigned id. */
export const CLIENT_KEY_HASH_PREFIX = 'h_'
const CLIENT_KEY_HASH_LENGTH = 32

export class CanonicalError extends Error {
  override readonly name = 'CanonicalError'
  constructor(message: string) {
    super(message)
  }
}

function describePath(path: readonly (string | number)[]): string {
  if (path.length === 0) return '<root>'
  return path.map((seg) => (typeof seg === 'number' ? `[${seg}]` : `.${seg}`)).join('')
}

/**
 * Refuse anything JSON cannot carry rather than coercing it. `JSON.stringify` silently turns
 * NaN into null and drops functions; in a tool whose worst possible bug is quietly losing a
 * field, a silent coercion is worse than a throw.
 */
function normalise(value: unknown, path: readonly (string | number)[]): Json | undefined {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalError(`non-finite number at ${describePath(path)}: ${String(value)}`)
      }
      // -0 and 0 are the same JSON number; collapse so the hash cannot depend on the sign.
      return value === 0 ? 0 : value
    case 'undefined':
      return undefined
    case 'bigint':
      throw new CanonicalError(`bigint is not JSON at ${describePath(path)}`)
    case 'function':
    case 'symbol':
      throw new CanonicalError(`${typeof value} is not JSON at ${describePath(path)}`)
    case 'object': {
      if (value === null) return null
      if (Array.isArray(value)) {
        // An undefined slot becomes null, matching JSON.stringify — array length is data.
        return value.map((element, index) => normalise(element, [...path, index]) ?? null)
      }
      const proto = Object.getPrototypeOf(value) as object | null
      if (proto !== Object.prototype && proto !== null) {
        // A Date would serialise to {} here, losing its value without saying so.
        throw new CanonicalError(
          `only plain objects are JSON at ${describePath(path)}: got ${value.constructor?.name ?? 'unknown'}`,
        )
      }
      const source = value as Record<string, unknown>
      const out: JsonObject = {}
      // Sort by UTF-16 code unit: the same total order in every JS engine, on every run.
      for (const key of Object.keys(source).sort()) {
        const normalised = normalise(source[key], [...path, key])
        if (normalised !== undefined) out[key] = normalised
      }
      return out
    }
    default:
      throw new CanonicalError(`unsupported value at ${describePath(path)}`)
  }
}

/** Structurally identical value with every object's keys in sorted order. Arrays keep order. */
export function canonicalize(value: Json): Json {
  const normalised = normalise(value, [])
  if (normalised === undefined) throw new CanonicalError('undefined is not JSON at <root>')
  return normalised
}

/**
 * The canonical text form: sorted keys, 2-space indent, LF, no trailing newline. This is what
 * gets hashed, what the audit log stores, and what human-readable diffs are computed over.
 */
export function canonicalJson(value: Json): string {
  return JSON.stringify(canonicalize(value), null, 2)
}

/** SHA-256 of the canonical text, lowercase hex. Stable across processes and runs. */
export function contentHash(value: Json): string {
  return createHash(HASH_ALGORITHM).update(canonicalJson(value), 'utf8').digest('hex')
}

/**
 * The identity rule from TECH-DESIGN §6.2. Never key the UI on `serverId` directly: several
 * backends have no stable id at all, so the fallback is not an edge case.
 */
export function clientKeyFor(raw: Json, serverId: string | null | undefined): string {
  if (serverId !== null && serverId !== undefined && serverId !== '') return serverId
  return CLIENT_KEY_HASH_PREFIX + contentHash(raw).slice(0, CLIENT_KEY_HASH_LENGTH)
}
