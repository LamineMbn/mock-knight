import { describe, expect, it } from 'vitest'
import { BACKENDS } from './backends.js'
import { ROUTES } from './routes.js'

describe('BACKENDS', () => {
  it('covers the four backends the adapters support', () => {
    expect(BACKENDS.map((backend) => backend.slug)).toEqual([
      'wiremock',
      'mockserver',
      'mockoon',
      'prism',
    ])
  })

  it('has a declared route for every backend', () => {
    for (const backend of BACKENDS) {
      expect(
        ROUTES.some((route) => route.path === `/${backend.slug}/`),
        `no route for ${backend.slug}`,
      ).toBe(true)
    }
  })

  /**
   * Invariant 4, applied to copy. In the application a capability that is off means the control
   * is absent with a reason. On the site the equivalent is: an absent capability is *stated*,
   * and it says why — because "no traffic log" without "MockServer records no attribution for a
   * served request" reads as an unfinished product rather than an honest limit.
   */
  it('explains every capability that is off', () => {
    for (const backend of BACKENDS) {
      for (const capability of backend.capabilities) {
        if (capability.state === 'off') {
          expect(
            capability.note,
            `${backend.slug} → "${capability.label}" is off with no reason given`,
          ).toBeTruthy()
        }
      }
    }
  })

  it('compares the same capabilities across every backend', () => {
    const labels = BACKENDS.map((backend) => backend.capabilities.map((c) => c.label).join('|'))
    expect(new Set(labels).size, 'a matrix with different rows per column compares nothing').toBe(1)
  })
})
