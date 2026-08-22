import { describe, expect, it } from 'vitest'
import { AdapterTransportError, describeTransportFailure, transportCode } from './adapter.js'

describe('transportCode', () => {
  it('digs the real reason out of undici’s cause chain', () => {
    // The shape undici actually throws: a bare TypeError wrapping the useful error.
    const inner = Object.assign(new Error('getaddrinfo ENOTFOUND api.example'), {
      code: 'ENOTFOUND',
    })
    const outer = Object.assign(new TypeError('fetch failed'), { cause: inner })
    expect(transportCode(outer)).toBe('ENOTFOUND')
  })

  it('gives up rather than looping on a self-referential cause', () => {
    const looped: { cause?: unknown } = {}
    looped.cause = looped
    expect(transportCode(looped)).toBeNull()
  })

  it('returns null when nothing in the chain carries a code', () => {
    expect(transportCode(new Error('fetch failed'))).toBeNull()
    expect(transportCode(null)).toBeNull()
    expect(transportCode('not an error')).toBeNull()
  })
})

describe('describeTransportFailure', () => {
  it('names the host, not the whole URL, so the sentence stays readable', () => {
    expect(describeTransportFailure('ECONNREFUSED', 'https://api-int.example.com/wcboo/__admin')).toBe(
      'Nothing is listening on api-int.example.com. The server may be down, or on a different port.',
    )
  })

  it('distinguishes the failures whose fixes are different', () => {
    const at = (code: string) => describeTransportFailure(code, 'https://host/x')
    // Each of these sends the reader somewhere different, which is the entire point.
    expect(at('ENOTFOUND')).toContain('VPN')
    expect(at('ETIMEDOUT')).toContain('firewall')
    expect(at('CERT_HAS_EXPIRED')).toContain('expired')
    expect(at('UNABLE_TO_VERIFY_LEAF_SIGNATURE')).toContain('trust store')
    expect(at('ERR_TLS_CERT_ALTNAME_INVALID')).toContain('different hostname')
  })

  it('surfaces an unrecognised code rather than hiding it behind a vague sentence', () => {
    // A code can be searched for; "something went wrong" cannot.
    expect(describeTransportFailure('EHOSTUNREACH', 'https://host/x')).toBe(
      'Could not reach host (EHOSTUNREACH).',
    )
  })

  it('keeps an unparseable URL whole, because that is itself the problem', () => {
    expect(describeTransportFailure(null, 'not a url')).toBe('Could not reach not a url.')
  })
})

describe('AdapterTransportError', () => {
  it('carries what the disclosure needs and reads well unhandled', () => {
    const error = new AdapterTransportError(
      'GET',
      'https://host/wcboo/__admin/mappings',
      'ENOTFOUND',
      'getaddrinfo ENOTFOUND host',
    )
    expect(error.name).toBe('AdapterTransportError')
    expect(error.method).toBe('GET')
    expect(error.code).toBe('ENOTFOUND')
    // The message is the human sentence, not "fetch failed".
    expect(error.message).toContain('No DNS record for host')
    // And the raw detail survives for the copyable block.
    expect(error.detail).toBe('getaddrinfo ENOTFOUND host')
  })
})
