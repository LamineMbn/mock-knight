import type { Json, JsonObject } from './types.js'
import { setKey } from './set-key.js'

/**
 * Three-way merge for stub documents — the machinery behind design brief §6.8.
 *
 * **Structural, not textual.** TECH-DESIGN §18 flags this as the most delicate component in the
 * app, and the usual reason is that text merges of pretty-printed JSON conflict on things that
 * are not conflicts: a reordered key, a changed indent, a trailing comma moving to the line
 * below. These documents are JSON, we already have a canonical form, and what a developer
 * actually wants to resolve is "you both changed `response.status`" — not "hunk at line 14". So
 * the merge works over paths.
 *
 * **Arrays are atomic.** `bodyPatterns` or `transformers` merge as whole values rather than
 * per-index, because index-wise merging of an array someone reordered produces plausible
 * nonsense — the worst outcome for a tool whose job is to be trusted with a shared server.
 *
 * Browser-safe: no `node:` imports.
 */

/** Distinguishes "absent" from "present and null", which JSON needs and `undefined` muddles. */
const MISSING = Symbol('missing')
type Slot = Json | typeof MISSING

export interface MergeConflict {
  /** Dotted path, e.g. `response.status`. */
  readonly path: string
  readonly base: Json | null
  readonly theirs: Json | null
  readonly mine: Json | null
  /** True where the side removed the field rather than changing it. */
  readonly theirsRemoved: boolean
  readonly mineRemoved: boolean
}

export interface MergeResult {
  /** Everything that could be resolved without asking. Conflicting paths hold *their* value. */
  readonly merged: JsonObject
  readonly conflicts: readonly MergeConflict[]
  /** Paths only the other side touched — merged in silently, but worth showing a count of. */
  readonly takenFromTheirs: readonly string[]
  /** Paths only this side touched. */
  readonly takenFromMine: readonly string[]
}

function isPlainObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Leaves are primitives and arrays; only objects recurse. */
function flatten(value: Json, prefix: string, into: Map<string, Json>): void {
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 0) {
      into.set(prefix, {})
      return
    }
    for (const key of keys) {
      flatten(value[key] as Json, prefix === '' ? key : `${prefix}.${key}`, into)
    }
    return
  }
  into.set(prefix, value)
}

function same(a: Slot, b: Slot): boolean {
  if (a === MISSING || b === MISSING) return a === b
  return JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b))
}

function sortDeep(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (isPlainObject(value)) {
    const out: JsonObject = {}
    // setKey, not `out[key] =`: a `__proto__` key would be dropped from the merged document.
    for (const key of Object.keys(value).sort()) setKey(out, key, sortDeep(value[key] as Json))
    return out
  }
  return value
}

function setPath(target: JsonObject, path: string, value: Json): void {
  const segments = path.split('.')
  let node = target
  for (let index = 0; index < segments.length - 1; index++) {
    const key = segments[index]!
    const existing = node[key]
    if (!isPlainObject(existing)) setKey(node, key, {})
    node = node[key] as JsonObject
  }
  // The leaf write, which is the one that actually carried the value. Missing it meant the
  // intermediate objects were created correctly and the field itself still vanished.
  setKey(node, segments[segments.length - 1]!, value)
}

/**
 * Merge `mine` and `theirs`, both descended from `base`.
 *
 * A field only one side touched is taken silently — that is the entire point, and it is what
 * stops a conflict dialog from listing forty rows when two people changed two different things.
 * Only a field both sides moved *differently* becomes a conflict for the user to settle.
 */
export function threeWayMerge(base: JsonObject, theirs: JsonObject, mine: JsonObject): MergeResult {
  const baseFlat = new Map<string, Json>()
  const theirsFlat = new Map<string, Json>()
  const mineFlat = new Map<string, Json>()
  flatten(base, '', baseFlat)
  flatten(theirs, '', theirsFlat)
  flatten(mine, '', mineFlat)

  const paths = [...new Set([...baseFlat.keys(), ...theirsFlat.keys(), ...mineFlat.keys()])].sort()

  const merged: JsonObject = {}
  const conflicts: MergeConflict[] = []
  const takenFromTheirs: string[] = []
  const takenFromMine: string[] = []

  for (const path of paths) {
    const b: Slot = baseFlat.has(path) ? baseFlat.get(path)! : MISSING
    const t: Slot = theirsFlat.has(path) ? theirsFlat.get(path)! : MISSING
    const m: Slot = mineFlat.has(path) ? mineFlat.get(path)! : MISSING

    if (same(t, m)) {
      // Both sides agree — including both having removed it.
      if (t !== MISSING) setPath(merged, path, t)
      continue
    }
    if (same(b, t)) {
      // Only this side moved it.
      if (m !== MISSING) setPath(merged, path, m)
      takenFromMine.push(path)
      continue
    }
    if (same(b, m)) {
      // Only the other side moved it.
      if (t !== MISSING) setPath(merged, path, t)
      takenFromTheirs.push(path)
      continue
    }

    // Both moved it, differently. Default to the server's value so an unresolved merge cannot
    // silently discard someone else's work; the UI must make the choice explicit either way.
    if (t !== MISSING) setPath(merged, path, t)
    conflicts.push({
      path,
      base: b === MISSING ? null : b,
      theirs: t === MISSING ? null : t,
      mine: m === MISSING ? null : m,
      theirsRemoved: t === MISSING,
      mineRemoved: m === MISSING,
    })
  }

  return { merged, conflicts, takenFromTheirs, takenFromMine }
}

/** Apply one side's answer for a conflicting path to an already-merged document. */
export function resolveConflict(
  document: JsonObject,
  conflict: MergeConflict,
  choice: 'mine' | 'theirs',
): JsonObject {
  const next = structuredClone(document)
  const removed = choice === 'mine' ? conflict.mineRemoved : conflict.theirsRemoved
  if (removed) {
    removePath(next, conflict.path)
    return next
  }
  setPath(next, conflict.path, (choice === 'mine' ? conflict.mine : conflict.theirs) as Json)
  return next
}

function removePath(target: JsonObject, path: string): void {
  const segments = path.split('.')
  let node: JsonObject = target
  for (let index = 0; index < segments.length - 1; index++) {
    const child = node[segments[index]!]
    if (!isPlainObject(child)) return
    node = child
  }
  delete node[segments[segments.length - 1]!]
}
