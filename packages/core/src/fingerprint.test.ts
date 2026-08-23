import { describe, expect, it } from 'vitest'
import { behaviourFingerprint } from './fingerprint.js'
import { blankMockDraft } from './blank.js'

const base = blankMockDraft()

describe('behaviourFingerprint', () => {
  it('survives the thing that breaks client_key: a new vendor id', () => {
    // The whole point. An import without an id gives the same stub a different id, and the
    // journal's reference stops resolving even though the stub is plainly still there.
    const before = { ...base, raw: { id: 'aaaa', uuid: 'aaaa' } }
    const after = { ...base, raw: { id: 'bbbb', uuid: 'bbbb' } }
    expect(behaviourFingerprint(after)).toBe(behaviourFingerprint(before))
  })

  it('ignores renaming, refoldering and retagging', () => {
    // Harmless edits people make constantly. Including them would break the match on precisely
    // the changes that do not change what the stub does.
    const renamed = { ...base, name: 'something else', folder: ['a', 'b'], tags: ['x'] }
    expect(behaviourFingerprint(renamed)).toBe(behaviourFingerprint(base))
  })

  it('changes when the matcher changes', () => {
    const moved = {
      ...base,
      request: { ...base.request, url: { kind: 'urlPath' as const, value: '/elsewhere' } },
    }
    expect(behaviourFingerprint(moved)).not.toBe(behaviourFingerprint(base))
  })

  it('changes when the response changes', () => {
    const failing = { ...base, response: { ...base.response, status: 500 } }
    expect(behaviourFingerprint(failing)).not.toBe(behaviourFingerprint(base))
  })

  it('changes when the priority changes, because that decides which stub answers', () => {
    expect(behaviourFingerprint({ ...base, priority: 1 })).not.toBe(behaviourFingerprint(base))
  })

  it('is stable across runs and insensitive to key order', () => {
    const reordered = {
      ...base,
      request: {
        bodyPatterns: base.request.bodyPatterns,
        cookies: base.request.cookies,
        queryParameters: base.request.queryParameters,
        headers: base.request.headers,
        url: base.request.url,
        method: base.request.method,
      },
    }
    expect(behaviourFingerprint(reordered)).toBe(behaviourFingerprint(base))
  })
})
