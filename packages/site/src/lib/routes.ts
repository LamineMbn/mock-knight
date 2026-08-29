/**
 * Every page, once.
 *
 * The nav, each page's `<head>`, the sitemap and the tests all read this list, so adding a page
 * is one edit and forgetting to link it is impossible. Titles and descriptions live here rather
 * than in each page because their constraints — unique, ≤60, ≤160 — are properties of the *set*,
 * and a rule about a set cannot be checked from inside one member of it.
 */
export interface Route {
  /** Base-relative, leading and trailing slash. */
  readonly path: string
  /** The `<title>`. ≤60 characters or Google truncates it mid-word. */
  readonly title: string
  /** The meta description. Not a ranking factor; it is the snippet people decide from. */
  readonly description: string
  /** Label in the top nav, or null for pages reachable from the body only. */
  readonly nav: string | null
}

export const ROUTES: readonly Route[] = [
  {
    path: '/',
    title: 'Mock Knight — a web UI for WireMock',
    description:
      'Open-source web UI for WireMock, MockServer, Mockoon and Prism. Search thousands of stubs, see why a request did not match, and edit safely. Runs with npx.',
    nav: null,
  },
  {
    path: '/wiremock/',
    title: 'WireMock UI — browse and edit stubs in a browser',
    description:
      'WireMock ships an admin API and no UI. Mock Knight is one: full-text search over your stubs, a live request journal, and safe edits on a shared server.',
    nav: 'WireMock',
  },
  {
    path: '/mockserver/',
    title: 'MockServer UI — search and edit expectations',
    description:
      'A browser UI for MockServer: search every expectation, edit as a form or raw JSON, and see which one answers a path. No traffic log — MockServer records none.',
    nav: 'MockServer',
  },
  {
    path: '/mockoon/',
    title: 'Mockoon environments in a shared web UI',
    description:
      'Read and edit a Mockoon environment file from a browser, with a traffic log — for the shared and CI setups where Mockoon’s desktop app is not what is running.',
    nav: 'Mockoon',
  },
  {
    path: '/prism/',
    title: 'Prism UI — read the stubs an OpenAPI mock serves',
    description:
      'What Stoplight Prism actually returns: one stub per declared response per operation, ranked the way Prism picks. Read-only — Prism has no control API.',
    nav: 'Prism',
  },
  {
    path: '/config/',
    title: 'Configuring Mock Knight — mock-knight.json',
    description:
      'Every field of mock-knight.json, generated from the JSON Schema it validates against: profiles, allowedHosts, authentication and environment interpolation.',
    nav: 'Config',
  },
  {
    path: '/faq/',
    title: 'Mock Knight FAQ',
    description:
      'Does WireMock have a UI? How is this different from WireMock Cloud? Will it rewrite my mapping files? Is it safe to point at a mock server my team shares?',
    nav: 'FAQ',
  },
]

export function routeFor(path: string): Route {
  const found = ROUTES.find((route) => route.path === path)
  if (found === undefined) throw new Error(`No route declared for "${path}". Add it to ROUTES.`)
  return found
}
