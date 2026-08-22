import type { FacetBucket, Facets } from '../api.js'
import { FolderTree } from './FolderTree.js'
import { MiddleEllipsis } from './primitives.js'

/**
 * The facet sidebar — design brief §6.2.
 *
 * Counts come from the BFF's `GROUP BY`, and each group's counts exclude that group's own
 * filter, so ticking one method still shows what the others would add. A facet with a zero
 * count is dimmed but still shown: its absence is information.
 *
 * Two things here are load-bearing against a real corpus rather than a demo one:
 *
 *  - **The folder facet renders as a tree**, not a flat list of full paths. Real folder paths
 *    run to 70 characters and six levels deep; flat, they are an unreadable wall in a 240px
 *    pane.
 *  - **No row has a fixed height, and every label is nowrap.** `text-overflow: ellipsis` does
 *    nothing without `white-space: nowrap`, so a long label wrapped — and inside a fixed-height
 *    row, wrapped text overlaps the row beneath it. Both halves of that bug are prevented here.
 */

export interface FacetPaneProps {
  facets: Facets | undefined
  active: ReadonlySet<string>
  onToggle: (tokens: string[]) => void
  /** Owned by the screen so it survives the refetch that selecting a folder triggers. */
  expandedFolders: ReadonlySet<string>
  onExpandedFoldersChange: (next: ReadonlySet<string>) => void
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h2
        style={{
          margin: '0 0 4px',
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--mk-text-secondary)',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  )
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
  onToggle: (tokens: string[]) => void
}) {
  if (buckets.length === 0) return null
  return (
    <Section title={title}>
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
                  // Free to grow, so a long value can never overlap the row below it.
                  minHeight: 24,
                  padding: '3px 4px',
                  borderRadius: 'var(--mk-radius-sm)',
                  cursor: 'pointer',
                  opacity: bucket.count === 0 ? 0.45 : 1,
                  background: checked ? 'var(--mk-accent-bg-subtle)' : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle([token])}
                  style={{ accentColor: 'var(--mk-accent-solid)', margin: 0, flex: '0 0 auto' }}
                />
                <MiddleEllipsis text={bucket.value} />
                <span
                  className="mk-tabular"
                  style={{ flex: '0 0 auto', color: 'var(--mk-text-tertiary)', fontSize: 12 }}
                >
                  {bucket.count}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

export function FacetPane({
  facets,
  active,
  onToggle,
  expandedFolders,
  onExpandedFoldersChange,
}: FacetPaneProps) {
  if (facets === undefined) return null

  return (
    <nav
      aria-label="Filters"
      style={{
        width: 240,
        flex: '0 0 240px',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--mk-border-default)',
        background: 'var(--mk-bg-surface)',
      }}
    >
      {facets.folder.length > 0 && (
        <div
          style={{
            // The tree scrolls independently (design brief §6.2) and is capped, so a corpus
            // with a hundred folders cannot push Method and Status off the bottom of the pane.
            flex: '0 1 auto',
            maxHeight: '42%',
            overflowY: 'auto',
            padding: '12px 10px 0',
            borderBottom: '1px solid var(--mk-border-subtle)',
          }}
        >
          <Section title="Folders">
            <FolderTree
              buckets={facets.folder}
              active={active}
              onToggle={onToggle}
              expanded={expandedFolders}
              onExpandedChange={onExpandedFoldersChange}
            />
          </Section>
        </div>
      )}

      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '12px 10px' }}>
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
      </div>
    </nav>
  )
}
