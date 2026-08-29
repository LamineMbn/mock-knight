import { describe, expect, it } from 'vitest'
import { BACKENDS, CAPABILITY_ORDER } from './backends.js'
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

  /**
   * `CapabilityMatrix.astro` zips `CAPABILITY_ORDER` (the row labels) with each backend's
   * `capabilities[index]` (the row values) by position, not by label — so the row axis and the
   * column axis have to agree on both order and membership, not just agree with each other. A
   * matrix with different rows per column compares nothing; a matrix whose columns agree with
   * each other but not with `CAPABILITY_ORDER` renders every row against the wrong label.
   */
  it('compares the same capabilities across every backend, in the order the matrix renders them', () => {
    const labels = BACKENDS.map((backend) => backend.capabilities.map((c) => c.label).join('|'))
    expect(
      new Set([...labels, CAPABILITY_ORDER.join('|')]).size,
      'a matrix whose rows do not match CAPABILITY_ORDER pairs every label with the wrong state',
    ).toBe(1)
  })
})
