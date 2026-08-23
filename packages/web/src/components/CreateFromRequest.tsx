import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.js'
import { Button, Chip, ErrorDisclosure, InferenceLabel, Skeleton, toFailure } from './primitives.js'
import type { Failure } from './primitives.js'

/**
 * Create a stub from a captured request — FR-TRAF-5, and the exit from §6.4.
 *
 * Most explainer sessions end here: the developer now knows why nothing matched and wants a
 * stub that would have. Two things keep it honest.
 *
 * **The tightness control is the whole design.** Reproducing the request exactly gives a stub
 * that matches once and never again; matching only the path gives one that swallows traffic it
 * should not. Neither default is right for everyone, so the choice is in front of the user with
 * its consequence written next to it.
 *
 * **Nothing is written until the JSON has been seen.** Every decision behind the generated
 * document is a guess, so it is shown, editable, with the guesses listed above it.
 */

const TIGHTNESS: { value: string; label: string; consequence: string }[] = [
  {
    value: 'exact',
    label: 'Exact',
    consequence:
      'Method, path, query, and distinguishing headers. Matches this call and little else.',
  },
  {
    value: 'method-and-path',
    label: 'Method + path',
    consequence: 'Matches any call to this path with this method.',
  },
  {
    value: 'path',
    label: 'Path only',
    consequence: 'Matches any method on this path. Broad — it may shadow other stubs.',
  },
]

export interface CreateFromRequestProps {
  profileId: string
  eventId: number
  onClose: () => void
  onCreated: () => void
}

export function CreateFromRequest({
  profileId,
  eventId,
  onClose,
  onCreated,
}: CreateFromRequestProps) {
  const queryClient = useQueryClient()
  const [tightness, setTightness] = useState('method-and-path')
  const [matchBody, setMatchBody] = useState(false)
  const [edited, setEdited] = useState<string | null>(null)
  const [error, setError] = useState<Failure | null>(null)

  const generated = useQuery({
    queryKey: ['stub-from-request', profileId, eventId, tightness, matchBody],
    queryFn: () => api.stubFromRequest(profileId, { eventId, tightness, matchBody }),
  })

  // Regenerating discards hand edits, which is the right trade: the controls above are the
  // reason to regenerate, and silently keeping stale text under a changed setting would lie.
  // Cleared during render, so the stale text is never committed under the new setting even for
  // a frame.
  const settings = `${tightness}:${String(matchBody)}`
  const [shownSettings, setShownSettings] = useState(settings)
  if (shownSettings !== settings) {
    setShownSettings(settings)
    setEdited(null)
  }

  const create = useMutation({
    mutationFn: async () => {
      const text = edited ?? JSON.stringify(generated.data?.raw ?? {}, null, 2)
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error('That is not valid JSON, so nothing was sent to the server.')
      }
      return api.createMock(profileId, parsed)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['corpus'] })
      onCreated()
    },
    onError: (caught: unknown) => setError(toFailure(caught, 'The stub could not be created.')),
  })

  const text = edited ?? JSON.stringify(generated.data?.raw ?? {}, null, 2)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create a stub from this request"
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
          width: 'min(900px, 100%)',
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
          <strong style={{ fontSize: 16, fontWeight: 600 }}>Create a stub from this request</strong>
        </header>

        <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend
              style={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--mk-text-secondary)',
                padding: 0,
                marginBottom: 6,
              }}
            >
              How closely should it match?
            </legend>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {TIGHTNESS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={tightness === option.value}
                  onClick={() => setTightness(option.value)}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    padding: '8px 10px',
                    font: 'inherit',
                    cursor: 'pointer',
                    borderRadius: 'var(--mk-radius-sm)',
                    border: `1px solid ${tightness === option.value ? 'var(--mk-accent-solid)' : 'var(--mk-border-default)'}`,
                    background:
                      tightness === option.value
                        ? 'var(--mk-accent-bg-subtle)'
                        : 'var(--mk-bg-surface)',
                  }}
                >
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>
                    {option.label}
                  </span>
                  <span
                    style={{ display: 'block', fontSize: 12, color: 'var(--mk-text-secondary)' }}
                  >
                    {option.consequence}
                  </span>
                </button>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={matchBody}
                onChange={(event) => setMatchBody(event.target.checked)}
                style={{ accentColor: 'var(--mk-accent-solid)', margin: 0 }}
              />
              Also match the request body
            </label>
          </fieldset>

          {generated.data !== undefined && generated.data.notes.length > 0 && (
            <ul
              style={{
                listStyle: 'none',
                margin: '12px 0 0',
                padding: 10,
                display: 'grid',
                gap: 4,
                background: 'var(--mk-bg-subtle)',
                borderRadius: 'var(--mk-radius-md)',
              }}
            >
              {generated.data.notes.map((note) => (
                <li key={note} style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>
                  {note}
                </li>
              ))}
            </ul>
          )}

          <div style={{ margin: '12px 0 4px' }}>
            <InferenceLabel title="Mock Knight composed this from the captured request. Nothing has been written yet — read it, change anything that is wrong, then create.">
              composed by Mock Knight · review before creating
            </InferenceLabel>
          </div>

          {generated.isPending ? (
            <Skeleton width="100%" height={220} />
          ) : (
            <textarea
              aria-label="Generated stub"
              spellCheck={false}
              value={text}
              onChange={(event) => setEdited(event.target.value)}
              className="mk-mono"
              style={{
                width: '100%',
                minHeight: 260,
                resize: 'vertical',
                padding: 10,
                fontSize: 12,
                lineHeight: '20px',
                color: 'var(--mk-text-primary)',
                background: 'var(--mk-code-bg)',
                border: '1px solid var(--mk-border-subtle)',
                borderRadius: 'var(--mk-radius-md)',
              }}
            />
          )}
        </div>

        {error !== null && (
          <div style={{ padding: '8px 14px' }}>
            {/* WireMock answers 422 and names the property it rejected; that is the whole
                diagnosis for a generated stub the server would not take. */}
            <ErrorDisclosure sentence={error.sentence} payload={error.payload} />
          </div>
        )}

        <footer
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderTop: '1px solid var(--mk-border-default)',
          }}
        >
          <span style={{ flex: 1 }}>
            {edited !== null && <Chip tone="warning">edited by hand</Chip>}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={create.isPending || generated.isPending}
            onClick={() => {
              setError(null)
              create.mutate()
            }}
          >
            {create.isPending ? 'Creating…' : 'Create stub'}
          </Button>
        </footer>
      </div>
    </div>
  )
}
