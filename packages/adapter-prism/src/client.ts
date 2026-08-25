import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { load as parseYaml } from 'js-yaml'
import { AdapterHostNotAllowedError, AdapterTransportError } from '@mock-knight/core'
import type { ConnectionConfig, JsonObject } from '@mock-knight/core'

/**
 * Transport for Prism — a file, and nothing else.
 *
 * Prism has no control API — its CLI documents exactly two commands, `mock` and `proxy`, and no
 * management endpoints. So unlike Mockoon, which at least offers a traffic log, there is no HTTP
 * surface here worth calling. The OpenAPI document is the entire source of truth, and the running
 * server is only reachable the way any caller reaches it.
 *
 * YAML is parsed as well as JSON because OpenAPI documents are predominantly YAML; a reader that
 * handled only JSON would refuse the common case.
 *
 * `js-yaml`, and specifically **not** `yaml` (eemeli), which this used first. The rule that
 * decided it: Mock Knight must not refuse a document Prism itself serves. A real specification —
 * 8 paths, 36 operations, served by Prism without complaint — was rejected outright by `yaml`
 * with `Missing closing 'quote`, because a multi-line quoted scalar continued at the *same*
 * indentation as its key rather than deeper. `yaml` is arguably right about the spec; it is
 * useless to be right about a file the backend is happily serving. `js-yaml` and
 * `@stoplight/yaml` (what Prism is built on) both accept it.
 */

export const DEFAULT_ADMIN_PATH = '/'

export class PrismClient {
  readonly documentPath: string
  readonly adminUrl: string

  constructor(config: ConnectionConfig) {
    const path = config.documentPath ?? null
    if (path === null || path.trim() === '') {
      throw new Error(
        'A Prism server needs the path to its OpenAPI document: Prism has no control API, so ' +
          'the document is the only source for the corpus.',
      )
    }
    if (!isAbsolute(path)) {
      // Relative to what has no answer a user could predict — the BFF's working directory is
      // wherever the CLI happened to be started.
      throw new Error(`The Prism OpenAPI document path must be absolute. Got: ${path}`)
    }
    this.documentPath = path

    const base = new URL(config.baseUrl)
    if (config.allowedHosts !== undefined && !config.allowedHosts.includes(base.host)) {
      throw new AdapterHostNotAllowedError(base.host)
    }
    // There is no admin path to compose. The base URL is what Prism answers on, and it is shown
    // as-is rather than with a suffix that would 404.
    this.adminUrl = base.toString().replace(/\/$/, '')
  }

  /**
   * The OpenAPI document.
   *
   * Read on every call rather than cached: the file is the source of truth, and someone editing
   * a spec in their editor is the ordinary case here more than anywhere — Prism's own `--watch`
   * exists for exactly that.
   */
  async readDocument(): Promise<JsonObject> {
    let text: string
    try {
      text = await readFile(this.documentPath, 'utf8')
    } catch (error) {
      const code = (error as { code?: string }).code ?? null
      throw new AdapterTransportError(
        'READ',
        this.documentPath,
        code,
        code === 'ENOENT'
          ? `No OpenAPI document at ${this.documentPath}.`
          : `Could not read ${this.documentPath}: ${(error as Error).message}`,
      )
    }

    let parsed: unknown
    try {
      // JSON is a subset of YAML, so one path handles both formats.
      parsed = parseYaml(text)
    } catch (error) {
      throw new AdapterTransportError(
        'PARSE',
        this.documentPath,
        'EINVALIDDOC',
        `${this.documentPath} is not valid YAML or JSON: ${(error as Error).message}`,
      )
    }

    if (!isObject(parsed)) {
      throw new AdapterTransportError(
        'PARSE',
        this.documentPath,
        'EINVALIDDOC',
        `${this.documentPath} is not an OpenAPI document: the document is not an object.`,
      )
    }
    if (!isObject(parsed['paths'])) {
      // Said plainly, because pointing at the wrong YAML file is the likely mistake and "0 stubs"
      // would look like an empty API rather than the wrong file.
      throw new AdapterTransportError(
        'PARSE',
        this.documentPath,
        'EINVALIDDOC',
        `${this.documentPath} has no "paths" object, so it is not an OpenAPI document Prism can serve.`,
      )
    }
    return parsed
  }
}

const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
