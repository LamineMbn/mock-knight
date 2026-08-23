import type {
  MockDraft,
  PriorityStanding,
  QueryPlan,
  ScenarioAnalysis,
} from '@mock-knight/core/types'
export type { ScenarioAnalysis }

/**
 * The BFF client.
 *
 * Types come from `@mock-knight/core/types` — the browser-safe entry point. Importing
 * `@mock-knight/core` here would pull `node:crypto` into the bundle and break the layering rule.
 */

export interface MockListItem {
  clientKey: string
  serverId: string | null
  name: string | null
  folder: string[]
  folderSource: 'metadata' | 'path' | 'none'
  tags: string[]
  method: string | null
  url: { kind: string; value: string } | null
  status: number | null
  priority: number | null
  enabled: boolean | null
  scenario: string | null
  hasDelay: boolean
  hasFault: boolean
  isProxy: boolean
  bodyFile: string | null
  /** Request header matchers. On a header-selected corpus these are the real discriminator. */
  headers: { name: string; operator: string; value: string | null }[]
  bodyTruncated: boolean
  lastServedAt: string | null
  contentHash: string
  /**
   * Which stub wins when several match the same method and path (FR-FIND-7). Mock Knight's own
   * inference over the full corpus, not something the server reported — render it as such.
   */
  standing: PriorityStanding
}

export interface FacetBucket {
  value: string
  count: number
}

export interface Facets {
  method: FacetBucket[]
  statusClass: FacetBucket[]
  scenario: FacetBucket[]
  folder: FacetBucket[]
  tag: FacetBucket[]
  header: FacetBucket[]
  hasDelay: number
  hasFault: number
  isProxy: number
}

export interface CorpusPage {
  items: MockListItem[]
  total: number
  limit: number
  offset: number
  facets: Facets
  textStrategy: 'none' | 'fts' | 'like' | 'mixed'
  bodyIndexTruncated: boolean
  plan: QueryPlan
  /** Present only when the query asked about unused stubs; carries the qualifier it needs. */
  unused: { provenance: 'server' | 'inferred'; earliestAt: string | null; bounded: boolean } | null
}

export interface Profile {
  id: string
  name: string
  baseUrl: string
  colour: string
  protected: boolean
  readOnly: boolean
  adapter: string
  adminPath: string | null
  capabilities: string[] | null
  createdAt: string
}

export interface NewProfile {
  name: string
  baseUrl: string
  /** Appended to the base URL, context path and all. `/__admin` unless the server says otherwise. */
  adminPath: string | null
  colour: string
  protected: boolean
  readOnly: boolean
}

export interface MirrorStatus {
  profileId: string
  count: number
  fetchedAt: string | null
  ageSeconds: number | null
  connected: boolean
  version: string | null
}

export interface CapabilityRow {
  bit: string
  on: boolean
  gate: 'backend' | 'environment'
  provenance: 'probed' | 'version' | 'declared'
  label: string
  whenOff: string
}

export interface PredicateResult {
  field: string
  outcome: 'pass' | 'fail' | 'unknown'
  expected: string | null
  actual: string | null
  operator: string | null
  note: string | null
}

export interface NearMiss {
  clientKey: string | null
  stubName: string | null
  distance: number
  mismatchCount: number
  unknownCount: number
  predicates: PredicateResult[]
  /** Where the candidate and its ranking came from. */
  provenance: 'server' | 'inferred'
  /** Where the per-field table came from — different, and shown differently. */
  predicateProvenance: 'server' | 'inferred'
}

export interface ServeEventRow {
  id: number
  upstreamId: string
  at: string
  matched: boolean
  matchedClientKey: string | null
  method: string | null
  url: string | null
  status: number | null
  correlation: string | null
  /** What the server said it took. `null` where it said nothing — never a fabricated zero. */
  durationMs: number | null
  /** How much of that was a delay someone configured rather than work the server did. */
  addedDelayMs: number | null
  /** Whether the stub that served this request is still in the corpus. */
  matchedStubPresent: boolean
}

/**
 * What the Traffic screen filters by — FR-TRAF-2.
 *
 * Empty string means "no filter" rather than `undefined`, because every one of these is bound
 * to an input whose empty state is the empty string; a second representation of "unset" is one
 * more thing to get wrong.
 */
export interface JournalFilters {
  matched: 'all' | 'matched' | 'unmatched'
  method: string
  path: string
  /** A leading digit as a string: '2', '4', '5'. */
  statusClass: string
  /** One request's correlation id, for following it through a system. */
  correlation: string
  /** Set only when the log has been narrowed to one stub's traffic. */
  clientKey?: string
}

export interface JournalPage {
  items: ServeEventRow[]
  total: number
  earliestAt: string | null
  /** The journal is finite and resettable; conclusions drawn from it carry this. */
  window: { earliestAt: string | null; bounded: boolean }
}

export interface Explanation {
  request: {
    method: string
    url: string
    headers: Record<string, string | string[]>
    body: string | null
  }
  nearMisses: NearMiss[]
  candidatesConsidered: number
}

export interface AuditRow {
  id: number
  at: string
  actor: string
  action: string
  clientKey: string | null
  summary: string
}

/**
 * A refused write. The server hands back what it currently holds, so the merge has all three
 * documents without another round trip through a target that keeps moving.
 */
export interface WriteConflict {
  error: 'conflict'
  message: string
  current: Record<string, unknown>
  currentHash: string
  baseHash: string
}

/** Carries the upstream detail so the UI can put it behind a copyable disclosure. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`Request failed with ${status}`)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const payload: unknown = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new ApiError(response.status, payload)
  return payload as T
}

export const api = {
  health: () => call<{ status: string; mode: string; version: string }>('/api/health'),
  profiles: () => call<{ profiles: Profile[] }>('/api/profiles'),
  capabilities: (profileId: string) =>
    call<{ connected: boolean; version: string | null; mode: string; report: CapabilityRow[] }>(
      `/api/profiles/${profileId}/capabilities`,
    ),
  mirror: (profileId: string) => call<MirrorStatus>(`/api/${profileId}/mirror`),
  refresh: (profileId: string) =>
    call<MirrorStatus>(`/api/${profileId}/refresh`, { method: 'POST' }),
  corpus: (profileId: string, query: string, limit: number, offset: number) =>
    call<CorpusPage>(
      `/api/${profileId}/mocks?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`,
    ),
  createProfile: (profile: NewProfile) =>
    call<{ profile: Profile }>('/api/profiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...profile, adapter: 'wiremock' }),
    }),
  updateProfile: (profileId: string, profile: NewProfile) =>
    call<{ profile: Profile; mirrorCleared: boolean }>(`/api/profiles/${profileId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...profile, adapter: 'wiremock' }),
    }),
  deleteProfile: (profileId: string) =>
    call<{ deleted: true }>(`/api/profiles/${profileId}`, { method: 'DELETE' }),
  connect: (profileId: string) =>
    call<{ connected: boolean; version: string | null; adminUrl: string; capabilities: string[] }>(
      `/api/profiles/${profileId}/connect`,
      { method: 'POST' },
    ),
  danger: (profileId: string, operation: string, confirm: string) =>
    call<{ done: true }>(`/api/${profileId}/danger/${operation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm }),
    }),
  scenarios: (profileId: string) =>
    call<{ scenarios: ScenarioAnalysis[]; canSetState: boolean; canResetAll: boolean }>(
      `/api/${profileId}/scenarios`,
    ),
  setScenarioState: (profileId: string, name: string, state: string | null) =>
    call<{ name: string; state: string | null }>(
      `/api/${profileId}/scenarios/${encodeURIComponent(name)}/state`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state }),
      },
    ),
  resetAllScenarios: (profileId: string, confirm: string) =>
    call<{ reset: true }>(`/api/${profileId}/scenarios/reset-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm }),
    }),
  events: (profileId: string, filters: JournalFilters, limit = 200) => {
    const search = new URLSearchParams({ limit: String(limit) })
    if (filters.matched !== 'all') search.set('matched', String(filters.matched === 'matched'))
    if (filters.method !== '') search.set('method', filters.method)
    if (filters.path !== '') search.set('path', filters.path)
    if (filters.statusClass !== '') search.set('statusClass', filters.statusClass)
    if (filters.correlation !== '') search.set('correlation', filters.correlation)
    if (filters.clientKey !== undefined) search.set('clientKey', filters.clientKey)
    return call<JournalPage>(`/api/${profileId}/events?${search.toString()}`)
  },
  explain: (profileId: string, eventId: number) =>
    call<Explanation>(`/api/${profileId}/explain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId }),
    }),
  stubFromRequest: (
    profileId: string,
    body: { eventId: number; tightness: string; matchBody: boolean },
  ) =>
    call<{ raw: Record<string, unknown>; notes: string[] }>(`/api/${profileId}/stub-from-request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  createMock: (profileId: string, raw: unknown) =>
    call<{ mock: MockListItem }>(`/api/${profileId}/mocks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ raw }),
    }),
  updateMock: (profileId: string, clientKey: string, raw: unknown, baseHash: string) =>
    call<{ mock: MockListItem & { raw: unknown } }>(
      `/api/${profileId}/mocks/${encodeURIComponent(clientKey)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw, baseHash }),
      },
    ),
  /**
   * The form tabs' write. Sends the canonical draft rather than vendor JSON, because the
   * browser has no adapter to render one; the server patches the retained document with it.
   * Same hash check, same conflict response as the raw path.
   */
  updateMockDraft: (profileId: string, clientKey: string, draft: MockDraft, baseHash: string) =>
    call<{ mock: MockListItem & { raw: unknown } }>(
      `/api/${profileId}/mocks/${encodeURIComponent(clientKey)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft, baseHash }),
      },
    ),
  /** Create from the form tabs. Same reason as `updateMockDraft`: the browser has no adapter. */
  createMockDraft: (profileId: string, draft: MockDraft) =>
    call<{ mock: MockListItem & { raw: unknown } }>(`/api/${profileId}/mocks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draft }),
    }),
  deleteMock: (profileId: string, clientKey: string, baseHash: string) =>
    call<{ deleted: true }>(`/api/${profileId}/mocks/${encodeURIComponent(clientKey)}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseHash }),
    }),
  audit: (profileId: string, clientKey?: string) =>
    call<{ entries: AuditRow[]; scope: string }>(
      `/api/${profileId}/audit${clientKey === undefined ? '' : `?key=${encodeURIComponent(clientKey)}`}`,
    ),
  mock: (profileId: string, clientKey: string) =>
    /**
     * `draft` is the canonical view the form tabs edit. It is `null` when the profile is not
     * connected — interpreting needs the adapter, and with no connection there is nothing to
     * save to, so an absent form is the honest state rather than one whose Save cannot work.
     */
    call<{ mock: MockListItem & { raw: unknown }; draft: MockDraft | null }>(
      `/api/${profileId}/mocks/${encodeURIComponent(clientKey)}`,
    ),
}
