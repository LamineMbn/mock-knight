import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.js'
import type { JournalFilters, Profile, ServeEventRow } from '../api.js'
import { MatchExplainer } from './MatchExplainer.js'
import { Eye, EyeOff, ExternalLink, FilterX, HelpCircle, Trash2 } from 'lucide-react'
import {
  Button,
  IconButton,
  MethodChip,
  MiddleEllipsis,
  Skeleton,
  StatusCode,
} from './primitives.js'

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

const NO_FILTERS: JournalFilters = {
  matched: 'all',
  method: '',
  path: '',
  statusClass: '',
  correlation: '',
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

const filterField: React.CSSProperties = {
  height: 26,
  padding: '0 6px',
  font: 'inherit',
  fontSize: 13,
  color: 'var(--mk-text-primary)',
  background: 'var(--mk-bg-surface)',
  border: '1px solid var(--mk-border-strong)',
  borderRadius: 'var(--mk-radius-sm)',
  minWidth: 0,
}

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
  tabStop,
  onFocus,
  onExplain,
  canExplain,
  onCorrelation,
  onOpenStub,
}: {
  event: ServeEventRow
  focused: boolean
  /**
   * Whether this row is the list's single tab stop.
   *
   * Deliberately not the same thing as `focused`, which also *moves* DOM focus. Until a row had
   * been focused, every row was `tabIndex={-1}` and the list had no tab stop at all — a keyboard
   * user tabbed straight past the whole traffic log and could only get in with a mouse. Making
   * the first row `focused` instead would fix the tab order by stealing focus on load.
   */
  tabStop: boolean
  onFocus: () => void
  onExplain: (id: number) => void
  /**
   * Whether this backend can explain a near miss at all.
   *
   * Mockoon is the first backend with a traffic log and no near-miss support, which is what made
   * this reachable: the row drew "Why didn't this match?" regardless, and the route behind it
   * correctly 404s when the capability is off. A control that can only fail is the one thing
   * invariant 4 forbids.
   */
  canExplain: boolean
  onCorrelation: (correlation: string) => void
  onOpenStub: (clientKey: string, refreshFirst: boolean) => void
}) {
  const ref = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    if (focused && ref.current !== null && document.activeElement !== ref.current) {
      ref.current.focus({ preventScroll: false })
    }
  }, [focused])

  const stripe = event.matched ? 'var(--mk-success-solid)' : 'var(--mk-danger-solid)'
  // The glyph drawn *on* that disc. Dark mode's solids are light, so a fixed white cross
  // disappeared against them; `on-solid` is whichever of the pair reads against the fill.
  const onStripe = event.matched ? 'var(--mk-success-on-solid)' : 'var(--mk-danger-on-solid)'
  return (
    <tr
      ref={ref}
      // Roving tabindex (§8): one stop for the whole list, arrows move within it.
      tabIndex={tabStop ? 0 : -1}
      aria-label={describeRow(event)}
      onFocus={onFocus}
      onKeyDown={(keyEvent) => {
        // Gated with the button, or Enter would reach a route that is not there.
        if (keyEvent.key === 'Enter' && !event.matched && canExplain) {
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
                stroke={onStripe}
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M5.5 5.5l5 5M10.5 5.5l-5 5"
                stroke={onStripe}
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
        <span style={{ display: 'flex', minWidth: 0, alignItems: 'center', gap: 6 }}>
          <MiddleEllipsis text={event.url ?? '—'} tailChars={18} />
          {event.correlation !== null && (
            /**
             * The correlation header this profile is configured to read. It has been stored on
             * every event since the journal existed and was never shown, which made it useless:
             * following one request through a system is the reason to configure it at all.
             * Click to see only that request's traffic.
             */
            <button
              type="button"
              title={`Show only ${event.correlation}`}
              onClick={(clickEvent) => {
                clickEvent.stopPropagation()
                onCorrelation(event.correlation!)
              }}
              className="mk-mono"
              style={{
                flex: '0 0 auto',
                maxWidth: 120,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                height: 16,
                padding: '0 5px',
                fontSize: 11,
                cursor: 'pointer',
                color: 'var(--mk-text-secondary)',
                background: 'var(--mk-bg-subtle)',
                border: '1px solid var(--mk-border-default)',
                borderRadius: 'var(--mk-radius-sm)',
              }}
            >
              {event.correlation}
            </button>
          )}
        </span>
      </td>
      <td style={{ padding: '4px 8px', textAlign: 'right' }}>
        <StatusCode status={event.status} />
      </td>
      <td
        className="mk-tabular"
        style={{
          padding: '4px 8px',
          textAlign: 'right',
          fontSize: 11,
          whiteSpace: 'nowrap',
          color: 'var(--mk-text-tertiary)',
        }}
      >
        {/*
          An em-dash, not "0ms": rows recorded before the timing column existed, and backends
          that report nothing, genuinely have no number — and "0ms" would read as instant.

          When part of it was a configured delay, say so. A 2,000ms mock is not a performance
          problem when 2,000ms of it is a setting, and that is the single most likely
          misreading of this column on a mock server.
        */}
        {event.durationMs === null ? (
          '—'
        ) : event.addedDelayMs !== null && event.addedDelayMs > 0 ? (
          <span title={`${event.addedDelayMs}ms of this was a delay configured on the stub`}>
            {event.durationMs}ms <span aria-hidden="true">⏱</span>
            <span style={{ position: 'absolute', left: -9999 }}>
              , including {event.addedDelayMs}ms of configured delay
            </span>
          </span>
        ) : (
          `${event.durationMs}ms`
        )}
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
          event.matchedClientKey === null ? (
            <span style={{ fontSize: 12, color: 'var(--mk-text-tertiary)' }}>—</span>
          ) : (
            /*
              Always a link. The key came from the server, so the stub existed; whether we can
              resolve it here depends on how fresh the mirror is, and the mirror goes stale the
              moment anyone changes the corpus outside this tool — an import reissues every id.

              So a key the mirror does not know is a reason to refresh, not a reason to say the
              stub is gone. Clicking refreshes first and then opens it, which resolves the
              common case outright; if it is genuinely deleted, the detail pane says so.
            */
            <IconButton
              icon={ExternalLink}
              variant="quiet"
              label={`Open the stub that answered ${event.method ?? ''} ${event.url ?? ''}`}
              onClick={() =>
                // The resolved key where we have one — after an import that is the stub with the
                // same behaviour, not the id the event recorded. Falling back to the recorded id
                // lets the detail pane give the honest answer when nothing resolved.
                onOpenStub(
                  event.resolvedStubKey ?? event.matchedClientKey!,
                  event.resolvedStubKey === null,
                )
              }
            />
          )
        ) : canExplain ? (
          <IconButton
            icon={HelpCircle}
            variant="quiet"
            onClick={() => onExplain(event.id)}
            // 30 buttons all named the same tell a screen-reader user nothing about which is
            // which, so each carries its own request *and* its time.
            label={`Why didn't ${event.method ?? ''} ${event.url ?? ''} at ${new Date(event.at).toLocaleTimeString()} match?`}
          />
        ) : null}
      </td>
    </tr>
  )
}

export function TrafficScreen({
  profile,
  onOpenStub,
}: {
  profile: Profile
  onOpenStub: (clientKey: string, refreshFirst: boolean) => void
}) {
  const profileId = profile.id
  const baseUrl = profile.baseUrl
  // A backend can record traffic and still have no way to say why something did not match —
  // Mockoon does exactly that. Absent, not disabled (invariant 4).
  const canExplain = (profile.capabilities ?? []).includes('diagnostics.nearMiss')
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  /**
   * Everything but the match state, which keeps its own segmented control because it is the one
   * people reach for constantly. Filtering happens in SQL over the mirror, not in the browser:
   * the count in the footer has to describe the filtered set or paging lies about what is left.
   */
  const [filters, setFilters] = useState<JournalFilters>(NO_FILTERS)
  const narrowed =
    filters.method !== '' ||
    filters.path !== '' ||
    filters.statusClass !== '' ||
    filters.correlation !== ''
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
    queryKey: [
      'events',
      profileId,
      filter,
      filters.method,
      filters.path,
      filters.statusClass,
      filters.correlation,
    ],
    queryFn: () => api.events(profileId, { ...filters, matched: filter }),
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

        <select
          aria-label="Filter by method"
          value={filters.method}
          onChange={(event) => setFilters({ ...filters, method: event.target.value })}
          style={{ ...filterField, flex: '0 0 116px' }}
        >
          <option value="">Any method</option>
          {METHODS.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by status class"
          value={filters.statusClass}
          onChange={(event) => setFilters({ ...filters, statusClass: event.target.value })}
          style={{ ...filterField, flex: '0 0 96px' }}
        >
          <option value="">Any status</option>
          {['2', '3', '4', '5'].map((digit) => (
            <option key={digit} value={digit}>
              {digit}xx
            </option>
          ))}
        </select>

        <input
          aria-label="Filter by path"
          placeholder="Path contains…"
          value={filters.path}
          onChange={(event) => setFilters({ ...filters, path: event.target.value })}
          className="mk-mono"
          style={{ ...filterField, flex: '0 1 200px' }}
        />

        {filters.correlation !== '' && (
          <span
            className="mk-mono"
            title="Showing one request's correlation id"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 26,
              padding: '0 6px',
              fontSize: 12,
              color: 'var(--mk-accent-text)',
              background: 'var(--mk-accent-bg-subtle)',
              border: '1px solid var(--mk-accent-border)',
              borderRadius: 'var(--mk-radius-sm)',
            }}
          >
            {filters.correlation}
          </span>
        )}

        {narrowed && (
          <IconButton
            icon={FilterX}
            variant="quiet"
            label="Clear filters"
            onClick={() => setFilters(NO_FILTERS)}
          />
        )}

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
          <IconButton
            icon={EyeOff}
            variant="quiet"
            label="Clear view — hide what is on screen without touching the server"
            onClick={() => setDismissed(new Set(displayed.map((event) => event.id)))}
          />
        )}
        {hiddenCount > 0 && (
          <IconButton
            icon={Eye}
            variant="quiet"
            label={`Show ${hiddenCount} hidden ${hiddenCount === 1 ? 'request' : 'requests'}`}
            onClick={() => setDismissed(new Set())}
          />
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
              <IconButton
                icon={Trash2}
                variant="danger"
                label="Clear the request journal…"
                onClick={() => setConfirmingClear(true)}
              />
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
              {narrowed
                ? 'No requests match these filters.'
                : hiddenCount > 0
                  ? 'Waiting for the next request.'
                  : 'No requests recorded yet.'}
            </strong>
            {narrowed ? (
              // Distinguished from an empty journal on purpose: "nothing here" and "nothing
              // here that you asked for" send someone to different places. No count here —
              // `total` is the *filtered* total, so it is always zero in this branch and a
              // sentence quoting it would say "0 matching requests match nothing".
              <>
                Widen or clear the filters. The journal itself only reaches back to{' '}
                {journal.data?.window.earliestAt == null
                  ? 'the last reset'
                  : new Date(journal.data.window.earliestAt).toLocaleTimeString()}
                , so an older request would not be here either way.
              </>
            ) : hiddenCount > 0 ? (
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
              {visible.map((event, index) => (
                <Row
                  key={event.id}
                  event={event}
                  focused={event.id === focusedId}
                  // Before anything has been focused the first row is the way in. Without it the
                  // list is unreachable from the keyboard entirely.
                  tabStop={focusedId === null ? index === 0 : event.id === focusedId}
                  onFocus={() => setFocusedId(event.id)}
                  onExplain={setExplaining}
                  canExplain={canExplain}
                  onOpenStub={onOpenStub}
                  onCorrelation={(correlation) =>
                    // Replaces the other filters rather than adding to them: following one
                    // request means seeing all of it, not the part that also matched a path box.
                    setFilters({ ...NO_FILTERS, correlation })
                  }
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
