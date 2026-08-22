import { describe, expect, it } from 'vitest'
import {
  type CapabilityBit,
  BACKEND_CAPABILITY_BITS,
  CAPABILITY_BITS,
  CAPABILITY_REGISTRY,
  DEPLOYED_ENVIRONMENT_CAPABILITIES,
  ENVIRONMENT_CAPABILITY_BITS,
  LOCAL_ENVIRONMENT_CAPABILITIES,
  capabilityBitSchema,
  capabilityReport,
  has,
  resolveCapabilities,
} from './capabilities.js'

describe('the bit registry', () => {
  it('describes every bit exactly once', () => {
    expect(Object.keys(CAPABILITY_REGISTRY).sort()).toEqual([...CAPABILITY_BITS].sort())
  })

  it('gives every bit a plain-language consequence for when it is off', () => {
    for (const bit of CAPABILITY_BITS) {
      const entry = CAPABILITY_REGISTRY[bit]
      expect(entry.whenOff.length, `${bit} has no consequence copy`).toBeGreaterThan(20)
      expect(entry.whenOff, `${bit} consequence should be a sentence`).toMatch(/\.$/)
    }
  })

  it('splits bits into exactly two gates with no overlap', () => {
    const backend = new Set<CapabilityBit>(BACKEND_CAPABILITY_BITS)
    const environment = new Set<CapabilityBit>(ENVIRONMENT_CAPABILITY_BITS)
    for (const bit of CAPABILITY_BITS) {
      expect(backend.has(bit) !== environment.has(bit), `${bit} must have exactly one gate`).toBe(
        true,
      )
    }
    expect(backend.size + environment.size).toBe(CAPABILITY_BITS.length)
  })

  it('gates the five environment bits added by TECH-DESIGN amendment A4', () => {
    expect([...ENVIRONMENT_CAPABILITY_BITS].sort()).toEqual([
      'audit.multiUser',
      'config.writeFile',
      'files.bindDirectory',
      'files.exportToDisk',
      'files.pullPush',
    ])
  })

  it('rejects a bit name that is not in the registry', () => {
    expect(capabilityBitSchema.safeParse('mock.enableDisable').success).toBe(true)
    expect(capabilityBitSchema.safeParse('mock.doWhateverIWant').success).toBe(false)
  })
})

describe('resolveCapabilities', () => {
  it('turns a backend-gated bit off when the backend lacks it', () => {
    const effective = resolveCapabilities({
      backend: ['corpus.list'],
      environment: LOCAL_ENVIRONMENT_CAPABILITIES,
    })
    expect(has(effective, 'corpus.list')).toBe(true)
    expect(has(effective, 'mock.update')).toBe(false)
  })

  it('leaves a backend-gated bit alone when the environment says nothing about it', () => {
    const effective = resolveCapabilities({
      backend: ['mock.update'],
      environment: DEPLOYED_ENVIRONMENT_CAPABILITIES,
    })
    expect(has(effective, 'mock.update')).toBe(true)
  })

  it('turns an environment-gated bit off in deployed mode however capable the backend is', () => {
    const effective = resolveCapabilities({
      backend: BACKEND_CAPABILITY_BITS,
      environment: DEPLOYED_ENVIRONMENT_CAPABILITIES,
    })
    expect(has(effective, 'files.bindDirectory')).toBe(false)
    expect(has(effective, 'files.pullPush')).toBe(false)
    expect(has(effective, 'files.exportToDisk')).toBe(false)
    expect(has(effective, 'config.writeFile')).toBe(false)
    // ...and turns on the one bit deployed mode adds.
    expect(has(effective, 'audit.multiUser')).toBe(true)
  })

  it('gives local mode the filesystem bits and withholds multi-user audit', () => {
    const effective = resolveCapabilities({
      backend: BACKEND_CAPABILITY_BITS,
      environment: LOCAL_ENVIRONMENT_CAPABILITIES,
    })
    expect(has(effective, 'files.bindDirectory')).toBe(true)
    expect(has(effective, 'config.writeFile')).toBe(true)
    expect(has(effective, 'audit.multiUser')).toBe(false)
  })

  it('keeps the backend `files.serverSave` bit distinct from the environment `files.exportToDisk` bit', () => {
    // These two are one letter apart in meaning and were separated deliberately (A4):
    // one writes to the mock server's disk, the other to ours.
    const effective = resolveCapabilities({
      backend: ['files.serverSave'],
      environment: DEPLOYED_ENVIRONMENT_CAPABILITIES,
    })
    expect(has(effective, 'files.serverSave')).toBe(true)
    expect(has(effective, 'files.exportToDisk')).toBe(false)
  })

  it('is order-independent and duplicate-tolerant', () => {
    const a = resolveCapabilities({
      backend: ['mock.update', 'corpus.list', 'mock.update'],
      environment: LOCAL_ENVIRONMENT_CAPABILITIES,
    })
    const b = resolveCapabilities({
      backend: ['corpus.list', 'mock.update'],
      environment: LOCAL_ENVIRONMENT_CAPABILITIES,
    })
    expect([...a].sort()).toEqual([...b].sort())
  })
})

describe('capabilityReport', () => {
  const report = capabilityReport({
    backend: ['corpus.list', 'journal.read'],
    environment: LOCAL_ENVIRONMENT_CAPABILITIES,
  })

  it('covers every bit so the report can never omit one', () => {
    expect(report).toHaveLength(CAPABILITY_BITS.length)
  })

  it('names which gate turned a bit off, so "why is this greyed out?" has an answer', () => {
    const attribution = report.find((row) => row.bit === 'journal.attribution')
    expect(attribution).toMatchObject({ on: false, gate: 'backend' })
    expect(attribution?.whenOff).toContain('which stub')

    const bindDirectory = report.find((row) => row.bit === 'files.bindDirectory')
    expect(bindDirectory).toMatchObject({ on: true, gate: 'environment' })
  })

  it('is sorted by bit name so the report has a stable order', () => {
    expect(report.map((row) => row.bit)).toEqual([...report.map((row) => row.bit)].sort())
  })
})
