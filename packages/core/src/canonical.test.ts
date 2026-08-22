import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { canonicalJson, canonicalize, clientKeyFor, contentHash } from './canonical.js'
import type { Json, JsonObject } from './types.js'

/** Rebuild an equal value with object keys visited in reverse insertion order. */
function reorderKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(reorderKeys)
  if (value !== null && typeof value === 'object') {
    const out: JsonObject = {}
    for (const key of Object.keys(value).reverse()) out[key] = reorderKeys(value[key] as Json)
    return out
  }
  return value
}

const jsonArb: fc.Arbitrary<Json> = fc.letrec<{ json: Json }>((tie) => ({
  json: fc.oneof(
    { depthSize: 'small' },
    fc.constant(null),
    fc.boolean(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.string(),
    fc.array(tie('json'), { maxLength: 6 }),
    fc.dictionary(fc.string(), tie('json'), { maxKeys: 6 }),
  ),
})).json

describe('canonicalize', () => {
  it('sorts object keys at every depth', () => {
    const out = canonicalize({ b: 1, a: { d: 2, c: 3 } })
    expect(Object.keys(out as JsonObject)).toEqual(['a', 'b'])
    expect(Object.keys((out as { a: JsonObject }).a)).toEqual(['c', 'd'])
  })

  it('preserves array order — arrays are data, not sets', () => {
    expect(canonicalize(['c', 'a', 'b'])).toEqual(['c', 'a', 'b'])
  })

  it('sorts keys inside objects nested in arrays', () => {
    const out = canonicalize([{ z: 1, a: 2 }]) as JsonObject[]
    expect(Object.keys(out[0]!)).toEqual(['a', 'z'])
  })
})

describe('canonicalJson', () => {
  it('emits 2-space indentation with no trailing newline', () => {
    expect(canonicalJson({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('is byte-identical for values differing only in key order', () => {
    const a = { request: { method: 'GET', url: '/v1/orders' }, priority: 3 }
    const b = { priority: 3, request: { url: '/v1/orders', method: 'GET' } }
    expect(canonicalJson(a)).toBe(canonicalJson(b))
  })

  it('canonical output is byte-stable across runs', () => {
    const value = { b: [3, { d: 4, c: 5 }], a: 'x' }
    const first = canonicalJson(value)
    for (let i = 0; i < 50; i++) expect(canonicalJson(value)).toBe(first)
  })

  it('drops undefined members and nulls undefined array slots, as JSON does', () => {
    expect(canonicalJson({ a: 1, b: undefined } as unknown as Json)).toBe('{\n  "a": 1\n}')
    expect(canonicalJson([1, undefined] as unknown as Json)).toBe('[\n  1,\n  null\n]')
  })

  it('refuses values JSON cannot represent rather than coercing them', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/NaN|finite/i)
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/finite/i)
    expect(() => canonicalJson({ a: 1n } as unknown as Json)).toThrow(/bigint/i)
  })

  it('parse(canonical(x)) deep-equals x for arbitrary JSON', () => {
    fc.assert(
      fc.property(jsonArb, (value) => {
        expect(JSON.parse(canonicalJson(value))).toEqual(JSON.parse(JSON.stringify(value)))
      }),
    )
  })

  it('is insensitive to key order for arbitrary JSON', () => {
    fc.assert(
      fc.property(jsonArb, (value) => {
        expect(canonicalJson(reorderKeys(value))).toBe(canonicalJson(value))
      }),
    )
  })
})

describe('contentHash', () => {
  it('is equal for values that differ only in key order', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }))
  })

  it('changes when any value changes', () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }))
  })

  it('distinguishes a string from the number that prints the same', () => {
    expect(contentHash({ a: '1' })).not.toBe(contentHash({ a: 1 }))
  })

  it('is a 64-character lowercase hex digest', () => {
    expect(contentHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('clientKeyFor', () => {
  const raw = { request: { method: 'GET' } }

  it('prefers a stable server id when the backend has one', () => {
    expect(clientKeyFor(raw, 'b8f3-uuid')).toBe('b8f3-uuid')
  })

  it('derives a content-addressed key when the backend has no id', () => {
    expect(clientKeyFor(raw, null)).toMatch(/^h_[0-9a-f]{32}$/)
  })

  it('derives the same key for the same content regardless of key order', () => {
    expect(clientKeyFor({ a: 1, b: 2 }, null)).toBe(clientKeyFor({ b: 2, a: 1 }, null))
  })

  it('treats an empty-string server id as absent', () => {
    expect(clientKeyFor(raw, '')).toMatch(/^h_/)
  })
})
