import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.js'
import type { SavedSearch } from '../api.js'
import { Button } from './primitives.js'

/**
 * Saving a query worth keeping — FR-FIND-6.
 *
 * A structured query is the fastest way to find one stub among thousands and also the thing
 * nobody remembers the syntax of a week later. `method:POST status:5xx header:X-Tenant` is worth
 * keeping once someone has worked it out.
 *
 * Deliberately a small control rather than a panel: this is a shortcut to something the search
 * box already does, and it should not take space away from the corpus.
 */
export function SavedSearches({
  profileId,
  query,
  appliedId,
  onApply,
}: {
  profileId: string
  query: string
  /** The saved search the current query came from, if any. Enables Update rather than re-save. */
  appliedId: number | null
  onApply: (saved: SavedSearch) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const queryClient = useQueryClient()

  const searches = useQuery({
    queryKey: ['searches', profileId],
    queryFn: () => api.searches(profileId),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['searches', profileId] })
  const update = useMutation({
    mutationFn: () => api.saveSearch(profileId, applied!.name, query),
    onSuccess: () => void invalidate(),
  })
  const save = useMutation({
    mutationFn: () => api.saveSearch(profileId, name.trim(), query),
    onSuccess: (result) => {
      setName('')
      setOpen(false)
      void invalidate()
      // Having just saved it, you are on it — so editing the query next offers Update rather
      // than only "save another one under a name you have to invent". This is the commonest
      // flow of all and it was the one that did not work.
      onApply(result.search)
    },
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteSearch(profileId, id),
    onSuccess: () => void invalidate(),
  })

  const saved = searches.data?.searches ?? []
  const existing = saved.find((candidate) => candidate.query === query)
  /**
   * The search this query came from, once it has been edited away from what was saved.
   *
   * Without this the only route back was retyping the exact name into the save box and relying
   * on the upsert, which means remembering a name the app already knew.
   */
  const applied = saved.find((candidate) => candidate.id === appliedId)
  const edited = applied !== undefined && applied.query !== query && query !== ''

  return (
    <div style={{ position: 'relative', display: 'flex', gap: 6 }}>
      {edited && (
        // Offered before "Save search", because after tweaking a saved query updating it is
        // almost always the intention and re-saving under a new name is the exception.
        <Button
          variant="primary"
          disabled={update.isPending}
          onClick={() => update.mutate()}
          title={`Replace “${applied!.name}” with the query in the box`}
        >
          {update.isPending ? 'Updating…' : `Update ${applied!.name}`}
        </Button>
      )}

      {/* Saving an empty search would save "everything", which is not worth a name. */}
      {query !== '' && existing === undefined && (
        <Button onClick={() => setOpen((was) => !was)}>
          {edited ? 'Save as new' : 'Save search'}
        </Button>
      )}
      {existing !== undefined && (
        // A button, not a chip. It was inert, which left no way back into the panel to rename
        // or delete a search once it had been saved — the affordance looked like a state and
        // was in fact a dead end.
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          title="This search is saved — click to manage saved searches"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 26,
            padding: '0 8px',
            font: 'inherit',
            fontSize: 12,
            cursor: 'pointer',
            color: 'var(--mk-accent-text)',
            background: 'var(--mk-accent-bg-subtle)',
            border: '1px solid var(--mk-accent-border)',
            borderRadius: 'var(--mk-radius-sm)',
          }}
        >
          {existing.name}
        </button>
      )}

      {saved.length > 0 && (
        <select
          aria-label="Saved searches"
          value=""
          onChange={(event) => {
            const chosen = saved.find((candidate) => String(candidate.id) === event.target.value)
            if (chosen !== undefined) onApply(chosen)
          }}
          style={{
            height: 26,
            padding: '0 6px',
            font: 'inherit',
            fontSize: 12,
            color: 'var(--mk-text-secondary)',
            background: 'var(--mk-bg-surface)',
            border: '1px solid var(--mk-border-default)',
            borderRadius: 'var(--mk-radius-sm)',
          }}
        >
          <option value="">Saved ({saved.length})</option>
          {saved.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      )}

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 30,
            right: 0,
            zIndex: 40,
            width: 300,
            padding: 10,
            display: 'grid',
            gap: 8,
            background: 'var(--mk-bg-raised)',
            border: '1px solid var(--mk-border-strong)',
            borderRadius: 'var(--mk-radius-md)',
            boxShadow: 'var(--mk-shadow-popover)',
          }}
        >
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            {existing === undefined ? 'Name this search' : 'Save it again under another name'}
            <input
              autoFocus
              aria-label="Name this search"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && name.trim() !== '') save.mutate()
                if (event.key === 'Escape') setOpen(false)
              }}
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
          <code
            className="mk-mono"
            style={{
              fontSize: 11,
              padding: '4px 6px',
              color: 'var(--mk-text-secondary)',
              background: 'var(--mk-bg-subtle)',
              borderRadius: 'var(--mk-radius-sm)',
              wordBreak: 'break-all',
            }}
          >
            {query}
          </code>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ flex: 1 }} />
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={name.trim() === '' || save.isPending}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          </div>
          {saved.length > 0 && (
            <div style={{ borderTop: '1px solid var(--mk-border-default)', paddingTop: 6 }}>
              {saved.map((candidate) => (
                <div
                  key={candidate.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>{candidate.name}</span>
                  <Button variant="quiet" onClick={() => remove.mutate(candidate.id)}>
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
