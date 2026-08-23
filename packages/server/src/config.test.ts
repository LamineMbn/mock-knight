import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from './config.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mk-config-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env['MK_TEST_URL']
  delete process.env['MK_TEST_TOKEN']
})

function write(contents: unknown, name = 'mock-knight.json'): string {
  const path = join(dir, name)
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents))
  return path
}

describe('loadConfig', () => {
  it('reads the fields the CLI needs', () => {
    const { config } = loadConfig(
      write({
        port: 8123,
        mode: 'deployed',
        allowedHosts: ['localhost:8080', 'wiremock.internal'],
        profiles: [{ name: 'staging', adapter: 'wiremock', baseUrl: 'https://mocks.example/ctx' }],
      }),
    )
    expect(config.port).toBe(8123)
    expect(config.mode).toBe('deployed')
    expect(config.allowedHosts).toEqual(['localhost:8080', 'wiremock.internal'])
    expect(config.profiles?.[0]).toMatchObject({
      name: 'staging',
      baseUrl: 'https://mocks.example/ctx',
    })
  })

  it('distinguishes an empty allowlist from an absent one', () => {
    // Absent means "no restriction"; empty means "reach nothing". Collapsing them would turn a
    // deliberate lockdown into unrestricted outbound access.
    expect(loadConfig(write({ allowedHosts: [] })).config.allowedHosts).toEqual([])
    expect(loadConfig(write({})).config.allowedHosts).toBeUndefined()
  })

  it('interpolates ${env:VAR}', () => {
    process.env['MK_TEST_URL'] = 'http://localhost:19000'
    const { config } = loadConfig(
      write({ profiles: [{ name: 'p', adapter: 'wiremock', baseUrl: '${env:MK_TEST_URL}/ctx' }] }),
    )
    expect(config.profiles?.[0]?.baseUrl).toBe('http://localhost:19000/ctx')
  })

  it('never interpolates authRef, which names a variable rather than holding one', () => {
    // The whole secret design depends on this: the file stores the name, the value is resolved
    // per request and never persisted. Interpolating would let a token into a committed file.
    process.env['MK_TEST_TOKEN'] = 'super-secret'
    const { config } = loadConfig(
      write({
        profiles: [
          {
            name: 'p',
            adapter: 'wiremock',
            baseUrl: 'http://localhost:8080',
            authKind: 'bearer',
            authRef: 'MK_TEST_TOKEN',
          },
        ],
      }),
    )
    expect(config.profiles?.[0]?.authRef).toBe('MK_TEST_TOKEN')
    expect(JSON.stringify(config)).not.toContain('super-secret')
  })

  it('refuses rather than substituting an empty string for an unset variable', () => {
    const path = write({
      profiles: [{ name: 'p', adapter: 'wiremock', baseUrl: '${env:MK_ABSENT}' }],
    })
    // An empty base URL would fail later with a message about URLs, which sends the reader
    // somewhere unrelated to the actual mistake.
    expect(() => loadConfig(path)).toThrow(/MK_ABSENT.*not set/s)
  })

  it('resolves relative paths against the file, not the working directory', () => {
    const { config } = loadConfig(write({ state: './mirror.db' }))
    expect(config.state).toBe(join(dir, 'mirror.db'))
  })

  it('names the file and the field when the config is wrong', () => {
    const path = write({ port: 99999 })
    try {
      loadConfig(path)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as ConfigError).path).toBe(path)
      expect((error as ConfigError).message).toContain('port')
    }
  })

  it('rejects an unknown key instead of ignoring it', () => {
    // A typo'd key that is silently dropped is the same failure this file was added to fix.
    expect(() => loadConfig(write({ allowedHost: ['x'] }))).toThrow(/allowedHost/)
  })

  it('says YAML is unsupported rather than skipping the file', () => {
    expect(() => loadConfig(write('host: 0.0.0.0', 'mock-knight.yaml'))).toThrow(
      /YAML config is not implemented/,
    )
  })

  it('reports malformed JSON as such', () => {
    expect(() => loadConfig(write('{ "port": }'))).toThrow(/not valid JSON/)
  })

  it('reports a missing file rather than pretending there was none', () => {
    // Distinct from "no config file was given": an explicit --config that does not exist is a
    // mistake worth stopping for.
    expect(() => loadConfig(join(dir, 'absent.json'))).toThrow(/Could not read it/)
  })
})

describe('the messages that promise this file', () => {
  it('names a file name loadConfig actually looks for', async () => {
    // Two user-facing messages told people to edit `mock-knight.json` for two milestones before
    // anything read it. This asserts the promise and the implementation stay the same string.
    const { DEFAULT_CONFIG_FILENAME } = await import('./config.js')
    const { AdapterHostNotAllowedError } = await import('@mock-knight/core')
    expect(new AdapterHostNotAllowedError('h').message).toContain(DEFAULT_CONFIG_FILENAME)
  })

  it('accepts a file carrying only allowedHosts, which is what that message tells people to write', () => {
    const { config } = loadConfig(write({ allowedHosts: ['wiremock.internal:8080'] }))
    expect(config.allowedHosts).toEqual(['wiremock.internal:8080'])
  })
})
