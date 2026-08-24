import { describe, expect, it } from 'vitest'
import { exposeCapableAdapter } from './expose.js'
import { resolveCapabilities } from './capabilities.js'
import { METHOD_CAPABILITY, OPTIONAL_ADAPTER_METHODS } from './adapter.js'
import type { MockBackendAdapter } from './adapter.js'

const implementation = {
  id: 'test',
  displayName: 'Test',
  connect: async () => ({ backendId: 'test', version: '1', fingerprint: 'f', adminUrl: 'u' }),
  capabilities: () => new Set(),
  interpret: () => ({}) as never,
  render: () => ({}),
  listMocks: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
  replaceAll: async () => {},
  resetAll: async () => {},
  getMock: async () => {
    throw new Error('should not be reachable')
  },
  updateMock: async () => {
    throw new Error('should not be reachable')
  },
  listScenarios: async () => [],
} as unknown as MockBackendAdapter

describe('exposeCapableAdapter', () => {
  it('keeps the genuinely universal primitives whatever the capabilities say', () => {
    const exposed = exposeCapableAdapter(implementation, new Set())
    // Listing is the one corpus method that is always present: a backend that cannot be listed
    // has nothing for this tool to show.
    expect(typeof exposed.listMocks).toBe('function')
    // `interpret` is not capability-gated: reading its own vendor format is something every
    // adapter can do, and the write path needs it before it knows whether a write is allowed.
    expect(typeof exposed.interpret).toBe('function')
  })

  it('gates the wholesale corpus writes, because a read-only backend has none', () => {
    // These were unconditional until a document-backed backend arrived: Mockoon's corpus is a
    // JSON file with no read endpoint, so a read-only profile implements neither, and a method
    // that exists and throws is what this facade exists to prevent.
    expect('replaceAll' in exposeCapableAdapter(implementation, new Set())).toBe(false)

    const writable = exposeCapableAdapter(
      implementation,
      new Set(['corpus.replaceAll', 'corpus.reset'] as const),
    )
    expect(typeof writable.replaceAll).toBe('function')
    expect(typeof writable.resetAll).toBe('function')
  })

  it('makes an unsupported method absent rather than present and throwing', () => {
    const exposed = exposeCapableAdapter(implementation, new Set())
    // `in` rather than a truthiness check: "absent" has to be literally absent, because that is
    // what the route layer tests to decide between serving and returning 404.
    expect('getMock' in exposed).toBe(false)
    expect('updateMock' in exposed).toBe(false)
    expect('listScenarios' in exposed).toBe(false)
  })

  it('exposes a method whose bit is on', () => {
    const exposed = exposeCapableAdapter(
      implementation,
      resolveCapabilities({ backend: ['mock.read'], environment: [] }),
    )
    expect('getMock' in exposed).toBe(true)
    expect('updateMock' in exposed).toBe(false)
  })

  it('omits a method the adapter never implemented, even when the bit is on', () => {
    // A bit claiming more than the code delivers is an adapter bug, but it must not become a
    // runtime crash in the route layer.
    const exposed = exposeCapableAdapter(
      implementation,
      resolveCapabilities({ backend: ['mock.delete'], environment: [] }),
    )
    expect('deleteMock' in exposed).toBe(false)
  })

  it('reports the capabilities it was built with, not the implementation’s own opinion', () => {
    const capabilities = resolveCapabilities({ backend: ['mock.read'], environment: [] })
    expect([...exposeCapableAdapter(implementation, capabilities).capabilities()]).toEqual([
      'mock.read',
    ])
  })

  it('covers every optional method in the capability map', () => {
    for (const method of OPTIONAL_ADAPTER_METHODS) {
      expect(METHOD_CAPABILITY[method], `${method} has no governing capability`).toBeDefined()
    }
  })
})
