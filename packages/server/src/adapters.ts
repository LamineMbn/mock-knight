import { MockoonAdapter } from '@mock-knight/adapter-mockoon'
import { MockServerAdapter } from '@mock-knight/adapter-mockserver'
import { WireMockAdapter } from '@mock-knight/adapter-wiremock'
import type { MockBackendAdapter } from '@mock-knight/core'

/**
 * The backends this build can talk to.
 *
 * The one place that knows which adapters exist. `server` is the only package allowed to import
 * more than one of them (the layering rule), so the browser learns the list from `/api/adapters`
 * rather than importing it — which also means a build with a different set of adapters needs no
 * change in the UI at all.
 */
const FACTORIES: Record<string, () => MockBackendAdapter> = {
  wiremock: () => new WireMockAdapter(),
  mockserver: () => new MockServerAdapter(),
  mockoon: () => new MockoonAdapter(),
}

export const ADAPTER_IDS = Object.keys(FACTORIES) as [string, ...string[]]

export interface AdapterDescriptor {
  readonly id: string
  readonly displayName: string
  /** Two or three characters, for the badge beside every server address. */
  readonly shortName: string
  /** What the Servers form previews before a connection exists. */
  readonly defaultAdminPath: string
  /** Non-null when this backend reads its corpus from a file the form has to ask for. */
  readonly corpusDocument: { readonly label: string; readonly hint: string } | null
}

/**
 * Built once at module load to read the static fields off each adapter.
 *
 * Constructing one is cheap — no transport is opened until `connect` — and asking the adapter
 * beats a second table of names that can disagree with it.
 */
export const ADAPTERS: readonly AdapterDescriptor[] = Object.values(FACTORIES).map((build) => {
  const instance = build()
  return {
    id: instance.id,
    displayName: instance.displayName,
    shortName: instance.shortName,
    defaultAdminPath: instance.defaultAdminPath,
    corpusDocument: instance.corpusDocument,
  }
})

export function createAdapter(id: string): MockBackendAdapter {
  const build = FACTORIES[id]
  // A profile naming a backend this build does not have is a real possibility — an older state
  // database, or a config file from a colleague — and it should say so rather than silently
  // connecting to the wrong kind of server.
  if (build === undefined) {
    throw new Error(`No adapter for "${id}". This build has: ${ADAPTER_IDS.join(', ')}.`)
  }
  return build()
}
