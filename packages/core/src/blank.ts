import type { MockDraft } from './model.js'

/**
 * A new stub, and a copy of an existing one — FR-EDIT-5, FR-EDIT-7.
 *
 * Until these existed, the only route to a new stub was capturing an unmatched request, so
 * pointing Mock Knight at an empty server was a dead end: the screen said "This server has no
 * stubs yet" and offered no way to change that.
 *
 * Browser-safe: no `node:` imports.
 */

/**
 * The starting point for a stub written by hand.
 *
 * Deliberately narrow rather than clever. It matches one method on one path and returns an
 * empty JSON document, so the first thing someone does is replace obviously-placeholder values
 * — as opposed to a template full of plausible defaults that get shipped by accident.
 *
 * `raw` is `{}`: there is no retained vendor document to patch, so every canonical field
 * differs from "absent" and is therefore written. That is exactly how the adapter builds a
 * fresh document.
 */
export function blankMockDraft(): MockDraft {
  return {
    name: null,
    folder: [],
    tags: [],
    enabled: null,
    priority: null,
    request: {
      method: 'GET',
      url: { kind: 'urlPath', value: '/' },
      headers: {},
      queryParameters: {},
      cookies: {},
      bodyPatterns: [],
    },
    response: {
      status: 200,
      statusMessage: null,
      headers: { 'Content-Type': 'application/json' },
      body: { kind: 'json', value: {} },
      delay: null,
      fault: null,
      proxy: null,
      transformers: [],
    },
    state: null,
    metadata: {},
    raw: {},
  }
}

/**
 * A copy of an existing stub, ready to be written as a new one.
 *
 * The name is suffixed because two stubs sharing one name is the fastest way to make a corpus
 * unreadable, and because the copy is otherwise indistinguishable from its original in every
 * list.
 *
 * **`raw` is deliberately kept.** A duplicate should carry the fields the canonical model does
 * not understand — that is the whole reason `raw` is retained — so the copy is a copy rather
 * than a lossy reconstruction. The vendor's own identifiers are stripped instead, since reusing
 * one would make the "new" stub overwrite the original.
 */
export function duplicateMockDraft(source: MockDraft, vendorIdKeys: readonly string[]): MockDraft {
  const raw = { ...source.raw }
  for (const key of vendorIdKeys) delete raw[key]
  return {
    ...source,
    name: `${source.name ?? 'Untitled stub'} (copy)`,
    raw,
  }
}
