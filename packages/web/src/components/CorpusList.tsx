import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { CSSProperties } from 'react'
import type { MockListItem } from '../api.js'
import {
  Chip,
  MethodChip,
  MiddleEllipsis,
  PriorityCell,
  Skeleton,
  StatusCode,
  priorityLabel,
} from './primitives.js'

/**
 * The stub list — design brief §6.2.
 *
 * **Never animated.** At 10,000 rows an entry, reorder, or selection transition drops frames,
 * and a list that stutters makes the whole tool feel slow; selection is a synchronous state
 * change with no transition at all.
 *
 * *Deviation from the brief, deliberately:* §8 asks for "a real `table`, not a div grid".
 * Virtualisation needs rows absolutely positioned inside a container of known height, which a
 * table's layout algorithm cannot provide — and a `<table>` whose sections are all forced to
 * `display: block` is no longer a table to the accessibility tree anyway, so it buys the
 * semantics in name only. This is an explicit ARIA grid instead: `role="grid"` with
 * `aria-rowcount`/`aria-rowindex` reporting the *full* result set, so a screen reader announces
 * "row 412 of 1,284" even though only ~30 rows exist in the DOM. That is strictly more accurate
 * than a table which would claim the corpus is 30 rows long.
 */

const ROW_HEIGHT = 32
/** Matches the selected row's stripe, so headers sit over their columns. */
const STRIPE_WIDTH = 3

interface Column {
  key: string
  label: string
  /** Fixed px, or `flex` for the one column that absorbs the remaining space. */
  width: number | 'flex'
}

/**
 * The header column is conditional rather than user-toggled-off-by-default.
 *
 * Where a team selects stubs by header, the header value *is* the stub's identity and a list
 * without it shows rows that are indistinguishable. Where no stub matches on a header, the
 * column would be 180px of nothing. So it appears exactly when the result set uses one.
 */
function columnsFor(showHeader: boolean): Column[] {
  return [
    { key: 'method', label: 'Method', width: 72 },
    { key: 'path', label: 'Path', width: 'flex' },
    ...(showHeader ? [{ key: 'header', label: 'Header', width: 240 } as Column] : []),
    { key: 'status', label: 'Status', width: 56 },
    { key: 'priority', label: 'Priority', width: 104 },
    { key: 'scenario', label: 'Scenario', width: 112 },
    { key: 'served', label: 'Last served', width: 96 },
  ]
}

/**
 * Look a column up by name.
 *
 * The cells used to index this array positionally, which meant the Header column being
 * conditional had every later cell written as `COLUMNS[showHeaderColumn ? 4 : 3]`. Adding a
 * column renumbered all of them, and getting one wrong misaligns a cell from its header
 * silently — the row still renders, just under the wrong heading.
 */
function columnLookup(columns: Column[]): (key: string) => Column {
  const byKey = new Map(columns.map((column) => [column.key, column]))
  return (key) => {
    const found = byKey.get(key)
    if (found === undefined) throw new Error(`No such column: ${key}`)
    return found
  }
}

function cellStyle(column: Column): CSSProperties {
  return {
    ...(column.width === 'flex'
      ? { flex: '1 1 auto', minWidth: 0 }
      : { flex: `0 0 ${column.width}px` }),
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 8px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  }
}

/** One matcher rendered compactly; the name and operator live in the tooltip. */
function HeaderCell({ headers }: { headers: MockListItem['headers'] }) {
  if (headers.length === 0) return <span style={{ color: 'var(--mk-text-tertiary)' }}>—</span>
  const first = headers[0]!
  const describe = headers
    .map((h) => `${h.name} ${h.operator}${h.value === null ? '' : ` ${h.value}`}`)
    .join('\n')
  return (
    <>
      <MiddleEllipsis
        text={first.value ?? `${first.name} ${first.operator}`}
        title={describe}
        tailChars={10}
      />
      {headers.length > 1 && (
        <Chip tone="neutral" title={describe}>
          +{headers.length - 1}
        </Chip>
      )}
    </>
  )
}

export interface CorpusListProps {
  items: MockListItem[]
  /** The full result-set size, which may exceed what is loaded. Announced to assistive tech. */
  total: number
  selectedKey: string | null
  onSelect: (clientKey: string) => void
  loading: boolean
  emptyMessage: React.ReactNode
  /** Show the Header column — true when anything in the corpus matches on a header. */
  showHeaderColumn: boolean
}

export function CorpusList({
  items,
  total,
  selectedKey,
  onSelect,
  loading,
  emptyMessage,
  showHeaderColumn,
}: CorpusListProps) {
  const COLUMNS = columnsFor(showHeaderColumn)
  const col = columnLookup(COLUMNS)
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  return (
    <div
      role="grid"
      aria-label="Stubs in this corpus"
      aria-rowcount={total}
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <div
        role="row"
        style={{
          display: 'flex',
          height: 26,
          alignItems: 'center',
          paddingLeft: STRIPE_WIDTH,
          background: 'var(--mk-bg-surface)',
          borderBottom: '1px solid var(--mk-border-default)',
        }}
      >
        {COLUMNS.map((column) => (
          <span
            key={column.key}
            role="columnheader"
            style={{
              ...cellStyle(column),
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--mk-text-secondary)',
            }}
          >
            {column.label}
          </span>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: '8px 11px', display: 'grid', gap: 14 }}>
          {/* Skeletons match the real row rhythm, so nothing shifts on arrival. */}
          {Array.from({ length: 10 }, (_, index) => (
            <div key={index} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Skeleton width={56} height={18} />
              <Skeleton width={`${30 + ((index * 7) % 40)}%`} />
              <Skeleton width={28} />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div
          style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--mk-text-secondary)' }}
        >
          {emptyMessage}
        </div>
      ) : (
        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <div style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index]!
              const selected = item.clientKey === selectedKey
              return (
                <div
                  key={item.clientKey}
                  role="row"
                  aria-rowindex={virtualRow.index + 1}
                  aria-selected={selected}
                  tabIndex={0}
                  onClick={() => onSelect(item.clientKey)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(item.clientKey)
                    }
                  }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    display: 'flex',
                    alignItems: 'center',
                    transform: `translateY(${virtualRow.start}px)`,
                    background: selected ? 'var(--mk-bg-emphasis)' : 'transparent',
                    borderBottom: '1px solid var(--mk-border-subtle)',
                    borderLeft: `${STRIPE_WIDTH}px solid ${
                      selected ? 'var(--mk-accent-solid)' : 'transparent'
                    }`,
                    cursor: 'pointer',
                  }}
                >
                  <span role="gridcell" style={cellStyle(col('method'))}>
                    <MethodChip method={item.method} />
                  </span>
                  <span
                    role="gridcell"
                    className="mk-mono"
                    style={{ ...cellStyle(col('path')), fontSize: 12 }}
                  >
                    <MiddleEllipsis text={item.url?.value ?? item.name ?? '—'} tailChars={16} />
                    {item.isProxy && (
                      <Chip tone="neutral" title="Proxies to another server">
                        proxy
                      </Chip>
                    )}
                    {item.hasFault && (
                      <Chip tone="warning" title="Injects a connection fault">
                        fault
                      </Chip>
                    )}
                    {item.hasDelay && (
                      <Chip tone="neutral" title="Responds after a delay">
                        delay
                      </Chip>
                    )}
                  </span>
                  {showHeaderColumn && (
                    <span
                      role="gridcell"
                      className="mk-mono"
                      style={{ ...cellStyle(col('header')), fontSize: 12 }}
                    >
                      <HeaderCell headers={item.headers} />
                    </span>
                  )}
                  <span role="gridcell" style={cellStyle(col('status'))}>
                    <StatusCode status={item.status} />
                  </span>
                  <span
                    role="gridcell"
                    style={cellStyle(col('priority'))}
                    aria-label={priorityLabel(item.standing)}
                  >
                    <PriorityCell standing={item.standing} />
                  </span>
                  <span role="gridcell" style={cellStyle(col('scenario'))}>
                    {item.scenario !== null && (
                      <Chip tone="accent" title={`Scenario: ${item.scenario}`}>
                        <MiddleEllipsis text={item.scenario} tailChars={5} />
                      </Chip>
                    )}
                  </span>
                  <span
                    role="gridcell"
                    className="mk-tabular"
                    style={{
                      ...cellStyle(col('served')),
                      color: 'var(--mk-text-tertiary)',
                      fontSize: 12,
                    }}
                  >
                    {/* An em-dash, not "never": the journal is bounded and resettable, so we
                        only know we have not seen it serve — not that it never has. */}
                    {item.lastServedAt ?? '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
