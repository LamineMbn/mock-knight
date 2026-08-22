import { Hono } from 'hono'
import { z } from 'zod'
import { AdapterHttpError, AdapterHostNotAllowedError, parseQuery } from '@mock-knight/core'
import type { LoggedRequest, Mock, NearMiss } from '@mock-knight/core'
import type { Database as Db } from 'better-sqlite3'
import { mirrorStatus, replaceCorpus } from './db/mirror.js'
import { getMock, searchCorpus } from './db/search.js'
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
} from './profiles.js'
import type { ConnectionRegistry, RuntimeMode } from './runtime.js'

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
})

const writeBodySchema = z.object({
  /** The full vendor document. Edited directly, so nothing is reconstructed from our model. */
  raw: z.record(z.string(), z.any()),
  /** What the caller believed it was editing. The whole safety mechanism hangs off this. */
  baseHash: z.string().min(1),
})

const createBodySchema = z.object({ raw: z.record(z.string(), z.any()) })
const deleteBodySchema = z.object({ baseHash: z.string().min(1) })

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
            message: `The mock server rejected ${error.method} ${error.url}.`,
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
      if (error instanceof AdapterHostNotAllowedError) {
        return c.json({ error: 'host_not_allowed', message: error.message }, 403)
      }
      return c.json({ error: 'internal_error', message: error.message }, 500)
    })

    .get('/api/health', (c) => c.json({ status: 'ok' as const, mode, version: options.version }))

    .get('/api/profiles', (c) => c.json({ profiles: listProfiles(db) }))

    .post('/api/profiles', async (c) => {
      const parsed = profileInputSchema.safeParse(await c.req.json())
      if (!parsed.success) {
        return c.json({ error: 'invalid_profile', issues: parsed.error.issues }, 400)
      }
      return c.json({ profile: createProfile(db, parsed.data) }, 201)
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
      const mock = getMock(db, c.req.param('p'), c.req.param('key'))
      return mock === null ? c.json({ error: 'not_found' }, 404) : c.json({ mock })
    })

    .get('/api/:p/mirror', (c) => {
      const profileId = c.req.param('p')
      if (getProfile(db, profileId) === null) return c.json({ error: 'not_found' }, 404)
      const connection = registry.get(profileId)
      return c.json({
        ...mirrorStatus(db, profileId, new Date()),
        connected: connection !== null,
        version: connection?.version ?? null,
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

      const existing = getMock(db, c.req.param('p'), c.req.param('key'))
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

      const outcome = await updateMock(resolved.context, {
        clientKey: c.req.param('key'),
        serverId: existing.serverId,
        raw: parsed.data.raw,
        baseHash: parsed.data.baseHash,
      })
      return writeResponse(c, outcome)
    })

    .post('/api/:p/mocks', async (c) => {
      const resolved = writeContext(c.req.param('p'))
      if ('error' in resolved) {
        return c.json({ error: resolved.error }, resolved.error === 'not_found' ? 404 : 409)
      }
      const parsed = createBodySchema.safeParse(await c.req.json())
      if (!parsed.success)
        return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
      return writeResponse(c, await createMock(resolved.context, parsed.data.raw), 201)
    })

    .delete('/api/:p/mocks/:key', async (c) => {
      const resolved = writeContext(c.req.param('p'))
      if ('error' in resolved) {
        return c.json({ error: resolved.error }, resolved.error === 'not_found' ? 404 : 409)
      }
      const parsed = deleteBodySchema.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success)
        return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)

      const existing = getMock(db, c.req.param('p'), c.req.param('key'))
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
