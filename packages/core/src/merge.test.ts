import { describe, expect, it } from 'vitest'
import { resolveConflict, threeWayMerge } from './merge.js'
import type { JsonObject } from './types.js'

/**
 * Deep-frozen on purpose. `{ ...base }` is a shallow copy, so a test that reaches into a nested
 * object to build a variant silently edits the shared fixture and every later test in the file
 * runs against different data. Freezing turns that into an immediate error instead.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

const base: JsonObject = deepFreeze({
  name: 'orders create',
  request: { method: 'POST', urlPath: '/v1/orders' },
  response: { status: 200, headers: { 'Content-Type': 'application/json' } },
  metadata: { team: 'payments' },
})

describe('changes only one side made', () => {
  it('takes my change when the server did not touch that field', () => {
    const theirs = base
    const mine = { ...base, response: { ...(base['response'] as JsonObject), status: 500 } }
    const result = threeWayMerge(base, theirs, mine)
    expect(result.conflicts).toEqual([])
    expect((result.merged['response'] as JsonObject)['status']).toBe(500)
    expect(result.takenFromMine).toContain('response.status')
  })

  it('takes the server’s change when I did not touch that field', () => {
    const theirs = { ...base, name: 'renamed upstream' }
    const result = threeWayMerge(base, theirs, base)
    expect(result.conflicts).toEqual([])
    expect(result.merged['name']).toBe('renamed upstream')
    expect(result.takenFromTheirs).toContain('name')
  })

  it('merges both sides silently when they touched different fields', () => {
    // The whole point: two people editing one stub is usually not a conflict at all.
    const theirs = { ...base, name: 'renamed upstream' }
    const mine = { ...base, response: { ...(base['response'] as JsonObject), status: 500 } }
    const result = threeWayMerge(base, theirs, mine)
    expect(result.conflicts).toEqual([])
    expect(result.merged['name']).toBe('renamed upstream')
    expect((result.merged['response'] as JsonObject)['status']).toBe(500)
  })

  it('is not fooled by a reordered key, which a text merge would call a conflict', () => {
    const reordered: JsonObject = {
      metadata: { team: 'payments' },
      response: { headers: { 'Content-Type': 'application/json' }, status: 200 },
      request: { urlPath: '/v1/orders', method: 'POST' },
      name: 'orders create',
    }
    const mine = { ...base, name: 'mine' }
    const result = threeWayMerge(base, reordered, mine)
    expect(result.conflicts).toEqual([])
    expect(result.merged['name']).toBe('mine')
  })
})

describe('changes both sides made', () => {
  it('reports a conflict only where both moved the same field differently', () => {
    const theirs = { ...base, response: { ...(base['response'] as JsonObject), status: 418 } }
    const mine = { ...base, response: { ...(base['response'] as JsonObject), status: 500 } }
    const result = threeWayMerge(base, theirs, mine)
    expect(result.conflicts).toEqual([
      {
        path: 'response.status',
        base: 200,
        theirs: 418,
        mine: 500,
        theirsRemoved: false,
        mineRemoved: false,
      },
    ])
  })

  it('is not a conflict when both made the same change', () => {
    const edited = { ...base, response: { ...(base['response'] as JsonObject), status: 500 } }
    expect(threeWayMerge(base, edited, edited).conflicts).toEqual([])
  })

  it('defaults an unresolved conflict to the server’s value', () => {
    // So that abandoning the dialog cannot quietly discard the other person's work.
    const theirs = { ...base, name: 'theirs' }
    const mine = { ...base, name: 'mine' }
    expect(threeWayMerge(base, theirs, mine).merged['name']).toBe('theirs')
  })

  it('treats a removal on one side and an edit on the other as a conflict', () => {
    const withoutHeaders: JsonObject = {
      ...base,
      response: { status: 200 },
    }
    const mine = {
      ...base,
      response: { status: 200, headers: { 'Content-Type': 'text/plain' } },
    }
    const result = threeWayMerge(base, withoutHeaders, mine)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({
      path: 'response.headers.Content-Type',
      theirsRemoved: true,
    })
  })

  it('treats an array as one value rather than merging it index by index', () => {
    // Index-wise merging of a reordered array produces plausible nonsense.
    const withArray: JsonObject = { ...base, tags: ['a', 'b'] }
    const theirs: JsonObject = { ...base, tags: ['b', 'a'] }
    const mine: JsonObject = { ...base, tags: ['a', 'b', 'c'] }
    const result = threeWayMerge(withArray, theirs, mine)
    expect(result.conflicts.map((c) => c.path)).toEqual(['tags'])
    expect(result.conflicts[0]?.mine).toEqual(['a', 'b', 'c'])
  })

  it('keeps fields neither side touched', () => {
    const theirs = { ...base, name: 'theirs' }
    const mine = { ...base, name: 'mine' }
    const result = threeWayMerge(base, theirs, mine)
    expect((result.merged['request'] as JsonObject)['urlPath']).toBe('/v1/orders')
    expect(result.merged['metadata']).toEqual({ team: 'payments' })
  })
})

describe('additions', () => {
  it('keeps a field only I added', () => {
    const mine = { ...base, priority: 3 }
    expect(threeWayMerge(base, base, mine).merged['priority']).toBe(3)
  })

  it('conflicts when both added the same field with different values', () => {
    const result = threeWayMerge(base, { ...base, priority: 1 }, { ...base, priority: 9 })
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({ path: 'priority', base: null, theirs: 1, mine: 9 })
  })
})

describe('resolveConflict', () => {
  const theirs = { ...base, response: { ...(base['response'] as JsonObject), status: 418 } }
  const mine = { ...base, response: { ...(base['response'] as JsonObject), status: 500 } }
  const result = threeWayMerge(base, theirs, mine)

  it('applies my value', () => {
    const resolved = resolveConflict(result.merged, result.conflicts[0]!, 'mine')
    expect((resolved['response'] as JsonObject)['status']).toBe(500)
  })

  it('applies their value', () => {
    const resolved = resolveConflict(result.merged, result.conflicts[0]!, 'theirs')
    expect((resolved['response'] as JsonObject)['status']).toBe(418)
  })

  it('removes the field when the chosen side removed it', () => {
    const removedTheirs: JsonObject = { ...base, response: { status: 200 } }
    const keptMine = {
      ...base,
      response: { status: 200, headers: { 'Content-Type': 'text/plain' } },
    }
    const merged = threeWayMerge(base, removedTheirs, keptMine)

    // Choosing the side that deleted the field leaves it absent, not present-and-empty.
    const takingTheirs = resolveConflict(merged.merged, merged.conflicts[0]!, 'theirs')
    expect((takingTheirs['response'] as JsonObject)['headers']).toBeUndefined()

    const takingMine = resolveConflict(merged.merged, merged.conflicts[0]!, 'mine')
    expect((takingMine['response'] as JsonObject)['headers']).toEqual({
      'Content-Type': 'text/plain',
    })
  })

  it('does not mutate the document it was given', () => {
    const before = JSON.stringify(result.merged)
    resolveConflict(result.merged, result.conflicts[0]!, 'mine')
    expect(JSON.stringify(result.merged)).toBe(before)
  })
})
