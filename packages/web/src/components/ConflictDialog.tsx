import { useMemo, useState } from 'react'
import { resolveConflict, threeWayMerge } from '@mock-knight/core/types'
import type { JsonObject, MergeConflict } from '@mock-knight/core/types'
import { Button, Chip } from './primitives.js'

/**
 * Conflict resolution — design brief §6.8.
 *
 * The copy carries the surprise. Nobody expects a merge dialog in a mock tool, so the header
 * says what happened in one sentence before showing anything: *"This stub changed on staging
 * while you were editing it."*
 *
 * Most of the work is deciding what **not** to ask. Two people editing one stub have usually
 * touched different fields, and those merge silently — the dialog exists for the fields they
 * both moved. A dialog listing forty rows when the real disagreement is one status code is a
 * dialog people learn to click through without reading.
 */

export interface ConflictDialogProps {
  profileName: string
  /** What the editor loaded. */
  base: JsonObject
  /** What the server holds now. */
  theirs: JsonObject
  /** What the user typed. */
  mine: JsonObject
  onCancel: () => void
  onResolve: (merged: JsonObject) => void
  saving: boolean
}

function preview(value: unknown, removed: boolean): string {
  if (removed) return '(removed)'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function Side({
  label,
  value,
  removed,
  chosen,
  onChoose,
  tone,
}: {
  label: string
  value: unknown
  removed: boolean
  chosen: boolean
  onChoose: () => void
  tone: 'theirs' | 'mine'
}) {
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={chosen}
      style={{
        flex: 1,
        minWidth: 0,
        textAlign: 'left',
        padding: '6px 8px',
        font: 'inherit',
        cursor: 'pointer',
        borderRadius: 'var(--mk-radius-sm)',
        border: `1px solid ${chosen ? 'var(--mk-accent-solid)' : 'var(--mk-border-default)'}`,
        background: chosen ? 'var(--mk-accent-bg-subtle)' : 'var(--mk-bg-surface)',
      }}
    >
      <span
        style={{
          display: 'block',
          fontSize: 11,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: chosen ? 'var(--mk-accent-text)' : 'var(--mk-text-secondary)',
          marginBottom: 2,
        }}
      >
        {label}
        {chosen && ' ✓'}
      </span>
      <span
        className="mk-mono"
        style={{
          display: 'block',
          fontSize: 12,
          overflowWrap: 'anywhere',
          color: removed ? 'var(--mk-text-tertiary)' : 'var(--mk-text-primary)',
          fontStyle: removed ? 'italic' : 'normal',
        }}
        data-side={tone}
      >
        {preview(value, removed)}
      </span>
    </button>
  )
}

export function ConflictDialog({
  profileName,
  base,
  theirs,
  mine,
  onCancel,
  onResolve,
  saving,
}: ConflictDialogProps) {
  const merge = useMemo(() => threeWayMerge(base, theirs, mine), [base, theirs, mine])
  // Unresolved defaults to the server's value, so abandoning the dialog cannot discard someone
  // else's work by inaction.
  const [choices, setChoices] = useState<Record<string, 'mine' | 'theirs'>>({})

  const resolved = useMemo(() => {
    let document = merge.merged
    for (const conflict of merge.conflicts) {
      const choice = choices[conflict.path]
      if (choice !== undefined) document = resolveConflict(document, conflict, choice)
    }
    return document
  }, [merge, choices])

  const autoMerged = merge.takenFromMine.length + merge.takenFromTheirs.length
  const undecided = merge.conflicts.filter((c) => choices[c.path] === undefined).length

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Resolve conflicting edits"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--mk-scrim)',
        display: 'grid',
        placeItems: 'center',
        padding: 32,
        zIndex: 60,
      }}
    >
      <div
        style={{
          width: 'min(980px, 100%)',
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--mk-bg-raised)',
          border: '1px solid var(--mk-border-strong)',
          borderRadius: 'var(--mk-radius-lg)',
          boxShadow: 'var(--mk-shadow-modal)',
          overflow: 'hidden',
        }}
      >
        <header
          style={{ padding: '12px 14px', borderBottom: '1px solid var(--mk-border-default)' }}
        >
          <strong style={{ fontSize: 16, fontWeight: 600, display: 'block' }}>
            This stub changed on {profileName} while you were editing it.
          </strong>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--mk-text-secondary)' }}>
            {merge.conflicts.length === 0
              ? 'Your changes and theirs touch different fields, so they combine cleanly.'
              : `${merge.conflicts.length} ${merge.conflicts.length === 1 ? 'field was' : 'fields were'} changed by both of you. Pick a value for each.`}
            {autoMerged > 0 &&
              ` ${autoMerged} other ${autoMerged === 1 ? 'change' : 'changes'} merged automatically.`}
          </p>
        </header>

        <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          {merge.conflicts.map((conflict: MergeConflict) => (
            <section key={conflict.path} style={{ marginBottom: 14 }}>
              <div
                className="mk-mono"
                style={{ fontSize: 12, marginBottom: 4, color: 'var(--mk-text-primary)' }}
              >
                {conflict.path}
                <span style={{ marginLeft: 8 }}>
                  <Chip title="What you loaded before editing">
                    was {preview(conflict.base, conflict.base === null)}
                  </Chip>
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Side
                  label={`On ${profileName}`}
                  value={conflict.theirs}
                  removed={conflict.theirsRemoved}
                  chosen={(choices[conflict.path] ?? 'theirs') === 'theirs'}
                  onChoose={() => setChoices((c) => ({ ...c, [conflict.path]: 'theirs' }))}
                  tone="theirs"
                />
                <Side
                  label="Your edit"
                  value={conflict.mine}
                  removed={conflict.mineRemoved}
                  chosen={choices[conflict.path] === 'mine'}
                  onChoose={() => setChoices((c) => ({ ...c, [conflict.path]: 'mine' }))}
                  tone="mine"
                />
              </div>
            </section>
          ))}

          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--mk-text-secondary)' }}>
              Preview the document that will be saved
            </summary>
            <pre
              className="mk-mono"
              data-testid="merge-preview"
              style={{
                marginTop: 8,
                padding: 10,
                fontSize: 12,
                background: 'var(--mk-code-bg)',
                border: '1px solid var(--mk-border-subtle)',
                borderRadius: 'var(--mk-radius-md)',
                overflow: 'auto',
                maxHeight: 260,
              }}
            >
              {JSON.stringify(resolved, null, 2)}
            </pre>
          </details>
        </div>

        <footer
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderTop: '1px solid var(--mk-border-default)',
          }}
        >
          <span style={{ flex: 1, fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
            {undecided > 0
              ? `${undecided} still on the server’s value`
              : 'Every conflict has a choice'}
          </span>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => onResolve(resolved)}>
            {saving ? 'Saving…' : 'Save merged'}
          </Button>
        </footer>
      </div>
    </div>
  )
}
