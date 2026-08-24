import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { describeStanding, verdictOf } from '@mock-knight/core/types'
import type { PriorityStanding } from '@mock-knight/core/types'

/**
 * The small shared pieces. Every colour here is a `--mk-*` token: a literal colour in a
 * component is the one thing that breaks theming, because theme switching swaps token *values*
 * and a component that hardcodes one can never follow.
 */

/**
 * Hue per method, following Insomnia so the mapping is one a developer already knows.
 *
 * Every pair is contrast-checked in `design/design-tokens.py`; change a value there and
 * regenerate, never here. Anything unlisted (TRACE, CONNECT, a custom verb, WireMock's ANY)
 * falls through to the neutral chip rather than borrowing a colour that means something else.
 */
const METHOD_TOKENS: Record<string, string> = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'delete',
  HEAD: 'head',
  OPTIONS: 'options',
  QUERY: 'query',
}

/**
 * Fixed width so paths align down the list — a column that resizes per row makes 30 rows of
 * paths unscannable, and it forces a layout measurement per row at 10k rows.
 */
export function MethodChip({ method }: { method: string | null }) {
  const label = method ?? 'ANY'
  const token = METHOD_TOKENS[label] ?? 'other'
  return (
    <span
      className="mk-mono"
      // A stable hook for tests. The chip sits inside a gridcell whose text is also the method
      // name, so a text-based selector silently measures the wrapper and reports the chip as
      // unstyled — which it did, twice.
      data-method={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 56,
        flex: '0 0 56px',
        height: 18,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.02em',
        borderRadius: 'var(--mk-radius-sm)',
        color: `var(--mk-method-${token}-text)`,
        background: `var(--mk-method-${token}-bg)`,
      }}
    >
      {label}
    </span>
  )
}

/**
 * Status codes are coloured text with no chip — the numeral is already its own label, so an
 * icon would be redundant and a chip would compete with the method chip beside it.
 *
 * 2xx is green by explicit request. Note the trade this makes: design brief §3.1 reserved
 * green and red for matched/unmatched, and on the Traffic screen a green 200 now sits beside a
 * red UNMATCHED stripe. Match state stays legible because it is triple-encoded — stripe, filled
 * icon, and a text label — so the signal survives; but the two hues no longer mean one thing.
 */
/**
 * One definition of the status scale, so a code in the list, the detail pane, the traffic log,
 * and the facet sidebar can never disagree about what colour a 404 is.
 */
export function statusColour(status: number): string {
  if (status >= 500) return 'var(--mk-danger-text)'
  if (status >= 400) return 'var(--mk-warning-text)'
  if (status >= 300) return 'var(--mk-accent-text)'
  if (status >= 200) return 'var(--mk-success-text)'
  return 'var(--mk-text-primary)'
}

export function StatusCode({ status }: { status: number | null }) {
  if (status === null) return <span style={{ color: 'var(--mk-text-tertiary)' }}>—</span>
  return (
    <span
      className="mk-tabular"
      data-status={status}
      style={{ color: statusColour(status), fontWeight: 500 }}
    >
      {status}
    </span>
  )
}

/**
 * A status *class* — `2xx`, `4xx` — as the facet sidebar lists them. Coloured from the same
 * scale as an individual code, so ticking `5xx` and reading a 500 in the list are visibly the
 * same idea.
 */
export function StatusClass({ value }: { value: string }) {
  const leading = Number(value[0])
  const colour = Number.isFinite(leading) ? statusColour(leading * 100) : 'var(--mk-text-primary)'
  return (
    <span
      className="mk-tabular"
      data-status-class={value}
      style={{ color: colour, fontWeight: 500 }}
    >
      {value}
    </span>
  )
}

/**
 * Truncate in the middle, not the end — design brief §3.2.
 *
 * The tail of a path is usually what distinguishes it: `/v1/orders/{id}/cancel` and
 * `/v1/orders/{id}/refund` are identical for twenty characters, and `order-spi-hs-acrs-v1`
 * differs from `order-spi-hs-tars-v1` only in the middle.
 *
 * Done with CSS rather than by counting characters, for two reasons. It adapts to the actual
 * space — a resizable pane and a proportional typeface make any character count wrong at most
 * widths — and the **full string stays in the DOM**, so screen readers read the whole path and
 * a copy-paste yields something real, rather than a string with a `…` baked into it.
 */
export function MiddleEllipsis({
  text,
  tailChars = 7,
  title,
}: {
  text: string
  /** How much of the end to protect from truncation. */
  tailChars?: number
  title?: string
}) {
  const label = title ?? text
  if (text.length <= tailChars + 2) {
    return (
      <span title={label} style={{ whiteSpace: 'nowrap', flex: '0 1 auto', minWidth: 0 }}>
        {text}
      </span>
    )
  }
  const head = text.slice(0, text.length - tailChars)
  const tail = text.slice(text.length - tailChars)
  return (
    <span title={label} style={{ display: 'flex', flex: '1 1 auto', minWidth: 0 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {head}
      </span>
      <span style={{ whiteSpace: 'nowrap' }}>{tail}</span>
    </span>
  )
}

export function Chip({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'warning'
  title?: string
}) {
  const tones: Record<string, CSSProperties> = {
    neutral: {
      color: 'var(--mk-text-secondary)',
      background: 'var(--mk-bg-subtle)',
      borderColor: 'var(--mk-border-default)',
    },
    accent: {
      color: 'var(--mk-accent-text)',
      background: 'var(--mk-accent-bg-subtle)',
      borderColor: 'var(--mk-accent-border)',
    },
    warning: {
      color: 'var(--mk-warning-text)',
      background: 'var(--mk-warning-bg)',
      borderColor: 'var(--mk-warning-border)',
    },
  }
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 18,
        padding: '0 6px',
        fontSize: 12,
        borderRadius: 'var(--mk-radius-sm)',
        border: '1px solid',
        whiteSpace: 'nowrap',
        ...tones[tone],
      }}
    >
      {children}
    </span>
  )
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'quiet'
  disabled?: boolean
  title?: string
}) {
  const styles: Record<string, CSSProperties> = {
    primary: {
      background: 'var(--mk-accent-solid)',
      color: 'var(--mk-accent-on-solid)',
      border: '1px solid var(--mk-accent-solid)',
    },
    secondary: {
      background: 'var(--mk-bg-surface)',
      color: 'var(--mk-text-primary)',
      border: '1px solid var(--mk-border-strong)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--mk-text-secondary)',
      border: '1px solid transparent',
    },
    /**
     * An accent action that repeats down a list.
     *
     * A filled primary button is right for *one* action in a view. On a failing test run most
     * traffic rows are unmatched, so a filled "Why?" becomes thirty stacked blocks of indigo
     * competing with the red match stripes for the same eye. This reads as the action it is
     * without shouting on every row.
     */
    quiet: {
      background: 'transparent',
      color: 'var(--mk-accent-text)',
      border: '1px solid var(--mk-border-default)',
    },
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        height: 26,
        padding: '0 10px',
        fontSize: 13,
        fontFamily: 'inherit',
        borderRadius: 'var(--mk-radius-sm)',
        cursor: disabled === true ? 'not-allowed' : 'pointer',
        opacity: disabled === true ? 0.5 : 1,
        transition: `background var(--mk-motion-fast) var(--mk-ease)`,
        ...styles[variant],
      }}
    >
      {children}
    </button>
  )
}

/**
 * Anything Mock Knight worked out itself, marked as such.
 *
 * A tool that presents a guess with the same confidence as a fact gets abandoned the first time
 * the guess is wrong, so inference never renders in the same voice as something the server said
 * (design brief §7.4).
 */
export function InferenceLabel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 11,
        color: 'var(--mk-text-tertiary)',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" fill="none">
        <path
          d="M8 2.5 9.2 6l3.3 1.2-3.3 1.3L8 12l-1.2-3.5L3.5 7.2 6.8 6 8 2.5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </span>
  )
}

export function Skeleton({ width, height = 12 }: { width: number | string; height?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width,
        height,
        borderRadius: 'var(--mk-radius-sm)',
        background: 'var(--mk-bg-subtle)',
      }}
    />
  )
}

/**
 * Priority, and what it actually means for this stub — FR-FIND-7, design brief §6.2.
 *
 * A bare number is close to useless here for two reasons. Lower wins, which is the opposite of
 * what most people assume, and a priority only matters relative to the stubs it competes with:
 * `3` is decisive against a `5` and irrelevant if nothing else matches that path. So the cell
 * renders the number *and* the standing — "1 of 3" — and flags the rows that lose.
 *
 * The count is Mock Knight's inference over the corpus, not something WireMock reported, so it
 * carries the inference glyph and says so on hover (§9.4). Its absence is not a promise: two
 * stubs whose patterns overlap without sharing a matcher are not detected, and the tooltip
 * says that rather than implying a clean bill of health.
 */
export function PriorityCell({ standing }: { standing: PriorityStanding }) {
  const verdict = verdictOf(standing)
  const contested = standing.contenders > 1
  const rank = standing.ahead + 1
  const note = describeStanding(standing)

  const title = [
    `Priority ${standing.priority}${standing.explicit ? '' : ', the default — this stub does not set one'}. Lower wins.`,
    note,
    contested
      ? 'Contenders computed by Mock Knight: stubs sharing this URL matcher whose methods can overlap. Stubs that overlap by pattern alone are not counted.'
      : 'No other stub shares this URL matcher. Mock Knight does not detect overlap between different patterns, so this is not a guarantee.',
  ]
    .filter((line) => line !== null)
    .join('\n\n')

  return (
    <span
      title={title}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}
    >
      <span
        className="mk-tabular"
        style={{
          fontSize: 12,
          // A defaulted number is dimmer than a chosen one: the stub did not ask for it.
          color: standing.explicit ? 'var(--mk-text-primary)' : 'var(--mk-text-tertiary)',
        }}
      >
        {standing.priority}
      </span>
      {contested && (
        <Chip tone={verdict === 'wins' ? 'accent' : 'warning'}>
          {/* Never colour alone (§8): the glyph and the text both carry the state. */}
          {verdict === 'wins' ? (
            <svg width="9" height="9" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3.5 8.5l3 3 6-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <span aria-hidden="true">⚑</span>
          )}
          <span className="mk-tabular">
            {rank} of {standing.contenders}
          </span>
        </Chip>
      )}
    </span>
  )
}

/** The screen-reader sentence for a priority cell, which cannot rely on a hover tooltip. */
export function priorityLabel(standing: PriorityStanding): string {
  const note = describeStanding(standing)
  return `Priority ${standing.priority}${standing.explicit ? '' : ' by default'}${note === null ? '' : `. ${note}`}`
}

/**
 * The shape the BFF puts on an error it wants disclosed. Every field is optional because a
 * failure that never reached the mock server has no status, and one refused before it left the
 * process has no upstream at all.
 */
export interface ErrorPayload {
  error?: string
  message?: string
  upstream?: {
    method?: string
    url?: string
    status?: number | null
    code?: string | null
    body?: string
  }
}

/** Pull the disclosable part out of whatever was thrown, without assuming it is one. */
export function errorPayloadOf(caught: unknown): ErrorPayload | null {
  if (caught === null || typeof caught !== 'object') return null
  const payload = (caught as { payload?: unknown }).payload
  return payload !== null && typeof payload === 'object' ? (payload as ErrorPayload) : null
}

/**
 * An error, the way design brief §6.11 requires it: human sentence first, then a disclosure
 * carrying the upstream method, path, status and body — and copyable, because a developer is
 * going to paste it into an issue or a Slack thread.
 *
 * The disclosure is collapsed by default and the sentence stands alone: someone who typed a
 * hostname wrong needs one line, not a stack trace. Someone debugging a load balancer needs the
 * body verbatim. Both are here, in that order.
 *
 * We had the upstream block on the wire for the whole build and threw it away in the browser,
 * which is how a context path being silently dropped turned into "it does not work".
 */
export function ErrorDisclosure({
  sentence,
  payload,
  onRetry,
}: {
  sentence: string
  payload: ErrorPayload | null
  onRetry?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const upstream = payload?.upstream
  const answered = upstream?.status !== null && upstream?.status !== undefined

  const report =
    upstream === undefined
      ? null
      : [
          `${upstream.method ?? '?'} ${upstream.url ?? '?'}`,
          upstream.status === null || upstream.status === undefined
            ? `no response${upstream.code == null ? '' : ` (${upstream.code})`}`
            : `${upstream.status}`,
          '',
          upstream.body ?? '',
        ].join('\n')

  return (
    <div
      role="alert"
      style={{
        padding: '10px 12px',
        borderRadius: 'var(--mk-radius-md)',
        border: '1px solid var(--mk-danger-border)',
        background: 'var(--mk-danger-bg)',
        color: 'var(--mk-danger-text)',
        fontSize: 13,
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <span style={{ flex: 1 }}>{sentence}</span>
        {onRetry !== undefined && <Button onClick={onRetry}>Try again</Button>}
      </div>

      {report !== null && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12 }}>
            {/* Never claim the server said something when nothing answered. The two cases have
                different diagnoses and the label is the first thing that tells them apart. */}
            {answered ? 'What the mock server said' : 'What happened on the wire'}
          </summary>
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            <dl
              className="mk-mono"
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '2px 10px',
                fontSize: 12,
                margin: 0,
              }}
            >
              <dt style={{ color: 'var(--mk-text-tertiary)' }}>request</dt>
              <dd style={{ margin: 0, wordBreak: 'break-all' }}>
                {upstream?.method} {upstream?.url}
              </dd>
              <dt style={{ color: 'var(--mk-text-tertiary)' }}>status</dt>
              <dd style={{ margin: 0 }}>
                {/* Never a fabricated 0 or 500: nothing answered, and saying so is the point. */}
                {upstream?.status ??
                  `no response${upstream?.code == null ? '' : ` · ${upstream.code}`}`}
              </dd>
            </dl>
            {upstream?.body !== undefined && upstream.body !== '' && (
              <pre
                className="mk-mono"
                style={{
                  margin: 0,
                  padding: 8,
                  maxHeight: 200,
                  overflow: 'auto',
                  fontSize: 12,
                  background: 'var(--mk-bg-subtle)',
                  color: 'var(--mk-text-primary)',
                  borderRadius: 'var(--mk-radius-sm)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {upstream.body}
              </pre>
            )}
            <div>
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(`${sentence}\n\n${report}`).then(
                    () => setCopied(true),
                    // Clipboard access can be refused; saying nothing would look like it worked.
                    () => setCopied(false),
                  )
                }}
              >
                {copied ? 'Copied' : 'Copy details'}
              </Button>
            </div>
          </div>
        </details>
      )}
    </div>
  )
}

export interface Failure {
  sentence: string
  payload: ErrorPayload | null
}

/**
 * Turn whatever was thrown into something renderable, preferring the server's own sentence.
 *
 * The BFF already writes the human explanation — "No DNS record for host…", "The mock server
 * rejected GET …" — so a component that substitutes its own generic string is throwing away the
 * more specific one. The fallback is for the cases that never reached the server at all.
 */
export function toFailure(caught: unknown, fallback: string): Failure {
  const payload = errorPayloadOf(caught)
  const sentence =
    payload?.message ??
    (caught instanceof Error && caught.message !== '' ? caught.message : fallback)
  return { sentence, payload }
}

/**
 * A button that is an icon, with its words on hover.
 *
 * Density is the point: a toolbar of five verbs eats the width the corpus needs, and these are
 * actions people repeat all day rather than read once. `label` is not optional and is not
 * decoration — it becomes the accessible name *and* the tooltip, so the button is never a
 * shape with no meaning.
 *
 * **Not for commitments.** A title attribute is invisible to a keyboard user until focus lands
 * and invisible to touch entirely, so the moment of "yes, do it" keeps its words: the confirm
 * inside a typed confirmation, and the primary action of a dialog. An icon-only Save reads as a
 * guess, and a guess is a bad thing to take at the point of writing to a server a team shares.
 */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  variant = 'secondary',
  disabled,
  pressed,
}: {
  icon: (props: { size?: number; 'aria-hidden'?: boolean }) => ReactNode
  /** The words. Used as the accessible name and the tooltip; never omitted. */
  label: string
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger'
  disabled?: boolean
  /** For a toggle. Rendered as `aria-pressed`, not left to colour alone. */
  pressed?: boolean
}) {
  const styles: Record<string, CSSProperties> = {
    primary: {
      background: 'var(--mk-accent-solid)',
      color: 'var(--mk-accent-on-solid)',
      border: '1px solid var(--mk-accent-solid)',
    },
    secondary: {
      background: 'var(--mk-bg-surface)',
      color: 'var(--mk-text-primary)',
      border: '1px solid var(--mk-border-strong)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--mk-text-secondary)',
      border: '1px solid transparent',
    },
    quiet: {
      background: 'transparent',
      color: 'var(--mk-accent-text)',
      border: '1px solid var(--mk-border-default)',
    },
    danger: {
      background: 'var(--mk-bg-surface)',
      color: 'var(--mk-danger-text)',
      border: '1px solid var(--mk-danger-border)',
    },
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        // 26 square: the row density elsewhere, and above the 24px minimum target in §8.
        width: 26,
        height: 26,
        padding: 0,
        borderRadius: 'var(--mk-radius-sm)',
        cursor: disabled === true ? 'not-allowed' : 'pointer',
        opacity: disabled === true ? 0.5 : 1,
        ...styles[pressed === true ? 'primary' : variant],
      }}
    >
      <Icon size={14} aria-hidden={true} />
    </button>
  )
}

/**
 * Which backend a server is, beside its address.
 *
 * A lettermark, not the vendor's logo: shipping an approximation of someone else's trademark is
 * worse than shipping none — it is wrong, it is theirs, and a redrawn mark is the kind of thing
 * a project gets asked to take down. Two letters distinguish two backends at a glance and claim
 * to be nobody's brand.
 *
 * Tinted per backend so the eye can sort a list without reading, and lettered so the tint is
 * never the only signal (§8). The tint is derived from the id rather than configured, so a third
 * backend gets one without anyone choosing.
 */
export function BackendBadge({
  shortName,
  displayName,
  id,
  logoUrl = null,
  logoDarkUrl = null,
}: {
  shortName: string
  displayName: string
  id: string
  logoUrl?: string | null
  logoDarkUrl?: string | null
}) {
  /**
   * A real logo if one has been dropped in, a lettermark otherwise.
   *
   * `logoUrl` is decided server-side from the convention `public/backends/<adapter id>.svg`, so
   * adding a backend's mark is putting a file in a folder — no code to change, nothing to
   * register. `<adapter id>-dark.svg` beside it is swapped in on the dark theme, because a
   * single-colour mark legible on white usually vanishes on it. See the README there.
   *
   * No logo ships with this repo on purpose: an approximation of someone else's trademark is
   * worse than none, and their real files are theirs to license. `WM` and `MS` distinguish two
   * backends without claiming to be anybody's brand.
   */
  // Existing profile-colour tokens rather than new ones: the palette is already contrast-checked
  // in both themes, and inventing a colour here would break the literal-colour rule.
  const tints = ['indigo', 'cyan', 'violet', 'olive', 'rose', 'slate'] as const
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const tint = tints[hash % tints.length]!

  if (logoUrl !== null) {
    // Both variants are rendered and CSS picks one, the same way the app's own mark swaps. No
    // JS theme state is involved, so it is right on the first paint and follows the OS while
    // the theme control is on "system".
    return (
      <>
        <img
          className={logoDarkUrl === null ? 'mk-backend-logo' : 'mk-backend-logo mk-mark-light'}
          src={logoUrl}
          alt={displayName}
          title={displayName}
          height={16}
        />
        {logoDarkUrl !== null && (
          <img
            className="mk-backend-logo mk-mark-dark"
            src={logoDarkUrl}
            alt={displayName}
            title={displayName}
            height={16}
          />
        )}
      </>
    )
  }

  return (
    <span
      title={displayName}
      aria-label={displayName}
      role="img"
      className="mk-mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        width: 20,
        height: 16,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.02em',
        color: `var(--mk-profile-${tint})`,
        background: 'var(--mk-bg-subtle)',
        border: `1px solid var(--mk-profile-${tint})`,
        borderRadius: 'var(--mk-radius-sm)',
      }}
    >
      {shortName}
    </span>
  )
}

/** Look a backend up by id, for the badge. Unknown ids still render, marked as unknown. */
export interface BackendIdentity {
  id: string
  displayName: string
  shortName: string
  logoUrl: string | null
  logoDarkUrl: string | null
}

export function backendOf(adapters: readonly BackendIdentity[], id: string): BackendIdentity {
  return (
    adapters.find((candidate) => candidate.id === id) ?? {
      id,
      // A profile can name a backend this build does not have — an older state database, or a
      // config file from a colleague. Saying so beats rendering nothing at all.
      displayName: `${id} (not available in this build)`,
      shortName: '??',
      logoUrl: null,
      logoDarkUrl: null,
    }
  )
}
