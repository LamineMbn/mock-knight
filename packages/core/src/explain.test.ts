import { describe, expect, it } from 'vitest'
import { explainMatch } from './explain.js'
import type { LoggedRequest, Matcher, RequestMatcher } from './model.js'

function request(over: Partial<LoggedRequest> = {}): LoggedRequest {
  return {
    method: 'POST',
    url: '/v1/orders',
    absoluteUrl: 'http://mock:8080/v1/orders',
    clientIp: null,
    headers: { 'X-Tenant': 'acme-corp', 'Content-Type': 'application/json' },
    cookies: {},
    queryParameters: {},
    body: '{"sku":"AX-91","qty":2}',
    bodyTruncated: false,
    ...over,
  }
}

function matcher(over: Partial<RequestMatcher> = {}): RequestMatcher {
  return {
    method: 'POST',
    url: { kind: 'urlPath', value: '/v1/orders' },
    headers: {},
    queryParameters: {},
    cookies: {},
    bodyPatterns: [],
    ...over,
  }
}

const m = (operator: string, value: unknown, options: Record<string, unknown> = {}): Matcher =>
  ({ operator, value, options }) as Matcher

const find = (results: ReturnType<typeof explainMatch>['predicates'], field: string) =>
  results.find((r) => r.field === field)

describe('method and url', () => {
  it('passes a matching method and marks a mismatch', () => {
    expect(find(explainMatch(matcher(), request()).predicates, 'method')?.outcome).toBe('pass')
    expect(
      find(explainMatch(matcher({ method: 'GET' }), request()).predicates, 'method'),
    ).toMatchObject({ outcome: 'fail', expected: 'GET', actual: 'POST' })
  })

  it('treats a null method as "any method", which always passes', () => {
    expect(
      find(explainMatch(matcher({ method: null }), request()).predicates, 'method'),
    ).toBeUndefined()
  })

  it('compares urlPath against the path only, ignoring the query string', () => {
    const result = explainMatch(matcher(), request({ url: '/v1/orders?dryRun=true' }))
    expect(find(result.predicates, 'url')?.outcome).toBe('pass')
  })

  it('compares url against the full url including the query string', () => {
    const withQuery = matcher({ url: { kind: 'url', value: '/v1/orders' } })
    expect(
      find(explainMatch(withQuery, request({ url: '/v1/orders?dryRun=true' })).predicates, 'url')
        ?.outcome,
    ).toBe('fail')
    expect(find(explainMatch(withQuery, request()).predicates, 'url')?.outcome).toBe('pass')
  })

  it('applies urlPathPattern as a full-string regex on the path', () => {
    const pattern = matcher({ url: { kind: 'urlPathPattern', value: '/v1/orders/[0-9]+' } })
    expect(
      find(explainMatch(pattern, request({ url: '/v1/orders/42' })).predicates, 'url')?.outcome,
    ).toBe('pass')
    // Anchored: a regex that merely matches a prefix must not count as a match.
    expect(
      find(explainMatch(pattern, request({ url: '/v1/orders/42/cancel' })).predicates, 'url')
        ?.outcome,
    ).toBe('fail')
  })

  it('reports an unparseable regex as unknown rather than as a failure', () => {
    const broken = matcher({ url: { kind: 'urlPattern', value: '/v1/(orders' } })
    const url = find(explainMatch(broken, request()).predicates, 'url')
    expect(url?.outcome).toBe('unknown')
    expect(url?.note).toMatch(/regex/i)
  })
})

describe('header matchers — the discriminator this screen exists for', () => {
  it('shows expected and actual side by side on a mismatch', () => {
    const result = explainMatch(
      matcher({ headers: { 'X-Tenant': [m('equalTo', 'acme')] } }),
      request(),
    )
    expect(find(result.predicates, 'headers.X-Tenant')).toMatchObject({
      outcome: 'fail',
      operator: 'equalTo',
      expected: 'acme',
      actual: 'acme-corp',
    })
    expect(result.mismatchCount).toBe(1)
  })

  it('matches header names case-insensitively, as HTTP does', () => {
    const result = explainMatch(
      matcher({ headers: { 'x-tenant': [m('equalTo', 'acme-corp')] } }),
      request(),
    )
    expect(find(result.predicates, 'headers.x-tenant')?.outcome).toBe('pass')
  })

  it('reports a missing header as absent rather than as an empty string', () => {
    const result = explainMatch(
      matcher({ headers: { 'X-Trace': [m('equalTo', 'abc')] } }),
      request(),
    )
    expect(find(result.predicates, 'headers.X-Trace')).toMatchObject({
      outcome: 'fail',
      actual: null,
    })
  })

  it('honours caseInsensitive on equalTo', () => {
    const result = explainMatch(
      matcher({ headers: { 'X-Tenant': [m('equalTo', 'ACME-CORP', { caseInsensitive: true })] } }),
      request(),
    )
    expect(find(result.predicates, 'headers.X-Tenant')?.outcome).toBe('pass')
  })

  it('evaluates absent both ways', () => {
    const missing = explainMatch(
      matcher({ headers: { 'X-Trace': [m('absent', true)] } }),
      request(),
    )
    expect(find(missing.predicates, 'headers.X-Trace')?.outcome).toBe('pass')

    const present = explainMatch(
      matcher({ headers: { 'X-Tenant': [m('absent', true)] } }),
      request(),
    )
    expect(find(present.predicates, 'headers.X-Tenant')?.outcome).toBe('fail')
  })

  it('evaluates contains, matches, and their negations', () => {
    const cases: [Matcher, string][] = [
      [m('contains', 'acme'), 'pass'],
      [m('contains', 'zzz'), 'fail'],
      [m('doesNotContain', 'zzz'), 'pass'],
      [m('matches', 'acme-.*'), 'pass'],
      [m('doesNotMatch', 'acme-.*'), 'fail'],
    ]
    for (const [predicate, expected] of cases) {
      const result = explainMatch(matcher({ headers: { 'X-Tenant': [predicate] } }), request())
      expect(find(result.predicates, 'headers.X-Tenant')?.outcome, predicate.operator).toBe(
        expected,
      )
    }
  })

  it('says unknown for an operator it does not implement, and names it', () => {
    const result = explainMatch(
      matcher({ headers: { 'X-Tenant': [m('matchesXPath', '//a')] } }),
      request(),
    )
    const row = find(result.predicates, 'headers.X-Tenant')
    expect(row?.outcome).toBe('unknown')
    expect(row?.note).toContain('matchesXPath')
    expect(result.unknownCount).toBe(1)
    // An unevaluated predicate is not a mismatch: claiming it failed would be a guess.
    expect(result.mismatchCount).toBe(0)
  })
})

describe('body matchers', () => {
  it('compares equalToJson structurally, ignoring key order and whitespace', () => {
    const result = explainMatch(
      matcher({ bodyPatterns: [m('equalToJson', { qty: 2, sku: 'AX-91' })] }),
      request(),
    )
    expect(find(result.predicates, 'body')?.outcome).toBe('pass')
  })

  it('fails equalToJson on a genuine difference', () => {
    const result = explainMatch(
      matcher({ bodyPatterns: [m('equalToJson', { sku: 'AX-91', qty: 3 })] }),
      request(),
    )
    expect(find(result.predicates, 'body')?.outcome).toBe('fail')
  })

  it('honours ignoreExtraElements', () => {
    const strict = explainMatch(
      matcher({ bodyPatterns: [m('equalToJson', { sku: 'AX-91' })] }),
      request(),
    )
    expect(find(strict.predicates, 'body')?.outcome).toBe('fail')

    const lenient = explainMatch(
      matcher({
        bodyPatterns: [m('equalToJson', { sku: 'AX-91' }, { ignoreExtraElements: true })],
      }),
      request(),
    )
    expect(find(lenient.predicates, 'body')?.outcome).toBe('pass')
  })

  it('reads a simple JSONPath expression', () => {
    expect(
      find(
        explainMatch(matcher({ bodyPatterns: [m('matchesJsonPath', '$.sku')] }), request())
          .predicates,
        'body',
      )?.outcome,
    ).toBe('pass')
    expect(
      find(
        explainMatch(matcher({ bodyPatterns: [m('matchesJsonPath', '$.missing')] }), request())
          .predicates,
        'body',
      )?.outcome,
    ).toBe('fail')
  })

  it('declines a JSONPath expression beyond its reader rather than guessing', () => {
    const result = explainMatch(
      matcher({ bodyPatterns: [m('matchesJsonPath', '$..items[?(@.qty > 1)]')] }),
      request(),
    )
    expect(find(result.predicates, 'body')?.outcome).toBe('unknown')
  })

  it('numbers several body patterns so each has its own row', () => {
    const result = explainMatch(
      matcher({ bodyPatterns: [m('contains', 'AX-91'), m('contains', 'nope')] }),
      request(),
    )
    expect(result.predicates.filter((p) => p.field.startsWith('body')).map((p) => p.field)).toEqual(
      ['body[0]', 'body[1]'],
    )
  })
})

describe('logical operators', () => {
  it('passes an and only when every branch passes', () => {
    const and = m('and', [{ contains: 'acme' }, { contains: 'corp' }])
    expect(
      find(
        explainMatch(matcher({ headers: { 'X-Tenant': [and] } }), request()).predicates,
        'headers.X-Tenant',
      )?.outcome,
    ).toBe('pass')

    const failing = m('and', [{ contains: 'acme' }, { contains: 'zzz' }])
    expect(
      find(
        explainMatch(matcher({ headers: { 'X-Tenant': [failing] } }), request()).predicates,
        'headers.X-Tenant',
      )?.outcome,
    ).toBe('fail')
  })

  it('passes an or when any branch passes', () => {
    const or = m('or', [{ equalTo: 'nope' }, { contains: 'corp' }])
    expect(
      find(
        explainMatch(matcher({ headers: { 'X-Tenant': [or] } }), request()).predicates,
        'headers.X-Tenant',
      )?.outcome,
    ).toBe('pass')
  })
})

describe('the summary the callout is written from', () => {
  it('counts only real mismatches', () => {
    const result = explainMatch(
      matcher({
        headers: { 'X-Tenant': [m('equalTo', 'acme')], 'Content-Type': [m('contains', 'json')] },
      }),
      request(),
    )
    expect(result.mismatchCount).toBe(1)
    expect(result.predicates.filter((p) => p.outcome === 'pass').length).toBeGreaterThan(1)
  })

  it('names the single closest failure, which is the hero line of the screen', () => {
    const result = explainMatch(
      matcher({ headers: { 'X-Tenant': [m('equalTo', 'acme')] } }),
      request(),
    )
    expect(result.summary).toBe('Closest stub differs on one header: X-Tenant')
  })

  it('says so plainly when everything matched', () => {
    expect(explainMatch(matcher(), request()).summary).toBe('Every predicate on this stub matches.')
  })

  it('counts fields rather than listing them when several differ', () => {
    const result = explainMatch(
      matcher({
        method: 'GET',
        headers: { 'X-Tenant': [m('equalTo', 'acme')] },
        bodyPatterns: [m('contains', 'nope')],
      }),
      request(),
    )
    expect(result.summary).toBe('Differs on 3 predicates: method, headers.X-Tenant, body')
  })
})
