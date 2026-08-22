/**
 * Where a backend's admin API lives, given a base URL and an admin path.
 *
 * In `core` rather than in the adapter because two places need the *same* answer: the transport
 * that actually calls the URL, and the form field that previews it while someone types. A
 * preview computed by a second implementation is a preview that can lie, and the thing it would
 * lie about — a dropped context path — is exactly the failure this function exists to prevent.
 *
 * The admin path is **appended to** the base URL, including any context path it carries. This
 * used to resolve the two as URLs, which meant an absolute admin path silently discarded the
 * context: `https://host/wcboo` + `/__admin` became `https://host/__admin`, and the tool then
 * reported whatever the load balancer said about a path nobody had asked for.
 *
 * An empty admin path is allowed, for a server whose admin API is the base URL itself.
 *
 * Browser-safe: no `node:` imports.
 */

export const DEFAULT_ADMIN_PATH = '/__admin'

export function composeAdminUrl(baseUrl: string, adminPath?: string | null): string {
  const base = new URL(baseUrl)
  const context = base.pathname.replace(/\/+$/, '')
  const raw = (adminPath ?? DEFAULT_ADMIN_PATH).trim().replace(/\/+$/, '')
  const suffix = raw === '' ? '' : raw.startsWith('/') ? raw : `/${raw}`
  return `${base.origin}${context}${suffix}`
}
