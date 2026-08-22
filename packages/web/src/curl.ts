import type { Explanation } from './api.js'

/**
 * Render a captured request as a runnable `curl` — FR-TRAF-6.
 *
 * The escaping is the whole difficulty. POSIX shells have **no escape sequence inside single
 * quotes**, so an apostrophe in a value cannot be escaped in place: the quote has to be closed,
 * a literal quote emitted, and the quote reopened — `'\''`. Getting this subtly wrong produces
 * a command that still runs and silently sends different data, which is worse than one that
 * fails: `'''` concatenates to nothing, so `it's` would be pasted, run, and quietly become
 * `its`. Hence the unit tests next door.
 */
const CLOSE_QUOTE_LITERAL_REOPEN = "'\\''"

export function shellQuote(value: string): string {
  return `'${value.split("'").join(CLOSE_QUOTE_LITERAL_REOPEN)}'`
}

/** Headers curl must recompute rather than replay, or the request hangs or truncates. */
const RECOMPUTED_HEADERS = new Set(['content-length'])

export function toCurl(request: Explanation['request'], baseUrl: string): string {
  const lines = [`curl -i -X ${request.method} ${shellQuote(`${baseUrl}${request.url}`)}`]

  for (const [name, value] of Object.entries(request.headers)) {
    const single = Array.isArray(value) ? value[0] : value
    if (single === undefined) continue
    if (RECOMPUTED_HEADERS.has(name.toLowerCase())) continue
    lines.push(`  -H ${shellQuote(`${name}: ${single}`)}`)
  }

  if (request.body !== null && request.body !== '') {
    lines.push(`  --data-raw ${shellQuote(request.body)}`)
  }

  return lines.join(' \\\n')
}
