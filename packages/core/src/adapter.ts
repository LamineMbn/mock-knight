import { z } from 'zod'
import type { CapabilityBit } from './capabilities.js'
import type { PriorityModel } from './overlap.js'
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
  /** Overrides how the tool identifies itself upstream. Adapters supply a default. */
  readonly userAgent?: string
  /**
   * The document a document-backed backend reads its corpus from.
   *
   * Added for Mockoon, whose admin API cannot read routes at all (§17.31): the corpus is an
   * environment JSON file, so "where is the corpus" is a path rather than a URL. Absent for the
   * API-driven backends, which have no use for it.
   */
  readonly documentPath?: string | null
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
  /**
   * Two or three characters identifying this backend where a name will not fit — beside every
   * server address, at 16px.
   *
   * A lettermark rather than the vendor's own logo, deliberately. Shipping an approximation of
   * someone else's trademark is worse than shipping no logo: it is wrong, it is theirs, and a
   * redrawn mark is the kind of thing a project gets asked to remove. `WM` and `MS` distinguish
   * two backends at a glance without claiming to be anybody's brand.
   */
  readonly shortName: string

  /**
   * Where this backend's control API lives when a profile does not say.
   *
   * On the contract rather than in a lookup table somewhere, because it is a property of the
   * backend and the UI has to know it before a connection exists — the Servers form previews
   * the composed address while someone is still typing. `/__admin` for WireMock, `/mockserver`
   * for MockServer, and getting it wrong is a connection failure with a confusing 404.
   */
  readonly defaultAdminPath: string

  /**
   * For a document-backed backend: what its corpus file is called, and why it is needed.
   *
   * `null` for a backend whose corpus is reachable over its admin API. Non-null means a profile
   * without a `documentPath` cannot work at all, so the Servers form must ask for one — asked of
   * the adapter rather than hardcoded against an id, exactly as `defaultAdminPath` is, so a
   * fourth backend needs no change in the UI.
   */
  readonly corpusDocument: { readonly label: string; readonly hint: string } | null

  /**
   * How this backend ranks stubs that contend for the same request.
   *
   * On the contract because backends disagree on both the default and the *direction*, and the
   * Priority column exists to say which stub answers — so assuming WireMock's rule made it name
   * the wrong winner on MockServer (§17.34).
   */
  readonly priorityModel: PriorityModel

  connect(cfg: ConnectionConfig): Promise<ConnectionInfo>
  /** Valid only after `connect`; results are probed, not inferred from a version string. */
  capabilities(): ReadonlySet<CapabilityBit>

  /**
   * Interpret a vendor document as a draft.
   *
   * Required, not optional: an adapter that can read its backend's format already does this,
   * and the write path needs it. When a user edits raw JSON, `raw` is the authoritative
   * document and the canonical fields must be **derived from it** — passing canonical fields
   * from some older version alongside a new `raw` makes `toVendor` patch the edit straight back
   * out, silently. Asking the adapter closes that hole without teaching the write service any
   * one backend's schema.
   */
  interpret(raw: JsonObject): MockDraft

  /**
   * The mirror of `interpret`: render a draft as a vendor document.
   *
   * Needed wherever a stub is *composed* rather than edited — creating one from a captured
   * request, for instance — so the UI can show exactly what will be written before it is.
   */
  render(draft: MockDraft): JsonObject

  // Corpus. `listMocks` is the one genuinely universal primitive: a backend that cannot be
  // listed cannot be shown, so there is nothing for this tool to do with it.
  listMocks(q?: { limit?: number; offset?: number }): Promise<Page<Mock>>

  /**
   * Wholesale corpus writes, optional like every other write.
   *
   * These were required until a *document-backed* backend arrived. Mockoon's corpus lives in an
   * environment JSON file with no read endpoint at all (§17.31), so a read-only Mockoon profile
   * has nothing to implement here — and the alternative, a method that exists and throws, is the
   * exact thing this contract's first paragraph forbids.
   *
   * `corpus.replaceAll` and `corpus.reset` already existed as capability bits: the capability
   * model had anticipated this and only the method list had not.
   */
  replaceAll?(mocks: readonly Mock[]): Promise<void>
  resetAll?(): Promise<void>

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
  'replaceAll',
  'resetAll',
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
  replaceAll: 'corpus.replaceAll',
  resetAll: 'corpus.reset',
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

/**
 * A request that never got an HTTP response at all — DNS, TCP, TLS, or a timeout.
 *
 * Separate from `AdapterHttpError` because the fix is different in kind: a 403 means the server
 * answered and refused, an `ENOTFOUND` means nothing was ever reached. undici collapses all of
 * these into `TypeError: fetch failed` and hides the real reason in `cause`, which is worse than
 * useless in a UI — "fetch failed" tells a developer pointing at a corporate host nothing about
 * whether they typed the name wrong, are off the VPN, or hit an expired certificate.
 */
export class AdapterTransportError extends Error {
  override readonly name = 'AdapterTransportError'
  constructor(
    readonly method: string,
    readonly url: string,
    /** The `cause.code` undici reported, e.g. `ENOTFOUND`, or `null` when it gave none. */
    readonly code: string | null,
    /** The underlying message, kept verbatim for the disclosure. */
    readonly detail: string,
  ) {
    super(describeTransportFailure(code, url))
  }
}

/**
 * A plain sentence for a transport failure, naming the likely fix.
 *
 * Deliberately says what to *check*, not just what happened: every one of these has a common
 * cause that is one step away from the message. Unknown codes fall through to the raw code
 * rather than a vague catch-all — a developer can search a code.
 *
 * Browser-safe.
 */
export function describeTransportFailure(code: string | null, url: string): string {
  let host = url
  try {
    host = new URL(url).host
  } catch {
    // Keep the whole string: a URL we could not parse is itself the useful detail.
  }
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `No DNS record for ${host}. Check the hostname, and whether this machine needs a VPN or an internal resolver to see it.`
    case 'ECONNREFUSED':
      return `Nothing is listening on ${host}. The server may be down, or on a different port.`
    case 'ECONNRESET':
      return `${host} closed the connection without answering. Often a proxy or load balancer in front of the server.`
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return `Timed out connecting to ${host}. Usually a firewall dropping the packets rather than refusing them.`
    case 'UND_ERR_HEADERS_TIMEOUT':
    case 'UND_ERR_BODY_TIMEOUT':
      return `${host} accepted the connection but did not finish answering in time.`
    case 'CERT_HAS_EXPIRED':
      return `The TLS certificate for ${host} has expired.`
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return `The TLS certificate for ${host} is not signed by a CA this machine trusts. Common with an internal CA that is not in the system trust store.`
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return `The TLS certificate presented by ${host} is for a different hostname.`
    case null:
      return `Could not reach ${host}.`
    default:
      return `Could not reach ${host} (${code}).`
  }
}

/** Dig undici's real reason out of the `cause` chain it hides it in. */
export function transportCode(error: unknown): string | null {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }
  return null
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
