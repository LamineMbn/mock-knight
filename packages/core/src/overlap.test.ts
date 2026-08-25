import { describe, expect, it } from 'vitest'
import { DEFAULT_PRIORITY, describeStanding, verdictOf, WIREMOCK_PRIORITY } from './overlap.js'
import type { PriorityModel, PriorityStanding } from './overlap.js'

const standing = (over: Partial<PriorityStanding> = {}): PriorityStanding => ({
  priority: DEFAULT_PRIORITY,
  explicit: false,
  contenders: 1,
  ahead: 0,
  tied: 0,
  ...over,
})

describe('priority standing', () => {
  it('says nothing when a stub has no contenders', () => {
    expect(verdictOf(standing())).toBe('sole')
    // A row with nothing to warn about must stay silent, or the glyph means nothing.
    expect(describeStanding(standing())).toBeNull()
  })

  it('treats a lower number as the stronger one', () => {
    // The direction people get wrong. 1 beats 5.
    expect(verdictOf(standing({ priority: 1, contenders: 3, ahead: 0, tied: 0 }))).toBe('wins')
    expect(verdictOf(standing({ priority: 9, contenders: 3, ahead: 2, tied: 0 }))).toBe('shadowed')
  })

  it('separates a tie from a win, because WireMock does not resolve ties', () => {
    const tie = standing({ contenders: 3, ahead: 0, tied: 2 })
    expect(verdictOf(tie)).toBe('ambiguous')
    // Not "wins": nothing outranks it, but nothing makes it the winner either.
    expect(describeStanding(tie)).toContain('does not define which of them answers')
  })

  it('marks an implied default as such rather than as the stub having chosen 5', () => {
    expect(describeStanding(standing({ contenders: 2, ahead: 1 }))).toContain(
      'priority 5 (the default)',
    )
    expect(describeStanding(standing({ contenders: 2, ahead: 1, explicit: true }))).not.toContain(
      'the default',
    )
  })

  it('counts in the singular without a stray plural', () => {
    const one = describeStanding(standing({ contenders: 2, ahead: 1 }))
    expect(one).toContain('1 higher-priority stub ')
    const two = describeStanding(standing({ contenders: 3, ahead: 2 }))
    expect(two).toContain('2 higher-priority stubs ')
  })

  it('describes every verdict that is not sole', () => {
    // A missing branch would render an empty tooltip on a visible glyph.
    for (const s of [
      standing({ contenders: 2, ahead: 0, tied: 0, priority: 1 }),
      standing({ contenders: 2, ahead: 0, tied: 1 }),
      standing({ contenders: 2, ahead: 1 }),
    ]) {
      expect(describeStanding(s)).toBeTruthy()
    }
  })
})

describe('a backend that ranks the other way round', () => {
  const MOCKSERVER: PriorityModel = {
    implicit: 0,
    direction: 'higher-wins',
    backend: 'MockServer',
  }

  it('tells a MockServer user to raise the number, not lower it', () => {
    /*
     * The advice used to be "give one a lower number" for every backend, because the sentence was
     * written against WireMock. On MockServer that is the exact opposite of what works: two
     * expectations on one path, priorities 1 and 9, and the **9** answers (§17.34). Following the
     * old advice would move a stub further from ever being reached.
     */
    const tied = { priority: 3, explicit: true, contenders: 2, ahead: 0, tied: 1 }
    expect(describeStanding(tied, MOCKSERVER)).toContain('give one a higher number')
    expect(describeStanding(tied, WIREMOCK_PRIORITY)).toContain('give one a lower number')
  })

  it('names the backend that cannot resolve the tie, rather than always WireMock', () => {
    const tied = { priority: 3, explicit: true, contenders: 2, ahead: 0, tied: 1 }
    expect(describeStanding(tied, MOCKSERVER)).toContain('MockServer does not define')
  })
})

describe('a backend with no priority number', () => {
  const PRISM: PriorityModel = { implicit: null, direction: 'lower-wins', backend: 'Prism' }

  it('explains the contest by order instead of quoting a number it does not have', () => {
    // Prism and Mockoon rank by order. Saying "at priority 5 (the default)" about them stated
    // WireMock's number as though it were theirs.
    const shadowed = { priority: null, explicit: false, contenders: 2, ahead: 1, tied: 0 }
    const sentence = describeStanding(shadowed, PRISM)
    expect(sentence).toContain('in the order this backend consults them')
    expect(sentence).not.toContain('priority 5')
  })
})
