import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import {
  ADAPTER_IDS,
  ConfigError,
  ConnectionRegistry,
  DEFAULT_CONFIG_FILENAME,
  createApp,
  createProfile,
  findProfileByAdminUrl,
  listProfiles,
  loadConfig,
  openDatabase,
  replaceCorpus,
  updateProfile,
} from '@mock-knight/server'
import type { LoadedConfig, ProfileInput, RuntimeMode } from '@mock-knight/server'

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

/** Replaced at build time from packages/cli/package.json; see tsup.config.ts. */
declare const __MOCK_KNIGHT_VERSION__: string
const VERSION = typeof __MOCK_KNIGHT_VERSION__ === 'string' ? __MOCK_KNIGHT_VERSION__ : '0.0.0-dev'
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
  --config <path>   Config file (default ./${DEFAULT_CONFIG_FILENAME} if present)
  --no-config       Ignore any config file
  --name <name>     Name for the profile created from --url
  --adapter <id>    Backend kind: wiremock (default) or mockserver
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
        adapter: { type: 'string' },
        config: { type: 'string' },
        refresh: { type: 'boolean', default: true },
        // A separate key, not a negation of `--config`: parseArgs only auto-negates booleans,
        // and `--config` carries a path.
        'no-config': { type: 'boolean', default: false },
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
  if (flags.adapter !== undefined && !ADAPTER_IDS.includes(flags.adapter)) {
    // Named a backend this build does not have. Failing here beats connecting to the wrong kind
    // of server and reporting whatever it makes of an unfamiliar control API.
    console.error(
      `Unknown --adapter "${flags.adapter}". This build has: ${ADAPTER_IDS.join(', ')}.`,
    )
    process.exit(1)
  }
  if (flags.help === true) {
    console.log(USAGE)
    return
  }
  if (flags.version === true) {
    console.log(VERSION)
    return
  }

  // Explicit --config must exist; a discovered one is optional. Asking for a file that is not
  // there is a mistake worth stopping for, and not asking for one is not.
  let loaded: LoadedConfig | null = null
  if (flags['no-config'] !== true) {
    const discovered = resolve(DEFAULT_CONFIG_FILENAME)
    const target = flags.config ?? (existsSync(discovered) ? discovered : null)
    if (target !== null) {
      try {
        loaded = loadConfig(target)
      } catch (error) {
        if (error instanceof ConfigError) {
          console.error(`\nmock-knight could not use ${error.path}\n\n  ${error.message}\n`)
          process.exit(1)
        }
        throw error
      }
    }
  }
  const file = loaded?.config ?? {}
  if (loaded !== null) console.log(`  config: ${loaded.path}`)

  // A flag always beats the file: a flag is what someone typed just now.
  const host = flags.host ?? file.host ?? '127.0.0.1'
  const port = Number(flags.port ?? file.port ?? DEFAULT_PORT)
  const mode: RuntimeMode =
    (flags.mode as RuntimeMode | undefined) ??
    file.mode ??
    (isLoopback(host) ? 'local' : 'deployed')
  const statePath = flags.state ?? file.state ?? join(homedir(), '.mock-knight', 'state.db')

  if (!isLoopback(host)) {
    console.warn(
      `\n  ⚠  Binding to ${host}, so mock-knight is reachable from your network.\n` +
        `     It has no authentication and will fetch any URL a profile names, which makes an\n` +
        `     exposed instance a relay into whatever it can reach. Put a reverse proxy in front,\n` +
        `     and set "allowedHosts" in ${loaded?.path ?? DEFAULT_CONFIG_FILENAME} to limit ` +
        `where it may connect.\n`,
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

  const registry = new ConnectionRegistry(db, mode, file.allowedHosts)
  if (file.allowedHosts !== undefined) {
    console.log(
      file.allowedHosts.length === 0
        ? `  allowedHosts is empty — no outbound connections are permitted`
        : `  allowedHosts: ${file.allowedHosts.join(', ')}`,
    )
  }

  // Config profiles are reconciled by name on every start, so editing the file and restarting
  // is enough. They keep origin 'config' to mark where they came from.
  for (const definition of file.profiles ?? []) {
    const input = definition as ProfileInput
    const existing = listProfiles(db).find((profile) => profile.name === input.name)
    if (existing === undefined) {
      createProfile(db, input, { origin: 'config' })
    } else {
      updateProfile(db, existing.id, input)
    }
  }
  /**
   * The profile `--url` named, once it is known. The app is built before that happens, so it
   * reads this through a function rather than being handed a value it cannot have yet.
   */
  let launchProfileId: string | null = null
  // Resolved before the app, because the app closes over it to answer whether a backend has a
  // logo file.
  const webRoot = findWebRoot()
  const app = createApp({
    db,
    registry,
    mode,
    version: VERSION,
    launchProfileId: () => launchProfileId,
    // Checked once, against the SPA's own asset directory. Dropping a file in needs a restart,
    // which is the same as every other static asset in a built bundle.
    backendLogo: (adapterId) => {
      if (webRoot === null) return null
      const light = `/backends/${adapterId}.svg`
      if (!existsSync(join(webRoot, light))) return null
      // Optional, and the same convention the app's own mark follows: a single-colour mark
      // legible on white usually disappears on the dark theme.
      const dark = `/backends/${adapterId}-dark.svg`
      return { light, dark: existsSync(join(webRoot, dark)) ? dark : null }
    },
  })

  if (webRoot !== null) {
    app.use('/*', serveStatic({ root: webRoot }))
    /**
     * The SPA owns client-side routing, so an unmatched path returns the shell — but only when
     * it could plausibly *be* a route.
     *
     * Without the extension check every missing asset answered 200 with HTML: a mistyped font
     * URL, a stale hashed bundle, an optional image that is simply not there. The browser then
     * fails to decode it and reports something about the file rather than about the 404, which
     * is a long way from the cause. A client-side route has no extension; a file does.
     */
    const shell = serveStatic({ path: join(webRoot, 'index.html') })
    app.get('/*', async (c, next) => {
      // A client-side route has no extension; a file does.
      if (/\.[a-z0-9]+$/i.test(new URL(c.req.url).pathname)) return c.notFound()
      return (await shell(c, next)) ?? c.notFound()
    })
  }

  if (flags.url !== undefined) {
    /**
     * Naming a server that is already known is not an error — it is the normal case on the
     * second run, and the answer is to open it.
     *
     * Matched on the composed admin URL, the same identity the API rejects duplicates by. A raw
     * string comparison would call `http://host:8080` and `http://host:8080/` different, create
     * a second profile for one server, and now be refused outright — turning an everyday
     * command into a failure.
     */
    const existing = findProfileByAdminUrl(db, { baseUrl: flags.url, adminPath: null })
    if (existing !== null) console.log(`  using the server already known as "${existing.name}"`)
    const profile =
      existing ??
      createProfile(db, {
        name: flags.name ?? new URL(flags.url).host,
        adapter: flags.adapter ?? 'wiremock',
        baseUrl: flags.url,
        adminPath: null,
        colour: 'indigo',
        protected: false,
        readOnly: false,
        mappingsDir: null,
        authKind: 'none',
        authUsername: null,
        authSecret: null,
        correlationHeader: null,
        redactHeaders: [],
      })

    // Whether or not it connects: the user named this server, so it is the one to open.
    launchProfileId = profile.id

    try {
      const connection = await registry.connect(profile)
      // Named by the adapter, not hardcoded: this build talks to more than one backend, and
      // announcing "WireMock 5.15.0" about a MockServer is the kind of small lie that makes
      // someone doubt everything else on the screen.
      console.log(
        `  connected to ${connection.adminUrl} ` +
          `(${connection.adapter.displayName} ${connection.version ?? '?'})`,
      )
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
