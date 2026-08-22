import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.js'
import { Button } from './primitives.js'

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
  const [error, setError] = useState<string | null>(null)

  const add = useMutation({
    mutationFn: async () => {
      let host: string
      try {
        host = new URL(baseUrl).host
      } catch {
        throw new Error('That is not a valid URL. It should look like http://localhost:8080')
      }
      const created = await api.createProfile({
        name: host,
        baseUrl: baseUrl.trim(),
        colour: 'indigo',
        protected: false,
        readOnly: false,
      })
      // Connect and mirror before handing over, so the first screen has something on it.
      const connected = await api.connect(created.profile.id).catch(() => null)
      if (connected === null) {
        // Undo the profile. "Test connection and continue" either continues or it does not —
        // leaving a broken profile behind drops the user into an empty corpus for a server that
        // does not answer, with the reason no longer on screen.
        await api.deleteProfile(created.profile.id).catch(() => undefined)
        throw new Error(
          `Nothing answered at ${baseUrl}. Check the server is running and the URL is right.`,
        )
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
      setError(caught instanceof Error ? caught.message : 'Could not connect.')
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

        {error !== null && (
          <p
            role="alert"
            style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--mk-danger-text)' }}
          >
            {error}
          </p>
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
