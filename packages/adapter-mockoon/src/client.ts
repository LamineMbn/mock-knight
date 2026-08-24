import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { Agent, request } from 'undici'
import {
  AdapterHostNotAllowedError,
  AdapterHttpError,
  AdapterTransportError,
  transportCode,
} from '@mock-knight/core'
import type { ConnectionConfig, Json, JsonObject, ResolvedAuth } from '@mock-knight/core'

/**
 * Transport for Mockoon — a file for the corpus, HTTP for the traffic log.
 *
 * The split is not a design choice. `GET /mockoon-admin/environment` is a 404 (§17.31): Mockoon's
 * admin API can *write* an environment and cannot read one, so the only way to see the corpus is
 * the environment JSON document itself. The admin API is still worth having for
 * `/mockoon-admin/logs`, which carries `routeUUID` — real attribution, which MockServer's journal
 * lacks entirely.
 *
 * Both halves are optional to *reach* in different ways: without the document there is no corpus
 * and connecting fails; without the admin API there is simply no traffic log, and `journal.read`
 * is off rather than the connection refused.
 */

const DEFAULT_TIMEOUT_MS = 10_000
export const DEFAULT_ADMIN_PATH = '/mockoon-admin'

/** Same reasoning as the other adapters: undici sends no User-Agent, and some WAFs refuse that. */
const USER_AGENT = 'mock-knight'

function authHeaders(auth: ResolvedAuth | undefined): Record<string, string> {
  if (auth === undefined || auth.kind === 'none') return {}
  switch (auth.kind) {
    case 'bearer':
      return { authorization: `Bearer ${auth.token}` }
    case 'basic':
      return {
        authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`,
      }
    case 'headers':
      return { ...auth.headers }
  }
}

const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export class MockoonClient {
  private readonly agent: Agent
  readonly adminUrl: string
  readonly documentPath: string
  private readonly headers: Record<string, string>
  private readonly allowedHosts: readonly string[] | undefined

  constructor(config: ConnectionConfig) {
    const path = config.documentPath ?? null
    if (path === null || path.trim() === '') {
      // Said plainly and early. Mockoon's corpus is not reachable over HTTP at all, so a profile
      // without a document is not a misconfiguration to work around — there is nothing to read.
      throw new Error(
        'A Mockoon server needs the path to its environment JSON file: its admin API cannot ' +
          'read routes, so the file is the only source for the corpus.',
      )
    }
    if (!isAbsolute(path)) {
      // Relative to *what* has no answer a user could predict: the BFF's working directory is
      // wherever the CLI happened to be started. The config loader resolves relative paths
      // against the config file; anything still relative here has no such anchor.
      throw new Error(`The Mockoon environment path must be absolute. Got: ${path}`)
    }
    this.documentPath = path

    const base = new URL(config.baseUrl)
    const adminPath = config.adminPath ?? DEFAULT_ADMIN_PATH
    this.adminUrl = new URL(adminPath.replace(/\/$/, ''), base).toString().replace(/\/$/, '')
    this.allowedHosts = config.allowedHosts
    this.assertHostAllowed(base.host)

    const timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.agent = new Agent({
      connectTimeout: timeout,
      headersTimeout: timeout,
      bodyTimeout: timeout,
      connections: 8,
    })
    this.headers = {
      accept: 'application/json',
      'user-agent': config.userAgent ?? USER_AGENT,
      ...authHeaders(config.auth),
    }
  }

  private assertHostAllowed(host: string): void {
    if (this.allowedHosts === undefined) return
    if (!this.allowedHosts.includes(host)) throw new AdapterHostNotAllowedError(host)
  }

  /**
   * The environment document.
   *
   * Read on every call rather than cached: the file is the source of truth and a developer editing
   * it in an editor is the ordinary case, not an edge one. A cache here would show a corpus that
   * had already changed and call it current.
   */
  async readEnvironment(): Promise<JsonObject> {
    let text: string
    try {
      text = await readFile(this.documentPath, 'utf8')
    } catch (error) {
      const code = (error as { code?: string }).code ?? null
      // Reported through the same error type as a network failure so the UI has one disclosure
      // to render: the cause differs, but "we could not reach the corpus" is the same sentence.
      throw new AdapterTransportError(
        'READ',
        this.documentPath,
        code,
        code === 'ENOENT'
          ? `No Mockoon environment file at ${this.documentPath}.`
          : `Could not read ${this.documentPath}: ${(error as Error).message}`,
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new AdapterTransportError(
        'PARSE',
        this.documentPath,
        'EINVALIDJSON',
        `${this.documentPath} is not valid JSON: ${(error as Error).message}`,
      )
    }
    if (!isObject(parsed)) {
      throw new AdapterTransportError(
        'PARSE',
        this.documentPath,
        'EINVALIDJSON',
        `${this.documentPath} is not a Mockoon environment: the document is not an object.`,
      )
    }
    return parsed
  }

  /**
   * @param expectedStatuses statuses to return rather than throw on, so a caller probing for a
   *   route's existence can read a 404 as an answer instead of an error.
   */
  async json<T = Json>(
    method: string,
    path: string,
    options: { body?: Json; expectedStatuses?: readonly number[] } = {},
  ): Promise<{ status: number; body: T }> {
    const url = `${this.adminUrl}${path}`
    this.assertHostAllowed(new URL(url).host)

    const hasBody = options.body !== undefined
    let response
    try {
      response = await request(url, {
        method: method as 'GET',
        dispatcher: this.agent,
        headers: hasBody ? { ...this.headers, 'content-type': 'application/json' } : this.headers,
        body: hasBody ? JSON.stringify(options.body) : undefined,
      })
    } catch (error) {
      throw new AdapterTransportError(
        method,
        url,
        transportCode(error),
        error instanceof Error ? error.message : String(error),
      )
    }

    const text = await response.body.text()
    const ok = response.statusCode >= 200 && response.statusCode < 300
    const expected = options.expectedStatuses?.includes(response.statusCode) ?? false
    if (!ok && !expected) throw new AdapterHttpError(method, url, response.statusCode, text)

    let parsed: unknown = null
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }
    return { status: response.statusCode, body: parsed as T }
  }

  async close(): Promise<void> {
    await this.agent.close()
  }
}
