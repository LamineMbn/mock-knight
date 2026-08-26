import { describe, expect, it } from 'vitest'
import { looksLikeSecret } from './ServerForm.js'

/**
 * The field takes the *name* of an environment variable. A secret typed there instead would be
 * stored in the state database and shown in the servers list, so the form warns — and the whole
 * value of the warning is whether it fires on things people actually paste.
 */
describe('looksLikeSecret', () => {
  it('accepts the variable names people really use', () => {
    for (const name of ['WIREMOCK_TOKEN', 'MK_USER', 'wiremock_pass', 'Token', 'CI']) {
      expect(looksLikeSecret('bearer', name), name).toBe(false)
    }
  })

  it('accepts each half of a basic-auth pair and each header pair', () => {
    expect(looksLikeSecret('basic', 'WIREMOCK_USER:WIREMOCK_PASS')).toBe(false)
    expect(looksLikeSecret('headers', 'Authorization=WM_TOKEN,X-Api-Key=WM_KEY')).toBe(false)
  })

  it('catches a JWT, which is entirely alphanumeric and passed the first version of this', () => {
    expect(looksLikeSecret('bearer', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(true)
  })

  it('catches the shapes credentials come in', () => {
    // Punctuation no identifier can hold.
    expect(looksLikeSecret('basic', 'mkuser:hunter2!!')).toBe(true)
    // A hex key: one case, but far too long to be a name and no word separators.
    expect(looksLikeSecret('bearer', 'a3f2b1c4d5e6f7a8b9c0d1e2f3a4b5c6')).toBe(true)
    // A real-looking API token.
    expect(looksLikeSecret('bearer', 'sk-proj-AbCdEf0123456789GhIjKlMnOp')).toBe(true)
  })

  it('says nothing when authentication is off or the field is empty', () => {
    expect(looksLikeSecret('none', 'anything at all')).toBe(false)
    expect(looksLikeSecret('bearer', '   ')).toBe(false)
  })
})
