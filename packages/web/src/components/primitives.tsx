import type { CSSProperties, ReactNode } from 'react'

/**
 * The small shared pieces. Every colour here is a `--mk-*` token: a literal colour in a
 * component is the one thing that breaks theming, because theme switching swaps token *values*
 * and a component that hardcodes one can never follow.
 */

const METHOD_TOKENS: Record<string, string> = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'delete',
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
 */
export function StatusCode({ status }: { status: number | null }) {
  if (status === null) return <span style={{ color: 'var(--mk-text-tertiary)' }}>—</span>
  const token =
    status >= 500
      ? 'var(--mk-danger-text)'
      : status >= 400
        ? 'var(--mk-warning-text)'
        : status >= 300
          ? 'var(--mk-accent-text)'
          : 'var(--mk-text-primary)'
  return (
    <span className="mk-tabular" style={{ color: token, fontWeight: 500 }}>
      {status}
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
  variant?: 'primary' | 'secondary' | 'ghost'
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
