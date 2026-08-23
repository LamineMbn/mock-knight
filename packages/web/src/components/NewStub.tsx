import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { blankMockDraft } from '@mock-knight/core/types'
import type { MockDraft } from '@mock-knight/core/types'
import { api } from '../api.js'
import { MatcherForm } from './MatcherForm.js'
import { ResponseForm } from './ResponseForm.js'
import { Button, ErrorDisclosure, toFailure } from './primitives.js'
import type { Failure } from './primitives.js'

/**
 * Writing a stub by hand, and copying one — FR-EDIT-5, FR-EDIT-7.
 *
 * Before this the only route to a new stub was capturing an unmatched request, which made an
 * empty server a dead end: the corpus said "This server has no stubs yet" and offered no way to
 * change that.
 *
 * The same two forms the detail pane uses, over a draft with no server behind it yet. Sending
 * the draft rather than vendor JSON is what lets a duplicate keep the fields the canonical
 * model does not understand — the copy carries the original's `raw` with the vendor's own
 * identifiers stripped, so it is a copy rather than a lossy reconstruction.
 */

type Tab = 'matcher' | 'response'

export function NewStub({
  profileId,
  /** A stub being copied, or `undefined` to start from the blank template. */
  source,
  onClose,
  onCreated,
}: {
  profileId: string
  source?: MockDraft
  onClose: () => void
  onCreated: (clientKey: string) => void
}) {
  const duplicating = source !== undefined
  const [draft, setDraft] = useState<MockDraft>(() => source ?? blankMockDraft())
  const [tab, setTab] = useState<Tab>('matcher')
  const [error, setError] = useState<Failure | null>(null)
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: async () => {
      const body = draft.response.body
      if (body.kind === 'json' && typeof body.value === 'string') {
        // Held as text while typing; it has to be a document before it is sent, or the stub
        // serves valid JSON of the wrong shape.
        try {
          return api.createMockDraft(profileId, {
            ...draft,
            response: { ...draft.response, body: { kind: 'json', value: JSON.parse(body.value) } },
          })
        } catch {
          throw new Error('The response body is not valid JSON, so nothing was sent.')
        }
      }
      return api.createMockDraft(profileId, draft)
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['corpus'] })
      onCreated(result.mock.clientKey)
    },
    onError: (caught: unknown) => setError(toFailure(caught, 'The stub could not be created.')),
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={duplicating ? 'Duplicate this stub' : 'New stub'}
      onClick={(event) => {
        // Only a click on the scrim itself, never one that bubbled from a control inside.
        if (event.target === event.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--mk-scrim)',
        display: 'grid',
        placeItems: 'center',
        padding: 32,
        zIndex: 70,
      }}
    >
      <div
        style={{
          width: 'min(880px, 100%)',
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
          <strong style={{ fontSize: 16, fontWeight: 600 }}>
            {duplicating ? 'Duplicate this stub' : 'New stub'}
          </strong>
        </header>

        {duplicating && (
          <p
            role="status"
            style={{
              margin: 0,
              padding: '8px 14px',
              fontSize: 12,
              color: 'var(--mk-warning-text)',
              background: 'var(--mk-warning-bg)',
              borderBottom: '1px solid var(--mk-warning-border)',
            }}
          >
            {/* A copy matches the same requests as its original by definition, so it lands in a
                priority contest the moment it is written. Saying so here is cheaper than
                letting someone discover it from a shadowed row afterwards. */}
            A copy matches the same requests as the original, so one of them will shadow the other.
            Change the matcher, or set a priority — lower wins.
          </p>
        )}

        <div style={{ display: 'flex', borderBottom: '1px solid var(--mk-border-default)' }}>
          {(
            [
              ['matcher', 'Matcher'],
              ['response', 'Response'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              style={{
                padding: '8px 12px',
                fontSize: 13,
                fontFamily: 'inherit',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${tab === value ? 'var(--mk-accent-solid)' : 'transparent'}`,
                color: tab === value ? 'var(--mk-text-primary)' : 'var(--mk-text-secondary)',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          <label style={{ display: 'grid', gap: 4, marginBottom: 16, fontSize: 12, maxWidth: 420 }}>
            Name
            <input
              value={draft.name ?? ''}
              placeholder="Optional, but it is what every list shows"
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value === '' ? null : event.target.value })
              }
              style={{
                height: 26,
                padding: '0 6px',
                font: 'inherit',
                fontSize: 12,
                color: 'var(--mk-text-primary)',
                background: 'var(--mk-bg-surface)',
                border: '1px solid var(--mk-border-default)',
                borderRadius: 'var(--mk-radius-sm)',
              }}
            />
          </label>

          {tab === 'matcher' ? (
            <MatcherForm draft={draft} disabled={false} onChange={setDraft} />
          ) : (
            <ResponseForm draft={draft} disabled={false} onChange={setDraft} />
          )}
        </div>

        {error !== null && (
          <div style={{ padding: '8px 14px' }}>
            <ErrorDisclosure sentence={error.sentence} payload={error.payload} />
          </div>
        )}

        <footer
          style={{
            display: 'flex',
            gap: 8,
            padding: '10px 14px',
            borderTop: '1px solid var(--mk-border-default)',
          }}
        >
          <span style={{ flex: 1 }} />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : duplicating ? 'Create copy' : 'Create stub'}
          </Button>
        </footer>
      </div>
    </div>
  )
}
