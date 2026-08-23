/**
 * Full surface of @mock-knight/core, for `adapter-*` and `server`.
 *
 * `web` must import from `@mock-knight/core/types` instead: this entry point reaches Node-only
 * code and pulling it into the SPA bundle would break the layering rule that keeps the browser
 * free of server internals.
 */

export * from './types.js'
export * from './canonical.js'
export * from './expose.js'
export * from './fingerprint.js'
