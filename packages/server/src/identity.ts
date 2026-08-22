import { execFileSync } from 'node:child_process'
import { userInfo } from 'node:os'

/**
 * Who to attribute a change to — TECH-DESIGN §2 (Identity), amended by A3/§3.3.
 *
 * Local mode borrows the developer's git identity, which is right most of the time and costs
 * nothing. Deployed mode has no authentication in v1, so it records `unknown` rather than
 * guessing from a hostname or a header that anyone could set: an audit trail that names the
 * wrong person is worse than one that admits it does not know.
 */

export const UNKNOWN_ACTOR = 'unknown'

export function resolveActor(mode: 'local' | 'deployed'): string {
  if (mode === 'deployed') return UNKNOWN_ACTOR
  try {
    const email = execFileSync('git', ['config', 'user.email'], {
      encoding: 'utf8',
      timeout: 2_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (email !== '') return email
  } catch {
    // No git, no repo, or no configured email — fall through rather than fail a write.
  }
  try {
    const name = userInfo().username
    if (name !== '') return name
  } catch {
    // userInfo throws on some container images with no passwd entry.
  }
  return UNKNOWN_ACTOR
}
