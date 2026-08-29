/**
 * Every internal URL carries the base path GitHub Pages serves this site under.
 *
 * A hardcoded `/wiremock/` resolves correctly in `astro dev`, which serves from the base, and
 * 404s in production. That is the standard failure of a Pages project site and it is invisible
 * until deploy, so links go through here and `scripts/check-links.mjs` fails the build on any
 * that do not.
 *
 * `joinBase` is separate from `href` so it can be tested without a Vite environment supplying
 * `import.meta.env`.
 */
export function joinBase(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, '')
  const trimmedPath = path.replace(/^\/+/, '').replace(/\/+$/, '')
  if (trimmedPath === '') return trimmedBase === '' ? '/' : `${trimmedBase}/`
  return `${trimmedBase}/${trimmedPath}/`
}

export function href(path: string): string {
  return joinBase(import.meta.env.BASE_URL, path)
}

/**
 * `joinBase` always adds the trailing slash `trailingSlash: 'always'` requires — correct for a
 * page route, wrong for a file. A static host resolves `/images/corpus.png` but 404s on
 * `/images/corpus.png/`, and Astro's own preview server is too lenient to catch it: it serves
 * both, which is what let this through once already. `joinBaseAsset` is the same base-joining
 * knowledge as `joinBase`, minus the trailing slash a file must not carry.
 *
 * Guarded against stripping the bare root itself (`/`) down to an empty string.
 */
export function joinBaseAsset(base: string, path: string): string {
  const joined = joinBase(base, path)
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined
}

export function asset(path: string): string {
  return joinBaseAsset(import.meta.env.BASE_URL, path)
}
