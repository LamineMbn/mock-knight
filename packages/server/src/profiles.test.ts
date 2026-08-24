import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import { openDatabase } from './db/database.js'
import { adminUrlFor, createProfile, findProfileByAdminUrl } from './profiles.js'
import type { ProfileInput } from './profiles.js'

/**
 * Two profiles pointing at one server are not a second environment — they are a mistake someone
 * has to notice later: both mirror the same corpus, edits through one look stale in the other,
 * and the switcher offers a choice that changes nothing.
 */

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
})
afterEach(() => db.close())

const input = (over: Partial<ProfileInput> = {}): ProfileInput => ({
  name: 'a server',
  adapter: 'wiremock',
  baseUrl: 'http://localhost:8080',
  adminPath: null,
  colour: 'indigo',
  protected: false,
  readOnly: false,
  mappingsDir: null,
  authKind: 'none',
  authRef: null,
  correlationHeader: null,
  redactHeaders: [],
  ...over,
})

describe('adminUrlFor', () => {
  it('is the address actually talked to, not the base URL', () => {
    expect(adminUrlFor(input())).toBe('http://localhost:8080/__admin')
    expect(adminUrlFor(input({ baseUrl: 'https://host/ctx' }))).toBe('https://host/ctx/__admin')
  })

  it('is null for a base URL that will not parse', () => {
    // An unusable profile cannot collide with anything; refusing it is the validator's job.
    expect(adminUrlFor(input({ baseUrl: 'not a url' }))).toBeNull()
  })
})

describe('findProfileByAdminUrl', () => {
  it('sees through a trailing slash', () => {
    createProfile(db, input({ name: 'first', baseUrl: 'http://localhost:8080' }))
    const clash = findProfileByAdminUrl(db, input({ baseUrl: 'http://localhost:8080/' }))
    expect(clash?.name).toBe('first')
  })

  it('sees through an admin path spelled out rather than defaulted', () => {
    // One profile leaving adminPath unset and another writing `/__admin` reach the same API.
    createProfile(db, input({ name: 'first', adminPath: null }))
    expect(findProfileByAdminUrl(db, input({ adminPath: '/__admin' }))?.name).toBe('first')
  })

  it('does not confuse two context paths on one host', () => {
    // The case that makes base-URL comparison wrong in the other direction: same host, genuinely
    // different servers.
    createProfile(db, input({ name: 'v1', baseUrl: 'https://host/mock/v1' }))
    expect(findProfileByAdminUrl(db, input({ baseUrl: 'https://host/mock/v2' }))).toBeNull()
  })

  it('does not confuse two admin paths on one base URL', () => {
    createProfile(db, input({ name: 'wm', adminPath: '/__admin' }))
    expect(findProfileByAdminUrl(db, input({ adminPath: '/mockserver' }))).toBeNull()
  })

  it('ignores the profile being edited, so saving an unchanged URL is not a collision', () => {
    const mine = createProfile(db, input({ name: 'mine' }))
    expect(findProfileByAdminUrl(db, input(), mine.id)).toBeNull()
    // But another profile on that address still is.
    createProfile(db, input({ name: 'other', baseUrl: 'http://localhost:8080/' }))
    expect(findProfileByAdminUrl(db, input(), mine.id)?.name).toBe('other')
  })

  it('finds nothing when there is nothing', () => {
    expect(findProfileByAdminUrl(db, input())).toBeNull()
  })
})
