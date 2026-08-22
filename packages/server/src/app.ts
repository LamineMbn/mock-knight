import { Hono } from 'hono'
import { z } from 'zod'
import { AdapterHttpError, AdapterHostNotAllowedError, parseQuery } from '@mock-knight/core'
import type { Mock } from '@mock-knight/core'
import type { Database as Db } from 'better-sqlite3'
import { mirrorStatus, replaceCorpus } from './db/mirror.js'
import { getMock, searchCorpus } from './db/search.js'
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
}

const listQuerySchema = z.object({
  q: z.string().default(''),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

/** Fetch the whole corpus a page at a time, so one huge response cannot stall the process. */
const INGEST_PAGE_SIZE = 500

export function createApp(options: AppOptions) {
  const { db, registry, mode } = options

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

    .get('/api/:p/mocks', (c) => {
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
      const result = searchCorpus(db, {
        profileId,
        plan,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      })
      // The plan travels back with the results so the search box can render exactly what was
      // applied — including the tokens it had to reject, which is what makes an empty result
      // set explicable rather than mysterious.
      return c.json({ ...result, plan })
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
