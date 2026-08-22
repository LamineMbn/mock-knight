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
  it('keeps the near-universal primitives whatever the capabilities say', () => {
    const exposed = exposeCapableAdapter(implementation, new Set())
    expect(typeof exposed.listMocks).toBe('function')
    expect(typeof exposed.replaceAll).toBe('function')
    expect(typeof exposed.resetAll).toBe('function')
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
