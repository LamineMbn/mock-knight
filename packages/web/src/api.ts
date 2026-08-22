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
  mock: (profileId: string, clientKey: string) =>
    call<{ mock: MockListItem & { raw: unknown } }>(
      `/api/${profileId}/mocks/${encodeURIComponent(clientKey)}`,
    ),
}
