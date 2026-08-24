import { describe, expect, it } from 'vitest'
import { defaultStatusOf, documentToMocks, templateToUrlMatch } from './mapping.js'
import type { JsonObject } from '@mock-knight/core'

/**
 * The Prism read path.
 *
 * Fixtures are OpenAPI as Prism actually accepted it (TECH-DESIGN §17.32) — including the parts
 * Mock Knight ignores, because a real specification carries them and `raw` has to keep them.
 */

const document = (paths: JsonObject): JsonObject => ({
  openapi: '3.0.0',
  info: { title: 'demo', version: '1.0' },
  paths,
})

describe('documentToMocks', () => {
  it('reads an operation with one response as one stub', () => {
    const { mocks } = documentToMocks(
      document({
        '/v1/orders': {
          post: {
            operationId: 'createOrder',
            summary: 'place an order',
            responses: { '201': { description: 'created' } },
          },
        },
      }),
    )

    expect(mocks).toHaveLength(1)
    expect(mocks[0]!.id).toBe('createOrder:201')
    expect(mocks[0]!.name).toBe('place an order')
    expect(mocks[0]!.request.method).toBe('POST')
    expect(mocks[0]!.request.url).toEqual({ kind: 'urlPath', value: '/v1/orders' })
    expect(mocks[0]!.response.status).toBe(201)
    // One response has nothing to outrank, exactly as for Mockoon.
    expect(mocks[0]!.priority).toBeNull()
  })

  it('ranks by the lowest 2xx, not by the order responses appear in', () => {
    const { mocks } = documentToMocks(
      document({
        '/probe': {
          get: {
            operationId: 'probe',
            // 403 first in the document, deliberately.
            responses: { '403': { description: 'no' }, '200': { description: 'yes' } },
          },
        },
      }),
    )

    const byStatus = new Map(mocks.map((mock) => [mock.response.status, mock.priority]))
    // Verified against a running Prism: it answers 200 for this document. Reading document order
    // as the precedence would have made the Priority column exactly backwards.
    expect(byStatus.get(200)).toBe(1)
    expect(byStatus.get(403)).toBe(2)
  })

  it('reads a required parameter as a matcher, and ignores an optional one', () => {
    const { mocks } = documentToMocks(
      document({
        '/v1/customers/{id}': {
          get: {
            operationId: 'getCustomer',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'x-tenant', in: 'header', required: true, schema: { type: 'string' } },
              { name: 'verbose', in: 'query', required: false, schema: { type: 'boolean' } },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      }),
    )

    const request = mocks[0]!.request
    // Present, not equal to something: the document never says what the value must be, and an
    // invented `equalTo` would be a predicate the server does not have.
    expect(request.headers['x-tenant']).toEqual([
      { operator: 'prism:required', value: null, options: { schema: { type: 'string' } } },
    ])
    // An optional parameter does not decide whether a request matches, so it is not a predicate.
    expect(request.queryParameters).toEqual({})
    // A path parameter is already expressed by the URL pattern; repeating it would double-count.
    expect(request.url?.kind).toBe('urlPathPattern')
  })

  it('inherits parameters declared on the path item', () => {
    const { mocks } = documentToMocks(
      document({
        '/v1/things': {
          parameters: [
            { name: 'x-api-version', in: 'header', required: true, schema: { type: 'string' } },
          ],
          get: { operationId: 'listThings', responses: { '200': { description: 'ok' } } },
        },
      }),
    )

    // Path-level parameters apply to every operation under the path. Missing them would drop a
    // matcher that genuinely decides whether Prism answers.
    expect(Object.keys(mocks[0]!.request.headers)).toEqual(['x-api-version'])
  })

  it('reads an example as the body', () => {
    const { mocks } = documentToMocks(
      document({
        '/v1/customers': {
          get: {
            operationId: 'listCustomers',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { examples: { ada: { value: [{ id: '1', name: 'Ada' }] } } },
                },
              },
            },
          },
        },
      }),
    )

    expect(mocks[0]!.response.body).toEqual({ kind: 'json', value: [{ id: '1', name: 'Ada' }] })
    expect(mocks[0]!.response.headers['Content-Type']).toBe('application/json')
    expect(mocks[0]!.response.transformers).toEqual([])
  })

  it('says a schema-only response is generated rather than showing it as empty', () => {
    const { mocks } = documentToMocks(
      document({
        '/v1/customers': {
          get: {
            operationId: 'listCustomers',
            responses: {
              '200': {
                description: 'ok',
                content: { 'application/json': { schema: { type: 'array' } } },
              },
            },
          },
        },
      }),
    )

    // There is no stored body, and that is not the same as an empty one — Prism builds a response
    // from the schema on every request. The marker is what stops the Response tab implying that
    // this operation returns nothing.
    expect(mocks[0]!.response.body).toEqual({ kind: 'none', value: null })
    expect(mocks[0]!.response.transformers).toEqual(['prism:dynamic'])
  })

  it('takes the folder from the document own tags', () => {
    const { mocks } = documentToMocks(
      document({
        '/v1/orders': {
          post: {
            operationId: 'createOrder',
            tags: ['orders', 'v1'],
            responses: { '201': { description: 'created' } },
          },
        },
      }),
    )

    expect(mocks[0]!.folder).toEqual(['orders'])
    expect(mocks[0]!.folderSource).toBe('metadata')
    expect(mocks[0]!.tags).toEqual(['orders', 'v1'])
  })

  it('keeps where the operation lives, which OpenAPI does not record on it', () => {
    const { mocks } = documentToMocks(
      document({
        '/v1/orders': {
          post: { operationId: 'createOrder', responses: { '201': { description: 'created' } } },
        },
      }),
    )

    // Without these a stub could not be found again in the document it came from: an operation
    // object carries neither its path nor its method.
    expect(mocks[0]!.raw['x-mock-knight-path']).toBe('/v1/orders')
    expect(mocks[0]!.raw['x-mock-knight-method']).toBe('post')
  })

  it('says what it skipped instead of showing a shorter corpus', () => {
    const { mocks, skipped } = documentToMocks(
      document({
        '/a': {
          get: {
            operationId: 'a',
            responses: { '200': { description: 'ok' }, default: { description: 'fallback' } },
          },
        },
        '/b': { get: { operationId: 'b', responses: {} } },
      }),
    )

    expect(mocks).toHaveLength(1)
    expect(skipped).toHaveLength(2)
    expect(skipped.map((entry) => entry.reason.slice(0, 20))).toEqual([
      'response "default" i'.slice(0, 20),
      'the operation declar'.slice(0, 20),
    ])
  })

  it('ignores keys on a path item that are not operations', () => {
    const { mocks } = documentToMocks(
      document({
        '/v1/orders': {
          summary: 'orders',
          description: 'not an operation',
          post: { operationId: 'createOrder', responses: { '201': { description: 'ok' } } },
        },
      }),
    )

    expect(mocks).toHaveLength(1)
  })
})

describe('templateToUrlMatch', () => {
  it('reads a literal path as a path', () => {
    expect(templateToUrlMatch('/v1/orders')).toEqual({ kind: 'urlPath', value: '/v1/orders' })
  })

  it('reads a path template as a pattern that matches one segment', () => {
    const match = templateToUrlMatch('/pets/{petId}')
    expect(match.kind).toBe('urlPathPattern')
    expect(new RegExp(`^${match.value}$`).test('/pets/42')).toBe(true)
    expect(new RegExp(`^${match.value}$`).test('/pets/42/toys')).toBe(false)
  })

  it('escapes what is regex in the path before adding its own', () => {
    const match = templateToUrlMatch('/files/{name}.json')
    expect(new RegExp(`^${match.value}$`).test('/files/report.json')).toBe(true)
    // The dot is a literal in the template, so it must not match any character.
    expect(new RegExp(`^${match.value}$`).test('/files/reportxjson')).toBe(false)
  })
})

describe('defaultStatusOf', () => {
  it('prefers the lowest 2xx', () => {
    expect(defaultStatusOf([500, 403, 201, 200])).toBe(200)
  })

  it('falls back to the lowest status when nothing succeeds', () => {
    expect(defaultStatusOf([500, 403])).toBe(403)
  })

  it('has no answer for an operation with no responses', () => {
    expect(defaultStatusOf([])).toBeNull()
  })
})
