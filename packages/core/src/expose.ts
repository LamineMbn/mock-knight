import { METHOD_CAPABILITY, OPTIONAL_ADAPTER_METHODS } from './adapter.js'
import type { MockBackendAdapter } from './adapter.js'
import type { CapabilitySet } from './capabilities.js'

/**
 * Build the adapter surface a caller is allowed to see.
 *
 * PRD §8.1 requires that an unsupported operation makes the method *absent*, not present and
 * throwing — that is what lets the BFF answer "does this route exist?" without calling upstream,
 * and therefore what lets the UI avoid drawing a control that would fail.
 *
 * Adapters are written as ordinary classes with every method implemented; this is what narrows
 * them. Doing it in one shared place means a new adapter cannot get the rule subtly wrong, and
 * the conformance suite has a single thing to assert against.
 */
export function exposeCapableAdapter(
  implementation: MockBackendAdapter,
  capabilities: CapabilitySet,
): MockBackendAdapter {
  const exposed: Record<string, unknown> = {
    id: implementation.id,
    displayName: implementation.displayName,
    connect: implementation.connect.bind(implementation),
    capabilities: () => capabilities,
    interpret: implementation.interpret.bind(implementation),
    render: implementation.render.bind(implementation),
    // `listMocks` is the only corpus method that is always present; the wholesale writes moved
    // into the capability-gated loop below when a read-only backend arrived.
    listMocks: implementation.listMocks.bind(implementation),
  }
  if (typeof implementation.close === 'function') {
    exposed['close'] = implementation.close.bind(implementation)
  }

  for (const method of OPTIONAL_ADAPTER_METHODS) {
    const bit = METHOD_CAPABILITY[method]
    const candidate = implementation[method]
    if (!capabilities.has(bit) || typeof candidate !== 'function') continue
    exposed[method] = (candidate as (...args: unknown[]) => unknown).bind(implementation)
  }

  return exposed as unknown as MockBackendAdapter
}
