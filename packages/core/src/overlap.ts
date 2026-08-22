/**
 * Priority standing — which stub actually wins when several can match one request (FR-FIND-7).
 *
 * A corpus that selects between mocks by request header has many stubs on the same method and
 * path, differing only in what they require of the request. Which one answers is then decided
 * by `priority`, and that is invisible in a flat list: the stub you are reading may never be
 * reached, and nothing on the row says so.
 *
 * Everything here is **inference**, not something the server reported (design brief §9.4). It
 * is deliberately conservative: two stubs are treated as contending only when they share a URL
 * matcher *and* their methods can overlap. Stubs whose regex or path templates happen to cover
 * the same request are not detected, so an absent warning is not a promise of no conflict —
 * only a present one is a claim. Say the former plainly wherever this is rendered.
 *
 * Browser-safe: no `node:` imports.
 */

/**
 * WireMock's default when a stub does not set one, and the number a stub is judged at.
 *
 * Lower wins — 1 is the highest priority, not the lowest. This trips people up often enough
 * that the UI never shows a bare number without saying which direction is stronger.
 */
export const DEFAULT_PRIORITY = 5

export interface PriorityStanding {
  /** What the stub is judged at: its own priority, or `DEFAULT_PRIORITY`. */
  readonly priority: number
  /** Whether the stub set that number, or Mock Knight filled the default in. */
  readonly explicit: boolean
  /** Stubs that can match the same request, this one included. 1 means no contest. */
  readonly contenders: number
  /** Contenders that outrank it. Above zero and this stub may never be reached. */
  readonly ahead: number
  /** Contenders on the same number. WireMock does not define a winner among these. */
  readonly tied: number
}

/**
 * `sole` — nothing else contends. `wins` — outranks every contender.
 * `ambiguous` — level with at least one, so the winner is not decided by priority.
 * `shadowed` — something outranks it.
 */
export type PriorityVerdict = 'sole' | 'wins' | 'ambiguous' | 'shadowed'

export function verdictOf(standing: PriorityStanding): PriorityVerdict {
  if (standing.contenders <= 1) return 'sole'
  if (standing.ahead > 0) return 'shadowed'
  return standing.tied > 0 ? 'ambiguous' : 'wins'
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * The plain-language explanation, in the brief's §10 voice: specific, calm, no hedging beyond
 * what is actually uncertain. Returns `null` when there is nothing worth saying.
 */
export function describeStanding(standing: PriorityStanding): string | null {
  const at = `priority ${standing.priority}${standing.explicit ? '' : ' (the default)'}`
  switch (verdictOf(standing)) {
    case 'sole':
      return null
    case 'wins':
      return (
        `Answers first. ${plural(standing.contenders, 'stub', 'stubs')} match this method and ` +
        `path, and at ${at} this one outranks the rest.`
      )
    case 'ambiguous':
      return (
        `Level with ${plural(standing.tied, 'other stub', 'other stubs')} at ${at}. WireMock ` +
        `does not define which of them answers — give one a lower number to decide it.`
      )
    case 'shadowed':
      return (
        `Shadowed by ${plural(standing.ahead, 'higher-priority stub', 'higher-priority stubs')} ` +
        `on this method and path. At ${at} this one is only reached if they stop matching.`
      )
  }
}
