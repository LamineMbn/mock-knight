import { describe, expect, it } from 'vitest'
import { START_STATE, analyseScenario } from './scenarios.js'
import type { ScenarioTransition } from './scenarios.js'

const edge = (from: string | null, to: string | null, name = 'stub'): ScenarioTransition => ({
  clientKey: `${name}-${from}-${to}`,
  stubName: name,
  from,
  to,
})

/** Started → ordered → shipped */
const happyPath = [edge(START_STATE, 'ordered', 'create'), edge('ordered', 'shipped', 'ship')]

describe('states', () => {
  it('collects every state any stub mentions, plus the implicit start', () => {
    const analysis = analyseScenario('checkout', START_STATE, happyPath)
    expect(analysis.states.map((s) => s.name)).toEqual(['Started', 'ordered', 'shipped'])
  })

  it('includes states the server declares even when no stub mentions them', () => {
    const analysis = analyseScenario('checkout', START_STATE, happyPath, ['cancelled'])
    expect(analysis.states.map((s) => s.name)).toContain('cancelled')
  })

  it('marks the current state', () => {
    const analysis = analyseScenario('checkout', 'ordered', happyPath)
    expect(analysis.states.find((s) => s.name === 'ordered')?.isCurrent).toBe(true)
    expect(analysis.states.filter((s) => s.isCurrent)).toHaveLength(1)
  })
})

describe('reachability — FR-STATE-4', () => {
  it('treats everything on the happy path as reachable', () => {
    const analysis = analyseScenario('checkout', START_STATE, happyPath)
    expect(analysis.states.every((s) => s.reachable)).toBe(true)
    expect(analysis.warnings.filter((w) => w.includes('cannot be reached'))).toEqual([])
  })

  it('flags a state nothing transitions into, which is usually a typo', () => {
    const withTypo = [...happyPath, edge('shippd', 'delivered', 'deliver')]
    const analysis = analyseScenario('checkout', START_STATE, withTypo)
    const orphan = analysis.states.find((s) => s.name === 'shippd')
    expect(orphan?.reachable).toBe(false)
    expect(analysis.warnings.some((w) => w.includes('shippd') && w.includes('typo'))).toBe(true)
  })

  it('follows a stub with no required state, which applies in every state', () => {
    // `requiredScenarioState: null` means "matches whatever state we are in", so it is an edge
    // out of all of them — treating it as an edge only from Started would report false orphans.
    const analysis = analyseScenario('checkout', START_STATE, [
      edge(START_STATE, 'ordered'),
      edge(null, 'reset-marker', 'any-state'),
    ])
    expect(analysis.states.find((s) => s.name === 'reset-marker')?.reachable).toBe(true)
  })

  it('notices when the live state itself is unreachable', () => {
    // Someone set it by hand, or a stub was deleted after the fact.
    const analysis = analyseScenario('checkout', 'ghost', happyPath)
    expect(analysis.warnings.some((w) => w.includes('“ghost”') && w.includes('by hand'))).toBe(true)
  })
})

describe('dead ends', () => {
  it('flags a state nothing advances out of', () => {
    const analysis = analyseScenario('checkout', START_STATE, happyPath)
    expect(analysis.states.find((s) => s.name === 'shipped')?.terminal).toBe(true)
    expect(analysis.warnings.some((w) => w.includes('shipped') && w.includes('only a reset'))).toBe(
      true,
    )
  })

  it('does not call the start state a dead end just because it has no exit yet', () => {
    // An empty scenario is not a broken one.
    const analysis = analyseScenario('empty', START_STATE, [])
    expect(analysis.warnings).toEqual([])
  })
})

describe('edge counts, which the transition table renders', () => {
  it('counts incoming and outgoing per state', () => {
    const analysis = analyseScenario('checkout', START_STATE, happyPath)
    const started = analysis.states.find((s) => s.name === START_STATE)!
    const ordered = analysis.states.find((s) => s.name === 'ordered')!
    expect(started).toMatchObject({ incoming: 0, outgoing: 1 })
    expect(ordered).toMatchObject({ incoming: 1, outgoing: 1 })
  })

  it('keeps the transitions so a table can show which stub does what', () => {
    const analysis = analyseScenario('checkout', START_STATE, happyPath)
    expect(analysis.transitions.map((t) => t.stubName)).toEqual(['create', 'ship'])
  })
})
