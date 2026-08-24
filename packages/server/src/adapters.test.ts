import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database as Db } from 'better-sqlite3'
import { openDatabase } from './db/database.js'
import { ConnectionRegistry } from './runtime.js'
import { createApp } from './app.js'
import { ADAPTERS } from './adapters.js'

/**
 * The adapters route is what the browser learns backends from — including whether each one has
 * a logo file. That question is answered here rather than by the browser requesting a URL and
 * reacting to the 404: badges are rendered inside lists that remount on every keystroke, so
 * probing showed a broken-image glyph and re-requested a known-missing file on every render.
 */

let directory: string
let db: Db
let registry: ConnectionRegistry

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mk-adapters-'))
  db = openDatabase(join(directory, 'state.db'))
  registry = new ConnectionRegistry(db, 'local')
})

afterEach(async () => {
  await registry.closeAll()
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

const appWith = (backendLogo?: (id: string) => { light: string; dark: string | null } | null) =>
  createApp({ db, registry, mode: 'local', version: 'test', ...(backendLogo && { backendLogo }) })

describe('GET /api/adapters', () => {
  interface Row {
    id: string
    shortName: string
    logoUrl: string | null
    logoDarkUrl: string | null
  }
  const read = async (app: ReturnType<typeof appWith>): Promise<Row[]> =>
    ((await (await app.request('/api/adapters')).json()) as { adapters: Row[] }).adapters

  it('reports no logo when nothing has been dropped in for the backend', async () => {
    const adapters = await read(appWith())

    expect(adapters).toHaveLength(ADAPTERS.length)
    expect(adapters.every((adapter) => adapter.logoUrl === null)).toBe(true)
    expect(adapters.every((adapter) => adapter.logoDarkUrl === null)).toBe(true)
  })

  it('reports the logo of exactly the backend a file exists for', async () => {
    const adapters = await read(
      appWith((id) => (id === 'wiremock' ? { light: '/backends/wiremock.svg', dark: null } : null)),
    )

    const wiremock = adapters.find((adapter) => adapter.id === 'wiremock')
    expect(wiremock?.logoUrl).toBe('/backends/wiremock.svg')
    // The lettermark is still sent: it is what every other backend renders instead.
    expect(wiremock?.shortName).toBe('WM')
    expect(adapters.find((adapter) => adapter.id === 'mockserver')?.logoUrl).toBeNull()
  })

  it('reports a dark variant only when one sits beside the light one', async () => {
    const adapters = await read(
      appWith((id) => ({
        light: `/backends/${id}.svg`,
        dark: id === 'mockserver' ? `/backends/${id}-dark.svg` : null,
      })),
    )

    expect(adapters.find((a) => a.id === 'mockserver')?.logoDarkUrl).toBe(
      '/backends/mockserver-dark.svg',
    )
    // A mark that reads in both themes needs no second file, and must not claim one.
    expect(adapters.find((a) => a.id === 'wiremock')?.logoDarkUrl).toBeNull()
  })
})
