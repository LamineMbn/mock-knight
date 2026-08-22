import { describe, expect, it } from 'vitest'
import { DEFAULT_PRIORITY, describeStanding, verdictOf } from './overlap.js'
import type { PriorityStanding } from './overlap.js'

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
