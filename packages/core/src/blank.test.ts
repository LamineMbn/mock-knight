import { describe, expect, it } from 'vitest'
import { blankMockDraft, duplicateMockDraft } from './blank.js'

describe('blankMockDraft', () => {
  it('is a stub someone would have to edit before it is useful', () => {
    const draft = blankMockDraft()
    expect(draft.request.method).toBe('GET')
    expect(draft.request.url).toEqual({ kind: 'urlPath', value: '/' })
    expect(draft.response.status).toBe(200)
  })

  it('carries an empty raw, so every field is written rather than patched', () => {
    // There is no retained vendor document, so `render` must treat every canonical field as
    // differing from "absent". An undefined raw would make that a crash instead.
    expect(blankMockDraft().raw).toEqual({})
  })

  it('is a fresh object each time', () => {
    // A shared object would let one half-finished new stub leak into the next one.
    const a = blankMockDraft()
    a.request.headers['X-Leak'] = [{ operator: 'equalTo', value: 'y', options: {} }]
    expect(blankMockDraft().request.headers).toEqual({})
  })
})

describe('duplicateMockDraft', () => {
  const source = {
    ...blankMockDraft(),
    name: 'orders create 500',
    raw: { id: 'server-uuid', uuid: 'server-uuid', postServeActions: [{ name: 'webhook' }] },
  }

  it('strips the vendor identifiers, so the copy cannot overwrite the original', () => {
    const copy = duplicateMockDraft(source, ['id', 'uuid'])
    expect(copy.raw['id']).toBeUndefined()
    expect(copy.raw['uuid']).toBeUndefined()
  })

  it('keeps fields the canonical model does not understand', () => {
    // The point of retaining `raw`. A duplicate rebuilt from canonical fields alone would
    // silently be a different stub from the one it claims to copy.
    expect(duplicateMockDraft(source, ['id', 'uuid']).raw['postServeActions']).toEqual([
      { name: 'webhook' },
    ])
  })

  it('names the copy distinguishably', () => {
    expect(duplicateMockDraft(source, []).name).toBe('orders create 500 (copy)')
    expect(duplicateMockDraft({ ...source, name: null }, []).name).toBe('Untitled stub (copy)')
  })

  it('does not mutate the stub it copied', () => {
    const before = JSON.stringify(source)
    duplicateMockDraft(source, ['id', 'uuid'])
    expect(JSON.stringify(source)).toBe(before)
  })
})
