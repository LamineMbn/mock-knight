import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.js'
import type { ServeEventRow } from '../api.js'
import { MatchExplainer } from './MatchExplainer.js'
import { Button, MethodChip, MiddleEllipsis, Skeleton, StatusCode } from './primitives.js'

/**
 * The traffic log — design brief §6.5.
 *
 * Match state is triple-encoded, always: a 3px row stripe, a filled icon, and a text label.
 * Green/red is the pair 8% of men cannot separate, and it is this product's core signal.
 *
 * For an unmatched row the matched-stub cell becomes the primary call to action — **Why?** —
 * because that click is the reason the screen exists.
 */

type Filter = 'all' | 'matched' | 'unmatched'

function relative(at: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3600)}h ago`
}

function Row({ event, onExplain }: { event: ServeEventRow; onExplain: (id: number) => void }) {
  const stripe = event.matched ? 'var(--mk-success-solid)' : 'var(--mk-danger-solid)'
  return (
    <tr
      style={{
        borderBottom: '1px solid var(--mk-border-subtle)',
        background: event.matched
          ? 'transparent'
          : 'color-mix(in srgb, var(--mk-danger-bg) 45%, transparent)',
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
      <td style={{ padding: '4px 8px', width: 92, textAlign: 'right' }}>
        {event.matched ? (
          <span style={{ fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
            {event.matchedClientKey === null ? '—' : 'stub ↗'}
          </span>
        ) : (
          <Button variant="primary" onClick={() => onExplain(event.id)}>
            Why?
          </Button>
        )}
      </td>
    </tr>
  )
}

export function TrafficScreen({ profileId, baseUrl }: { profileId: string; baseUrl: string }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [explaining, setExplaining] = useState<number | null>(null)

  const journal = useQuery({
    queryKey: ['events', profileId, filter],
    queryFn: () => api.events(profileId, filter),
    // Polling, because WireMock has no push channel. Paused when the tab is hidden so a
    // background window does not keep hammering the server we are here to debug.
    refetchInterval: () => (document.visibilityState === 'visible' ? 2_000 : false),
  })

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
        <span style={{ flex: 1 }} />
        {journal.data?.window.earliestAt != null && (
          <span style={{ fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
            {/* Bounded truth: never a claim about all time. */}
            journal reaches back to {new Date(journal.data.window.earliestAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {journal.isPending ? (
          <div style={{ padding: 12, display: 'grid', gap: 14 }}>
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} width={`${40 + ((index * 11) % 50)}%`} />
            ))}
          </div>
        ) : journal.data === undefined || journal.data.items.length === 0 ? (
          <div
            style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--mk-text-secondary)' }}
          >
            <strong style={{ display: 'block', fontSize: 16, marginBottom: 6 }}>
              No requests recorded yet.
            </strong>
            Send a request to <code className="mk-mono">{baseUrl}</code> and it will appear here.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <caption style={{ position: 'absolute', left: -9999 }}>
              Requests this server has served
            </caption>
            <tbody>
              {journal.data.items.map((event) => (
                <Row key={event.id} event={event} onExplain={setExplaining} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {explaining !== null && (
        <MatchExplainer
          profileId={profileId}
          eventId={explaining}
          onClose={() => setExplaining(null)}
        />
      )}
    </main>
  )
}
