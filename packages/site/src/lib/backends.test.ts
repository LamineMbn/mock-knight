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
   * The install snippet is the page's primary call to action, so it has to be a command that
   * works. Mockoon and Prism are document-backed: both adapters' `connect()` reads the file
   * named by the profile's `mappingsDir`, and the CLI has no flag for that path — so their
   * snippet cannot be the whole story and must say where the path is supplied.
   *
   * The two are named here rather than derived, because document-backedness is a property of
   * the adapter and this package imports nothing from the workspace (invariant 1). A fifth
   * backend is added to this list at the same time it is added to `BACKENDS`.
   */
  it('never presents a bare command as the whole setup for a document-backed backend', () => {
    /** The adapters whose `connect()` reads `profile.mappingsDir` and throws without it. */
    const documentBacked = ['mockoon', 'prism']

    for (const backend of BACKENDS) {
      expect(
        backend.install.commands.length,
        `${backend.slug}: no install command`,
      ).toBeGreaterThan(0)
      expect(
        backend.install.commands.some((command) => command.includes('mock-knight')),
        `${backend.slug}: the install block never runs mock-knight`,
      ).toBe(true)
      expect(
        backend.install.commands.some((command) => command.includes(`--adapter ${backend.slug}`)),
        `${backend.slug}: the install block does not select this backend`,
      ).toBe(true)

      if (documentBacked.includes(backend.slug)) {
        expect(
          backend.install.note,
          `${backend.slug} is document-backed: the command alone builds a profile that cannot connect`,
        ).toBeTruthy()
        expect(backend.install.note).toContain('Servers screen')
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
