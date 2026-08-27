import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.js'
import { Button, ErrorDisclosure, toFailure } from './primitives.js'
import type { Failure } from './primitives.js'

/**
 * First run, no profile — design brief §6.11: "a centred setup card: paste a URL, pick an
 * adapter, test connection. One screen, three fields."
 *
 * It replaces a splash that told the user to go back to their terminal and restart the process
 * with a flag. An app whose empty state is an instruction to use a different tool has not
 * really got an empty state.
 *
 * The adapter field is deliberately absent rather than a select with one option: there is
 * exactly one adapter, and a control with no choice in it is furniture.
 */
export function FirstRun({ onAdded }: { onAdded: (id: string) => void }) {
  const queryClient = useQueryClient()
  const [baseUrl, setBaseUrl] = useState('http://localhost:8080')
  const [adminPath, setAdminPath] = useState('')
  const [error, setError] = useState<Failure | null>(null)

  const add = useMutation({
    mutationFn: async () => {
      let host: string
      try {
        host = new URL(baseUrl).host
      } catch {
        throw new Error('That is not a valid URL. It should look like http://localhost:8080')
      }
      const created = await api.createProfile({
        // First run has no picker: one field, one URL, the common case. Another backend is a
        // decision for the Servers screen, not for the first thing someone sees.
        adapter: 'wiremock',
        name: host,
        baseUrl: baseUrl.trim(),
        adminPath: adminPath.trim() === '' ? null : adminPath.trim(),
        colour: 'indigo',
        // WireMock reads its corpus over the admin API, so there is no document to point at.
        mappingsDir: null,
        // First run has one field; a server needing credentials is configured on the Servers
        // screen, which is also where the error from an unauthenticated connect points.
        authKind: 'none',
        authUsername: null,
        authSecret: null,
        protected: false,
        readOnly: false,
      })
      // Connect and mirror before handing over, so the first screen has something on it.
      try {
        await api.connect(created.profile.id)
      } catch (caught) {
        // Undo the profile. "Test connection and continue" either continues or it does not —
        // leaving a broken profile behind drops the user into an empty corpus for a server that
        // does not answer, with the reason no longer on screen.
        //
        // The original error is rethrown, not replaced: the server's sentence names the actual
        // failure (DNS, refused, expired certificate) and carries the upstream block the
        // disclosure renders.
        await api.deleteProfile(created.profile.id).catch(() => undefined)
        throw caught
      }
      await api.refresh(created.profile.id).catch(() => undefined)
      return created.profile
    },
    onSuccess: (profile) => {
      void queryClient.invalidateQueries({ queryKey: ['profiles'] })
      onAdded(profile.id)
    },
    onError: (caught: unknown) => {
      void queryClient.invalidateQueries({ queryKey: ['profiles'] })
      setError(toFailure(caught, 'Could not connect.'))
    },
  })

  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div
        style={{
          width: 'min(460px, 100%)',
          padding: 20,
          borderRadius: 'var(--mk-radius-md)',
          border: '1px solid var(--mk-border-default)',
          background: 'var(--mk-bg-surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <img
            className="mk-mark-light"
            src="/brand/mock-knight-mark.svg"
            alt=""
            width={20}
            height={20}
          />
          <img
            className="mk-mark-dark"
            src="/brand/mock-knight-mark-dark.svg"
            alt=""
            width={20}
            height={20}
          />
          <strong style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Connect a mock server
          </strong>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--mk-text-secondary)' }}>
          Mock Knight runs beside your mock server and never serves traffic itself. Point it at a
          WireMock admin URL to begin.
        </p>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>Base URL</span>
          <input
            autoFocus
            aria-label="Base URL"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !add.isPending) {
                setError(null)
                add.mutate()
              }
            }}
            style={{
              height: 30,
              padding: '0 10px',
              font: 'inherit',
              fontSize: 13,
              color: 'var(--mk-text-primary)',
              background: 'var(--mk-bg-surface)',
              border: '1px solid var(--mk-border-strong)',
              borderRadius: 'var(--mk-radius-sm)',
            }}
          />
        </label>

        <label style={{ display: 'grid', gap: 4, marginTop: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>
            Admin path <span style={{ color: 'var(--mk-text-tertiary)' }}>(default /__admin)</span>
          </span>
          <input
            aria-label="Admin path"
            placeholder="/__admin"
            value={adminPath}
            onChange={(event) => setAdminPath(event.target.value)}
            style={{
              height: 30,
              padding: '0 10px',
              font: 'inherit',
              fontSize: 13,
              color: 'var(--mk-text-primary)',
              background: 'var(--mk-bg-surface)',
              border: '1px solid var(--mk-border-strong)',
              borderRadius: 'var(--mk-radius-sm)',
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
            {/* A context path in the base URL is kept, so this appends to it. */}
            Appended to the base URL, including any context path it already has.
          </span>
        </label>

        {error !== null && (
          <div style={{ marginTop: 10 }}>
            <ErrorDisclosure sentence={error.sentence} payload={error.payload} />
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <Button
            variant="primary"
            disabled={add.isPending}
            onClick={() => {
              setError(null)
              add.mutate()
            }}
          >
            {add.isPending ? 'Connecting…' : 'Test connection and continue'}
          </Button>
        </div>
      </div>
    </div>
  )
}
