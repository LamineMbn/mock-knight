import type { QueryPlan } from '@mock-knight/core/types'

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
  events: (profileId: string, matched: 'all' | 'matched' | 'unmatched', limit = 200) =>
    call<JournalPage>(
      `/api/${profileId}/events?limit=${limit}` +
        (matched === 'all' ? '' : `&matched=${matched === 'matched'}`),
    ),
  explain: (profileId: string, eventId: number) =>
    call<Explanation>(`/api/${profileId}/explain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId }),
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
    call<{ mock: MockListItem & { raw: unknown } }>(
      `/api/${profileId}/mocks/${encodeURIComponent(clientKey)}`,
    ),
}
