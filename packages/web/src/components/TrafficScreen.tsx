import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.js'
import type { Profile, ServeEventRow } from '../api.js'
import { MatchExplainer } from './MatchExplainer.js'
import { Button, MethodChip, MiddleEllipsis, Skeleton, StatusCode } from './primitives.js'

/**
 * The traffic log — design brief §6.5.
 *
 * Match state is triple-encoded, always: a 3px row stripe, a filled icon, and a text label.
 * Green/red is the pair 8% of men cannot separate, and it is this product's core signal.
 *
 * **Arrivals are held while the pointer is over the list.** This is the load-bearing detail.
 * The log auto-follows, so rows drift downward under a stationary cursor — and a click that
 * lands mid-drift hits the row below the one being aimed at. That is why the action is a small
 * button in a fixed column rather than the whole row: a mistimed click on inert row space is a
 * no-op the user notices, whereas a whole-row target would succeed on the *neighbouring
 * request* and render a correct, plausible explanation for the wrong thing. Freezing the list
 * while someone is aiming at it removes the cause rather than mitigating the symptom.
 *
 * The keyboard gets what the mouse does not: `j`/`k` move a roving focus and Enter opens the
 * row's primary action. Focus is discrete and confirmed before activation, so it cannot land on
 * the wrong row mid-shift.
 */

type Filter = 'all' | 'matched' | 'unmatched'

function relative(at: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3600)}h ago`
}

/** One x-position for "the thing you click", whichever kind of row it is. */
const ACTION_COLUMN = 128

function describeRow(event: ServeEventRow): string {
  return `${event.matched ? 'Matched' : 'Unmatched'} ${event.method ?? ''} ${event.url ?? ''} at ${new Date(event.at).toLocaleTimeString()}`
}

function Row({
  event,
  focused,
  onFocus,
  onExplain,
}: {
  event: ServeEventRow
  focused: boolean
  onFocus: () => void
  onExplain: (id: number) => void
}) {
  const ref = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    if (focused && ref.current !== null && document.activeElement !== ref.current) {
      ref.current.focus({ preventScroll: false })
    }
  }, [focused])

  const stripe = event.matched ? 'var(--mk-success-solid)' : 'var(--mk-danger-solid)'
  return (
    <tr
      ref={ref}
      // Roving tabindex (§8): one stop for the whole list, arrows move within it.
      tabIndex={focused ? 0 : -1}
      aria-label={describeRow(event)}
      onFocus={onFocus}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === 'Enter' && !event.matched) {
          keyEvent.preventDefault()
          onExplain(event.id)
        }
      }}
      style={{
        borderBottom: '1px solid var(--mk-border-subtle)',
        background: event.matched
          ? 'transparent'
          : 'color-mix(in srgb, var(--mk-danger-bg) 45%, transparent)',
        outlineOffset: -2,
      }}
    >
      <td style={{ padding: 0, width: 3 }}>
        <span style={{ display: 'block', width: 3, height: 30, background: stripe }} />
      </td>
      <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill={stripe} />
            {event.matched ? (
              <path
                d="M4.7 8.3l2.2 2.2 4.4-4.7"
                fill="none"
                stroke="#fff"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M5.5 5.5l5 5M10.5 5.5l-5 5"
                stroke="#fff"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            )}
          </svg>
          <span
            style={{
              fontSize: 11,
              color: event.matched ? 'var(--mk-success-text)' : 'var(--mk-danger-text)',
            }}
          >
            {event.matched ? 'MATCHED' : 'UNMATCHED'}
          </span>
        </span>
      </td>
      <td
        className="mk-tabular"
        style={{
          padding: '4px 8px',
          color: 'var(--mk-text-tertiary)',
          fontSize: 12,
          whiteSpace: 'nowrap',
        }}
      >
        {relative(event.at)}
      </td>
      <td style={{ padding: '4px 8px' }}>
        <MethodChip method={event.method} />
      </td>
      <td
        className="mk-mono"
        style={{ padding: '4px 8px', fontSize: 12, maxWidth: 0, width: '100%' }}
      >
        <span style={{ display: 'flex', minWidth: 0 }}>
          <MiddleEllipsis text={event.url ?? '—'} tailChars={18} />
        </span>
      </td>
      <td style={{ padding: '4px 8px', textAlign: 'right' }}>
        <StatusCode status={event.status} />
      </td>
      <td
        style={{
          padding: '4px 8px',
          width: ACTION_COLUMN,
          minWidth: ACTION_COLUMN,
          textAlign: 'right',
        }}
      >
        {event.matched ? (
          <span style={{ fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
            {event.matchedClientKey === null ? '—' : 'stub ↗'}
          </span>
        ) : (
          <Button
            variant="quiet"
            onClick={() => onExplain(event.id)}
            // 30 buttons all named "Why?" tell a screen-reader user nothing about which is which.
            title={`Why didn't ${event.method ?? ''} ${event.url ?? ''} at ${new Date(event.at).toLocaleTimeString()} match?`}
          >
            Why?
          </Button>
        )}
      </td>
    </tr>
  )
}

export function TrafficScreen({ profile }: { profile: Profile }) {
  const profileId = profile.id
  const baseUrl = profile.baseUrl
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  /**
   * Events the user has dismissed from *their* view.
   *
   * Held as a set of ids rather than a timestamp watermark: events arrive newest-first within a
   * poll, so their ids are not monotonic with time and an id or time cutoff would hide the
   * wrong ones. This destroys nothing — the server's journal is untouched and so is everyone
   * else's view of it, which is the difference between this and Clear journal below.
   */
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(new Set())
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [explaining, setExplaining] = useState<number | null>(null)
  const [displayed, setDisplayed] = useState<ServeEventRow[]>([])
  const [focusedId, setFocusedId] = useState<number | null>(null)
  const [held, setHeld] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pointerInside = useRef(false)
  const scrolledAway = useRef(false)

  const journal = useQuery({
    queryKey: ['events', profileId, filter],
    queryFn: () => api.events(profileId, filter),
    // Polled, because WireMock has no push channel. Paused when the tab is hidden so a
    // background window does not keep hammering the server we are here to debug.
    refetchInterval: () => (document.visibilityState === 'visible' ? 2_000 : false),
  })

  const fetched = useMemo(() => journal.data?.items ?? [], [journal.data])

  /**
   * Hold arrivals while the user is aiming at the list or has scrolled off the top.
   *
   * Recomputed from refs rather than state so a fetch that resolves between renders sees the
   * current pointer position — `onMouseEnter` alone misses the case where the pointer was
   * already inside before the first event arrived.
   */
  const shouldHold = useCallback(() => pointerInside.current || scrolledAway.current, [])

  useEffect(() => {
    if (shouldHold()) {
      setHeld(true)
      return
    }
    setDisplayed(fetched)
    setHeld(false)
  }, [fetched, shouldHold])

  const visible = useMemo(
    () => displayed.filter((event) => !dismissed.has(event.id)),
    [displayed, dismissed],
  )
  // Counted against what is actually on hand, not against the dismissed set: events age out of
  // the journal window, and offering to unhide 40 that no longer exist would be a lie.
  const hiddenCount = displayed.length - visible.length
  const shownIds = useMemo(() => new Set(displayed.map((e) => e.id)), [displayed])
  const pending = fetched.filter((event) => !shownIds.has(event.id)).length

  const clearJournal = useMutation({
    mutationFn: () => api.danger(profileId, 'clear-journal', confirmText),
    onSuccess: () => {
      setConfirmingClear(false)
      setConfirmText('')
      setDismissed(new Set())
      setDisplayed([])
      void queryClient.invalidateQueries({ queryKey: ['events', profileId] })
      // "Unused since…" was quoting a window whose events no longer exist.
      void queryClient.invalidateQueries({ queryKey: ['corpus'] })
    },
  })

  const flush = () => {
    setDisplayed(fetched)
    setHeld(false)
  }

  // Focus is keyed to the row **id**, never the index: rows prepend, so an index-based roving
  // focus walks the user down one row on every arrival.
  const move = (delta: number) => {
    if (visible.length === 0) return
    const current = visible.findIndex((event) => event.id === focusedId)
    const next = Math.min(visible.length - 1, Math.max(0, (current === -1 ? 0 : current) + delta))
    setFocusedId(visible[next]!.id)
  }

  return (
    <main
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--mk-bg-surface)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 8,
          borderBottom: '1px solid var(--mk-border-default)',
        }}
      >
        <div role="group" aria-label="Filter by match state" style={{ display: 'flex' }}>
          {(['all', 'unmatched', 'matched'] as const).map((value, index) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              style={{
                height: 26,
                padding: '0 10px',
                font: 'inherit',
                fontSize: 13,
                cursor: 'pointer',
                textTransform: 'capitalize',
                color: filter === value ? 'var(--mk-text-primary)' : 'var(--mk-text-secondary)',
                background: filter === value ? 'var(--mk-bg-emphasis)' : 'var(--mk-bg-surface)',
                border: '1px solid var(--mk-border-strong)',
                borderLeftWidth: index === 0 ? 1 : 0,
                borderRadius:
                  index === 0
                    ? 'var(--mk-radius-sm) 0 0 var(--mk-radius-sm)'
                    : index === 2
                      ? '0 var(--mk-radius-sm) var(--mk-radius-sm) 0'
                      : 0,
              }}
            >
              {value}
            </button>
          ))}
        </div>

        {/* Held arrivals are counted and visible — never a silent freeze, never a yanked viewport. */}
        {pending > 0 && (
          <Button variant="quiet" onClick={flush}>
            {pending} new
          </Button>
        )}
        {pending === 0 && held && (
          <span style={{ fontSize: 12, color: 'var(--mk-text-tertiary)' }}>paused</span>
        )}

        {/*
          Hides what is on screen so the next call is easy to spot. Nothing is deleted, which is
          what makes it safe to press on a server a whole team shares — the destructive version
          is beside it, and says so.
        */}
        {visible.length > 0 && (
          <Button
            variant="quiet"
            onClick={() => setDismissed(new Set(displayed.map((event) => event.id)))}
          >
            Clear view
          </Button>
        )}
        {hiddenCount > 0 && (
          <Button variant="quiet" onClick={() => setDismissed(new Set())}>
            Show {hiddenCount} hidden
          </Button>
        )}

        <span style={{ flex: 1 }} />
        {journal.data?.window.earliestAt != null && (
          <span style={{ fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
            {/* Bounded truth: never a claim about all time. */}
            journal reaches back to {new Date(journal.data.window.earliestAt).toLocaleTimeString()}
          </span>
        )}

        {/*
          The real thing — FR-TRAF-7 makes it a §9.6 destructive operation, so it takes the
          profile name typed back and is absent on a protected profile. It empties the journal
          for *everyone* pointed at this server, which is why it is not the easy button.
        */}
        {!profile.protected && !profile.readOnly && (
          <>
            {confirmingClear ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>
                  Empties it for everyone. Type <code className="mk-mono">{profile.name}</code>:
                </span>
                <input
                  autoFocus
                  aria-label="Type the profile name to confirm clearing the journal"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  style={{
                    height: 24,
                    width: 150,
                    padding: '0 6px',
                    font: 'inherit',
                    fontSize: 12,
                    color: 'var(--mk-text-primary)',
                    background: 'var(--mk-bg-surface)',
                    border: '1px solid var(--mk-border-strong)',
                    borderRadius: 'var(--mk-radius-sm)',
                  }}
                />
                <Button
                  onClick={() => {
                    setConfirmingClear(false)
                    setConfirmText('')
                  }}
                >
                  Cancel
                </Button>
                <button
                  type="button"
                  disabled={confirmText !== profile.name || clearJournal.isPending}
                  onClick={() => clearJournal.mutate()}
                  style={{
                    height: 24,
                    padding: '0 8px',
                    font: 'inherit',
                    fontSize: 12,
                    borderRadius: 'var(--mk-radius-sm)',
                    cursor: confirmText === profile.name ? 'pointer' : 'not-allowed',
                    opacity: confirmText === profile.name ? 1 : 0.5,
                    color: 'var(--mk-danger-on-solid)',
                    background: 'var(--mk-danger-solid)',
                    border: '1px solid var(--mk-danger-solid)',
                  }}
                >
                  Clear journal
                </button>
              </span>
            ) : (
              <Button onClick={() => setConfirmingClear(true)}>Clear journal…</Button>
            )}
          </>
        )}
      </div>

      <div
        ref={scrollRef}
        style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
        onPointerEnter={() => {
          pointerInside.current = true
        }}
        onPointerMove={() => {
          pointerInside.current = true
        }}
        onPointerLeave={() => {
          pointerInside.current = false
          if (!scrolledAway.current) flush()
        }}
        onScroll={(event) => {
          scrolledAway.current = event.currentTarget.scrollTop > 4
          if (!scrolledAway.current && !pointerInside.current) flush()
        }}
        onKeyDown={(event) => {
          if (event.key === 'j' || event.key === 'ArrowDown') {
            event.preventDefault()
            move(1)
          }
          if (event.key === 'k' || event.key === 'ArrowUp') {
            event.preventDefault()
            move(-1)
          }
        }}
      >
        {journal.isPending ? (
          <div style={{ padding: 12, display: 'grid', gap: 14 }}>
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} width={`${40 + ((index * 11) % 50)}%`} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div
            style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--mk-text-secondary)' }}
          >
            <strong style={{ display: 'block', fontSize: 16, marginBottom: 6 }}>
              {hiddenCount > 0 ? 'Waiting for the next request.' : 'No requests recorded yet.'}
            </strong>
            {hiddenCount > 0 ? (
              <>
                {hiddenCount} earlier {hiddenCount === 1 ? 'request is' : 'requests are'} hidden
                from this view — still on the server.
              </>
            ) : (
              <>
                Send a request to <code className="mk-mono">{baseUrl}</code> and it will appear
                here.
              </>
            )}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <caption style={{ position: 'absolute', left: -9999 }}>
              Requests this server has served. Use j and k to move, Enter to explain one.
            </caption>
            <tbody>
              {visible.map((event) => (
                <Row
                  key={event.id}
                  event={event}
                  focused={event.id === focusedId}
                  onFocus={() => setFocusedId(event.id)}
                  onExplain={setExplaining}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {explaining !== null && (
        <MatchExplainer
          profileId={profileId}
          eventId={explaining}
          baseUrl={baseUrl}
          onClose={() => setExplaining(null)}
        />
      )}
    </main>
  )
}
