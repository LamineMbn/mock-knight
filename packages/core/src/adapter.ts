import { z } from 'zod'
import type { CapabilityBit } from './capabilities.js'
import type {
  LoggedRequest,
  Mock,
  MockDraft,
  NearMiss,
  Page,
  RequestMatcher,
  Scenario,
  ServeEvent,
} from './model.js'
import type { JsonObject } from './types.js'

/**
 * The adapter contract — PRD §8.1.
 *
 * The load-bearing rule is that an unsupported operation makes the method *absent*, not present
 * and throwing. `capabilities()` and method presence must agree in both directions, and the
 * conformance suite asserts both, because "never show a control that will fail" is only true if
 * the server can tell that a control would fail without calling it.
 */

export const AUTH_KINDS = ['none', 'bearer', 'basic', 'headers'] as const
export const authKindSchema = z.enum(AUTH_KINDS)
export type AuthKind = (typeof AUTH_KINDS)[number]

/**
 * Auth as it crosses into an adapter: resolved values, server-side only.
 *
 * Config and the database hold env-var *names* (`auth_ref`); the resolved secret exists only in
 * this object, in memory, in the server process. It must never reach the SPA bundle, a URL, a
 * log line, or the audit table (PRD §12, TECH-DESIGN §13).
 */
export type ResolvedAuth =
  | { kind: 'none' }
  | { kind: 'bearer'; token: string }
  | { kind: 'basic'; username: string; password: string }
  | { kind: 'headers'; headers: Readonly<Record<string, string>> }

export interface ConnectionConfig {
  readonly baseUrl: string
  /** Admin path, e.g. `/__admin`. Adapters supply their own default. */
  readonly adminPath?: string
  readonly auth?: ResolvedAuth
  readonly timeoutMs?: number
  /** Host allowlist from config; when present every request is checked against it. */
  readonly allowedHosts?: readonly string[]
  /** Header that groups one test run's traffic together (FR-TRAF-8). */
  readonly correlationHeader?: string | null
}

export interface ConnectionInfo {
  readonly backendId: string
  readonly version: string | null
  /**
   * Version plus an instance marker. When this changes the mirror is dropped and queued writes
   * are discarded — never retry a write against a server that is not the one it was composed
   * against (TECH-DESIGN §7.3).
   */
  readonly fingerprint: string
  readonly adminUrl: string
  /**
   * When this server process started, if it can say. Compared with a tolerance rather than by
   * equality — two connects compute it from an integer uptime a moment apart, so the values
   * differ slightly for the same instance. `null` where the backend exposes no such signal, in
   * which case a restart simply cannot be detected and the UI must not pretend otherwise.
   */
  readonly instanceStartedAt: string | null
  /**
   * How each capability was decided. A bit inferred from a version string is a weaker claim
   * than one proved by calling the route, and design brief §7.4 forbids the capability report
   * from rendering the two identically.
   */
  readonly capabilityProvenance: Readonly<Record<string, CapabilityProvenance>>
}

/** `probed` — we called it. `version` — inferred from the version string. `declared` — hardcoded
 * for this backend because it is a property of the product, not of the deployment. */
export type CapabilityProvenance = 'probed' | 'version' | 'declared'

export interface JournalQuery {
  readonly limit?: number
  readonly offset?: number
  readonly since?: string
}

export interface MockBackendAdapter {
  readonly id: string
  readonly displayName: string

  connect(cfg: ConnectionConfig): Promise<ConnectionInfo>
  /** Valid only after `connect`; results are probed, not inferred from a version string. */
  capabilities(): ReadonlySet<CapabilityBit>

  // Corpus — the only near-universal primitives (PRD Appendix B).
  listMocks(q?: { limit?: number; offset?: number }): Promise<Page<Mock>>
  replaceAll(mocks: readonly Mock[]): Promise<void>
  resetAll(): Promise<void>

  // Per-unit. Each is a separate bit because a different backend breaks each one.
  getMock?(id: string): Promise<Mock>
  createMock?(draft: MockDraft): Promise<Mock>
  updateMock?(id: string, draft: MockDraft): Promise<Mock>
  deleteMock?(id: string): Promise<void>
  setEnabled?(id: string, enabled: boolean): Promise<void>

  // Traffic.
  listServeEvents?(q: JournalQuery): Promise<Page<ServeEvent>>
  listUnmatched?(): Promise<ServeEvent[]>
  findUnusedMocks?(): Promise<Mock[]>
  nearMissesForRequest?(request: LoggedRequest): Promise<NearMiss[]>
  nearMissesForMatcher?(matcher: RequestMatcher): Promise<NearMiss[]>
  clearJournal?(): Promise<void>

  // State.
  listScenarios?(): Promise<Scenario[]>
  /** `null` resets that one scenario. Resetting every scenario is `resetAllScenarios`. */
  setScenarioState?(name: string, state: string | null): Promise<void>
  resetAllScenarios?(): Promise<void>

  // Files.
  exportAll?(): Promise<JsonObject>
  importAll?(doc: JsonObject, mode: 'merge' | 'replace'): Promise<void>
  saveToServerDisk?(): Promise<void>

  /** Release transport resources. Adapters hold a per-profile connection pool. */
  close?(): Promise<void>
}

/** Every adapter method that a capability bit can switch off. */
export const OPTIONAL_ADAPTER_METHODS = [
  'getMock',
  'createMock',
  'updateMock',
  'deleteMock',
  'setEnabled',
  'listServeEvents',
  'listUnmatched',
  'findUnusedMocks',
  'nearMissesForRequest',
  'nearMissesForMatcher',
  'clearJournal',
  'listScenarios',
  'setScenarioState',
  'resetAllScenarios',
  'exportAll',
  'importAll',
  'saveToServerDisk',
] as const
export type OptionalAdapterMethod = (typeof OPTIONAL_ADAPTER_METHODS)[number]

/**
 * Which bit governs which method. The conformance suite reads this in both directions: bit on
 * ⇒ method present and working, bit off ⇒ method absent. A method that exists but throws
 * "unsupported" is a conformance failure, not an implementation detail.
 */
export const METHOD_CAPABILITY: Readonly<Record<OptionalAdapterMethod, CapabilityBit>> = {
  getMock: 'mock.read',
  createMock: 'mock.create',
  updateMock: 'mock.update',
  deleteMock: 'mock.delete',
  setEnabled: 'mock.enableDisable',
  listServeEvents: 'journal.read',
  listUnmatched: 'diagnostics.unmatched',
  findUnusedMocks: 'diagnostics.unusedStubs',
  nearMissesForRequest: 'diagnostics.nearMiss',
  nearMissesForMatcher: 'diagnostics.nearMiss',
  clearJournal: 'journal.clear',
  listScenarios: 'state.read',
  setScenarioState: 'state.write',
  resetAllScenarios: 'state.resetAll',
  exportAll: 'files.export',
  importAll: 'files.import',
  saveToServerDisk: 'files.serverSave',
}

/**
 * An upstream failure, carrying enough to render design brief §6.11's error disclosure: the
 * developer will paste it into an issue, so method, URL, status, and body all survive.
 */
export class AdapterHttpError extends Error {
  override readonly name = 'AdapterHttpError'
  constructor(
    readonly method: string,
    readonly url: string,
    readonly status: number,
    readonly responseBody: string,
    message?: string,
  ) {
    super(message ?? `${method} ${url} → ${status}`)
  }
}

/** A request refused before it left the process, because the host is not on the allowlist. */
export class AdapterHostNotAllowedError extends Error {
  override readonly name = 'AdapterHostNotAllowedError'
  constructor(readonly host: string) {
    super(
      `Refusing to reach ${host}: it is not in the configured allowedHosts list. ` +
        `Add it to allowedHosts in mock-knight.json, or remove the list to allow any host.`,
    )
  }
}
