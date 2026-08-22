import { useEffect, useMemo, useRef } from 'react'
import type { FacetBucket } from '../api.js'
import { MiddleEllipsis } from './primitives.js'

/**
 * The folder tree — FR-FIND-5, design brief §6.2.
 *
 * The facet API returns one bucket per *full* folder path. Rendering those flat does not
 * survive contact with a real corpus: 33 paths up to 69 characters in a 240px pane is an
 * unreadable wall. A tree shows one path **segment** per row, so row width stops depending on
 * folder depth, and it restores the structure the paths already encode.
 *
 * Counts aggregate up the tree: a parent's number is every stub beneath it, not just the ones
 * sitting directly in it — which is what makes the top level a useful summary of the corpus.
 *
 * Expansion state is **owned by the parent**, not held here. It has to outlive this component:
 * selecting a folder changes the query, which refetches, which would otherwise remount the tree
 * and throw away everything the user had opened.
 */

interface TreeNode {
  segment: string
  /** Full '/'-joined path, which is what the `folder:` token filters on. */
  path: string
  /** Stubs anywhere beneath this node, including in it. */
  total: number
  /** Stubs filed exactly here. A node can have both its own stubs and children. */
  own: number
  children: TreeNode[]
}

function buildTree(buckets: FacetBucket[]): TreeNode[] {
  const roots: TreeNode[] = []

  for (const bucket of buckets) {
    const segments = bucket.value.split('/').filter((segment) => segment.length > 0)
    if (segments.length === 0) continue

    let level = roots
    let path = ''
    segments.forEach((segment, index) => {
      path = path === '' ? segment : `${path}/${segment}`
      let node = level.find((candidate) => candidate.segment === segment)
      if (node === undefined) {
        node = { segment, path, total: 0, own: 0, children: [] }
        level.push(node)
      }
      node.total += bucket.count
      if (index === segments.length - 1) node.own += bucket.count
      level = node.children
    })
  }

  const sort = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => b.total - a.total || a.segment.localeCompare(b.segment))
    for (const node of nodes) sort(node.children)
  }
  sort(roots)
  return roots
}

/**
 * Tokens that select this node's subtree.
 *
 * A branch needs two, because `folder:` matches the stored path exactly: one for stubs filed
 * directly in the node, one glob for everything under it. A single `folder:orders*` would be
 * wrong — it would also swallow `orders-legacy`.
 */
export function folderTokensFor(path: string, hasChildren: boolean): string[] {
  return hasChildren ? [`folder:${path}`, `folder:${path}/*`] : [`folder:${path}`]
}

type Selection = 'on' | 'off' | 'partial'

function selectionOf(node: TreeNode, active: ReadonlySet<string>): Selection {
  const tokens = folderTokensFor(node.path, node.children.length > 0)
  if (tokens.every((token) => active.has(token))) return 'on'
  // A parent whose descendant is selected must not look unselected: otherwise a filter is in
  // force with nothing on screen to say where it came from.
  const anyDescendant = (candidate: TreeNode): boolean =>
    candidate.children.some((child) => selectionOf(child, active) !== 'off' || anyDescendant(child))
  return anyDescendant(node) ? 'partial' : 'off'
}

/** Every ancestor path of a selected node, so the selection can be revealed rather than hidden. */
function ancestorsOfSelected(nodes: TreeNode[], active: ReadonlySet<string>): string[] {
  const out: string[] = []
  const walk = (node: TreeNode): boolean => {
    const selfOn = folderTokensFor(node.path, node.children.length > 0).every((token) =>
      active.has(token),
    )
    let childSelected = false
    for (const child of node.children) if (walk(child)) childSelected = true
    if (childSelected) out.push(node.path)
    return selfOn || childSelected
  }
  for (const node of nodes) walk(node)
  return out
}

/** React has no prop for the indeterminate state; it can only be set on the DOM node. */
function TriStateCheckbox({
  selection,
  onChange,
  label,
}: {
  selection: Selection
  onChange: () => void
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = selection === 'partial'
  }, [selection])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={selection === 'on'}
      aria-checked={selection === 'partial' ? 'mixed' : selection === 'on'}
      aria-label={label}
      onChange={onChange}
      style={{ accentColor: 'var(--mk-accent-solid)', margin: 0, flex: '0 0 auto' }}
    />
  )
}

export interface FolderTreeProps {
  buckets: FacetBucket[]
  active: ReadonlySet<string>
  onToggle: (tokens: string[]) => void
  expanded: ReadonlySet<string>
  onExpandedChange: (next: ReadonlySet<string>) => void
}

export function FolderTree({
  buckets,
  active,
  onToggle,
  expanded,
  onExpandedChange,
}: FolderTreeProps) {
  const roots = useMemo(() => buildTree(buckets), [buckets])

  // Reveal a selection made anywhere in the tree, including one restored from a pasted URL.
  const needed = useMemo(() => ancestorsOfSelected(roots, active), [roots, active])
  useEffect(() => {
    const missing = needed.filter((path) => !expanded.has(path))
    if (missing.length === 0) return
    onExpandedChange(new Set([...expanded, ...missing]))
  }, [needed, expanded, onExpandedChange])

  if (roots.length === 0) return null

  const toggleExpanded = (path: string) => {
    const next = new Set(expanded)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    onExpandedChange(next)
  }

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0
    const selection = selectionOf(node, active)
    const isOpen = expanded.has(node.path)

    return (
      <li key={node.path} role="none">
        <div
          role="treeitem"
          aria-expanded={hasChildren ? isOpen : undefined}
          aria-selected={selection === 'on'}
          aria-level={depth + 1}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            // Not a fixed height: a row must be free to be its natural height so that nothing
            // can ever overlap the row beneath it, whatever the label turns out to be.
            minHeight: 24,
            paddingLeft: depth * 12,
            borderRadius: 'var(--mk-radius-sm)',
            background: selection === 'on' ? 'var(--mk-accent-bg-subtle)' : 'transparent',
          }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleExpanded(node.path)}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.path}`}
              style={{
                flex: '0 0 16px',
                width: 16,
                height: 16,
                display: 'grid',
                placeItems: 'center',
                padding: 0,
                border: 'none',
                background: 'transparent',
                color: 'var(--mk-text-tertiary)',
                cursor: 'pointer',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d={isOpen ? 'M3 6l5 5 5-5' : 'M6 3l5 5-5 5'}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : (
            <span style={{ flex: '0 0 16px' }} />
          )}

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flex: 1,
              minWidth: 0,
              padding: '3px 4px 3px 0',
              cursor: 'pointer',
            }}
          >
            <TriStateCheckbox
              selection={selection}
              label={`Filter to ${node.path}`}
              onChange={() => onToggle(folderTokensFor(node.path, hasChildren))}
            />
            <MiddleEllipsis text={node.segment} title={node.path} />
            <span
              className="mk-tabular"
              style={{ flex: '0 0 auto', color: 'var(--mk-text-tertiary)', fontSize: 12 }}
            >
              {node.total}
            </span>
          </label>
        </div>

        {hasChildren && isOpen && (
          <ul role="group" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <ul role="tree" aria-label="Folders" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {roots.map((root) => renderNode(root, 0))}
    </ul>
  )
}
