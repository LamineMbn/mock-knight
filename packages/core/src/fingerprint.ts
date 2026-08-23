import { contentHash } from './canonical.js'
import type { MockDraft } from './model.js'

/**
 * What makes a stub *the same stub* when its id has changed underneath you.
 *
 * `client_key` is the backend's id where one exists, and that id is not ours to keep. WireMock
 * assigns a fresh UUID to any mapping imported without one — verified: importing the same
 * mapping twice without an `id` produces two mappings with two ids, so an import does not even
 * reissue, it duplicates. A journal entry recorded before such an import then names a stub the
 * corpus no longer has, though the stub itself is plainly still there.
 *
 * So identity gets a second answer that survives that: a hash of what the stub *does*.
 *
 * Deliberately excludes `raw` and everything organisational — name, folder, tags, metadata.
 * Renaming a stub or moving it between folders does not make it a different stub, and including
 * those would break the match on exactly the harmless edits people make most.
 *
 * A fingerprint is a *hint*, never proof. Two stubs can legitimately share one, so a caller
 * resolving by fingerprint must require a unique match and decline otherwise.
 *
 * Browser-safe: no `node:` imports.
 */
export function behaviourFingerprint(
  mock: Pick<MockDraft, 'request' | 'response' | 'state' | 'priority'>,
): string {
  return contentHash({
    request: mock.request,
    response: mock.response,
    state: mock.state,
    priority: mock.priority,
  } as never)
}
