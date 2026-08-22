import { z } from 'zod'

/**
 * Capability bits — PRD §8.2, extended by TECH-DESIGN amendment A4.
 *
 * A capability that is off means the corresponding adapter method is *absent* and the route
 * returns 404, not 403 (CLAUDE.md invariant 4). The UI never draws a control that can fail, so
 * every bit here carries the plain-language consequence of it being off: that copy is what the
 * capability report renders (design brief §6.9) and what "why is this greyed out?" tooltips
 * link to. It is product content, not a code comment.
 *
 * This module is browser-safe: `web` imports it for the capability report.
 */

/** Bits the connected backend decides, by declaration or by connect-time probe. */
export const BACKEND_CAPABILITY_BITS = [
  'corpus.list',
  'corpus.replaceAll',
  'corpus.reset',
  'mock.read',
  'mock.create',
  'mock.update',
  'mock.delete',
  'mock.stableServerId',
  'mock.enableDisable',
  'mock.priority',
  'mock.metadata',
  'journal.read',
  'journal.attribution',
  'journal.clear',
  'journal.stream',
  'diagnostics.nearMiss',
  'diagnostics.unmatched',
  'diagnostics.unusedStubs',
  'state.machine',
  'state.read',
  'state.write',
  'state.resetAll',
  'state.kv',
  'files.export',
  'files.import',
  'files.serverSave',
  'files.browse',
] as const

/** Bits the runtime mode decides — amendment A4. Same mechanism, different source. */
export const ENVIRONMENT_CAPABILITY_BITS = [
  'files.bindDirectory',
  'files.pullPush',
  'files.exportToDisk',
  'config.writeFile',
  'audit.multiUser',
] as const

export const CAPABILITY_BITS = [...BACKEND_CAPABILITY_BITS, ...ENVIRONMENT_CAPABILITY_BITS] as const

export type BackendCapabilityBit = (typeof BACKEND_CAPABILITY_BITS)[number]
export type EnvironmentCapabilityBit = (typeof ENVIRONMENT_CAPABILITY_BITS)[number]
export type CapabilityBit = (typeof CAPABILITY_BITS)[number]

export type CapabilityGate = 'backend' | 'environment'
export type CapabilitySet = ReadonlySet<CapabilityBit>

export interface CapabilityEntry {
  /** Which source is allowed to turn this bit off. */
  readonly gate: CapabilityGate
  /** Short human label for the capability report. */
  readonly label: string
  /** What the user loses when this bit is off. A full sentence, in the product's voice. */
  readonly whenOff: string
}

export const CAPABILITY_REGISTRY = {
  'corpus.list': {
    gate: 'backend',
    label: 'List stubs',
    whenOff: 'Mock Knight cannot read this server’s stubs, so the corpus list stays empty.',
  },
  'corpus.replaceAll': {
    gate: 'backend',
    label: 'Replace the whole corpus',
    whenOff: 'Import can only merge; replacing the whole corpus in one write is unavailable.',
  },
  'corpus.reset': {
    gate: 'backend',
    label: 'Reset all stubs',
    whenOff: 'Reset all stubs is absent from the danger zone.',
  },
  'mock.read': {
    gate: 'backend',
    label: 'Read one stub',
    whenOff:
      'A single stub cannot be re-read, so conflict detection falls back to the last full refresh.',
  },
  'mock.create': {
    gate: 'backend',
    label: 'Create a stub',
    whenOff: 'Creating a stub is unavailable, including from a captured request.',
  },
  'mock.update': {
    gate: 'backend',
    label: 'Update a stub',
    whenOff: 'Stubs are read-only on this server; the editor opens but cannot save.',
  },
  'mock.delete': {
    gate: 'backend',
    label: 'Delete a stub',
    whenOff: 'Deleting an individual stub is unavailable.',
  },
  'mock.stableServerId': {
    gate: 'backend',
    label: 'Stable server-assigned ids',
    whenOff:
      'This backend assigns no stable id, so stubs are identified by their content and editing works on the whole document.',
  },
  'mock.enableDisable': {
    gate: 'backend',
    label: 'Enable and disable a stub',
    whenOff:
      'This server has no disabled flag, so a stub can be deleted but not switched off. The disabled: search token is rejected.',
  },
  'mock.priority': {
    gate: 'backend',
    label: 'Stub priority',
    whenOff: 'Priority is not modelled, so the order stubs shadow each other in cannot be set.',
  },
  'mock.metadata': {
    gate: 'backend',
    label: 'Stub metadata',
    whenOff:
      'Folders, tags, and notes cannot be stored on the server, so that organisation will not survive a round-trip.',
  },
  'journal.read': {
    gate: 'backend',
    label: 'Read the request journal',
    whenOff:
      'There is no request journal, so the Traffic screen and the unused-stub view are both absent.',
  },
  'journal.attribution': {
    gate: 'backend',
    label: 'Journal names the matched stub',
    whenOff: 'The traffic log can show requests but cannot tell you which stub served them.',
  },
  'journal.clear': {
    gate: 'backend',
    label: 'Clear the journal',
    whenOff: 'Clearing the journal is absent from the danger zone.',
  },
  'journal.stream': {
    gate: 'backend',
    label: 'Server pushes journal events',
    whenOff:
      'The server has no push channel, so Mock Knight polls it and republishes; new requests appear within a second or two rather than instantly.',
  },
  'diagnostics.nearMiss': {
    gate: 'backend',
    label: 'Server-computed near misses',
    whenOff:
      'The server cannot rank near misses, so match explanations are computed by Mock Knight and labelled as inference.',
  },
  'diagnostics.unmatched': {
    gate: 'backend',
    label: 'List unmatched requests',
    whenOff: 'Unmatched requests cannot be listed on their own; filter the traffic log instead.',
  },
  'diagnostics.unusedStubs': {
    gate: 'backend',
    label: 'Server-computed unused stubs',
    whenOff:
      'The server cannot compute unused stubs, so Mock Knight derives them from the journal it has seen and says so.',
  },
  'state.machine': {
    gate: 'backend',
    label: 'Scenarios are a state machine',
    whenOff: 'Scenarios are not modelled as a state machine, so the state graph is absent.',
  },
  'state.read': {
    gate: 'backend',
    label: 'Read scenario state',
    whenOff: 'Scenario names and current states cannot be read, so the Scenarios screen is absent.',
  },
  'state.write': {
    gate: 'backend',
    label: 'Set scenario state',
    whenOff: 'Scenario state cannot be set from here; drive it by sending requests instead.',
  },
  'state.resetAll': {
    gate: 'backend',
    label: 'Reset all scenarios',
    whenOff: 'Resetting every scenario at once is absent from the danger zone.',
  },
  'state.kv': {
    gate: 'backend',
    label: 'Key-value runtime state',
    whenOff: 'This backend has no key-value runtime state, so the KV editor is absent.',
  },
  'files.export': {
    gate: 'backend',
    label: 'Server can dump its corpus',
    whenOff:
      'The server cannot dump its own corpus, so an export contains what Mock Knight has mirrored instead.',
  },
  'files.import': {
    gate: 'backend',
    label: 'Server accepts an import document',
    whenOff: 'Importing a document into this server is unavailable.',
  },
  'files.serverSave': {
    gate: 'backend',
    label: 'Server saves to its own disk',
    whenOff: 'This server cannot write its stubs to its own filesystem.',
  },
  'files.browse': {
    gate: 'backend',
    label: 'Browse the server’s body files',
    whenOff:
      'The server’s body-file directory cannot be browsed; body files are referenced by name only.',
  },
  'files.bindDirectory': {
    gate: 'environment',
    label: 'Bind a local mappings directory',
    whenOff:
      'Mock Knight has no filesystem access in this mode, so a profile cannot be bound to a mappings directory and the Sync screen is absent.',
  },
  'files.pullPush': {
    gate: 'environment',
    label: 'Pull and Push against a checkout',
    whenOff: 'Pull and Push between the server and a local checkout are unavailable in this mode.',
  },
  'files.exportToDisk': {
    gate: 'environment',
    label: 'Write an export to disk',
    whenOff: 'Export offers a browser download rather than writing a directory on disk.',
  },
  'config.writeFile': {
    gate: 'environment',
    label: 'Write the config file back',
    whenOff:
      'Profile edits are saved to Mock Knight’s database but not written back to the config file, so they diverge from what is checked in.',
  },
  'audit.multiUser': {
    gate: 'environment',
    label: 'Audit spans several users',
    whenOff: 'The audit trail covers only the changes made from this machine.',
  },
} as const satisfies Record<CapabilityBit, CapabilityEntry>

export const capabilityBitSchema = z.enum(CAPABILITY_BITS)

/** Environment grants for the two runtime modes — TECH-DESIGN §3.3. */
export const LOCAL_ENVIRONMENT_CAPABILITIES = [
  'files.bindDirectory',
  'files.pullPush',
  'files.exportToDisk',
  'config.writeFile',
] as const satisfies readonly EnvironmentCapabilityBit[]

export const DEPLOYED_ENVIRONMENT_CAPABILITIES = [
  'audit.multiUser',
] as const satisfies readonly EnvironmentCapabilityBit[]

export interface CapabilityInputs {
  readonly backend: Iterable<CapabilityBit>
  readonly environment: Iterable<CapabilityBit>
}

/**
 * `effective = backendBits ∩ environmentBits`, exactly as TECH-DESIGN §3.3 states it.
 *
 * Each source is taken to grant everything outside its own gate — the backend has no opinion on
 * whether we can reach a filesystem, and the environment has no opinion on whether the server
 * supports near misses — which is what makes a literal intersection the right operation rather
 * than a special case per bit.
 */
export function resolveCapabilities(inputs: CapabilityInputs): CapabilitySet {
  const backendClaims = new Set<CapabilityBit>(inputs.backend)
  const environmentClaims = new Set<CapabilityBit>(inputs.environment)

  const backendSide = new Set<CapabilityBit>(ENVIRONMENT_CAPABILITY_BITS)
  for (const bit of backendClaims) backendSide.add(bit)

  const environmentSide = new Set<CapabilityBit>(BACKEND_CAPABILITY_BITS)
  for (const bit of environmentClaims) environmentSide.add(bit)

  const effective = new Set<CapabilityBit>()
  for (const bit of CAPABILITY_BITS) {
    if (backendSide.has(bit) && environmentSide.has(bit)) effective.add(bit)
  }
  return effective
}

export function has(capabilities: CapabilitySet, bit: CapabilityBit): boolean {
  return capabilities.has(bit)
}

export interface CapabilityReportRow extends CapabilityEntry {
  readonly bit: CapabilityBit
  readonly on: boolean
}

/**
 * Every bit, on or off, with its gate and its consequence — the table behind design brief §6.9.
 * It covers the full set deliberately: a report that omits the bits that are off would be a
 * report you cannot use to answer the question you opened it with.
 */
export function capabilityReport(inputs: CapabilityInputs): readonly CapabilityReportRow[] {
  const effective = resolveCapabilities(inputs)
  return [...CAPABILITY_BITS]
    .sort()
    .map((bit) => ({ bit, on: effective.has(bit), ...CAPABILITY_REGISTRY[bit] }))
}
