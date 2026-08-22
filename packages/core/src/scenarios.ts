/**
 * Scenario analysis — FR-STATE-1, FR-STATE-3, FR-STATE-4.
 *
 * A scenario is not declared anywhere in WireMock: it *emerges* from the stubs that reference
 * it. Its states are whatever those stubs require or set, and its shape is only visible by
 * reading them all together. That is precisely the thing a developer cannot do by grepping, and
 * it is why this analysis exists rather than a plain list of names.
 *
 * Design brief §6.6 leaves the choice of a rendered state *graph* open, noting a table of
 * `from → stub → to` delivers most of the value. This module produces the data either would
 * need, so that decision stays a rendering question.
 *
 * Browser-safe: no `node:` imports.
 */

/** WireMock's implicit starting state; a stub with no `requiredScenarioState` matches here. */
export const START_STATE = 'Started'

export interface ScenarioTransition {
  readonly clientKey: string
  readonly stubName: string | null
  /** `null` means the stub does not constrain the state, so it applies in every state. */
  readonly from: string | null
  /** `null` means the stub does not advance the scenario. */
  readonly to: string | null
}

export interface ScenarioState {
  readonly name: string
  readonly isCurrent: boolean
  /**
   * Whether any sequence of transitions from the start state can arrive here. An unreachable
   * state is dead configuration — usually a typo in a `newScenarioState` (FR-STATE-4).
   */
  readonly reachable: boolean
  /** No stub advances out of here. Fine for a terminal state, a bug for one in the middle. */
  readonly terminal: boolean
  readonly incoming: number
  readonly outgoing: number
}

export interface ScenarioAnalysis {
  readonly name: string
  readonly currentState: string
  readonly states: readonly ScenarioState[]
  readonly transitions: readonly ScenarioTransition[]
  /** Plain-language problems worth surfacing, or empty when the scenario looks sound. */
  readonly warnings: readonly string[]
}

/**
 * @param declaredStates states the server reports, which may include some no stub mentions.
 */
export function analyseScenario(
  name: string,
  currentState: string,
  transitions: readonly ScenarioTransition[],
  declaredStates: readonly string[] = [],
): ScenarioAnalysis {
  const states = new Set<string>([START_STATE, currentState, ...declaredStates])
  for (const transition of transitions) {
    if (transition.from !== null) states.add(transition.from)
    if (transition.to !== null) states.add(transition.to)
  }

  // A transition with no `from` applies in every state, so it is an edge out of all of them.
  const edgesFrom = (state: string): ScenarioTransition[] =>
    transitions.filter((t) => t.to !== null && (t.from === null || t.from === state))

  const reachable = new Set<string>([START_STATE])
  const queue = [START_STATE]
  while (queue.length > 0) {
    const state = queue.shift()!
    for (const edge of edgesFrom(state)) {
      if (edge.to !== null && !reachable.has(edge.to)) {
        reachable.add(edge.to)
        queue.push(edge.to)
      }
    }
  }

  const analysed: ScenarioState[] = [...states].sort().map((state) => ({
    name: state,
    isCurrent: state === currentState,
    reachable: reachable.has(state),
    terminal: edgesFrom(state).length === 0,
    incoming: transitions.filter((t) => t.to === state).length,
    outgoing: transitions.filter((t) => t.to !== null && (t.from === null || t.from === state))
      .length,
  }))

  const warnings: string[] = []
  const unreachable = analysed.filter((state) => !state.reachable)
  if (unreachable.length > 0) {
    warnings.push(
      `${unreachable.map((s) => `“${s.name}”`).join(', ')} cannot be reached from “${START_STATE}”. ` +
        `Usually a typo in a newScenarioState.`,
    )
  }
  const deadEnds = analysed.filter((state) => state.terminal && state.name !== START_STATE)
  if (deadEnds.length > 0) {
    warnings.push(
      `Nothing advances out of ${deadEnds.map((s) => `“${s.name}”`).join(', ')}. ` +
        `Once the scenario reaches ${deadEnds.length === 1 ? 'it' : 'one of them'}, only a reset moves it.`,
    )
  }
  if (!reachable.has(currentState)) {
    warnings.push(
      `The scenario is currently in “${currentState}”, which no transition can reach. ` +
        `It was probably set by hand.`,
    )
  }

  return { name, currentState, states: analysed, transitions, warnings }
}

/** Group flat transitions by scenario, so one pass over the corpus produces every analysis. */
export function analyseScenarios(
  scenarios: readonly { name: string; currentState: string; possibleStates: readonly string[] }[],
  transitionsByScenario: Readonly<Record<string, readonly ScenarioTransition[]>>,
): ScenarioAnalysis[] {
  return scenarios.map((scenario) =>
    analyseScenario(
      scenario.name,
      scenario.currentState,
      transitionsByScenario[scenario.name] ?? [],
      scenario.possibleStates,
    ),
  )
}
