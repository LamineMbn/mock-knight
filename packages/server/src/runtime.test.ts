import { describe, expect, it } from 'vitest'
import {
  RESTART_TOLERANCE_MS,
  environmentCapabilities,
  hasRestarted,
  resolveAuth,
} from './runtime.js'
import type { Profile } from './profiles.js'

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
