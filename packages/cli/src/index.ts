import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import {
  ConnectionRegistry,
  createApp,
  createProfile,
  listProfiles,
  openDatabase,
  replaceCorpus,
} from '@mock-knight/server'
import type { RuntimeMode } from '@mock-knight/server'

/**
 * The `npx mock-knight` entry point.
 *
 * Two things here are safety decisions rather than ergonomics:
 *
 *  - **Loopback by default.** mock-knight fetches arbitrary URLs by design, so an exposed
 *    instance is a relay into whatever network it can reach. `--host` is opt-in and prints what
 *    it exposes; the risky configuration has to be a typed choice (TECH-DESIGN §13).
 *  - **A designed failure for a missing native binary.** The most likely first-run failure is
 *    `better-sqlite3` having no prebuild for the platform, and a raw node-gyp stack trace is a
 *    terrible first impression (§16).
 */

const VERSION = '0.0.0'
const DEFAULT_PORT = 7777
const MINIMUM_NODE_MAJOR = 22

const USAGE = `
mock-knight — a local-first web UI for HTTP mock servers

  npx mock-knight --url http://localhost:8080

Options
  --url <url>       Mock server base URL. Creates a profile on first run.
  --port <n>        Port to listen on (default ${DEFAULT_PORT})
  --host <addr>     Bind address (default 127.0.0.1). A non-loopback address
                    turns on deployed mode and prints an exposure warning.
  --mode <m>        local | deployed. Inferred from --host when omitted.
  --state <path>    State database (default ~/.mock-knight/state.db)
  --name <name>     Name for the profile created from --url
  --no-refresh      Start without fetching the corpus
  --verbose         Log every upstream call
  --version         Print the version and exit
  --help            Print this message
`

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function assertNodeVersion(): void {
  const major = Number(process.versions.node.split('.')[0])
  if (major >= MINIMUM_NODE_MAJOR) return
  console.error(
    `mock-knight needs Node ${MINIMUM_NODE_MAJOR} or newer; this is Node ${process.versions.node}.\n` +
      `better-sqlite3 v13 does not build below ${MINIMUM_NODE_MAJOR}. Install a current Node ` +
      `(https://nodejs.org) or use the Docker image.`,
  )
  process.exit(1)
}

/** The SPA lives beside the bundle in the published tarball, and in web/dist during development. */
function findWebRoot(): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const candidate of [join(here, 'web'), join(here, '..', '..', 'web', 'dist')]) {
    if (existsSync(join(candidate, 'index.html'))) return candidate
  }
  return null
}

async function main(): Promise<void> {
  assertNodeVersion()

  let parsed
  try {
    parsed = parseArgs({
      options: {
        url: { type: 'string' },
        port: { type: 'string' },
        host: { type: 'string' },
        mode: { type: 'string' },
        state: { type: 'string' },
        name: { type: 'string' },
        refresh: { type: 'boolean', default: true },
        verbose: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    })
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`)
    process.exit(1)
  }

  const flags = parsed.values
  if (flags.help === true) {
    console.log(USAGE)
    return
  }
  if (flags.version === true) {
    console.log(VERSION)
    return
  }

  const host = flags.host ?? '127.0.0.1'
  const port = Number(flags.port ?? DEFAULT_PORT)
  const mode: RuntimeMode =
    (flags.mode as RuntimeMode | undefined) ?? (isLoopback(host) ? 'local' : 'deployed')
  const statePath = flags.state ?? join(homedir(), '.mock-knight', 'state.db')

  if (!isLoopback(host)) {
    console.warn(
      `\n  ⚠  Binding to ${host}, so mock-knight is reachable from your network.\n` +
        `     It has no authentication and will fetch any URL a profile names, which makes an\n` +
        `     exposed instance a relay into whatever it can reach. Put a reverse proxy in front,\n` +
        `     and set "allowedHosts" in mock-knight.json to limit where it may connect.\n`,
    )
  }

  let db
  try {
    db = openDatabase(resolve(statePath))
  } catch (error) {
    const message = (error as Error).message
    if (/better_sqlite3|node_gyp|\.node/i.test(message)) {
      console.error(
        `mock-knight could not load its SQLite binary on ${process.platform}/${process.arch} ` +
          `(Node ${process.versions.node}).\n\n${message}\n\n` +
          `A prebuilt binary was not available for this platform. Install a build toolchain ` +
          `(python3 and a C++ compiler) and reinstall, or use the Docker image.`,
      )
      process.exit(1)
    }
    throw error
  }

  const registry = new ConnectionRegistry(db, mode)
  const app = createApp({ db, registry, mode, version: VERSION })

  const webRoot = findWebRoot()
  if (webRoot !== null) {
    app.use('/*', serveStatic({ root: webRoot }))
    // The SPA owns client-side routing, so any unmatched path returns the shell.
    app.get('/*', serveStatic({ path: join(webRoot, 'index.html') }))
  }

  if (flags.url !== undefined) {
    const existing = listProfiles(db).find((profile) => profile.baseUrl === flags.url)
    const profile =
      existing ??
      createProfile(db, {
        name: flags.name ?? new URL(flags.url).host,
        adapter: 'wiremock',
        baseUrl: flags.url,
        adminPath: null,
        colour: 'indigo',
        protected: false,
        readOnly: false,
        mappingsDir: null,
        authKind: 'none',
        authRef: null,
        correlationHeader: null,
        redactHeaders: [],
      })

    try {
      const connection = await registry.connect(profile)
      console.log(`  connected to ${connection.adminUrl} (WireMock ${connection.version ?? '?'})`)
      if (flags.refresh !== false) {
        const page = await connection.adapter.listMocks({ limit: 1000, offset: 0 })
        replaceCorpus(db, profile.id, page.items, new Date().toISOString())
        console.log(`  mirrored ${page.items.length} of ${page.total} stubs`)
      }
    } catch (error) {
      // Not fatal: the UI has a designed disconnected state, and starting anyway lets the user
      // fix the URL in the app rather than in their shell history.
      console.warn(`  could not reach ${flags.url}: ${(error as Error).message}`)
    }
  }

  const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
    console.log(`\n  Mock Knight  ${mode} mode  ·  http://${host}:${info.port}`)
    if (webRoot === null) {
      console.log(
        `  (no UI bundled — API only. Build it with: pnpm --filter @mock-knight/web build)`,
      )
    }
    console.log(`  state: ${resolve(statePath)}\n`)
  })

  // A port clash is the second most likely startup failure after a missing native binary, and
  // an unhandled 'error' event would surface it as a bare Node stack trace.
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `\n  Port ${port} on ${host} is already in use — most likely another Mock Knight.\n` +
          `  Start this one elsewhere with --port, or stop the process using it.\n`,
      )
      process.exit(1)
    }
    if (error.code === 'EACCES') {
      console.error(`\n  Not permitted to bind ${host}:${port}. Ports below 1024 need elevation.\n`)
      process.exit(1)
    }
    throw error
  })

  const shutdown = async (): Promise<void> => {
    await registry.closeAll()
    db.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

await main()
