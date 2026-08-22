import type { FacetBucket, Facets } from '../api.js'

/**
 * The facet sidebar — design brief §6.2.
 *
 * Counts come from the BFF's `GROUP BY`, and each group's counts exclude that group's own
 * filter, so ticking one method still shows what the others would add. A facet with a zero
 * count is dimmed but still shown: its absence is information.
 */

export interface FacetPaneProps {
  facets: Facets | undefined
  active: ReadonlySet<string>
  onToggle: (token: string) => void
}

function Group({
  title,
  buckets,
  tokenFor,
  active,
  onToggle,
}: {
  title: string
  buckets: FacetBucket[]
  tokenFor: (bucket: FacetBucket) => string
  active: ReadonlySet<string>
  onToggle: (token: string) => void
}) {
  if (buckets.length === 0) return null
  return (
    <section style={{ marginBottom: 20 }}>
      <h2
        style={{
          margin: '0 0 6px',
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--mk-text-secondary)',
        }}
      >
        {title}
      </h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {buckets.map((bucket) => {
          const token = tokenFor(bucket)
          const checked = active.has(token)
          return (
            <li key={token}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 24,
                  padding: '0 4px',
                  borderRadius: 'var(--mk-radius-sm)',
                  cursor: 'pointer',
                  opacity: bucket.count === 0 ? 0.45 : 1,
                  background: checked ? 'var(--mk-accent-bg-subtle)' : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(token)}
                  style={{ accentColor: 'var(--mk-accent-solid)', margin: 0 }}
                />
                <span
                  style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {bucket.value}
                </span>
                <span
                  className="mk-tabular"
                  style={{ color: 'var(--mk-text-tertiary)', fontSize: 12 }}
                >
                  {bucket.count}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function FacetPane({ facets, active, onToggle }: FacetPaneProps) {
  if (facets === undefined) return null
  return (
    <nav
      aria-label="Filters"
      style={{
        width: 240,
        flex: '0 0 240px',
        borderRight: '1px solid var(--mk-border-default)',
        background: 'var(--mk-bg-surface)',
        overflowY: 'auto',
        padding: '12px 10px',
      }}
    >
      <Group
        title="Folders"
        buckets={facets.folder}
        tokenFor={(bucket) => `folder:${bucket.value}`}
        active={active}
        onToggle={onToggle}
      />
      <Group
        title="Method"
        buckets={facets.method}
        tokenFor={(bucket) => `method:${bucket.value}`}
        active={active}
        onToggle={onToggle}
      />
      <Group
        title="Status"
        buckets={facets.statusClass}
        tokenFor={(bucket) => `status:${bucket.value}`}
        active={active}
        onToggle={onToggle}
      />
      <Group
        title="Scenario"
        buckets={facets.scenario}
        tokenFor={(bucket) => `scenario:${bucket.value}`}
        active={active}
        onToggle={onToggle}
      />
      <Group
        title="Tag"
        buckets={facets.tag}
        tokenFor={(bucket) => `tag:${bucket.value}`}
        active={active}
        onToggle={onToggle}
      />
    </nav>
  )
}
