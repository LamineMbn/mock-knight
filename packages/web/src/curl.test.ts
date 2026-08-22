import { describe, expect, it } from 'vitest'
import { shellQuote, toCurl } from './curl.js'
import type { Explanation } from './api.js'

const request = (over: Partial<Explanation['request']> = {}): Explanation['request'] => ({
  method: 'POST',
  url: '/v1/orders',
  headers: { 'X-Tenant': 'acme' },
  body: null,
  ...over,
})

describe('shellQuote', () => {
  it('wraps a plain value', () => {
    expect(shellQuote('acme')).toBe("'acme'")
  })

  it('survives an apostrophe, which single quotes cannot escape in place', () => {
    // The failure this guards is silent: `'''` concatenates away and the apostrophe vanishes,
    // so a pasted command runs and sends different data than the one that was captured.
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })

  it('leaves double quotes and backslashes alone — single quotes already protect them', () => {
    expect(shellQuote('{"a":"b\\c"}')).toBe(`'{"a":"b\\c"}'`)
  })

  it('handles a value that is only an apostrophe', () => {
    expect(shellQuote("'")).toBe(`''\\'''`)
  })
})

describe('toCurl', () => {
  it('builds a runnable command', () => {
    expect(toCurl(request(), 'http://mock:8080')).toBe(
      "curl -i -X POST 'http://mock:8080/v1/orders' \\\n  -H 'X-Tenant: acme'",
    )
  })

  it('drops Content-Length, which curl must recompute', () => {
    const command = toCurl(
      request({ headers: { 'Content-Length': '23', 'X-Tenant': 'acme' } }),
      'http://mock:8080',
    )
    expect(command).not.toContain('Content-Length')
    expect(command).toContain('X-Tenant')
  })

  it('includes a body and escapes an apostrophe inside it', () => {
    const command = toCurl(request({ body: `{"note":"it's fine"}` }), 'http://mock:8080')
    expect(command).toContain(`--data-raw '{"note":"it'\\''s fine"}'`)
  })

  it('omits --data-raw for an empty body rather than sending an empty string', () => {
    expect(toCurl(request({ body: '' }), 'http://mock:8080')).not.toContain('--data-raw')
  })
})
