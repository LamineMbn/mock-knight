import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.js'
import type { Explanation, NearMiss, PredicateResult } from '../api.js'
import { Button, InferenceLabel, MethodChip, Skeleton } from './primitives.js'
import { toCurl } from '../curl.js'
import { CreateFromRequest } from './CreateFromRequest.js'

export interface MatchExplainerProps {
  profileId: string
  eventId: number
  /** The mock server's own base URL, so the copied curl actually points somewhere. */
  baseUrl: string
  onClose: () => void
}

/** The longest shared prefix and suffix, so the middle — the actual difference — can be marked. */
function diffParts(expected: string, actual: string): { head: string; mid: string; tail: string } {
  let head = 0
  while (head < expected.length && head < actual.length && expected[head] === actual[head]) head++
  let tail = 0
  while (
    tail < actual.length - head &&
    tail < expected.length - head &&
    expected[expected.length - 1 - tail] === actual[actual.length - 1 - tail]
  ) {
    tail++
  }
  return {
    head: actual.slice(0, head),
    mid: actual.slice(head, actual.length - tail),
    tail: actual.slice(actual.length - tail),
  }
}

function ActualValue({ predicate }: { predicate: PredicateResult }) {
  if (predicate.actual === null) {
    return <span style={{ color: 'var(--mk-text-tertiary)' }}>absent</span>
  }
  if (predicate.outcome !== 'fail' || predicate.expected === null) {
    return <>{predicate.actual}</>
  }
  const { head, mid, tail } = diffParts(predicate.expected, predicate.actual)
  if (mid === '') return <>{predicate.actual}</>
  return (
    <>
      {head}
      <mark
        style={{
          background: 'var(--mk-diff-del-bg)',
          color: 'var(--mk-diff-del-text)',
          padding: '0 1px',
          borderRadius: 2,
        }}
      >
        {mid}
      </mark>
      {tail}
    </>
  )
}

function OutcomeIcon({ outcome }: { outcome: PredicateResult['outcome'] }) {
  if (outcome === 'fail') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="var(--mk-danger-solid)" />
        <path
          d="M5.5 5.5l5 5M10.5 5.5l-5 5"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (outcome === 'unknown') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
        <circle
          cx="8"
          cy="8"
          r="7"
          fill="none"
          stroke="var(--mk-warning-indicator)"
          strokeWidth="1.6"
        />
        <path
          d="M8 4.6v4.2M8 11.2v.6"
          stroke="var(--mk-warning-indicator)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  // Deliberately grey, not green: passes are context, not news.
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-6.5"
        fill="none"
        stroke="var(--mk-text-tertiary)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PredicateTable({ predicates }: { predicates: PredicateResult[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          {['Field', 'Expected', 'Actual', ''].map((label, index) => (
            <th
              key={label || index}
              scope="col"
              style={{
                textAlign: 'left',
                padding: '4px 8px',
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--mk-text-secondary)',
                borderBottom: '1px solid var(--mk-border-default)',
                width: label === '' ? 28 : undefined,
              }}
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {predicates.map((predicate, index) => {
          const failed = predicate.outcome === 'fail'
          return (
            <tr
              key={`${predicate.field}-${index}`}
              title={predicate.note ?? undefined}
              style={{
                background: failed ? 'var(--mk-danger-bg)' : 'transparent',
                borderBottom: '1px solid var(--mk-border-subtle)',
              }}
            >
              <td
                className="mk-mono"
                style={{
                  padding: '5px 8px',
                  color: failed ? 'var(--mk-danger-text)' : 'var(--mk-text-secondary)',
                }}
              >
                {predicate.field}
              </td>
              <td
                className="mk-mono"
                style={{
                  padding: '5px 8px',
                  color: 'var(--mk-text-secondary)',
                  overflowWrap: 'anywhere',
                }}
              >
                {predicate.expected ?? '—'}
              </td>
              <td
                className="mk-mono"
                style={{
                  padding: '5px 8px',
                  color: failed ? 'var(--mk-danger-text)' : 'var(--mk-text-primary)',
                  overflowWrap: 'anywhere',
                }}
              >
                <ActualValue predicate={predicate} />
              </td>
              <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                {/* Icon plus the row's colour plus a text label in the tooltip: never colour alone. */}
                <span
                  role="img"
                  aria-label={
                    predicate.outcome === 'fail'
                      ? 'failed'
                      : predicate.outcome === 'unknown'
                        ? 'not evaluated'
                        : 'passed'
                  }
                >
                  <OutcomeIcon outcome={predicate.outcome} />
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Candidate({
  miss,
  rank,
  defaultOpen,
}: {
  miss: NearMiss
  rank: number
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  // A bar, not the raw distance. Closest = fullest.
  const fill = Math.max(0.06, 1 - Math.min(1, miss.distance * 4))

  return (
    <section
      style={{
        border: '1px solid var(--mk-border-default)',
        borderRadius: 'var(--mk-radius-md)',
        marginBottom: 8,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '8px 10px',
          background: 'transparent',
          border: 'none',
          font: 'inherit',
          color: 'inherit',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ color: 'var(--mk-text-tertiary)', width: 12 }}>{rank}</span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {miss.stubName ?? <span style={{ color: 'var(--mk-text-tertiary)' }}>unnamed stub</span>}
        </span>
        <span
          aria-hidden="true"
          style={{
            width: 64,
            height: 6,
            borderRadius: 3,
            background: 'var(--mk-bg-subtle)',
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              display: 'block',
              width: `${fill * 100}%`,
              height: '100%',
              background: 'var(--mk-accent-solid)',
            }}
          />
        </span>
        <span
          style={{ width: 96, textAlign: 'right', color: 'var(--mk-text-secondary)', fontSize: 12 }}
        >
          {miss.mismatchCount === 1 ? '1 mismatch' : `${miss.mismatchCount} mismatches`}
          {miss.unknownCount > 0 && ` · ${miss.unknownCount}?`}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 10px 10px' }}>
          <PredicateTable predicates={miss.predicates} />
        </div>
      )}
    </section>
  )
}

export function MatchExplainer({ profileId, eventId, baseUrl, onClose }: MatchExplainerProps) {
  const [copied, setCopied] = useState(false)
  const [creating, setCreating] = useState(false)
  const query = useQuery({
    queryKey: ['explain', profileId, eventId],
    queryFn: () => api.explain(profileId, eventId),
  })

  const closest = query.data?.nearMisses[0]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Why didn't this match?"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgb(16 18 27 / 0.32)',
        display: 'grid',
        placeItems: 'center',
        padding: 32,
        zIndex: 50,
      }}
      /**
       * Only a click on the backdrop itself closes this.
       *
       * `onClick={onClose}` closes on *bubbled* clicks too, which meant every click inside the
       * create-stub dialog rendered below tore this one down under it. Comparing target to
       * currentTarget is the fix; a stopPropagation wrapper only protects children that happen
       * to sit inside it.
       */
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: 'min(1040px, 100%)',
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--mk-bg-raised)',
          border: '1px solid var(--mk-border-strong)',
          borderRadius: 'var(--mk-radius-lg)',
          boxShadow: '0 8px 32px rgb(16 18 27 / 0.14)',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            borderBottom: '1px solid var(--mk-border-default)',
          }}
        >
          <strong style={{ fontSize: 16, fontWeight: 600 }}>Why didn’t this match?</strong>
          <span style={{ flex: 1 }} />
          {query.data !== undefined && (
            <>
              <MethodChip method={query.data.request.method} />
              <span className="mk-mono" style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>
                {query.data.request.url}
              </span>
            </>
          )}
          {query.data !== undefined && (
            /**
             * The primary exit (design brief §6.4 rule 7). Most sessions end in "create a stub
             * from this", so it is the emphasised action rather than one of three equals.
             */
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create stub from this request
            </Button>
          )}
          {query.data !== undefined && (
            <Button
              onClick={() => {
                void navigator.clipboard
                  .writeText(toCurl(query.data.request, baseUrl))
                  .then(() => {
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1600)
                  })
                  .catch(() => setCopied(false))
              }}
            >
              {copied ? 'Copied' : 'Copy as curl'}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </header>

        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          {query.isPending && (
            <div style={{ display: 'grid', gap: 10 }}>
              <Skeleton width="70%" height={20} />
              <Skeleton width="100%" height={90} />
            </div>
          )}

          {query.isError && (
            <div style={{ fontSize: 13 }}>
              <p style={{ margin: '0 0 8px', color: 'var(--mk-danger-text)' }}>
                Mock Knight could not explain this request.
              </p>
              <details style={{ color: 'var(--mk-text-secondary)' }}>
                <summary style={{ cursor: 'pointer' }}>Details</summary>
                <pre className="mk-mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                  {String(query.error)}
                </pre>
              </details>
            </div>
          )}

          {query.data !== undefined && (
            <>
              {/* Rule 1: the sentence is the hero. Most sessions end here. */}
              <div
                style={{
                  padding: '10px 12px',
                  marginBottom: 12,
                  borderRadius: 'var(--mk-radius-md)',
                  background: closest === undefined ? 'var(--mk-bg-subtle)' : 'var(--mk-danger-bg)',
                  border: `1px solid ${closest === undefined ? 'var(--mk-border-default)' : 'var(--mk-danger-border)'}`,
                }}
              >
                <p style={{ margin: 0, fontSize: 14, lineHeight: '22px' }}>
                  {closest === undefined
                    ? 'No candidate stubs were close enough to compare.'
                    : summaryFor(closest)}
                </p>
                {closest !== undefined && (
                  <div style={{ marginTop: 6 }}>
                    <InferenceLabel title="WireMock ranks the candidates and scores how close each one is, but it does not report which predicate failed — that comparison is Mock Knight's own.">
                      candidates ranked by the server · field comparison computed by Mock Knight
                    </InferenceLabel>
                  </div>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  marginBottom: 6,
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: 'var(--mk-text-secondary)',
                }}
              >
                Candidate stubs
                <span
                  style={{
                    textTransform: 'none',
                    letterSpacing: 0,
                    color: 'var(--mk-text-tertiary)',
                  }}
                >
                  {query.data.candidatesConsidered} near{' '}
                  {query.data.candidatesConsidered === 1 ? 'miss' : 'misses'}
                </span>
              </div>

              {query.data.nearMisses.map((miss, index) => (
                <Candidate
                  key={miss.clientKey ?? index}
                  miss={miss}
                  rank={index + 1}
                  defaultOpen={index === 0}
                />
              ))}
            </>
          )}
        </div>
      </div>
      {creating && (
        <CreateFromRequest
          profileId={profileId}
          eventId={eventId}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            onClose()
          }}
        />
      )}
    </div>
  )
}

/** The one-sentence callout, written from the closest candidate's failing predicates. */
function summaryFor(miss: NearMiss): string {
  const failures = miss.predicates.filter((p) => p.outcome === 'fail')
  if (failures.length === 0) {
    return miss.unknownCount > 0
      ? `Every predicate Mock Knight could evaluate matches; ${miss.unknownCount} could not be checked.`
      : 'Every predicate on the closest stub matches — the difference is elsewhere.'
  }
  if (failures.length === 1) {
    const only = failures[0]!
    const name = only.field.startsWith('headers.')
      ? `header ${only.field.slice('headers.'.length)}`
      : only.field
    return `Closest stub differs on one ${name}: expected “${only.expected ?? '—'}”, got “${only.actual ?? 'nothing'}”.`
  }
  return `Closest stub differs on ${failures.length} predicates: ${failures.map((f) => f.field).join(', ')}.`
}
