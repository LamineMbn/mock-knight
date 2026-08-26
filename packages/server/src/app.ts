import { Hono } from 'hono'
import { z } from 'zod'
import {
  AdapterHttpError,
  AdapterHostNotAllowedError,
  AdapterTransportError,
  mockDraftSchema,
  parseQuery,
} from '@mock-knight/core'
import type { JsonObject, LoggedRequest, Mock, NearMiss, PriorityModel } from '@mock-knight/core'
import type { Database as Db } from 'better-sqlite3'
import { mirrorStatus, replaceCorpus } from './db/mirror.js'
import { getMock, searchCorpus } from './db/search.js'
import { ADAPTERS, priorityModelFor } from './adapters.js'
import { adminUrlFor, findProfileByAdminUrl } from './profiles.js'
import {
  deleteSavedSearch,
  listSavedSearches,
  saveSearch,
  savedSearchInputSchema,
} from './searches.js'
import { getServeEventRaw, listServeEvents, recordServeEvents } from './db/journal.js'
import { listAudit, recordAudit } from './db/audit.js'
import { createMock, deleteMock, updateMock } from './writes.js'
import type { WriteContext } from './writes.js'
import { resolveActor } from './identity.js'
import { MATCHER_TIGHTNESS, analyseScenarios, stubFromRequest } from '@mock-knight/core'
import type { ScenarioTransition } from '@mock-knight/core'
import {
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  profileInputSchema,
  updateProfile,
} from './profiles.js'
import { ProfileConfigurationError } from './runtime.js'
import type { Connection, ConnectionRegistry, RuntimeMode } from './runtime.js'

/**
 * The BFF's HTTP surface — TECH-DESIGN §9.
 *
 * Two conventions run through all of it:
 *
 *  - **Every data route is profile-scoped.** There is no ambient "current profile" on the
 *    server, so two browsers pointed at different profiles cannot interfere.
 *  - **A capability that is off makes the route 404, not 403.** The route does not exist for
 *    that profile, which is exactly what the UI models when it declines to draw a control.
 *
 * Routes are chained rather than registered separately so `hc<AppType>` can infer them.
 */

export interface AppOptions {
  db: Db
  registry: ConnectionRegistry
  mode: RuntimeMode
  version: string
  /** Overridable so tests do not depend on the machine's git config. */
  actor?: string
  /**
   * The profile this process was started for, if any — the one `--url` named.
   *
   * A function rather than a value because the CLI builds the app before it has resolved the
   * profile, and because the answer must not be captured at construction time.
   *
   * Without it the browser has no way to tell which server the command line asked for and falls
   * back to the first profile it holds, which is the *oldest*. Someone who ran against a local
   * WireMock last week and then names a staging URL today gets the local one — the tool opening
   * a server other than the one they just typed.
   */
  launchProfileId?: () => string | null
  /**
   * Whether a logo file has been dropped in for a backend, and where.
   *
   * Answered here rather than probed from the browser. The badge lives in lists that remount on
   * every keystroke, so an `<img>` that falls back on error showed a broken-image glyph and
   * re-requested a missing file on each render — and with fast enough remounting the probe never
   * completed at all. One `existsSync` at startup replaces all of it.
   */
  backendLogo?: (adapterId: string) => { light: string; dark: string | null } | null
}

const listQuerySchema = z.object({
  q: z.string().default(''),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

/** Fetch the whole corpus a page at a time, so one huge response cannot stall the process. */
const INGEST_PAGE_SIZE = 500
/** How much of the upstream journal to pull per request. Its journal is bounded anyway. */
const JOURNAL_POLL_LIMIT = 200
/** design brief §6.4 shows three candidates; more is noise, and near-miss cost grows with them. */
const MAX_CANDIDATES = 5

const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  matched: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  correlation: z.string().optional(),
  method: z.string().optional(),
  path: z.string().optional(),
  status: z.coerce.number().int().min(100).max(599).optional(),
  /** A leading digit — 2, 4, 5 — rather than the "2xx" spelling the corpus facets use. */
  statusClass: z.coerce.number().int().min(1).max(5).optional(),
  clientKey: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
})

/**
 * A write arrives as **either** the vendor document or a canonical draft.
 *
 * `raw` is the Raw JSON tab: the user edited the vendor document directly, so nothing is
 * reconstructed from our model. `draft` is the form tabs, and it exists because the browser
 * cannot import an adapter (the layering rule) and so cannot turn a form field back into vendor
 * JSON. The server renders it through `adapter.render`, which *patches* the `raw` the draft
 * carries rather than rebuilding it — the only way the form can edit a stub without dropping
 * every field the canonical model does not know about (invariant 4).
 *
 * Both then go down the identical hash-checked path, so there is one write story and one
 * conflict story rather than two.
 */
const writeBodySchema = z.union([
  z.object({
    raw: z.record(z.string(), z.any()),
    /** What the caller believed it was editing. The whole safety mechanism hangs off this. */
    baseHash: z.string().min(1),
  }),
  z.object({
    draft: mockDraftSchema,
    baseHash: z.string().min(1),
  }),
])

/** Create takes either shape too, for the same reason as the write above. */
const createBodySchema = z.union([
  z.object({ raw: z.record(z.string(), z.any()) }),
  z.object({ draft: mockDraftSchema }),
])
const deleteBodySchema = z.object({ baseHash: z.string().min(1) })

/**
 * The destructive list. Adding a route here is what makes it destructive — there is no prefix
 * or naming convention doing that work implicitly.
 */
const DESTRUCTIVE: Record<
  string,
  {
    action: 'reset' | 'bulk'
    summary: string
    available: (connection: Connection) => boolean
    perform: (connection: Connection, db: Db, profileId: string) => Promise<void>
  }
> = {
  'reset-stubs': {
    action: 'reset',
    summary: 'reset every stub on the server',
    // Method presence, like every other entry here. The facade narrows the adapter by
    // capability, so "is the method there" is the same question as "is the bit on" — and it is
    // the one the typechecker can enforce now that a read-only backend exists.
    available: (connection) => connection.adapter.resetAll !== undefined,
    perform: async (connection, db, profileId) => {
      await connection.adapter.resetAll?.()
      db.prepare(`DELETE FROM mock WHERE profile_id = ?`).run(profileId)
    },
  },
  'clear-journal': {
    action: 'bulk',
    summary: 'cleared the request journal',
    available: (connection) => connection.adapter.clearJournal !== undefined,
    perform: async (connection, db, profileId) => {
      await connection.adapter.clearJournal?.()
      db.prepare(`DELETE FROM serve_event WHERE profile_id = ?`).run(profileId)
      // Our window has to move with theirs, or "unused since…" starts quoting a time whose
      // events we have just thrown away.
      db.prepare(
        `UPDATE journal_window SET earliest_at = NULL, reset_count = reset_count + 1
         WHERE profile_id = ?`,
      ).run(profileId)
    },
  },
}

const scenarioStateSchema = z.object({ state: z.string().nullable().default(null) })
const confirmSchema = z.object({ confirm: z.string() })

const fromRequestSchema = z.object({
  eventId: z.number().int().optional(),
  request: z
    .object({
      method: z.string(),
      url: z.string(),
      headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
      body: z.string().nullable().default(null),
    })
    .optional(),
  tightness: z.enum(MATCHER_TIGHTNESS).default('method-and-path'),
  matchBody: z.boolean().default(false),
  responseStatus: z.number().int().optional(),
})

const explainBodySchema = z.object({
  eventId: z.number().int().optional(),
  request: z
    .object({
      method: z.string(),
      url: z.string(),
      headers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
      body: z.string().nullable().default(null),
    })
    .optional(),
})

const EMPTY_REQUEST: LoggedRequest = {
  method: 'GET',
  url: '/',
  absoluteUrl: null,
  clientIp: null,
  headers: {},
  cookies: {},
  queryParameters: {},
  body: null,
  bodyTruncated: false,
}

/**
 * Turn a write outcome into a response.
 *
 * A conflict is a **409 carrying the server's current document**, not a bare error: the client
 * already holds the base and its own edit, so this is the third input the three-way merge needs
 * and withholding it would force another round trip through a moving target.
 */
function writeResponse(
  c: { json: (body: unknown, status?: 200 | 201 | 404 | 409 | 422) => Response },
  outcome:
    | Awaited<ReturnType<typeof updateMock>>
    | Awaited<ReturnType<typeof createMock>>
    | Awaited<ReturnType<typeof deleteMock>>,
  okStatus: 200 | 201 = 200,
  /**
   * What the caller was trying to write, echoed on a conflict.
   *
   * The three-way merge needs "mine", and a form write does not have one to send: the browser
   * submitted a canonical draft and never saw the vendor document it renders to. The server
   * did, so it hands it back rather than leaving the merge dialog with an empty side.
   */
  attempted?: JsonObject,
): Response {
  if (outcome.ok) return c.json({ mock: outcome.value }, okStatus)
  if (outcome.reason === 'conflict') {
    return c.json(
      {
        error: 'conflict',
        message: outcome.summary,
        current: outcome.current,
        currentHash: outcome.currentHash,
        baseHash: outcome.baseHash,
        ...(attempted === undefined ? {} : { attempted }),
      },
      409,
    )
  }
  if (outcome.reason === 'not_found') return c.json({ error: 'not_found' }, 404)
  return c.json(
    {
      error: 'unsupported',
      message: 'This backend does not support that operation on a single stub.',
    },
    404,
  )
}

/** How far back our mirrored journal reaches; null when we have never polled it. */
function journalWindowOf(db: Db, profileId: string): string | null {
  const row = db
    .prepare(`SELECT earliest_at FROM journal_window WHERE profile_id = ?`)
    .get(profileId) as { earliest_at: string | null } | undefined
  return row?.earliest_at ?? null
}

/** Rebuild a logged request from the verbatim upstream event we stored. */
function readRequestFromEvent(raw: unknown): LoggedRequest {
  const event = raw as { request?: Record<string, unknown> }
  const source = event.request ?? {}
  return {
    ...EMPTY_REQUEST,
    method: typeof source['method'] === 'string' ? source['method'] : 'GET',
    url: typeof source['url'] === 'string' ? source['url'] : '/',
    absoluteUrl: typeof source['absoluteUrl'] === 'string' ? source['absoluteUrl'] : null,
    headers: (source['headers'] ?? {}) as LoggedRequest['headers'],
    body: typeof source['body'] === 'string' ? source['body'] : null,
  }
}

/**
 * The sentence shown above the disclosure when the mock server refuses a request.
 *
 * 401 and 403 get named specifically. "The mock server rejected GET /__admin/version" is true of
 * an authentication failure and tells nobody what to do about it — the fix is a credential, and
 * the message has to say so or the status code sits unread inside a collapsed disclosure.
 *
 * The *name* of the environment variable is safe to think about here; its value never is. This
 * function never sees the resolved secret, and nothing about the credential is echoed back.
 */
export function describeUpstreamRejection(error: AdapterHttpError): string {
  if (error.status === 401) {
    return (
      `${error.url} requires credentials. Set this server's authentication on the Servers ` +
      `screen — Mock Knight stores the name of an environment variable, never the secret itself.`
    )
  }
  if (error.status === 403) {
    return (
      `${error.url} refused these credentials. They reached the server and were rejected, so ` +
      `the variable is set but the value or the account is wrong.`
    )
  }
  return `The mock server rejected ${error.method} ${error.url}.`
}

export function createApp(options: AppOptions) {
  const { db, registry, mode } = options
  // Resolved once: shelling out to git on every write would be absurd, and the answer cannot
  // change while the process runs.
  const actor = options.actor ?? resolveActor(mode)

  /**
   * Everything a write needs, or the reason it must not happen.
   *
   * A read-only profile returns 404 rather than 403 on purpose: the route does not exist for
   * that profile, which is exactly what the UI models when it declines to draw a Save button
   * (design brief §7.1 — never a control that fails).
   */
  /**
   * How the profile's backend ranks contenders.
   *
   * Read from the descriptor rather than a live adapter: the mirrored corpus stays browsable
   * while disconnected, and the Priority column has to be right there too.
   */
  const rankingOf = (profileId: string): PriorityModel =>
    priorityModelFor(getProfile(db, profileId)?.adapter ?? '')

  const writeContext = (
    profileId: string,
  ): { context: WriteContext } | { error: 'not_found' | 'not_connected' } => {
    const profile = getProfile(db, profileId)
    if (profile === null) return { error: 'not_found' }
    if (profile.readOnly) return { error: 'not_found' }
    const connection = registry.get(profileId)
    if (connection === null) return { error: 'not_connected' }
    return { context: { db, profile, connection, actor } }
  }

  const app = new Hono()
    .onError((error, c) => {
      if (error instanceof AdapterHttpError) {
        // Surfaced verbatim behind the UI's disclosure: a developer will paste this into an
        // issue, so the upstream method, path, status, and body all have to survive.
        return c.json(
          {
            error: 'upstream_error',
            message: describeUpstreamRejection(error),
            upstream: {
              method: error.method,
              url: error.url,
              status: error.status,
              body: error.responseBody.slice(0, 4000),
            },
          },
          502,
        )
      }
      if (error instanceof AdapterTransportError) {
        /*
         * The connection is gone, so stop claiming it is not.
         *
         * A handle that has stopped working used to keep reporting healthy — the badge stayed
         * clean while every action failed on its own. Dropping it here means the next mirror
         * poll says "unreachable" with this reason, and the reconnect loop takes it from there.
         *
         * Only a *transport* failure counts. A 4xx or 5xx from the mock server means it
         * answered, which is the opposite of unreachable.
         */
        const failed = c.req.param('p') ?? c.req.param('id')
        if (failed !== undefined) registry.markUnreachable(failed, error)

        // Same envelope as an upstream HTTP error so the UI has one disclosure to render, with
        // `status: null` marking the difference: nothing answered, so there is no status.
        return c.json(
          {
            error: 'upstream_unreachable',
            message: error.message,
            upstream: {
              method: error.method,
              url: error.url,
              status: null,
              code: error.code,
              body: error.detail,
            },
          },
          502,
        )
      }
      if (error instanceof ProfileConfigurationError) {
        // The profile is wrong, not the server: 400, and the message names what to change.
        return c.json({ error: 'profile_misconfigured', message: error.message }, 400)
      }
      if (error instanceof AdapterHostNotAllowedError) {
        return c.json({ error: 'host_not_allowed', message: error.message }, 403)
      }
      return c.json({ error: 'internal_error', message: error.message }, 500)
    })

    .get('/api/health', (c) =>
      c.json({
        status: 'ok' as const,
        mode,
        version: options.version,
        launchProfileId: options.launchProfileId?.() ?? null,
      }),
    )

    /**
     * The backends this build can talk to. The browser cannot import an adapter (the layering
     * rule), so it learns the list — and each one's default control path — from here.
     */
    .get('/api/adapters', (c) =>
      c.json({
        adapters: ADAPTERS.map((adapter) => {
          const logo = options.backendLogo?.(adapter.id) ?? null
          return { ...adapter, logoUrl: logo?.light ?? null, logoDarkUrl: logo?.dark ?? null }
        }),
      }),
    )

    .get('/api/profiles', (c) => c.json({ profiles: listProfiles(db) }))

    .post('/api/profiles', async (c) => {
      const parsed = profileInputSchema.safeParse(await c.req.json())
      if (!parsed.success) {
        return c.json({ error: 'invalid_profile', issues: parsed.error.issues }, 400)
      }
      /**
       * Two profiles pointing at one server are not a second environment, they are a mistake
       * someone has to notice later: both mirror the same corpus, edits made through one look
       * stale in the other, and the switcher offers a choice that changes nothing.
       *
       * Compared on the composed admin URL rather than the base URL, so a trailing slash or an
       * explicit `/__admin` cannot smuggle one past.
       */
      const clash = findProfileByAdminUrl(db, parsed.data)
      if (clash !== null) {
        return c.json(
          {
            error: 'duplicate_server',
            message: `“${clash.name}” already points at ${adminUrlFor(clash) ?? clash.baseUrl}. Switch to it, or edit it, rather than adding a second one.`,
            existingProfileId: clash.id,
          },
          409,
        )
      }
      return c.json({ profile: createProfile(db, parsed.data) }, 201)
    })

    .patch('/api/profiles/:id', async (c) => {
      const id = c.req.param('id')
      const parsed = profileInputSchema.safeParse(await c.req.json())
      if (!parsed.success) {
        return c.json({ error: 'invalid_profile', issues: parsed.error.issues }, 400)
      }
      // Ignoring itself, or every save of an unchanged URL would report a collision.
      const clash = findProfileByAdminUrl(db, parsed.data, id)
      if (clash !== null) {
        return c.json(
          {
            error: 'duplicate_server',
            message: `“${clash.name}” already points at ${adminUrlFor(clash) ?? clash.baseUrl}.`,
            existingProfileId: clash.id,
          },
          409,
        )
      }

      const updated = updateProfile(db, id, parsed.data)
      if (updated === null) return c.json({ error: 'not_found' }, 404)

      // Re-point the live connection too: leaving the old adapter in place would answer for a
      // server the profile no longer names.
      if (updated.targetChanged) {
        await registry.disconnect(id)
        await registry.connect(updated.profile).catch(() => undefined)
      }
      return c.json({ profile: updated.profile, mirrorCleared: updated.targetChanged })
    })

    .delete('/api/profiles/:id', (c) =>
      deleteProfile(db, c.req.param('id'))
        ? c.json({ deleted: true })
        : c.json({ error: 'not_found' }, 404),
    )

    .post('/api/profiles/:id/connect', async (c) => {
      const profile = getProfile(db, c.req.param('id'))
      if (profile === null) return c.json({ error: 'not_found' }, 404)
      const connection = await registry.connect(profile)
      return c.json({
        connected: true,
        version: connection.version,
        adminUrl: connection.adminUrl,
        fingerprint: connection.fingerprint,
        capabilities: [...connection.capabilities],
      })
    })

    .get('/api/profiles/:id/capabilities', (c) => {
      const profile = getProfile(db, c.req.param('id'))
      if (profile === null) return c.json({ error: 'not_found' }, 404)
      const connection = registry.get(profile.id)
      return c.json({
        connected: connection !== null,
        version: connection?.version ?? null,
        // Which backend, so the UI names it rather than assuming one.
        backend: connection?.adapter.displayName ?? null,
        mode,
        report: registry.report(profile.id),
      })
    })

    .get('/api/:p/mocks', async (c) => {
      const profileId = c.req.param('p')
      if (getProfile(db, profileId) === null) return c.json({ error: 'not_found' }, 404)

      const parsed = listQuerySchema.safeParse(c.req.query())
      if (!parsed.success) {
        return c.json({ error: 'invalid_query', issues: parsed.error.issues }, 400)
      }

      const connection = registry.get(profileId)
      const plan = parseQuery(parsed.data.q, {
        capabilities: connection?.capabilities ?? new Set(),
      })

      // `unused:` is a **bounded truth** either way, but not equally bounded. Where the server
      // can compute it (WireMock ≥3.13), its answer wins and we say so; otherwise we join our
      // own mirrored journal, which only holds what we happened to poll — a weaker claim that
      // has to be labelled differently (FR-FIND-8, TECH-DESIGN §6.4).
      const wantsUnused = plan.groups.some((group) => group.field === 'unused')
      let unusedKeys: string[] | null = null
      let unusedProvenance: 'server' | 'inferred' | null = null
      if (wantsUnused) {
        if (connection?.adapter.findUnusedMocks !== undefined) {
          unusedKeys = (await connection.adapter.findUnusedMocks()).map((mock) => mock.clientKey)
          unusedProvenance = 'server'
        } else {
          unusedProvenance = 'inferred'
        }
      }

      const result = searchCorpus(db, {
        profileId,
        plan,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        unusedKeys,
        // From the profile's backend, not a constant: WireMock and MockServer rank in opposite
        // directions, and the mirror stays browsable while disconnected so this cannot come
        // from a live adapter.
        priority: rankingOf(profileId),
      })
      // The plan travels back with the results so the search box can render exactly what was
      // applied — including the tokens it had to reject, which is what makes an empty result
      // set explicable rather than mysterious.
      return c.json({
        ...result,
        plan,
        // Present only when the query asked about unused stubs, so the UI can attach the
        // qualifier the requirement insists on rather than printing a bare "unused".
        unused:
          unusedProvenance === null
            ? null
            : {
                provenance: unusedProvenance,
                earliestAt: journalWindowOf(db, profileId),
                bounded: true,
              },
      })
    })

    .get('/api/:p/mocks/:key', (c) => {
      const profileId = c.req.param('p')
      const mock = getMock(db, profileId, c.req.param('key'), rankingOf(profileId))
      if (mock === null) return c.json({ error: 'not_found' }, 404)

      // The canonical view, for the form tabs. Only when connected: interpreting needs the
      // adapter, and without a connection there is nothing to write to anyway, so the form
      // being absent is the honest state rather than a form whose Save cannot work.
      const connection = registry.get(profileId)
      const draft =
        connection === null ? null : connection.adapter.interpret(mock.raw as JsonObject)
      return c.json({ mock, draft })
    })

    /**
     * Saved searches — FR-FIND-6. Scoped to the profile in the path; there is no route that
     * reaches another profile's, which is why the store takes the id rather than trusting one
     * in the body.
     */
    .get('/api/:p/searches', (c) => {
      const profileId = c.req.param('p')
      if (getProfile(db, profileId) === null) return c.json({ error: 'not_found' }, 404)
      return c.json({ searches: listSavedSearches(db, profileId) })
    })

    .post('/api/:p/searches', async (c) => {
      const profileId = c.req.param('p')
      if (getProfile(db, profileId) === null) return c.json({ error: 'not_found' }, 404)
      const parsed = savedSearchInputSchema.safeParse(await c.req.json())
      if (!parsed.success) {
        return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
      }
      return c.json({ search: saveSearch(db, profileId, parsed.data) }, 201)
    })

    .delete('/api/:p/searches/:id', (c) => {
      const profileId = c.req.param('p')
      if (getProfile(db, profileId) === null) return c.json({ error: 'not_found' }, 404)
      const id = Number(c.req.param('id'))
      if (!Number.isInteger(id)) return c.json({ error: 'not_found' }, 404)
      return deleteSavedSearch(db, profileId, id)
        ? c.json({ deleted: true as const })
        : c.json({ error: 'not_found' }, 404)
    })

    /**
     * Mirror status, and the place a dropped connection is picked back up.
     *
     * Reconnecting here rather than on a timer of its own: this is the one request the UI makes
     * about a profile's health, so the attempt happens exactly when someone is looking at the
     * answer. `ensure` holds a backoff, so a server that is down is tried on a schedule rather
     * than on every poll.
     */
    .get('/api/:p/mirror', async (c) => {
      const profileId = c.req.param('p')
      const profile = getProfile(db, profileId)
      if (profile === null) return c.json({ error: 'not_found' }, 404)
      const connection = await registry.ensure(profile)
      return c.json({
        ...mirrorStatus(db, profileId, new Date()),
        connected: connection !== null,
        version: connection?.version ?? null,
        // Which backend, so the UI names it rather than assuming one.
        backend: connection?.adapter.displayName ?? null,
        // Why it is not connected, so the badge can say so instead of claiming to be trying.
        failure: registry.lastFailure(profileId),
      })
    })

    /**
     * The traffic log. Pulls the upstream journal first so the view is current, then serves
     * from the mirror — polling is the only option WireMock offers (`journal.stream` is off).
     */
    .get('/api/:p/events', async (c) => {
      const profileId = c.req.param('p')
      const profile = getProfile(db, profileId)
      if (profile === null) return c.json({ error: 'not_found' }, 404)

      const connection = registry.get(profileId)
      if (connection === null) return c.json({ error: 'not_connected' }, 409)
      // Capability off ⇒ the route does not exist for this profile.
      if (connection.adapter.listServeEvents === undefined)
        return c.json({ error: 'not_found' }, 404)

      const parsed = eventsQuerySchema.safeParse(c.req.query())
      if (!parsed.success)
        return c.json({ error: 'invalid_query', issues: parsed.error.issues }, 400)

      const upstream = await connection.adapter.listServeEvents({ limit: JOURNAL_POLL_LIMIT })
      recordServeEvents(db, profileId, upstream.items, { redactHeaders: profile.redactHeaders })

      const page = listServeEvents(db, profileId, {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        ...(parsed.data.matched === undefined ? {} : { matched: parsed.data.matched }),
        ...(parsed.data.correlation === undefined ? {} : { correlation: parsed.data.correlation }),
        ...(parsed.data.method === undefined ? {} : { method: parsed.data.method }),
        ...(parsed.data.path === undefined ? {} : { path: parsed.data.path }),
        ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
        ...(parsed.data.statusClass === undefined ? {} : { statusClass: parsed.data.statusClass }),
        ...(parsed.data.clientKey === undefined ? {} : { clientKey: parsed.data.clientKey }),
        ...(parsed.data.since === undefined ? {} : { since: parsed.data.since }),
        ...(parsed.data.until === undefined ? {} : { until: parsed.data.until }),
      })
      return c.json({
        ...page,
        // Never let a journal-derived claim travel without its window (design brief §7.4).
        window: { earliestAt: page.earliestAt, bounded: true },
      })
    })

    /**
     * Why didn't this match? — design brief §6.4.
     *
     * Takes either a stored serve event or a request supplied by hand, so the same route backs
     * both the click-through from the traffic log and the "test a request" direction.
     */
    .post('/api/:p/explain', async (c) => {
      const profileId = c.req.param('p')
      if (getProfile(db, profileId) === null) return c.json({ error: 'not_found' }, 404)

      const connection = registry.get(profileId)
      if (connection === null) return c.json({ error: 'not_connected' }, 409)

      const parsed = explainBodySchema.safeParse(await c.req.json())
      if (!parsed.success)
        return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)

      let request: LoggedRequest
      if (parsed.data.eventId !== undefined) {
        const raw = getServeEventRaw(db, profileId, parsed.data.eventId)
        if (raw === null) return c.json({ error: 'not_found' }, 404)
        request = readRequestFromEvent(raw)
      } else if (parsed.data.request !== undefined) {
        request = { ...EMPTY_REQUEST, ...parsed.data.request }
      } else {
        return c.json({ error: 'invalid_body', message: 'Give either eventId or request.' }, 400)
      }

      if (connection.adapter.nearMissesForRequest === undefined) {
        // The backend cannot rank candidates. FR-TRAF-3's third branch — Mock Knight's own
        // matcher model over the mirror — is not built yet, so say so rather than return an
        // empty list that reads as "nothing was close".
        return c.json(
          {
            error: 'not_supported',
            message:
              'This server cannot rank near misses, and Mock Knight cannot yet compute ' +
              'candidates itself. The match explainer is unavailable for this profile.',
          },
          404,
        )
      }

      const nearMisses: NearMiss[] = await connection.adapter.nearMissesForRequest(request)
      return c.json({
        request,
        nearMisses: nearMisses.slice(0, MAX_CANDIDATES),
        candidatesConsidered: nearMisses.length,
      })
    })

    /** Replace a stub's vendor document. The conflict check lives in `writes.ts`. */
    .put('/api/:p/mocks/:key', async (c) => {
      const resolved = writeContext(c.req.param('p'))
      if ('error' in resolved) {
        return c.json({ error: resolved.error }, resolved.error === 'not_found' ? 404 : 409)
      }
      const parsed = writeBodySchema.safeParse(await c.req.json())
      if (!parsed.success)
        return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)

      const existing = getMock(
        db,
        c.req.param('p'),
        c.req.param('key'),
        rankingOf(c.req.param('p')),
      )
      if (existing === null) return c.json({ error: 'not_found' }, 404)
      if (existing.serverId === null) {
        return c.json(
          {
            error: 'no_server_id',
            message:
              'This backend assigns no stable id, so a single stub cannot be addressed for ' +
              'update. Editing is whole-document on such backends.',
          },
          404,
        )
      }

      // A draft is rendered to a patched vendor document here, where the adapter lives.
      const raw =
        'raw' in parsed.data
          ? parsed.data.raw
          : resolved.context.connection.adapter.render(parsed.data.draft)

      const outcome = await updateMock(resolved.context, {
        clientKey: c.req.param('key'),
        serverId: existing.serverId,
        raw,
        baseHash: parsed.data.baseHash,
      })
      return writeResponse(c, outcome, 200, raw)
    })

    .post('/api/:p/mocks', async (c) => {
      const resolved = writeContext(c.req.param('p'))
      if ('error' in resolved) {
        return c.json({ error: resolved.error }, resolved.error === 'not_found' ? 404 : 409)
      }
      const parsed = createBodySchema.safeParse(await c.req.json())
      if (!parsed.success)
        return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
      const raw =
        'raw' in parsed.data
          ? parsed.data.raw
          : resolved.context.connection.adapter.render(parsed.data.draft)
      return writeResponse(c, await createMock(resolved.context, raw), 201)
    })

    .delete('/api/:p/mocks/:key', async (c) => {
      const resolved = writeContext(c.req.param('p'))
      if ('error' in resolved) {
        return c.json({ error: resolved.error }, resolved.error === 'not_found' ? 404 : 409)
      }
      const parsed = deleteBodySchema.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success)
        return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)

      const existing = getMock(
        db,
        c.req.param('p'),
        c.req.param('key'),
        rankingOf(c.req.param('p')),
      )
      if (existing === null || existing.serverId === null)
        return c.json({ error: 'not_found' }, 404)

      return writeResponse(
        c,
        await deleteMock(resolved.context, {
          clientKey: c.req.param('key'),
          serverId: existing.serverId,
          baseHash: parsed.data.baseHash,
        }),
      )
    })

    /** The local audit trail (FR-EDIT-8), scoped to one stub when asked. */
    .get('/api/:p/audit', (c) => {
      const profileId = c.req.param('p')
      if (getProfile(db, profileId) === null) return c.json({ error: 'not_found' }, 404)
      const clientKey = c.req.query('key')
      return c.json({
        entries: listAudit(db, profileId, {
          limit: Number(c.req.query('limit') ?? 100),
          ...(clientKey === undefined ? {} : { clientKey }),
        }),
        // The UI is required to repeat this; it is not a footnote.
        scope:
          mode === 'local'
            ? 'Changes made through Mock Knight on this machine.'
            : 'Changes made through this Mock Knight instance.',
      })
    })

    /**
     * Compose a stub from a captured request — FR-TRAF-5. Renders only; nothing is written.
     *
     * Separate from the create route on purpose: every choice this makes is a guess about
     * intent, so the document and the reasoning are shown for review before anything reaches
     * the server.
     */
    .post('/api/:p/stub-from-request', async (c) => {
      const profileId = c.req.param('p')
      if (getProfile(db, profileId) === null) return c.json({ error: 'not_found' }, 404)
      const connection = registry.get(profileId)
      if (connection === null) return c.json({ error: 'not_connected' }, 409)

      const parsed = fromRequestSchema.safeParse(await c.req.json())
      if (!parsed.success)
        return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)

      let request: LoggedRequest
      if (parsed.data.eventId !== undefined) {
        const raw = getServeEventRaw(db, profileId, parsed.data.eventId)
        if (raw === null) return c.json({ error: 'not_found' }, 404)
        request = readRequestFromEvent(raw)
      } else if (parsed.data.request !== undefined) {
        request = { ...EMPTY_REQUEST, ...parsed.data.request }
      } else {
        return c.json({ error: 'invalid_body', message: 'Give either eventId or request.' }, 400)
      }

      const generated = stubFromRequest(request, {
        tightness: parsed.data.tightness,
        matchBody: parsed.data.matchBody,
        ...(parsed.data.responseStatus === undefined
          ? {}
          : { responseStatus: parsed.data.responseStatus }),
      })
      return c.json({ raw: connection.adapter.render(generated.draft), notes: generated.notes })
    })

    /**
     * Scenarios, with the shape derived from the corpus — FR-STATE-1/3/4.
     *
     * The server reports each scenario's name and current state; everything else (which stubs
     * move it, which states are unreachable, which are dead ends) exists only as a property of
     * the stubs that reference it, so it is computed here from the mirror.
     */
    .get('/api/:p/scenarios', async (c) => {
      const profileId = c.req.param('p')
      if (getProfile(db, profileId) === null) return c.json({ error: 'not_found' }, 404)
      const connection = registry.get(profileId)
      if (connection === null) return c.json({ error: 'not_connected' }, 409)
      if (connection.adapter.listScenarios === undefined) return c.json({ error: 'not_found' }, 404)

      const scenarios = await connection.adapter.listScenarios()
      const rows = db
        .prepare(
          `SELECT client_key, name, scenario, required_state, new_state
           FROM mock WHERE profile_id = ? AND scenario IS NOT NULL`,
        )
        .all(profileId) as {
        client_key: string
        name: string | null
        scenario: string
        required_state: string | null
        new_state: string | null
      }[]

      const byScenario: Record<string, ScenarioTransition[]> = {}
      for (const row of rows) {
        ;(byScenario[row.scenario] ??= []).push({
          clientKey: row.client_key,
          stubName: row.name,
          from: row.required_state,
          to: row.new_state,
        })
      }

      return c.json({
        scenarios: analyseScenarios(scenarios, byScenario),
        // The write affordances are drawn from this, not guessed at.
        canSetState: connection.adapter.setScenarioState !== undefined,
        canResetAll: connection.adapter.resetAllScenarios !== undefined,
      })
    })

    /** Set one scenario's state, or reset just that one when `state` is null. Not destructive. */
    .put('/api/:p/scenarios/:name/state', async (c) => {
      const profileId = c.req.param('p')
      const profile = getProfile(db, profileId)
      if (profile === null || profile.readOnly) return c.json({ error: 'not_found' }, 404)
      const connection = registry.get(profileId)
      if (connection === null) return c.json({ error: 'not_connected' }, 409)
      if (connection.adapter.setScenarioState === undefined) {
        return c.json({ error: 'not_found' }, 404)
      }

      const parsed = scenarioStateSchema.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success)
        return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)

      const name = c.req.param('name')
      await connection.adapter.setScenarioState(name, parsed.data.state)
      recordAudit(db, {
        profileId,
        actor,
        action: 'state',
        clientKey: null,
        before: null,
        after: null,
        summary:
          parsed.data.state === null
            ? `reset scenario ${name}`
            : `set scenario ${name} to ${parsed.data.state}`,
      })
      return c.json({ name, state: parsed.data.state })
    })

    /**
     * Reset **every** scenario — a §9.6 destructive operation, so it takes a typed confirmation
     * matching the profile name, re-validated here rather than trusted from the UI, and is
     * absent entirely on a protected profile.
     */
    .post('/api/:p/scenarios/reset-all', async (c) => {
      const profileId = c.req.param('p')
      const profile = getProfile(db, profileId)
      if (profile === null || profile.readOnly || profile.protected) {
        return c.json({ error: 'not_found' }, 404)
      }
      const connection = registry.get(profileId)
      if (connection === null) return c.json({ error: 'not_connected' }, 409)
      if (connection.adapter.resetAllScenarios === undefined) {
        return c.json({ error: 'not_found' }, 404)
      }

      const parsed = confirmSchema.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success || parsed.data.confirm !== profile.name) {
        return c.json(
          {
            error: 'confirmation_required',
            message: `Type the profile name (${profile.name}) to confirm resetting every scenario.`,
          },
          400,
        )
      }

      await connection.adapter.resetAllScenarios()
      recordAudit(db, {
        profileId,
        actor,
        action: 'reset',
        clientKey: null,
        before: null,
        after: null,
        summary: 'reset every scenario',
      })
      return c.json({ reset: true })
    })

    /**
     * Destructive operations — PRD §9.6, TECH-DESIGN §9.
     *
     * Defined by a **list, not a URL prefix**: each one names itself here rather than inheriting
     * danger from where it sits in the route tree. Each requires the profile name typed back,
     * re-validated server-side because the dialog is a convenience and this is the gate, and
     * each is absent — 404, not 403 — on a protected profile.
     */
    .post('/api/:p/danger/:operation', async (c) => {
      const profileId = c.req.param('p')
      const operation = c.req.param('operation')
      const profile = getProfile(db, profileId)
      if (profile === null || profile.readOnly || profile.protected) {
        return c.json({ error: 'not_found' }, 404)
      }
      const connection = registry.get(profileId)
      if (connection === null) return c.json({ error: 'not_connected' }, 409)

      const run = DESTRUCTIVE[operation]
      if (run === undefined) return c.json({ error: 'not_found' }, 404)
      if (!run.available(connection)) return c.json({ error: 'not_found' }, 404)

      const parsed = confirmSchema.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success || parsed.data.confirm !== profile.name) {
        return c.json(
          {
            error: 'confirmation_required',
            message: `Type the profile name (${profile.name}) to confirm.`,
          },
          400,
        )
      }

      await run.perform(connection, db, profileId)
      recordAudit(db, {
        profileId,
        actor,
        action: run.action,
        clientKey: null,
        before: null,
        after: null,
        summary: run.summary,
      })
      return c.json({ done: true })
    })

    .post('/api/:p/refresh', async (c) => {
      const profileId = c.req.param('p')
      const profile = getProfile(db, profileId)
      if (profile === null) return c.json({ error: 'not_found' }, 404)

      const connection = registry.get(profileId) ?? (await registry.connect(profile))
      const fetchedAt = new Date().toISOString()

      const collected: Mock[] = []
      let offset = 0
      let total = Number.POSITIVE_INFINITY
      while (collected.length < total) {
        const page = await connection.adapter.listMocks({ limit: INGEST_PAGE_SIZE, offset })
        collected.push(...page.items)
        // Trust the page, not the reported total: TECH-DESIGN §17.8 flags `meta.total`'s
        // semantics as unconfirmed, so a short page is the reliable end-of-corpus signal.
        if (page.items.length < INGEST_PAGE_SIZE) break
        total = page.total
        offset += INGEST_PAGE_SIZE
      }

      const stats = replaceCorpus(db, profileId, collected, fetchedAt)
      return c.json({ ...stats, ...mirrorStatus(db, profileId, new Date()) })
    })

  return app
}

export type AppType = ReturnType<typeof createApp>
