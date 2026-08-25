import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AdapterTransportError } from '@mock-knight/core'
import { PrismClient } from './client.js'

/**
 * Reading the document.
 *
 * The rule these exist to hold: **Mock Knight must not refuse a document Prism itself serves.**
 * A parser stricter than the backend's makes the tool useless for the specifications people
 * actually have, however defensible its reading of the YAML spec is.
 */

let directory: string
let path: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mk-prism-'))
  path = join(directory, 'api.yaml')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

const client = (): PrismClient =>
  new PrismClient({ baseUrl: 'http://127.0.0.1:4010', documentPath: path })

describe('readDocument', () => {
  it('accepts a multi-line quoted scalar continued at its key indentation', async () => {
    /*
     * Taken from a real specification that Prism served without complaint — 8 paths, 36
     * operations — and that the `yaml` package rejected outright with `Missing closing 'quote`,
     * because the continuation line is indented the *same* as its key rather than deeper.
     *
     * Whether that is strictly legal YAML is beside the point: the backend serves it, so this
     * has to read it. `js-yaml` and `@stoplight/yaml` (which Prism is built on) both do.
     */
    writeFileSync(
      path,
      [
        'openapi: 3.0.0',
        'info: { title: real, version: "1.0" }',
        'paths:',
        '  /baskets:',
        '    get:',
        '      operationId: getBasket',
        '      responses:',
        "        '200':",
        '          description: ok',
        '      parameters:',
        '        - name: creationClientId',
        '          in: query',
        '          schema:',
        '            type: string',
        "            description: 'ClientId used when creating the basket,",
        '',
        "            Computed with the clientid header as passed in the POST baskets'",
        '',
      ].join('\n'),
    )

    const document = await client().readDocument()
    expect(Object.keys(document['paths'] as object)).toEqual(['/baskets'])
  })

  it('reads a JSON document through the same path', async () => {
    writeFileSync(
      path,
      JSON.stringify({ openapi: '3.0.0', info: {}, paths: { '/a': { get: { responses: {} } } } }),
    )
    expect(Object.keys((await client().readDocument())['paths'] as object)).toEqual(['/a'])
  })

  it('says a document with no paths is not one Prism can serve', async () => {
    writeFileSync(path, 'openapi: 3.0.0\ninfo: { title: x, version: "1" }\n')

    // Asserted on `detail`, not `message`: the message is the generic "could not reach" sentence
    // every transport failure shares, and `detail` is what the UI shows inside the disclosure —
    // the half that has to name the actual problem. Pointing at the wrong YAML file is the
    // likely mistake here, and "0 stubs" would read as an empty API rather than as the wrong file.
    const failure = await client()
      .readDocument()
      .catch((error: unknown) => error as AdapterTransportError)
    expect(failure).toBeInstanceOf(AdapterTransportError)
    expect((failure as AdapterTransportError).detail).toMatch(/no "paths" object/)
    expect((failure as AdapterTransportError).code).toBe('EINVALIDDOC')
  })

  it('refuses a relative path rather than resolving it against an unpredictable directory', () => {
    expect(
      () => new PrismClient({ baseUrl: 'http://127.0.0.1:4010', documentPath: './api.yaml' }),
    ).toThrow(/must be absolute/)
  })
})
