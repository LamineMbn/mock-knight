/**
 * Credentials held for this run only.
 *
 * The default. A password typed into the Servers screen stays in this process and is gone when it
 * exits, so nothing about it survives to be read out of a backup, a cloud-synced home directory,
 * a screen share, or a `cat` of the state database. Persisting is opt-in — the "remember" box is
 * off — because the safest place for a secret is somewhere it was never written.
 *
 * **What this does not do.** Anything running as the same user can still read this process's
 * memory, and can more easily just drive the unauthenticated API and use the credential without
 * ever seeing it. That route is not closed by any storage decision, which is why the deployed
 * guard in the CLI exists: a network-reachable Mock Knight holding a working credential is a
 * different proposition from a loopback one.
 *
 * Not an LRU and not expiring: a developer leaves this running all day, and re-typing a password
 * because a timer fired would teach them to tick "remember" instead, which is worse.
 */

export interface SessionCredential {
  readonly username: string | null
  readonly secret: string
}

export class CredentialStore {
  private readonly held = new Map<string, SessionCredential>()

  get(profileId: string): SessionCredential | null {
    return this.held.get(profileId) ?? null
  }

  set(profileId: string, credential: SessionCredential): void {
    this.held.set(profileId, credential)
  }

  /** Called when a profile is deleted, or when its credential is persisted or cleared instead. */
  forget(profileId: string): void {
    this.held.delete(profileId)
  }

  /** Whether a credential is available for this run without one being stored on disk. */
  has(profileId: string): boolean {
    return this.held.has(profileId)
  }
}
