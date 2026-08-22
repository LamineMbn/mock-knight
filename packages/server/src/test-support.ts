/**
 * Read-back helpers for the integration tests.
 *
 * These tests assert against what a **real** WireMock holds after a write, not against our
 * mirror — the mirror agreeing with us proves nothing. That read-back was written out longhand
 * at eight call sites, each with its own cast; here it is once, typed.
 *
 * Not named `*.test.ts`, so Vitest does not try to collect it as a suite.
 */

/** The parts of a WireMock stub mapping the integration tests read back off the server. */
export interface RawMapping {
  id?: string
  name?: string
  priority?: number
  request?: { url?: string; urlPath?: string; method?: string }
  response?: { status?: number }
  /** Not in the canonical model. A write must never be able to drop it. */
  postServeActions?: unknown
  metadata?: Record<string, unknown>
}

export async function readMappings(baseUrl: string): Promise<{ mappings: RawMapping[] }> {
  const response = await fetch(`${baseUrl}/__admin/mappings`)
  return (await response.json()) as { mappings: RawMapping[] }
}

export async function readScenarios(
  baseUrl: string,
): Promise<{ scenarios: { name?: string; state?: string }[] }> {
  const response = await fetch(`${baseUrl}/__admin/scenarios`)
  return (await response.json()) as { scenarios: { name?: string; state?: string }[] }
}
