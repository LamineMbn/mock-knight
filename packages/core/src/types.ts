/**
 * Browser-safe surface of @mock-knight/core.
 *
 * The layering rule (CLAUDE.md invariant 1, TECH-DESIGN §4) lets `web` import core's *types* but
 * never its Node code. Everything reachable from this entry point must therefore stay free of
 * `node:` imports — which is why `canonical.ts` (node:crypto) is reachable only from `index.ts`.
 */

export type JsonPrimitive = string | number | boolean | null
export type Json = JsonPrimitive | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }
export type JsonArray = Json[]

export * from './capabilities.js'
export * from './model.js'
export * from './query.js'
export * from './adapter.js'
