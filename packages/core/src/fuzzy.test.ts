import { describe, expect, it } from 'vitest'
import { fuzzyMatch, fuzzyRank } from './fuzzy.js'

describe('fuzzyMatch', () => {
  it('matches a subsequence and reports where', () => {
    const match = fuzzyMatch('cj', 'Clear journal')
    expect(match).not.toBeNull()
    expect(match!.indices).toEqual([0, 6])
  })

  it('requires every character, in order', () => {
    // The reason this is a subsequence match and not a distance one: the palette lists
    // destructive actions, and guessing past a typo puts one under a query nobody typed.
    expect(fuzzyMatch('xyz', 'Clear journal')).toBeNull()
    // A letter that is simply absent.
    expect(fuzzyMatch('clearz', 'Clear journal')).toBeNull()
    // Present, but out of order — 'c' occurs only before 'j'.
    expect(fuzzyMatch('jc', 'Clear journal')).toBeNull()
    // And `clean` *is* a subsequence of "clear journal", which is the honest behaviour of a
    // subsequence match rather than a bug: c-l-e-a from "clea", n from "journal".
    expect(fuzzyMatch('clean', 'Clear journal')).not.toBeNull()
  })

  it('treats spaces in the query as separators', () => {
    expect(fuzzyMatch('cl jo', 'Clear journal')).not.toBeNull()
  })

  it('matches everything on an empty query', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] })
  })

  it('is case-insensitive both ways', () => {
    expect(fuzzyMatch('CLEAR', 'clear journal')).not.toBeNull()
    expect(fuzzyMatch('clear', 'CLEAR JOURNAL')).not.toBeNull()
  })
})

describe('fuzzyRank', () => {
  const rank = (query: string, labels: string[]) =>
    fuzzyRank(query, labels, (label) => label).map((result) => result.item)

  it('prefers a contiguous run over scattered characters', () => {
    expect(rank('jour', ['just our thing', 'journal'])[0]).toBe('journal')
  })

  it('prefers word boundaries', () => {
    expect(rank('cj', ['conjure', 'Clear journal'])[0]).toBe('Clear journal')
  })

  it('prefers matching most of a short label over a little of a long one', () => {
    expect(rank('traffic', ['Traffic', 'Filter traffic by correlation id'])[0]).toBe('Traffic')
  })

  it('drops what does not match rather than ranking it last', () => {
    // A palette that shows everything, badly ordered, is a list — the filtering is the feature.
    expect(rank('zzz', ['Corpus', 'Traffic'])).toEqual([])
  })

  it('keeps every candidate on an empty query, in the given order', () => {
    expect(rank('', ['Corpus', 'Traffic', 'Servers'])).toEqual(['Corpus', 'Traffic', 'Servers'])
  })
})
