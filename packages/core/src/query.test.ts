import { describe, expect, it } from 'vitest'
import { LOCAL_ENVIRONMENT_CAPABILITIES, resolveCapabilities } from './capabilities.js'
import type { CapabilityBit } from './capabilities.js'
import { QUERY_FIELDS, QUERY_FIELD_CAPABILITY, describeFilter, parseQuery } from './query.js'

function withBackend(...bits: CapabilityBit[]) {
  return { capabilities: resolveCapabilities({ backend: bits, environment: [] }) }
}

const fullyCapable = {
  capabilities: resolveCapabilities({
    backend: ['journal.read', 'mock.enableDisable', 'mock.priority'],
    environment: LOCAL_ENVIRONMENT_CAPABILITIES,
  }),
}

describe('the grammar', () => {
  it('has exactly the token types the design specifies — ten from §11, plus header from A6', () => {
    // This list is a guard, not a formality: the grammar is a published contract, so growing it
    // is a documented amendment rather than an implementation detail.
    expect([...QUERY_FIELDS].sort()).toEqual([
      'body',
      'disabled',
      'folder',
      'header',
      'method',
      'priority',
      'scenario',
      'status',
      'tag',
      'unused',
      'url',
    ])
  })
})

describe('parseQuery — recognised tokens', () => {
  it('parses the worked example from TECH-DESIGN §11', () => {
    const plan = parseQuery(
      'method:POST url:/v1/orders* status:500 scenario:checkout tag:legacy ' +
        'body:"insufficient" priority:<5 unused:true disabled:true folder:orders/v1',
      fullyCapable,
    )
    expect(plan.rejected).toEqual([])
    expect(plan.terms).toEqual([])
    expect(plan.filters).toEqual([
      { field: 'method', op: 'eq', value: 'POST', span: { start: 0, end: 11 } },
      { field: 'url', op: 'glob', value: '/v1/orders*', span: { start: 12, end: 27 } },
      { field: 'status', op: 'eq', value: 500, span: { start: 28, end: 38 } },
      { field: 'scenario', op: 'eq', value: 'checkout', span: { start: 39, end: 56 } },
      { field: 'tag', op: 'eq', value: 'legacy', span: { start: 57, end: 67 } },
      { field: 'body', op: 'contains', value: 'insufficient', span: { start: 68, end: 87 } },
      { field: 'priority', op: 'lt', value: 5, span: { start: 88, end: 99 } },
      { field: 'unused', op: 'is', value: true, span: { start: 100, end: 111 } },
      { field: 'disabled', op: 'is', value: true, span: { start: 112, end: 125 } },
      { field: 'folder', op: 'eq', value: 'orders/v1', span: { start: 126, end: 142 } },
    ])
  })

  it('upper-cases methods so method:post finds POST stubs', () => {
    expect(parseQuery('method:post', fullyCapable).filters[0]).toMatchObject({ value: 'POST' })
  })

  it('reads a status class as a class, not as a number', () => {
    expect(parseQuery('status:5xx', fullyCapable).filters[0]).toMatchObject({
      field: 'status',
      op: 'class',
      value: 5,
    })
    expect(parseQuery('status:2XX', fullyCapable).filters[0]).toMatchObject({ op: 'class' })
  })

  it('reads every priority comparison operator', () => {
    const ops = ['priority:<5', 'priority:<=5', 'priority:>5', 'priority:>=5', 'priority:5']
    expect(ops.map((q) => parseQuery(q, fullyCapable).filters[0]?.op)).toEqual([
      'lt',
      'lte',
      'gt',
      'gte',
      'eq',
    ])
  })

  it('treats a url without a wildcard as a substring search', () => {
    expect(parseQuery('url:/v1/orders', fullyCapable).filters[0]).toMatchObject({ op: 'contains' })
  })

  it('accepts the usual spellings of a boolean', () => {
    for (const yes of ['true', 'yes', '1']) {
      expect(parseQuery(`unused:${yes}`, fullyCapable).filters[0]).toMatchObject({ value: true })
    }
    for (const no of ['false', 'no', '0']) {
      expect(parseQuery(`unused:${no}`, fullyCapable).filters[0]).toMatchObject({ value: false })
    }
  })

  it('keeps a quoted value whole, spaces and all', () => {
    const plan = parseQuery('body:"insufficient funds"', fullyCapable)
    expect(plan.filters[0]).toMatchObject({ field: 'body', value: 'insufficient funds' })
  })

  it('ORs repeated tokens on one field and ANDs across fields', () => {
    const plan = parseQuery('method:GET method:POST status:500', fullyCapable)
    expect(plan.groups).toEqual([
      { field: 'method', filters: [expect.anything(), expect.anything()] },
      { field: 'status', filters: [expect.anything()] },
    ])
  })
})

describe('parseQuery — free text and degradation', () => {
  it('keeps an unknown token as literal text rather than dropping it', () => {
    const plan = parseQuery('sku:AX-91', fullyCapable)
    expect(plan.filters).toEqual([])
    expect(plan.terms).toEqual([{ text: 'sku:AX-91', span: { start: 0, end: 9 }, phrase: false }])
  })

  it('degrades a recognised field with an unusable value to free text', () => {
    for (const query of ['status:banana', 'priority:soon', 'unused:maybe']) {
      const plan = parseQuery(query, fullyCapable)
      expect(plan.filters, query).toEqual([])
      expect(plan.terms[0]?.text, query).toBe(query)
    }
  })

  it('degrades an empty value to free text instead of erroring', () => {
    const plan = parseQuery('status:', fullyCapable)
    expect(plan.filters).toEqual([])
    expect(plan.terms[0]?.text).toBe('status:')
  })

  it('marks a quoted run as a phrase and strips the quotes', () => {
    const plan = parseQuery('"insufficient funds"', fullyCapable)
    expect(plan.terms).toEqual([
      { text: 'insufficient funds', span: { start: 0, end: 20 }, phrase: true },
    ])
  })

  it('survives an unterminated quote by taking the rest of the line', () => {
    const plan = parseQuery('body:"never closed', fullyCapable)
    expect(plan.filters[0]).toMatchObject({ field: 'body', value: 'never closed' })
  })

  it('mixes free text with filters in one query', () => {
    const plan = parseQuery('orders method:POST refund', fullyCapable)
    expect(plan.filters).toHaveLength(1)
    expect(plan.terms.map((t) => t.text)).toEqual(['orders', 'refund'])
  })

  it('returns an empty plan for empty or whitespace-only input', () => {
    for (const query of ['', '   ', '\t']) {
      const plan = parseQuery(query, fullyCapable)
      expect(plan.filters).toEqual([])
      expect(plan.terms).toEqual([])
      expect(plan.isEmpty).toBe(true)
    }
  })
})

describe('parseQuery — capability gating', () => {
  it('gates exactly the three tokens whose data a backend can withhold', () => {
    expect(QUERY_FIELD_CAPABILITY).toEqual({
      unused: 'journal.read',
      disabled: 'mock.enableDisable',
      priority: 'mock.priority',
    })
  })

  it('rejects a token whose capability is off, naming the bit', () => {
    const plan = parseQuery('unused:true', withBackend('mock.priority'))
    expect(plan.filters).toEqual([])
    expect(plan.rejected).toEqual([
      {
        field: 'unused',
        span: { start: 0, end: 11 },
        text: 'unused:true',
        capability: 'journal.read',
        reason: expect.stringContaining('journal'),
      },
    ])
  })

  it('never silently ignores a gated token — a filter that does nothing is worse than an error', () => {
    const plan = parseQuery('disabled:true priority:<5 unused:true', withBackend())
    expect(plan.filters).toEqual([])
    expect(plan.rejected.map((r) => r.field)).toEqual(['disabled', 'priority', 'unused'])
    // Rejected is not the same as free text: it must not silently become a body search either.
    expect(plan.terms).toEqual([])
  })

  it('applies the ungated tokens in a query that also has a rejected one', () => {
    const plan = parseQuery('method:POST unused:true', withBackend())
    expect(plan.filters).toHaveLength(1)
    expect(plan.rejected).toHaveLength(1)
  })

  it('gives every rejection copy that names the consequence, for the warning pill', () => {
    const plan = parseQuery('unused:true disabled:true priority:<5', withBackend())
    for (const rejection of plan.rejected) {
      expect(rejection.reason.length).toBeGreaterThan(20)
      expect(rejection.reason).toMatch(/\.$/)
    }
  })
})

describe('parseQuery — spans', () => {
  it('gives spans that index back into the original string', () => {
    const query = 'orders method:POST'
    const plan = parseQuery(query, fullyCapable)
    const filter = plan.filters[0]!
    expect(query.slice(filter.span.start, filter.span.end)).toBe('method:POST')
    const term = plan.terms[0]!
    expect(query.slice(term.span.start, term.span.end)).toBe('orders')
  })

  it('keeps spans correct across runs of whitespace', () => {
    const query = '  method:GET    orders  '
    const plan = parseQuery(query, fullyCapable)
    expect(query.slice(plan.filters[0]!.span.start, plan.filters[0]!.span.end)).toBe('method:GET')
    expect(query.slice(plan.terms[0]!.span.start, plan.terms[0]!.span.end)).toBe('orders')
  })
})

describe('parseQuery — header matchers', () => {
  it('parses a bare header name as "this stub matches on that header"', () => {
    expect(parseQuery('header:X-Mock', fullyCapable).filters[0]).toEqual({
      field: 'header',
      op: 'present',
      name: 'x-mock',
      value: null,
      span: { start: 0, end: 13 },
    })
  })

  it('parses name=value as a value match', () => {
    expect(parseQuery('header:X-Mock=anais-post', fullyCapable).filters[0]).toEqual({
      field: 'header',
      op: 'contains',
      name: 'x-mock',
      value: 'anais-post',
      span: { start: 0, end: 24 },
    })
  })

  it('lower-cases the header name, because HTTP header names are case-insensitive', () => {
    expect(parseQuery('header:X-MOCK=a', fullyCapable).filters[0]).toMatchObject({ name: 'x-mock' })
    expect(parseQuery('header:x-mock=a', fullyCapable).filters[0]).toMatchObject({ name: 'x-mock' })
  })

  it('does not lower-case the value — header values are case-sensitive', () => {
    expect(parseQuery('header:X-Mock=Anais', fullyCapable).filters[0]).toMatchObject({
      value: 'Anais',
    })
  })

  it('keeps a quoted value whole', () => {
    expect(parseQuery('header:X-Mock="two words"', fullyCapable).filters[0]).toMatchObject({
      value: 'two words',
    })
  })

  it('reads a value containing = as part of the value, splitting on the first one only', () => {
    expect(parseQuery('header:X-Sig=a=b', fullyCapable).filters[0]).toMatchObject({
      name: 'x-sig',
      value: 'a=b',
    })
  })

  it('treats a wildcard in the value as a glob', () => {
    expect(parseQuery('header:X-Mock=anais-*-unparsable', fullyCapable).filters[0]).toMatchObject({
      op: 'glob',
      value: 'anais-*-unparsable',
    })
  })

  it('degrades to free text when the header name is empty', () => {
    const plan = parseQuery('header:=value', fullyCapable)
    expect(plan.filters).toEqual([])
    expect(plan.terms[0]?.text).toBe('header:=value')
  })

  it('ORs several header tokens within the field', () => {
    const plan = parseQuery('header:X-Mock=a header:X-Mock=b', fullyCapable)
    expect(plan.groups).toEqual([
      { field: 'header', filters: [expect.anything(), expect.anything()] },
    ])
  })

  it('needs no capability — header matchers come from the mirrored corpus', () => {
    const plan = parseQuery('header:X-Mock=a', withBackend())
    expect(plan.rejected).toEqual([])
    expect(plan.filters).toHaveLength(1)
  })
})

describe('describeFilter', () => {
  const describe1 = (query: string): string[] =>
    parseQuery(
      query,
      withBackend('journal.read', 'mock.enableDisable', 'mock.priority'),
    ).filters.map(describeFilter)

  it('keeps the header name, which the pills used to drop entirely', () => {
    // Rendered as "header: null" before, which names a filter nobody asked for.
    expect(describe1('header:X-Tenant')).toEqual(['header: x-tenant (any value)'])
    expect(describe1('header:X-Tenant=acme')).toEqual(['header: x-tenant = acme'])
  })

  it('renders a status class as a class', () => {
    expect(describe1('status:5xx')).toEqual(['status: 5xx'])
    expect(describe1('status:404')).toEqual(['status: 404'])
  })

  it('keeps a comparison operator, which changes what matched', () => {
    expect(describe1('priority:<5')).toEqual(['priority < 5'])
    expect(describe1('priority:>=2')).toEqual(['priority ≥ 2'])
    expect(describe1('priority:3')).toEqual(['priority: 3'])
  })

  it('reads a negative boolean as a negative', () => {
    expect(describe1('unused:true')).toEqual(['unused'])
    expect(describe1('unused:false')).toEqual(['not unused'])
  })

  it('says which kind of string match was applied', () => {
    // A bare value is a substring match, not an exact one — worth saying, because "url:
    // /v1/orders" reads as exact and would explain a result set that looks too large.
    expect(describe1('url:/v1/orders')).toEqual(['url contains /v1/orders'])
    expect(describe1('url:*orders*')).toEqual(['url matches *orders*'])
  })
})
