import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ConnectionRegistry,
  RESTART_TOLERANCE_MS,
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
  it('reads a bearer token from the named environment variable, never from the profile', () => {
    const auth = resolveAuth(profile({ authKind: 'bearer', authRef: 'TOKEN_VAR' }), {
      TOKEN_VAR: 'secret-value',
    })
    expect(auth).toEqual({ kind: 'bearer', token: 'secret-value' })
  })

  it('resolves basic credentials from two named variables', () => {
    expect(
      resolveAuth(profile({ authKind: 'basic', authRef: 'U:P' }), { U: 'dana', P: 'hunter2' }),
    ).toEqual({ kind: 'basic', username: 'dana', password: 'hunter2' })
  })

  it('resolves custom headers from a name=VAR list', () => {
    expect(
      resolveAuth(profile({ authKind: 'headers', authRef: 'x-key=KEY,x-org=ORG' }), {
        KEY: 'k',
        ORG: 'o',
      }),
    ).toEqual({ kind: 'headers', headers: { 'x-key': 'k', 'x-org': 'o' } })
  })

  it('yields an empty credential rather than throwing when the variable is unset', () => {
    // A missing variable is a misconfiguration to surface as a 401 from upstream, not a crash
    // on connect that tells the user nothing about which variable is missing.
    expect(resolveAuth(profile({ authKind: 'bearer', authRef: 'ABSENT' }), {})).toEqual({
      kind: 'bearer',
      token: '',
    })
  })

  it('is none when the profile names no variable', () => {
    expect(resolveAuth(profile({ authKind: 'bearer', authRef: null }), {})).toEqual({
      kind: 'none',
    })
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
