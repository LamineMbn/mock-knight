import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fuzzyRank } from '@mock-knight/core/types'
import type { FuzzyMatch } from '@mock-knight/core/types'
import { api } from '../api.js'
import type { Profile } from '../api.js'
import { BackendBadge, MethodChip, StatusCode } from './primitives.js'
import type { BackendIdentity } from './primitives.js'

/**
 * The command palette — design brief §6.10, FR-UX-1, FR-CONN-2.
 *
 * Four screens and a growing set of actions, each reachable only by knowing where it lives.
 * `⌘K` is what makes the keyboard the primary input rather than an accessibility footnote.
 *
 * **A destructive action is listed but never performed here.** Selecting one takes you to the
 * control that owns it, with its typed confirmation open. The palette is a way to reach an
 * action, not a way around the confirmation it carries (§6.10, §9.2) — and the confirmation
 * exists because these operations affect everyone pointed at the same server.
 *
 * Matching is a subsequence match, not a fuzzy-distance one: guessing past a typo would put a
 * destructive row under a query nobody typed.
 */

export interface Command {
  readonly id: string
  readonly label: string
  /** Grouped in the order the brief gives: actions, then navigation, then profiles. */
  readonly section: 'Actions' | 'Go to' | 'Saved searches' | 'Switch profile'
  readonly hint?: string
  readonly shortcut?: string
  /** Rendered in `danger-text`, and expected to open a confirmation rather than act. */
  readonly destructive?: boolean
  /** A profile's colour, shown as a dot. */
  readonly colour?: string
  /** Which backend, for a row that names a server. */
  readonly backend?: BackendIdentity
  readonly run: () => void
}

function Emphasised({ text, indices }: { text: string; indices: readonly number[] }) {
  if (indices.length === 0) return <>{text}</>
  const set = new Set(indices)
  return (
    <>
      {[...text].map((character, index) =>
        set.has(index) ? (
          <strong key={index} style={{ color: 'var(--mk-accent-text)', fontWeight: 600 }}>
            {character}
          </strong>
        ) : (
          <span key={index}>{character}</span>
        ),
      )}
    </>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        font: 'inherit',
        fontSize: 11,
        padding: '1px 5px',
        color: 'var(--mk-text-tertiary)',
        background: 'var(--mk-bg-subtle)',
        border: '1px solid var(--mk-border-default)',
        borderRadius: 'var(--mk-radius-sm)',
      }}
    >
      {children}
    </kbd>
  )
}

interface Row {
  readonly key: string
  readonly section: string
  /**
   * The row's accessible name. Set explicitly because the rendered content concatenates the
   * label, the hint and any chips — so a screen reader announced "staging http://…:8080" and a
   * name-based query matched every row whose *hint* happened to contain the text.
   */
  readonly name: string
  readonly render: React.ReactNode
  readonly destructive: boolean
  readonly run: () => void
}

export function CommandPalette({
  profileId,
  profiles,
  commands,
  onClose,
  onOpenStub,
}: {
  profileId: string
  profiles: readonly Profile[]
  commands: readonly Command[]
  onClose: () => void
  onOpenStub: (clientKey: string) => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  /**
   * Focus returns to whatever opened the palette (§8). Captured on mount rather than passed in,
   * so every future caller gets it without having to remember.
   */
  const origin = useRef<Element | null>(
    typeof document === 'undefined' ? null : document.activeElement,
  )
  useEffect(() => {
    const restore = origin.current
    return () => {
      if (restore instanceof HTMLElement) restore.focus()
    }
  }, [])

  // Stubs only once the query is worth a round trip; an empty palette should not fetch.
  const stubs = useQuery({
    queryKey: ['palette-stubs', profileId, query],
    queryFn: () => api.corpus(profileId, query, 6, 0),
    enabled: query.trim().length >= 2,
  })

  const rows = useMemo<Row[]>(() => {
    const commandRows = fuzzyRank(query, commands, (command) => command.label).map(
      ({ item, match }: { item: Command; match: FuzzyMatch }) => ({
        key: item.id,
        section: item.section,
        name: item.label,
        destructive: item.destructive === true,
        run: item.run,
        render: (
          <>
            {item.backend !== undefined && <BackendBadge {...item.backend} />}
            {item.colour !== undefined && (
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 9999,
                  flex: '0 0 auto',
                  background: `var(--mk-profile-${item.colour})`,
                }}
              />
            )}
            <span style={{ flex: 1, minWidth: 0 }}>
              <Emphasised text={item.label} indices={match.indices} />
              {item.hint !== undefined && (
                <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
                  {item.hint}
                </span>
              )}
            </span>
            {item.shortcut !== undefined && <Kbd>{item.shortcut}</Kbd>}
          </>
        ),
      }),
    )

    const stubRows: Row[] = (stubs.data?.items ?? []).map((item) => ({
      key: `stub:${item.clientKey}`,
      section: 'Search stubs',
      name: `${item.method ?? 'ANY'} ${item.url?.value ?? item.name ?? 'stub'}`,
      destructive: false,
      run: () => onOpenStub(item.clientKey),
      render: (
        <>
          <MethodChip method={item.method} />
          <span className="mk-mono" style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
            {item.url?.value ?? item.name ?? '—'}
          </span>
          <StatusCode status={item.status} />
        </>
      ),
    }))

    return [...commandRows, ...stubRows]
  }, [query, commands, stubs.data, onOpenStub])

  // Clamped rather than reset: retyping should not throw the selection back to the top on every
  // keystroke, but it must never point past the end of a shorter list.
  const index = Math.min(active, Math.max(0, rows.length - 1))

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index, rows.length])

  const sections = useMemo(() => {
    const order = ['Actions', 'Go to', 'Saved searches', 'Switch profile', 'Search stubs']
    const grouped = new Map<string, { row: Row; position: number }[]>()
    rows.forEach((row, position) => {
      const bucket = grouped.get(row.section) ?? []
      bucket.push({ row, position })
      grouped.set(row.section, bucket)
    })
    return order.flatMap((name) => {
      const bucket = grouped.get(name)
      return bucket === undefined || bucket.length === 0 ? [] : [{ name, entries: bucket }]
    })
  }, [rows])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--mk-scrim)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '20vh',
        zIndex: 90,
      }}
    >
      <div
        style={{
          width: 'min(640px, calc(100% - 32px))',
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--mk-bg-raised)',
          border: '1px solid var(--mk-border-strong)',
          borderRadius: 'var(--mk-radius-lg)',
          boxShadow: 'var(--mk-shadow-modal)',
          overflow: 'hidden',
        }}
      >
        <input
          autoFocus
          // Distinct from the dialog's own label: sharing one made "Command palette" ambiguous
          // to anything querying by accessible name, screen readers included.
          aria-label="Search commands and stubs"
          aria-activedescendant={rows[index]?.key}
          placeholder="Search actions, screens, servers and stubs…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
              event.preventDefault()
              setActive(Math.min(index + 1, rows.length - 1))
            } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
              event.preventDefault()
              setActive(Math.max(index - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const row = rows[index]
              if (row !== undefined) {
                // Closed first, so focus is restored before whatever the row opens takes it.
                onClose()
                row.run()
              }
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
          style={{
            height: 44,
            padding: '0 14px',
            font: 'inherit',
            fontSize: 15,
            color: 'var(--mk-text-primary)',
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid var(--mk-border-default)',
            outline: 'none',
          }}
        />

        <div ref={listRef} role="listbox" style={{ overflow: 'auto', padding: 4 }}>
          {rows.length === 0 && (
            <p
              style={{
                margin: 0,
                padding: '16px 14px',
                fontSize: 13,
                color: 'var(--mk-text-secondary)',
              }}
            >
              Nothing matches “{query}”.
            </p>
          )}

          {sections.map((section) => (
            <div key={section.name}>
              <div
                style={{
                  padding: '8px 10px 4px',
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: 'var(--mk-text-tertiary)',
                }}
              >
                {section.name}
              </div>
              {section.entries.map(({ row, position }) => (
                <div
                  key={row.key}
                  id={row.key}
                  role="option"
                  aria-label={row.name}
                  aria-selected={position === index}
                  data-active={position === index}
                  onMouseEnter={() => setActive(position)}
                  onClick={() => {
                    onClose()
                    row.run()
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 34,
                    padding: '0 10px',
                    borderRadius: 'var(--mk-radius-sm)',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: row.destructive ? 'var(--mk-danger-text)' : 'var(--mk-text-primary)',
                    background: position === index ? 'var(--mk-bg-emphasis)' : 'transparent',
                  }}
                >
                  {row.render}
                </div>
              ))}
            </div>
          ))}
        </div>

        <footer
          style={{
            display: 'flex',
            gap: 10,
            padding: '6px 12px',
            borderTop: '1px solid var(--mk-border-default)',
            fontSize: 11,
            color: 'var(--mk-text-tertiary)',
          }}
        >
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>↵</Kbd> run
          </span>
          <span>
            <Kbd>esc</Kbd> close
          </span>
          <span style={{ flex: 1 }} />
          <span>
            {profiles.length} {profiles.length === 1 ? 'server' : 'servers'}
          </span>
        </footer>
      </div>
    </div>
  )
}
