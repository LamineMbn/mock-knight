export interface Capability {
  readonly label: string
  readonly state: 'on' | 'off'
  /**
   * Required when state is 'off'. Why the backend cannot do it — never left as an absence.
   *
   * Allowed when state is 'on' too, for the capability that is present but conditional: a
   * reader following the default path must not be shown a plain "Yes" for something that is
   * only true once they have done something the page never told them about.
   */
  readonly note: string | null
}

/**
 * How a reader actually starts this backend under Mock Knight.
 *
 * Per backend rather than one template line, because two of the four are document-backed:
 * `MockoonAdapter.connect()` and `PrismAdapter.connect()` both read a file named by the
 * profile's `mappingsDir`, and the CLI has no flag for it. A single
 * `npx mock-knight --url … --adapter mockoon` is not an install command for those two — it is a
 * profile that fails to connect.
 */
export interface Install {
  /** The shell block, one command per line, in the order they are run. */
  readonly commands: readonly string[]
  /** What the commands alone do not do, or null when the one-liner is the whole story. */
  readonly note: string | null
}

export interface Backend {
  readonly slug: string
  readonly name: string
  readonly h1: string
  readonly lede: string
  readonly install: Install
  readonly capabilities: readonly Capability[]
  /** Shown above the fold where the honest story needs stating before anything is claimed. */
  readonly caveat: string | null
  readonly external: { readonly label: string; readonly url: string } | null
  /**
   * Basename, under `docs/images/`, of *this backend's own* corpus screenshot — Mock Knight
   * actually connected to it, with its name and version in the top bar.
   *
   * One shared file (`corpus.png`, WireMock's) used to be interpolated into every backend's alt
   * text regardless of which server the picture showed, which made three of the four pages
   * assert something the image did not back up. A field per backend, read by the template
   * instead of a filename it invents, is what keeps that from happening silently again.
   */
  readonly screenshot: string
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
/** Present, but only once the reader has done something the default path does not do. */
const onIf = (label: string, note: string): Capability => ({ label, state: 'on', note })
const off = (label: string, note: string): Capability => ({ label, state: 'off', note })

export const BACKENDS: readonly Backend[] = [
  {
    slug: 'wiremock',
    name: 'WireMock',
    h1: 'A UI for WireMock',
    lede: 'WireMock ships an admin API and no interface. Point Mock Knight at the WireMock you already run and you get one, without changing anything about how your mocks are served.',
    install: {
      commands: ['npx mock-knight --url http://localhost:8080 --adapter wiremock'],
      note: null,
    },
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
    screenshot: 'corpus-wiremock',
  },
  {
    slug: 'mockserver',
    name: 'MockServer',
    h1: 'A UI for MockServer',
    lede: 'Search, read and edit every expectation on a MockServer from a browser, as a form or as raw JSON.',
    install: {
      commands: ['npx mock-knight --url http://localhost:1080 --adapter mockserver'],
      note: null,
    },
    capabilities: [
      on('Search the corpus'),
      on('Read a stub'),
      on('Edit a stub'),
      on('Create and delete'),
      off(
        'Traffic log',
        'MockServer records no attribution for a served request, so there is nothing to show which expectation answered it. The screen is absent rather than empty.',
      ),
      off(
        'Why a request did not match',
        'The near-miss ranking needs the traffic log it does not have.',
      ),
      off('Scenarios', 'MockServer has no named states, so there is no state graph to draw.'),
    ],
    caveat: null,
    external: { label: 'MockServer', url: 'https://www.mock-server.com/' },
    screenshot: 'corpus-mockserver',
  },
  {
    slug: 'mockoon',
    name: 'Mockoon',
    h1: 'Mockoon, from a browser',
    lede: 'Read and edit the routes in a Mockoon environment file from anywhere that can reach it, with a traffic log once the admin API token is in the profile.',
    // Mockoon has a good desktop application. Pretending otherwise loses the reader in one line.
    caveat:
      'Mockoon has its own desktop app, and for local work it is the better tool. This is for the setups it does not cover: an environment file in version control, a mockoon-cli running in CI, or a team that wants one interface across four different mock servers.',
    install: {
      commands: [
        'mockoon-cli start --data ./env.json --port 3000 --watch',
        'npx mock-knight --url http://localhost:3000 --adapter mockoon',
      ],
      note: 'A Mockoon profile also needs the path to its environment JSON file — the Servers screen asks for it once Mockoon is chosen as the backend, because its admin API cannot read routes. Start Mockoon with --watch and the file is authoritative: edit it and the server follows.',
    },
    capabilities: [
      on('Search the corpus'),
      on('Read a stub'),
      on('Edit a stub'),
      off(
        'Create and delete',
        'Both also rewrite `rootChildren`, where a mistake silently stops a route being served.',
      ),
      onIf(
        'Traffic log',
        'Needs Mockoon’s admin API token. That API is token-protected by default, so Mock Knight probes it on connect: a profile without the token gets a 401 and the Traffic screen is absent.',
      ),
      off('Why a request did not match', 'Mockoon’s admin API reports no near misses.'),
      off('Scenarios', 'Mockoon has no equivalent of named scenario states.'),
    ],
    external: { label: 'Mockoon', url: 'https://mockoon.com/' },
    screenshot: 'corpus-mockoon',
  },
  {
    slug: 'prism',
    name: 'Prism',
    h1: 'A UI for Prism',
    lede: 'See what a Prism mock will actually return: every operation as one stub per declared response, ranked the way Prism picks — lowest 2xx first.',
    install: {
      commands: [
        'prism mock ./openapi.yaml --port 4010',
        'npx mock-knight --url http://localhost:4010 --adapter prism',
      ],
      note: 'A Prism profile also needs the path to the OpenAPI document it serves — the Servers screen asks for it once Prism is chosen as the backend, because Prism has no control API and the document is the corpus.',
    },
    caveat:
      'Read-only. Prism has no control API, so its corpus is the OpenAPI document it serves and the document is the only place to change it.',
    capabilities: [
      on('Search the corpus'),
      on('Read a stub'),
      off(
        'Edit a stub',
        'Prism has no control API. Editing would mean rewriting your OpenAPI document.',
      ),
      off('Create and delete', 'Same reason: the corpus is your specification.'),
      off('Traffic log', 'Prism exposes no request journal.'),
      off('Why a request did not match', 'The near-miss ranking needs a journal.'),
      off('Scenarios', 'Prism has no stateful stubs.'),
    ],
    external: { label: 'Stoplight Prism', url: 'https://stoplight.io/open-source/prism' },
    screenshot: 'corpus-prism',
  },
]

export function backendFor(slug: string): Backend {
  const found = BACKENDS.find((backend) => backend.slug === slug)
  if (found === undefined) throw new Error(`No backend "${slug}".`)
  return found
}

export { CAPABILITY_ORDER }
