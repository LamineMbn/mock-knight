export interface Capability {
  readonly label: string
  readonly state: 'on' | 'off'
  /** Required when state is 'off'. Why the backend cannot do it — never left as an absence. */
  readonly note: string | null
}

export interface Backend {
  readonly slug: string
  readonly name: string
  readonly h1: string
  readonly lede: string
  readonly capabilities: readonly Capability[]
  /** Shown above the fold where the honest story needs stating before anything is claimed. */
  readonly caveat: string | null
  readonly external: { readonly label: string; readonly url: string } | null
}

const CAPABILITY_ORDER = [
  'Search the corpus',
  'Read a stub',
  'Edit a stub',
  'Create and delete',
  'Traffic log',
  'Why a request did not match',
  'Scenarios',
] as const

const on = (label: string): Capability => ({ label, state: 'on', note: null })
const off = (label: string, note: string): Capability => ({ label, state: 'off', note })

export const BACKENDS: readonly Backend[] = [
  {
    slug: 'wiremock',
    name: 'WireMock',
    h1: 'A UI for WireMock',
    lede: 'WireMock ships an admin API and no interface. Point Mock Knight at the WireMock you already run and you get one, without changing anything about how your mocks are served.',
    capabilities: [
      on('Search the corpus'),
      on('Read a stub'),
      on('Edit a stub'),
      on('Create and delete'),
      on('Traffic log'),
      on('Why a request did not match'),
      on('Scenarios'),
    ],
    caveat: null,
    external: { label: 'WireMock', url: 'https://wiremock.org/' },
  },
  {
    slug: 'mockserver',
    name: 'MockServer',
    h1: 'A UI for MockServer',
    lede: 'Search, read and edit every expectation on a MockServer from a browser, as a form or as raw JSON.',
    capabilities: [
      on('Search the corpus'),
      on('Read a stub'),
      on('Edit a stub'),
      on('Create and delete'),
      off(
        'Traffic log',
        'MockServer records no attribution for a served request, so there is nothing to show which expectation answered it. The screen is absent rather than empty.',
      ),
      off('Why a request did not match', 'The near-miss ranking needs the traffic log it does not have.'),
      off('Scenarios', 'MockServer has no named states, so there is no state graph to draw.'),
    ],
    caveat: null,
    external: { label: 'MockServer', url: 'https://www.mock-server.com/' },
  },
  {
    slug: 'mockoon',
    name: 'Mockoon',
    h1: 'Mockoon, from a browser',
    lede: 'Read and edit the routes in a Mockoon environment file, with a traffic log, from anywhere that can reach it.',
    // Mockoon has a good desktop application. Pretending otherwise loses the reader in one line.
    caveat:
      'Mockoon has its own desktop app, and for local work it is the better tool. This is for the setups it does not cover: an environment file in version control, a mockoon-cli running in CI, or a team that wants one interface across four different mock servers.',
    capabilities: [
      on('Search the corpus'),
      on('Read a stub'),
      on('Edit a stub'),
      off(
        'Create and delete',
        'Both also rewrite `rootChildren`, where a mistake silently stops a route being served. Not worth the risk for a convenience.',
      ),
      on('Traffic log'),
      off('Why a request did not match', 'Mockoon’s admin API reports no near misses.'),
      off('Scenarios', 'Mockoon has no equivalent of named scenario states.'),
    ],
    external: { label: 'Mockoon', url: 'https://mockoon.com/' },
  },
  {
    slug: 'prism',
    name: 'Prism',
    h1: 'A UI for Prism',
    lede: 'See what a Prism mock will actually return: every operation as one stub per declared response, ranked the way Prism picks — lowest 2xx first.',
    caveat:
      'Read-only. Prism has no control API, so its corpus is the OpenAPI document it serves and the document is the only place to change it.',
    capabilities: [
      on('Search the corpus'),
      on('Read a stub'),
      off(
        'Edit a stub',
        'Prism has no control API. Editing would mean rewriting your OpenAPI document, which is a specification rather than a set of mocks.',
      ),
      off('Create and delete', 'Same reason: the corpus is your specification.'),
      off('Traffic log', 'Prism exposes no request journal.'),
      off('Why a request did not match', 'The near-miss ranking needs a journal.'),
      off('Scenarios', 'Prism has no stateful stubs.'),
    ],
    external: { label: 'Stoplight Prism', url: 'https://stoplight.io/open-source/prism' },
  },
]

export function backendFor(slug: string): Backend {
  const found = BACKENDS.find((backend) => backend.slug === slug)
  if (found === undefined) throw new Error(`No backend "${slug}".`)
  return found
}

export { CAPABILITY_ORDER }
