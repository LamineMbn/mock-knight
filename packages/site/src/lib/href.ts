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
