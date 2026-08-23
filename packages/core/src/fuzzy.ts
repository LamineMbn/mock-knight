/**
 * Subsequence matching for the command palette — design brief §6.10.
 *
 * Deliberately a *subsequence* match rather than a fuzzy-distance one: `crjn` should find
 * "Clear journal", but `clean` should not find "Clear journal" by tolerating a wrong letter. A
 * palette that guesses past a typo puts a destructive action under a query the person did not
 * type, and this palette lists destructive actions.
 *
 * Returns the indices it matched so the caller can emphasise them, and a score used only to
 * order results — never to decide whether something matched.
 *
 * Browser-safe: no `node:` imports.
 */

export interface FuzzyMatch {
  /** Higher is better. Only meaningful when comparing matches of the same query. */
  readonly score: number
  /** Indices into the haystack that the query matched, ascending. */
  readonly indices: readonly number[]
}

/**
 * @returns `null` when the query is not a subsequence of the haystack. An empty query matches
 *   everything with a score of 0, which is what an empty palette input should show.
 */
export function fuzzyMatch(query: string, haystack: string): FuzzyMatch | null {
  if (query === '') return { score: 0, indices: [] }

  const needle = query.toLowerCase()
  const target = haystack.toLowerCase()
  const indices: number[] = []

  let at = 0
  for (const character of needle) {
    // Spaces in the query are separators, not characters to find: "cl jo" should behave like
    // "cljo" against "Clear journal" rather than requiring a literal space between them.
    if (character === ' ') continue
    const found = target.indexOf(character, at)
    if (found === -1) return null
    indices.push(found)
    at = found + 1
  }
  if (indices.length === 0) return { score: 0, indices: [] }

  let score = 0
  for (let position = 0; position < indices.length; position++) {
    const index = indices[position]!
    // A run of adjacent characters is a much stronger signal than the same characters scattered,
    // so "jour" ranks "journal" above "just our".
    if (position > 0 && index === indices[position - 1]! + 1) score += 8
    // So is landing on a word boundary: "cj" should prefer "Clear journal" over "conjure".
    const previous = index === 0 ? ' ' : target[index - 1]!
    if (index === 0 || previous === ' ' || previous === '-' || previous === '/') score += 6
    // Earlier is better, mildly.
    score += Math.max(0, 4 - index / 8)
  }
  // Matching most of a short label beats matching a little of a long one.
  score += (indices.length / target.length) * 10
  return { score, indices }
}

/** Rank candidates by how well the query matches, dropping the ones it does not. */
export function fuzzyRank<T>(
  query: string,
  items: readonly T[],
  label: (item: T) => string,
): { item: T; match: FuzzyMatch }[] {
  return items
    .flatMap((item) => {
      const match = fuzzyMatch(query, label(item))
      return match === null ? [] : [{ item, match }]
    })
    .sort((a, b) => b.match.score - a.match.score)
}
