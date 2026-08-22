import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.js'
import type { CapabilityRow, NewProfile, Profile } from '../api.js'
import { ServerForm } from './ServerForm.js'
import { Button, Chip, Skeleton, toFailure } from './primitives.js'
import type { Failure } from './primitives.js'

/**
 * Connection management and the capability report — design brief §6.9, PRD FR-CONN-1..5.
 *
 * The capability report is the load-bearing part. PRD §10 calls it "a real feature", and it is
 * the answer to every "why is that button greyed out?": each bit that is **off** states its
 * consequence in plain language rather than just its name, and says which gate turned it off —
 * the backend, or this runtime mode. Without it, an absent control is indistinguishable from a
 * bug.
 */

function AddOrEditServer({
  existing,
  onDone,
}: {
  existing?: Profile
  onDone: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<Failure | null>(null)

  const save = useMutation({
    mutationFn: async (input: NewProfile) => {
      if (existing !== undefined) {
        const updated = await api.updateProfile(existing.id, input)
        if (updated.mirrorCleared) await api.refresh(existing.id).catch(() => undefined)
        return updated.profile
      }
      const created = await api.createProfile(input)
      try {
        await api.connect(created.profile.id)
      } catch (caught) {
        // Undo the profile, then rethrow **the original**. Swallowing it and throwing a generic
        // sentence is what made a dropped context path present as "it does not work": the server
        // had already worked out the status, the URL it called and the body it got back, and this
        // line threw all of it away one step before the screen that needed it.
        await api.deleteProfile(created.profile.id).catch(() => undefined)
        throw caught
      }
      await api.refresh(created.profile.id).catch(() => undefined)
      return created.profile
    },
    onSuccess: (profile) => {
      void queryClient.invalidateQueries()
      onDone(profile.id)
    },
    onError: (caught: unknown) => setError(toFailure(caught, 'Could not save that server.')),
  })

  return (
    <ServerForm
      {...(existing === undefined ? {} : { existing })}
      pending={save.isPending}
      failure={error}
      onSubmit={(input) => {
        setError(null)
        save.mutate(input)
      }}
      {...(existing === undefined ? {} : { onCancel: () => onDone(existing.id) })}
    />
  )
}

function CapabilityReport({ profileId }: { profileId: string }) {
  const [showAll, setShowAll] = useState(false)
  const query = useQuery({
    queryKey: ['capabilities', profileId],
    queryFn: () => api.capabilities(profileId),
  })

  if (query.isPending) return <Skeleton width="100%" height={120} />
  if (query.data === undefined) return null

  const off = query.data.report.filter((row) => !row.on)
  const rows = showAll ? query.data.report : off

  return (
    <section style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <strong style={{ fontSize: 14 }}>What this connection can do</strong>
        <span style={{ fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
          {query.data.report.length - off.length} of {query.data.report.length} available
          {query.data.version !== null && ` · WireMock ${query.data.version}`}
        </span>
        <span style={{ flex: 1 }} />
        <Button variant="quiet" onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Show only what is off' : 'Show everything'}
        </Button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['Capability', '', 'Gate', 'What it means'].map((label, index) => (
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
                }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: CapabilityRow) => (
            <tr key={row.bit} style={{ borderBottom: '1px solid var(--mk-border-subtle)' }}>
              <td className="mk-mono" style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                {row.bit}
              </td>
              <td style={{ padding: '5px 8px' }}>
                {/* Never colour alone: the word is the signal, not the tone. */}
                <Chip tone={row.on ? 'neutral' : 'warning'}>{row.on ? 'on' : 'off'}</Chip>
              </td>
              <td style={{ padding: '5px 8px', color: 'var(--mk-text-secondary)' }}>
                {row.gate === 'backend' ? 'this server' : 'this mode'}
                {row.provenance === 'version' && (
                  <span
                    title="Inferred from the server's version string rather than proved by calling the route — a weaker claim."
                    style={{ marginLeft: 4, color: 'var(--mk-text-tertiary)' }}
                  >
                    (from version)
                  </span>
                )}
              </td>
              <td style={{ padding: '5px 8px', color: 'var(--mk-text-secondary)' }}>
                {row.on ? row.label : row.whenOff}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function DangerZone({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient()
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState<string | null>(null)

  const run = useMutation({
    mutationFn: (operation: string) => api.danger(profile.id, operation, confirm),
    onSuccess: () => {
      setConfirm('')
      setPending(null)
      void queryClient.invalidateQueries()
    },
  })

  const operations = [
    { id: 'reset-stubs', label: 'Reset every stub', detail: 'Removes all stubs from the server.' },
    {
      id: 'clear-journal',
      label: 'Clear the request journal',
      detail: 'Discards the traffic history. “Unused since…” restarts from now.',
    },
  ]

  return (
    <section
      style={{
        marginTop: 24,
        padding: 12,
        border: '1px solid var(--mk-danger-border)',
        borderRadius: 'var(--mk-radius-md)',
      }}
    >
      <strong style={{ display: 'block', fontSize: 14, color: 'var(--mk-danger-text)' }}>
        Danger zone
      </strong>
      <p style={{ margin: '4px 0 10px', fontSize: 12, color: 'var(--mk-text-secondary)' }}>
        These affect everyone using {profile.name} and cannot be undone.
      </p>

      {operations.map((operation) => (
        <div key={operation.id} style={{ marginBottom: 8 }}>
          {pending === operation.id ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12 }}>
                Type <code className="mk-mono">{profile.name}</code> to confirm:
              </span>
              <input
                autoFocus
                aria-label={`Type the profile name to confirm: ${operation.label}`}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                style={{
                  height: 26,
                  padding: '0 8px',
                  font: 'inherit',
                  fontSize: 13,
                  color: 'var(--mk-text-primary)',
                  background: 'var(--mk-bg-surface)',
                  border: '1px solid var(--mk-border-strong)',
                  borderRadius: 'var(--mk-radius-sm)',
                }}
              />
              <Button
                onClick={() => {
                  setPending(null)
                  setConfirm('')
                }}
              >
                Cancel
              </Button>
              <button
                type="button"
                disabled={confirm !== profile.name || run.isPending}
                onClick={() => run.mutate(operation.id)}
                style={{
                  height: 26,
                  padding: '0 10px',
                  font: 'inherit',
                  fontSize: 13,
                  borderRadius: 'var(--mk-radius-sm)',
                  cursor: confirm === profile.name ? 'pointer' : 'not-allowed',
                  opacity: confirm === profile.name ? 1 : 0.5,
                  color: 'var(--mk-danger-on-solid)',
                  background: 'var(--mk-danger-solid)',
                  border: '1px solid var(--mk-danger-solid)',
                }}
              >
                {operation.label}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button onClick={() => setPending(operation.id)}>{operation.label}…</Button>
              <span style={{ fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
                {operation.detail}
              </span>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}

export function ProfilesScreen({
  profiles,
  active,
  onSelect,
}: {
  profiles: Profile[]
  active: Profile
  onSelect: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProfile(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['profiles'] }),
  })

  const underEdit = profiles.find((profile) => profile.id === editing)

  return (
    <main style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 14 }}>
      {/*
        Keyed, so switching between "add" and "edit" — or between two profiles — remounts the
        form. Without it React reuses the instance, the `useState` initialisers never re-run,
        and Edit opens showing whatever was half-typed into the add form.
      */}
      {underEdit === undefined ? (
        <AddOrEditServer key="new" onDone={onSelect} />
      ) : (
        <AddOrEditServer
          key={underEdit.id}
          existing={underEdit}
          onDone={(id) => {
            setEditing(null)
            onSelect(id)
          }}
        />
      )}

      <strong style={{ display: 'block', fontSize: 14, marginBottom: 6 }}>Servers</strong>
      <ul style={{ listStyle: 'none', margin: '0 0 8px', padding: 0, display: 'grid', gap: 6 }}>
        {profiles.map((profile) => (
          <li
            key={profile.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 'var(--mk-radius-md)',
              border: `1px solid ${profile.id === active.id ? 'var(--mk-accent-border)' : 'var(--mk-border-default)'}`,
              background:
                profile.id === active.id ? 'var(--mk-accent-bg-subtle)' : 'var(--mk-bg-surface)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: 9999,
                background: `var(--mk-profile-${profile.colour})`,
              }}
            />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>
                {profile.name}
              </span>
              <span
                className="mk-mono"
                style={{ display: 'block', fontSize: 11, color: 'var(--mk-text-tertiary)' }}
              >
                {profile.baseUrl}
              </span>
            </span>
            {profile.protected && <Chip tone="warning">protected</Chip>}
            {profile.readOnly && <Chip>read-only</Chip>}
            {profile.id === active.id ? (
              <Chip tone="accent">active</Chip>
            ) : (
              <Button variant="quiet" onClick={() => onSelect(profile.id)}>
                Switch
              </Button>
            )}
            <Button onClick={() => setEditing(profile.id)}>Edit</Button>
            {profiles.length > 1 && profile.id !== active.id && (
              <Button onClick={() => remove.mutate(profile.id)}>Remove</Button>
            )}
          </li>
        ))}
      </ul>

      <CapabilityReport profileId={active.id} />

      {/* Absent entirely on a protected profile — not disabled (§9.6, FR-CONN-5). */}
      {!active.protected && !active.readOnly && <DangerZone profile={active} />}
    </main>
  )
}
