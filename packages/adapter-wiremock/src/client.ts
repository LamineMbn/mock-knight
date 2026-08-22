import { Agent, request } from 'undici'
import {
  AdapterHostNotAllowedError,
  AdapterHttpError,
  AdapterTransportError,
  composeAdminUrl,
  transportCode,
} from '@mock-knight/core'
import type { ConnectionConfig, Json, ResolvedAuth } from '@mock-knight/core'

/**
 * Transport for the WireMock admin API.
 *
 * One `Agent` per profile (TECH-DESIGN §8) so a slow staging server cannot starve a local one
 * by monopolising a shared connection pool, and so timeouts can differ per profile.
 *
 * The allowlist check happens **here**, before the request leaves the process, because
 * mock-knight fetches arbitrary URLs by design: an exposed instance is otherwise a relay into
 * whatever network it can see (TECH-DESIGN §13).
 */

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Identify ourselves on every request.
 *
 * undici sends no `User-Agent` at all, and a request without one is refused outright by some
 * WAFs — observed against an AWS ALB that answered `404` to curl and `403` to us, purely
 * because of the missing header. The failure is doubly bad: the tool cannot connect, and the
 * status it reports points at the wrong cause.
 *
 * It also earns its place on the other side: this tool pokes at mock servers a whole team
 * shares, and "who is hitting my admin API?" should have an answer in the access log.
 */
const USER_AGENT = 'mock-knight'

/**
 * Re-exported so the adapter's own surface stays complete; the implementation moved to `core`
 * because the Servers form needs the identical answer to preview it (see admin-url.ts).
 */
export { DEFAULT_ADMIN_PATH, composeAdminUrl } from '@mock-knight/core'

export interface WireMockResponse<T> {
  status: number
  body: T
}

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

export class WireMockClient {
  private readonly agent: Agent
  readonly adminUrl: string
  private readonly headers: Record<string, string>
  private readonly allowedHosts: readonly string[] | undefined

  constructor(private readonly config: ConnectionConfig) {
    const base = new URL(config.baseUrl)
    this.adminUrl = composeAdminUrl(config.baseUrl, config.adminPath)
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
   * @param expectedStatuses statuses to return rather than throw on, so a caller probing for a
   *   route's existence can read a 404 as an answer instead of an error.
   */
  async json<T = Json>(
    method: string,
    path: string,
    options: { body?: Json; expectedStatuses?: readonly number[] } = {},
  ): Promise<WireMockResponse<T>> {
    const url = `${this.adminUrl}${path}`
    this.assertHostAllowed(new URL(url).host)

    const hasBody = options.body !== undefined
    // undici rejects with `TypeError: fetch failed` and buries the real reason — ENOTFOUND,
    // ECONNREFUSED, an expired certificate — in a `cause` chain. Caught here, where the method
    // and URL are still in scope, so the UI can say which one and what to check.
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
    if (!ok && !expected) {
      throw new AdapterHttpError(method, url, response.statusCode, text)
    }

    let parsed: unknown = null
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text)
      } catch {
        // /__admin/version answers with a bare version string on some builds.
        parsed = text
      }
    }
    return { status: response.statusCode, body: parsed as T }
  }

  async close(): Promise<void> {
    await this.agent.close()
  }
}
