import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { configSchema } from '../src/config.js'

/**
 * Publish the JSON Schema for `mock-knight.json` — TECH-DESIGN amendment A2.
 *
 * Generated from the same zod schema the loader validates against, so editor completion cannot
 * drift from what the program actually accepts. A hand-maintained second copy eventually would.
 *
 * CI regenerates this and fails if it differs from what is committed.
 */

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(here, '..', '..', '..', 'schema', 'mock-knight.schema.json')

const schema = {
  $id: 'https://raw.githubusercontent.com/LamineMbn/mock-knight/main/schema/mock-knight.schema.json',
  title: 'mock-knight configuration',
  description:
    'Configuration for the mock-knight CLI. Every field is optional; a command-line flag always ' +
    'overrides the equivalent here. String values may reference environment variables as ' +
    '${env:VAR}, except authRef, which names a variable rather than holding a value.',
  ...z.toJSONSchema(configSchema, { io: 'input' }),
}

writeFileSync(target, JSON.stringify(schema, null, 2) + '\n')
console.log(`emit-schema: ${target}`)
