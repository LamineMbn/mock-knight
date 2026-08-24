import { Agent, request } from 'undici'
import {
  AdapterHostNotAllowedError,
  AdapterHttpError,
  AdapterTransportError,
  composeAdminUrl,
  transportCode,
} from '@mock-knight/core'
import type { ConnectionConfig, Json } from '@mock-knight/core'

/**
 * Transport for the MockServer control API.
 *
 * Deliberately the same shape as the WireMock client — per-profile `Agent`, allowlist checked
 * before the request leaves the process, the same three error types — because the *differences*
 * between two adapters should be about the backend, not about how each one happened to be
 * written. Two transports that diverge for no reason make the canonical model look more
 * portable than it is.
 *
 * MockServer's control API differs from WireMock's in one shape that matters here: **every
 * control call is a `PUT`**, including the ones that only read, and several of them require a
 * body even when they take no arguments. `PUT /mockserver/status` with no body answers with a
 * description of its own schema rather than the version.
 */

/** MockServer's control API lives under this path by default. */
export const DEFAULT_CONTROL_PATH = '/mockserver'

const DEFAULT_TIMEOUT_MS = 10_000
const USER_AGENT = 'mock-knight'

export class MockServerClient {
  private readonly agent: Agent
  readonly controlUrl: string
  private readonly headers: Record<string, string>
  private readonly allowedHosts: readonly string[] | undefined

  constructor(config: ConnectionConfig) {
    const base = new URL(config.baseUrl)
    this.controlUrl = composeAdminUrl(config.baseUrl, config.adminPath ?? DEFAULT_CONTROL_PATH)
    this.allowedHosts = config.allowedHosts
    this.assertHostAllowed(base.host)

    const timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.agent = new Agent({
      connectTimeout: timeout,
      headersTimeout: timeout,
      bodyTimeout: timeout,
      connections: 8,
    })
    this.headers = { accept: 'application/json', 'user-agent': config.userAgent ?? USER_AGENT }
  }

  private assertHostAllowed(host: string): void {
    if (this.allowedHosts === undefined) return
    if (!this.allowedHosts.includes(host)) throw new AdapterHostNotAllowedError(host)
  }

  /**
   * @param body sent even when empty, because several control endpoints answer with a schema
   *   description instead of data when they receive none.
   */
  async control<T = Json>(
    path: string,
    body: Json = {},
    options: { expectedStatuses?: readonly number[] } = {},
  ): Promise<{ status: number; body: T }> {
    const url = `${this.controlUrl}${path}`
    this.assertHostAllowed(new URL(url).host)

    let response
    try {
      response = await request(url, {
        method: 'PUT',
        dispatcher: this.agent,
        headers: { ...this.headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw new AdapterTransportError(
        'PUT',
        url,
        transportCode(error),
        error instanceof Error ? error.message : String(error),
      )
    }

    const text = await response.body.text()
    const ok = response.statusCode >= 200 && response.statusCode < 300
    if (!ok && !(options.expectedStatuses?.includes(response.statusCode) ?? false)) {
      throw new AdapterHttpError('PUT', url, response.statusCode, text)
    }

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
