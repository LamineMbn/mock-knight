import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { profileInputSchema } from './profiles.js'

/**
 * `mock-knight.json` — TECH-DESIGN amendment A2.
 *
 * The file was referenced by two user-facing messages long before anything read it, which is
 * the worst state for a config file to be in: the host-allowlist error told people to edit a
 * file that had no effect, so following the advice looked like the tool ignoring them.
 *
 * Deliberately narrow. It carries the things that are awkward to pass as flags every time —
 * the host allowlist, and the profiles a team shares — plus defaults for the flags themselves.
 * A flag always wins over the file, because a flag is what someone typed just now.
 *
 * **JSON only.** A2 also names `.yaml`; that is not implemented, and `loadConfig` says so
 * rather than skipping the file silently.
 */

const ENV_REFERENCE = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * Fields never interpolated — currently none.
 *
 * `authRef` used to be here, and the reasoning inverted rather than disappeared. It held the
 * *name* of a variable, so interpolating it would have resolved the very indirection it existed
 * to provide. Credentials are now entered directly, which is what makes them settable from the
 * UI at all — and that would put a literal secret in a file people commit, except that
 * `authSecret` is an ordinary string and therefore *does* interpolate:
 *
 *   "authSecret": "${env:WIREMOCK_PASS}"
 *
 * So a shared config keeps a reference and an interactive user types a value, which is the right
 * answer for each.
 */
const NEVER_INTERPOLATED = new Set<string>()

export class ConfigError extends Error {
  override readonly name = 'ConfigError'
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message)
  }
}

/**
 * A profile defined in the file. Same shape as one created through the UI, minus the fields the
 * UI derives, so a config profile and a runtime profile cannot drift apart.
 */
const configProfileSchema = profileInputSchema.extend({
  adapter: profileInputSchema.shape.adapter.default('wiremock'),
})

export const configSchema = z
  .object({
    /** Ignored at runtime; present so editors offer completion from the published schema. */
    $schema: z.string().optional(),
    host: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    mode: z.enum(['local', 'deployed']).optional(),
    /** Relative paths resolve against the config file, not the working directory. */
    state: z.string().min(1).optional(),
    /**
     * Hosts this instance may connect to. Absent means no restriction; an empty array means
     * nothing is reachable, which is a legitimate way to disable outbound entirely.
     */
    allowedHosts: z.array(z.string().min(1)).optional(),
    profiles: z.array(configProfileSchema).optional(),
  })
  .strict()

export type MockKnightConfig = z.infer<typeof configSchema>

export interface LoadedConfig {
  /** Absolute path the config was read from. Every error message names it. */
  readonly path: string
  readonly config: MockKnightConfig
}

/** Replace `${env:VAR}` in every string except the fields that name a variable by design. */
function interpolate(value: unknown, key: string | null, path: string, missing: string[]): unknown {
  if (typeof value === 'string') {
    if (key !== null && NEVER_INTERPOLATED.has(key)) return value
    return value.replace(ENV_REFERENCE, (whole, name: string) => {
      const found = process.env[name]
      if (found === undefined) {
        missing.push(name)
        return whole
      }
      return found
    })
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, key, path, missing))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolate(v, k, path, missing)]),
    )
  }
  return value
}

/**
 * Read and validate a config file.
 *
 * Throws `ConfigError` with the file path and the offending field. A config file that is present
 * but wrong must never be skipped quietly — the whole point of the file is that someone expects
 * it to take effect.
 */
export function loadConfig(configPath: string): LoadedConfig {
  const absolute = resolve(configPath)

  if (/\.ya?ml$/i.test(absolute)) {
    throw new ConfigError(
      absolute,
      `YAML config is not implemented yet — only JSON. Rename it to mock-knight.json.`,
    )
  }

  let text: string
  try {
    text = readFileSync(absolute, 'utf8')
  } catch (error) {
    throw new ConfigError(absolute, `Could not read it: ${(error as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ConfigError(absolute, `It is not valid JSON: ${(error as Error).message}`)
  }

  const missing: string[] = []
  const interpolated = interpolate(parsed, null, absolute, missing)
  if (missing.length > 0) {
    // Left as the literal `${env:NAME}` rather than an empty string: an empty base URL fails
    // later with a message about URLs, which sends the reader somewhere unrelated.
    throw new ConfigError(
      absolute,
      `References ${[...new Set(missing)].map((n) => `\${env:${n}}\``).join(', ')} but ` +
        `${missing.length === 1 ? 'that variable is' : 'those variables are'} not set.`,
    )
  }

  const result = configSchema.safeParse(interpolated)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n')
    throw new ConfigError(absolute, `It has ${result.error.issues.length} problem(s):\n${issues}`)
  }

  // Relative paths in the file are relative to the file, which is what someone editing it
  // expects — not to whatever directory the command happened to be run from.
  const base = dirname(absolute)
  const config = { ...result.data }
  if (config.state !== undefined && !isAbsolute(config.state)) {
    config.state = resolve(base, config.state)
  }
  config.profiles = config.profiles?.map((profile) =>
    profile.mappingsDir === null ||
    profile.mappingsDir === undefined ||
    isAbsolute(profile.mappingsDir)
      ? profile
      : { ...profile, mappingsDir: resolve(base, profile.mappingsDir) },
  )

  return { path: absolute, config }
}

/** The file name looked for in the working directory when `--config` is not given. */
export const DEFAULT_CONFIG_FILENAME = 'mock-knight.json'
