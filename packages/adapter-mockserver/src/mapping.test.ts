import { describe, expect, it } from 'vitest'
import { toCanonical, toVendor } from './mapping.js'
import type { JsonObject } from '@mock-knight/core'

/**
 * The mapping written *second*, against a model shaped by the first backend. What it cannot say
 * is as interesting as what it can, so the gaps are asserted rather than left implicit.
 */

const expectation = (over: JsonObject = {}): JsonObject => ({
  id: 'e-1',
  priority: 3,
  httpRequest: {
    method: 'GET',
    path: '/v1/things',
    headers: { 'X-Tenant': ['acme'] },
    queryStringParameters: { page: ['1'] },
  },
  httpResponse: {
    statusCode: 201,
    reasonPhrase: 'Made',
    headers: { 'Content-Type': ['application/json'] },
    body: { type: 'JSON', json: { ok: true } },
    delay: { timeUnit: 'MILLISECONDS', value: 50 },
  },
  times: { unlimited: true },
  timeToLive: { unlimited: true },
  ...over,
})

describe('toCanonical', () => {
  it('reads the matcher, the response and the priority', () => {
    const mock = toCanonical(expectation())
    expect(mock.request.method).toBe('GET')
    expect(mock.request.url).toEqual({ kind: 'urlPath', value: '/v1/things' })
    expect(mock.response.status).toBe(201)
    expect(mock.response.statusMessage).toBe('Made')
    expect(mock.priority).toBe(3)
    expect(mock.response.delay?.milliseconds).toBe(50)
  })

  it('turns a header value into an equalTo matcher', () => {
    // MockServer states a value where WireMock states a predicate. `equalTo` is the honest
    // reading of `{"X-Tenant": ["acme"]}` — anything else would be inventing an operator.
    expect(toCanonical(expectation()).request.headers['X-Tenant']).toEqual([
      { operator: 'equalTo', value: 'acme', options: {} },
    ])
  })

  it('keys on the expectation id, which MockServer lets the caller choose', () => {
    expect(toCanonical(expectation()).clientKey).toBe('e-1')
  })

  it('says there is no name rather than inventing one from the path', () => {
    // A value here would be editable into nothing, and the server would not remember it.
    expect(toCanonical(expectation()).name).toBeNull()
  })

  it('says there is no scenario, because `times` is not a state machine', () => {
    // A stub that answers twice and then stops is a sequence, not a named state, and rendering
    // it as a graph would put something on screen the server cannot be asked about.
    expect(toCanonical(expectation()).state).toBeNull()
  })

  it('reads a body in both shapes MockServer uses', () => {
    // It is given `{type:'JSON', json:…}` and echoes it back bare.
    expect(toCanonical(expectation()).response.body).toEqual({ kind: 'json', value: { ok: true } })
    const echoed = expectation({
      httpResponse: { statusCode: 200, body: { ok: true } },
    })
    expect(toCanonical(echoed).response.body).toEqual({ kind: 'json', value: { ok: true } })
  })

  it('keeps the whole expectation in raw', () => {
    // Invariant 4. `times` and `timeToLive` have no canonical home and survive only here.
    const mock = toCanonical(expectation())
    expect(mock.raw['times']).toEqual({ unlimited: true })
    expect(mock.raw['timeToLive']).toEqual({ unlimited: true })
  })
})

describe('toVendor', () => {
  const roundTrip = (over: JsonObject = {}) => toVendor(toCanonical(expectation(over)))

  it('patches the retained document rather than rebuilding it', () => {
    // The fields the model has never heard of must survive a write, because MockServer replaces
    // an expectation wholesale.
    const out = roundTrip()
    expect(out['times']).toEqual({ unlimited: true })
    expect(out['timeToLive']).toEqual({ unlimited: true })
  })

  it('round-trips the fields it does model', () => {
    const out = roundTrip()
    expect((out['httpRequest'] as JsonObject)['path']).toBe('/v1/things')
    expect((out['httpRequest'] as JsonObject)['headers']).toEqual({ 'X-Tenant': ['acme'] })
    expect((out['httpResponse'] as JsonObject)['statusCode']).toBe(201)
    expect((out['httpResponse'] as JsonObject)['body']).toEqual({
      type: 'JSON',
      json: { ok: true },
    })
  })

  it('leaves a matcher it cannot express alone rather than downgrading it', () => {
    // Only `equalTo` maps to MockServer's value syntax. A `matches` header would otherwise be
    // silently rewritten as a literal, which changes what the stub matches.
    const mock = toCanonical(expectation())
    mock.request.headers['X-Tenant'] = [{ operator: 'matches', value: 'ac.*', options: {} }]
    const out = toVendor(mock)
    // Dropped from the rendered matcher rather than written as the literal string "ac.*"…
    expect((out['httpRequest'] as JsonObject)['headers']).toBeUndefined()
    // …and still present in the document the UI shows, because raw is what is patched.
    expect(out['id']).toBe('e-1')
  })

  it('removes a field the canonical model cleared', () => {
    const mock = toCanonical(expectation())
    mock.response.delay = null
    mock.priority = null
    const out = toVendor(mock)
    expect((out['httpResponse'] as JsonObject)['delay']).toBeUndefined()
    expect(out['priority']).toBeUndefined()
  })
})
