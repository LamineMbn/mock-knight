import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ConnectionRegistry,
  RESTART_TOLERANCE_MS,
  incompleteAuth,
  environmentCapabilities,
  hasRestarted,
  resolveAuth,
} from './runtime.js'
import { openDatabase } from './db/database.js'
import { createProfile } from './profiles.js'
import type { Profile } from './profiles.js'
import type { Database as Db } from 'better-sqlite3'

const profile = (over: Partial<Profile>): Profile =>
  ({
    id: 'p',
    name: 'p',
    adapter: 'wiremock',
    baseUrl: 'http://x',
    adminPath: null,
    colour: 'indigo',
    protected: false,
    readOnly: false,
    mappingsDir: null,
    authKind: 'none',
    authRef: null,
    correlationHeader: null,
    redactHeaders: [],
    origin: 'runtime',
    createdAt: '',
    capabilities: null,
    serverIdent: null,
    ...over,
  }) as Profile

describe('resolveAuth', () => {
  it('reads a bearer token from the profile, which is where it now lives', () => {
    expect(resolveAuth(profile({ authKind: 'bearer', authSecret: 'tok' }))).toEqual({
      kind: 'bearer',
      token: 'tok',
    })
  })

  it('resolves basic credentials from the two stored fields', () => {
    expect(
      resolveAuth(profile({ authKind: 'basic', authUsername: 'ci', authSecret: 'hunter2' })),
    ).toEqual({ kind: 'basic', username: 'ci', password: 'hunter2' })
  })

  it('is none when the profile selects none, whatever is stored', () => {
    // Switching the method off must stop sending, even if a value is still on the row.
    expect(resolveAuth(profile({ authKind: 'none', authSecret: 'left-over' }))).toEqual({
      kind: 'none',
    })
  })
})

describe('incompleteAuth', () => {
  it('names the half that is missing, before anything is sent', () => {
    // "You have not finished filling this in" beats whatever the server says about the 401 it
    // would otherwise answer.
    expect(incompleteAuth({ authKind: 'basic', authUsername: 'ci', authSecret: null })).toBe(
      'a password',
    )
    expect(incompleteAuth({ authKind: 'basic', authUsername: null, authSecret: 'p' })).toBe(
      'a username',
    )
    expect(incompleteAuth({ authKind: 'bearer', authUsername: null, authSecret: '' })).toBe(
      'a token',
    )
  })

  it('has nothing to say when the credential is complete or unused', () => {
    expect(incompleteAuth({ authKind: 'basic', authUsername: 'ci', authSecret: 'p' })).toBeNull()
    expect(incompleteAuth({ authKind: 'none', authUsername: null, authSecret: null })).toBeNull()
  })
})

describe('environmentCapabilities', () => {
  it('gives local mode the filesystem bits', () => {
    expect(environmentCapabilities('local')).toContain('files.bindDirectory')
  })
  it('gives deployed mode multi-user audit and no filesystem', () => {
    expect(environmentCapabilities('deployed')).toEqual(['audit.multiUser'])
  })
})

describe('hasRestarted', () => {
  const at = (ms: number) => new Date(ms).toISOString()

  it('tolerates the jitter of deriving a start time from a whole-second uptime', () => {
    expect(hasRestarted(at(1_000_000), at(1_000_000 + RESTART_TOLERANCE_MS - 1))).toBe(false)
  })

  it('reports a restart when the start time moves beyond the tolerance', () => {
    expect(hasRestarted(at(1_000_000), at(1_000_000 + RESTART_TOLERANCE_MS + 1))).toBe(true)
  })

  it('answers "unknowable" rather than "no" when the backend cannot report uptime', () => {
    expect(hasRestarted(null, at(1))).toBeNull()
    expect(hasRestarted(at(1), null)).toBeNull()
  })
})

describe('ConnectionRegistry.ensure', () => {
  /** A profile pointing at a port nothing listens on, so connecting genuinely fails. */
  const unreachable = (id: string): Profile =>
    profile({ id, name: id, baseUrl: 'http://127.0.0.1:9', adapter: 'wiremock' })

  let db: Db
  let registry: ConnectionRegistry

  beforeEach(() => {
    db = openDatabase(':memory:')
    registry = new ConnectionRegistry(db, 'local')
  })

  afterEach(() => {
    db.close()
  })

  it('reports the failure instead of throwing, because a server being down is a state to draw', async () => {
    const target = unreachable('down')
    createProfile(db, target, { id: target.id })

    expect(await registry.ensure(target)).toBeNull()
    const failure = registry.lastFailure(target.id)
    expect(failure).not.toBeNull()
    // The transport code is the useful half: ECONNREFUSED and ENOTFOUND need different fixes.
    expect(failure?.code).toBe('ECONNREFUSED')
    expect(failure?.message.length).toBeGreaterThan(0)
  })

  it('holds off between attempts, so a polling UI cannot hammer a server that is down', async () => {
    const target = unreachable('backoff')
    createProfile(db, target, { id: target.id })

    const start = 1_000_000
    await registry.ensure(target, start)
    const first = registry.lastFailure(target.id)!.nextAttemptAt
    expect(first).toBeGreaterThan(start)

    // Inside the window: no attempt is made at all, so the recorded time does not move.
    await registry.ensure(target, first - 1)
    expect(registry.lastFailure(target.id)!.nextAttemptAt).toBe(first)

    // At the window: it tries again, fails again, and waits longer than it did the first time.
    await registry.ensure(target, first)
    const second = registry.lastFailure(target.id)!.nextAttemptAt
    expect(second - first).toBeGreaterThan(first - start)
  })
})

describe('ConnectionRegistry.markUnreachable', () => {
  /**
   * A connection that has stopped working is not detected by probing — it is detected the next
   * time something uses it. Nothing here connects, so the behaviour under test is what happens
   * to registry state, not to a socket.
   */
  it('does nothing to a profile that was never connected', () => {
    const db = openDatabase(':memory:')
    const registry = new ConnectionRegistry(db, 'local')
    registry.markUnreachable('never-connected', new Error('boom'))
    // No phantom failure: a profile nobody has connected is untried, not broken.
    expect(registry.lastFailure('never-connected')).toBeNull()
    db.close()
  })
})
