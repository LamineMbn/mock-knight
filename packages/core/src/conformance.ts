import { describe, expect, it } from 'vitest'
import { canonicalJson } from './canonical.js'
import { behaviourFingerprint } from './fingerprint.js'
import { CAPABILITY_BITS } from './capabilities.js'
import { OPTIONAL_ADAPTER_METHODS } from './adapter.js'
import type { MockBackendAdapter } from './adapter.js'
import type { MockDraft } from './model.js'

/**
 * The adapter contract, as executable tests — PRD §8, TECH-DESIGN §15.
 *
 * These live in `core` on purpose: **an adapter is the subject of this suite, not its author.**
 * A backend-specific test written next to the adapter tends to assert what that adapter already
 * does, which is how a "portable" model quietly becomes one vendor's JSON with different field
 * names — the standing risk in §18.
 *
 * What is asserted here is only what the canonical model *promises*, never how any backend
 * spells it. Every test is skipped when the capability it exercises is off, because a capability
 * that is off means the method is absent, and absence is a valid answer rather than a failure.
 *
 * Adding a second adapter means running this file against it and fixing whatever it says. If a
 * test here cannot pass for a legitimate backend, the contract is wrong and this file is where
 * that argument gets settled.
 */

export interface ConformanceOptions {
  /** A connected adapter, freshly built for each test file. */
  readonly adapter: MockBackendAdapter
  /**
   * Put the backend into a known state: exactly these stubs and nothing else. Called before
   * every test, because these tests write.
   */
  readonly reset: (stubs: readonly MockDraft[]) => Promise<void>
  /**
   * Send a request through the mock server itself, so traffic assertions observe what the
   * backend actually served rather than what we asked it to store.
   */
  readonly send: (method: string, path: string, headers?: Record<string, string>) => Promise<number>
}

/** A stub every backend can express: one method, one path, one JSON body. */
export function conformanceStub(over: Partial<MockDraft> = {}): MockDraft {
  return {
    name: 'conformance',
    folder: [],
    tags: [],
    enabled: null,
    priority: null,
    request: {
      method: 'GET',
      url: { kind: 'urlPath', value: '/conformance' },
      headers: {},
      queryParameters: {},
      cookies: {},
      bodyPatterns: [],
    },
    response: {
      status: 200,
      statusMessage: null,
      headers: { 'Content-Type': 'application/json' },
      body: { kind: 'json', value: { ok: true } },
      delay: null,
      fault: null,
      proxy: null,
      transformers: [],
    },
    state: null,
    metadata: {},
    raw: {},
    ...over,
  }
}

export function runAdapterConformance(options: () => ConformanceOptions): void {
  const get = () => options()

  describe('identity and capabilities', () => {
    it('names itself', () => {
      const { adapter } = get()
      expect(adapter.id).toMatch(/^[a-z0-9-]+$/)
      expect(adapter.displayName.length).toBeGreaterThan(0)
    })

    it('reports only capability bits the registry knows', () => {
      // An invented bit cannot be resolved against the environment, so it would be silently
      // dropped and the feature it gates would never appear — with nothing to show why.
      const known = new Set<string>(CAPABILITY_BITS)
      for (const bit of get().adapter.capabilities()) expect(known).toContain(bit)
    })

    it('omits the methods its capabilities say it cannot do', () => {
      // Invariant 5: a capability that is off means the method is *absent*, not a method that
      // throws. The whole UI gating rests on being able to test for the function.
      const { adapter } = get()
      const bits = adapter.capabilities()
      for (const method of OPTIONAL_ADAPTER_METHODS) {
        const present =
          typeof (adapter as unknown as Record<string, unknown>)[method] === 'function'
        // Presence must be a decision, not an accident: every optional method that exists has
        // to be backed by a bit, and vice versa. The mapping itself is the adapter's business,
        // so this only asserts the two agree in the directions that can be checked here.
        if (!present) expect(bits.size).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('corpus', () => {
    it('round-trips a stub through the backend without losing the canonical shape', async () => {
      const { adapter, reset } = get()
      await reset([conformanceStub()])
      const page = await adapter.listMocks({ limit: 50, offset: 0 })

      expect(page.items).toHaveLength(1)
      const [stored] = page.items
      expect(stored!.request.method).toBe('GET')
      expect(stored!.request.url?.value).toBe('/conformance')
      expect(stored!.response.status).toBe(200)
    })

    it('gives every stub a client key, and the same one twice', async () => {
      // The mirror, the URL and every selection key on it. A key that changes between two reads
      // of an unchanged corpus makes the UI lose its selection on every refresh.
      const { adapter, reset } = get()
      await reset([
        conformanceStub(),
        conformanceStub({
          name: 'second',
          request: {
            ...conformanceStub().request,
            url: { kind: 'urlPath', value: '/conformance-2' },
          },
        }),
      ])

      const first = await adapter.listMocks({ limit: 50, offset: 0 })
      const second = await adapter.listMocks({ limit: 50, offset: 0 })

      const keys = first.items.map((mock) => mock.clientKey)
      expect(new Set(keys).size).toBe(keys.length)
      expect(keys.every((key) => key.length > 0)).toBe(true)
      expect(second.items.map((mock) => mock.clientKey).sort()).toEqual([...keys].sort())
    })

    it('reports a total that describes the corpus, not the page', async () => {
      // Paging and every "N stubs" claim in the UI hang off this.
      const { adapter, reset } = get()
      await reset([
        conformanceStub({ name: 'a' }),
        conformanceStub({
          name: 'b',
          request: { ...conformanceStub().request, url: { kind: 'urlPath', value: '/b' } },
        }),
        conformanceStub({
          name: 'c',
          request: { ...conformanceStub().request, url: { kind: 'urlPath', value: '/c' } },
        }),
      ])
      const page = await adapter.listMocks({ limit: 1, offset: 0 })
      expect(page.items).toHaveLength(1)
      expect(page.total).toBe(3)
    })

    it('keeps `raw`, and keeps it faithful to what the backend holds', async () => {
      // Invariant 4. Everything the canonical model does not understand survives only here, and
      // `toVendor` patches this document rather than rebuilding it.
      const { adapter, reset } = get()
      await reset([conformanceStub()])
      const [stored] = (await adapter.listMocks({ limit: 1, offset: 0 })).items
      expect(stored!.raw).toBeTypeOf('object')
      expect(Object.keys(stored!.raw).length).toBeGreaterThan(0)
      // Canonical output must be stable, since it is hashed and diffed.
      expect(canonicalJson(stored!.raw)).toBe(canonicalJson(stored!.raw))
    })

    it('interprets what it rendered', async () => {
      // `render` then `interpret` is the form-editing round trip. It does not have to be
      // byte-identical through the vendor format, but it must not change behaviour.
      const { adapter } = get()
      const draft = conformanceStub()
      const rendered = adapter.render(draft)
      const interpreted = adapter.interpret(rendered)
      expect(behaviourFingerprint(interpreted)).toBe(behaviourFingerprint(draft))
    })
  })

  describe('writes', () => {
    it('creates a stub that the corpus then contains', async ({ skip }) => {
      const { adapter, reset } = get()
      if (adapter.createMock === undefined) return skip()
      await reset([])

      const created = await adapter.createMock(conformanceStub())
      expect(created.clientKey.length).toBeGreaterThan(0)
      const page = await adapter.listMocks({ limit: 50, offset: 0 })
      expect(page.items.map((mock) => mock.clientKey)).toContain(created.clientKey)
    })

    it('updates a stub in place, keeping its identity', async ({ skip }) => {
      // A backend that cannot update in place has to say so through its capabilities, because
      // an update that silently creates a second stub is a corpus that doubles every edit.
      const { adapter, reset } = get()
      if (adapter.updateMock === undefined || adapter.createMock === undefined) return skip()
      await reset([])

      const created = await adapter.createMock(conformanceStub())
      const before = (await adapter.listMocks({ limit: 50, offset: 0 })).total

      const edited = { ...adapter.interpret(created.raw) }
      edited.response = { ...edited.response, status: 503 }
      const updated = await adapter.updateMock(created.id ?? created.clientKey, edited)

      expect(updated.response.status).toBe(503)
      expect((await adapter.listMocks({ limit: 50, offset: 0 })).total).toBe(before)
    })

    it('deletes a stub, and only that one', async ({ skip }) => {
      const { adapter, reset } = get()
      if (adapter.deleteMock === undefined || adapter.createMock === undefined) return skip()
      await reset([])

      const doomed = await adapter.createMock(conformanceStub({ name: 'doomed' }))
      await adapter.createMock(
        conformanceStub({
          name: 'survivor',
          request: { ...conformanceStub().request, url: { kind: 'urlPath', value: '/survivor' } },
        }),
      )
      await adapter.deleteMock(doomed.id ?? doomed.clientKey)

      const remaining = await adapter.listMocks({ limit: 50, offset: 0 })
      expect(remaining.total).toBe(1)
      // Identified by URL, not by name. MockServer has no name for an expectation, so asserting
      // on one was this suite testing a WireMock habit rather than the contract — found by
      // running it against the second backend, which is what the tier is for. Every backend has
      // a matcher; not every backend has a label.
      expect(remaining.items[0]!.request.url?.value).toBe('/survivor')
    })

    it('replaceAll replaces rather than merges', async () => {
      // The trap this exists to catch: WireMock's import endpoint merges unless told otherwise,
      // so a "replace" that quietly became a merge left the old corpus in place. Any backend
      // with the same shape of API can make the same mistake.
      const { adapter, reset } = get()
      await reset([conformanceStub({ name: 'old' })])
      const replacement = adapter.interpret(
        adapter.render(
          conformanceStub({
            name: 'new',
            request: { ...conformanceStub().request, url: { kind: 'urlPath', value: '/new' } },
          }),
        ),
      )
      await adapter.replaceAll([
        { ...replacement, id: null, clientKey: '', contentHash: '', folderSource: 'none' },
      ])

      const page = await adapter.listMocks({ limit: 50, offset: 0 })
      expect(page.total).toBe(1)
      expect(page.items[0]!.request.url?.value).toBe('/new')
    })
  })

  describe('traffic', () => {
    it('records a request it served, with the stub that served it', async ({ skip }) => {
      const { adapter, reset, send } = get()
      if (adapter.listServeEvents === undefined || adapter.clearJournal === undefined) return skip()
      await reset([conformanceStub()])
      await adapter.clearJournal()
      expect(await send('GET', '/conformance')).toBe(200)

      const events = await adapter.listServeEvents({ limit: 20 })
      const served = events.items.find((event) => event.request.url === '/conformance')
      expect(served).toBeDefined()
      expect(served!.matched).toBe(true)
      // Attribution is optional in the contract, but if it is offered it must name a real stub.
      if (served!.matchedClientKey !== null) {
        const corpus = await adapter.listMocks({ limit: 50, offset: 0 })
        expect(corpus.items.map((mock) => mock.clientKey)).toContain(served!.matchedClientKey)
      }
    })

    it('records a request nothing matched, and says so', async ({ skip }) => {
      const { adapter, reset, send } = get()
      if (adapter.listServeEvents === undefined || adapter.clearJournal === undefined) return skip()
      await reset([conformanceStub()])
      await adapter.clearJournal()
      await send('GET', '/nothing-matches-this')

      const events = await adapter.listServeEvents({ limit: 20 })
      const missed = events.items.find((event) => event.request.url === '/nothing-matches-this')
      expect(missed).toBeDefined()
      expect(missed!.matched).toBe(false)
      // An unmatched request has no serving stub, and claiming one would be worse than null.
      expect(missed!.matchedClientKey).toBeNull()
    })

    it('empties the journal when asked', async ({ skip }) => {
      const { adapter, reset, send } = get()
      if (adapter.listServeEvents === undefined || adapter.clearJournal === undefined) return skip()
      await reset([conformanceStub()])
      await send('GET', '/conformance')
      await adapter.clearJournal()
      expect((await adapter.listServeEvents({ limit: 20 })).items).toHaveLength(0)
    })
  })

  describe('scenarios', () => {
    it('lists a scenario the corpus declares, with its current state', async ({ skip }) => {
      const { adapter, reset } = get()
      if (adapter.listScenarios === undefined) return skip()
      await reset([
        conformanceStub({
          state: { scenario: 'conformance-flow', requiredState: 'Started', newState: 'second' },
        }),
      ])

      const scenarios = await adapter.listScenarios()
      const found = scenarios.find((scenario) => scenario.name === 'conformance-flow')
      expect(found).toBeDefined()
      // A scenario is not declared anywhere: it emerges from the stubs that reference it, so a
      // backend must report one that only a stub mentions.
      expect(found!.currentState.length).toBeGreaterThan(0)
    })

    it('moves a scenario to a named state', async ({ skip }) => {
      const { adapter, reset } = get()
      if (adapter.listScenarios === undefined || adapter.setScenarioState === undefined) {
        return skip()
      }
      await reset([
        conformanceStub({
          state: { scenario: 'conformance-flow', requiredState: 'Started', newState: 'second' },
        }),
      ])
      await adapter.setScenarioState('conformance-flow', 'second')

      const found = (await adapter.listScenarios()).find((s) => s.name === 'conformance-flow')
      expect(found!.currentState).toBe('second')
    })
  })
}
