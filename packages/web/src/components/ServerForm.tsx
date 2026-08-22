import { useState } from 'react'
import { composeAdminUrl } from '@mock-knight/core/types'
import type { NewProfile, Profile } from '../api.js'
import { Button, ErrorDisclosure } from './primitives.js'
import type { Failure } from './primitives.js'

/**
 * Add or edit a mock server. One form for both, because they ask for exactly the same things and
 * a separate "edit" dialog would drift from the "add" one within a release.
 *
 * The **admin path** field is here rather than hidden behind an "advanced" disclosure. A mock
 * server behind a context path is completely ordinary — an ALB routing `/wcboo/*`, a Spring app
 * with a `context-path` — and when it is wrong the tool reports whatever the load balancer says
 * about a path nobody asked for, which is a genuinely hard error to diagnose from the outside.
 */

const COLOURS = ['slate', 'indigo', 'cyan', 'violet', 'rose', 'olive'] as const

const field: React.CSSProperties = {
  height: 28,
  padding: '0 8px',
  font: 'inherit',
  fontSize: 13,
  color: 'var(--mk-text-primary)',
  background: 'var(--mk-bg-surface)',
  border: '1px solid var(--mk-border-strong)',
  borderRadius: 'var(--mk-radius-sm)',
}

export interface ServerFormProps {
  /** Present when editing; absent when adding. */
  existing?: Profile
  pending: boolean
  failure: Failure | null
  onSubmit: (profile: NewProfile) => void
  onCancel?: () => void
}

export function ServerForm({ existing, pending, failure, onSubmit, onCancel }: ServerFormProps) {
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? 'http://localhost:8080')
  const [adminPath, setAdminPath] = useState(existing?.adminPath ?? '')
  const [name, setName] = useState(existing?.name ?? '')
  const [colour, setColour] = useState<string>(existing?.colour ?? 'indigo')
  const [isProtected, setProtected] = useState(existing?.protected ?? false)
  const [readOnly, setReadOnly] = useState(existing?.readOnly ?? false)

  // Shown live, because the composed URL is the thing that is actually wrong when a context
  // path is missing, and it is not obvious from the two fields that produce it.
  //
  // The *same* function the transport calls, not a second implementation of it. A preview
  // computed separately can drift from where the request actually goes, and it would drift on
  // precisely the input this exists to catch. Empty while the base URL is still half-typed and
  // does not parse.
  const preview = (() => {
    try {
      return composeAdminUrl(baseUrl, adminPath.trim() === '' ? null : adminPath)
    } catch {
      return ''
    }
  })()

  const submit = () => {
    let resolved = name.trim()
    if (resolved === '') {
      try {
        resolved = new URL(baseUrl).host
      } catch {
        resolved = baseUrl
      }
    }
    onSubmit({
      name: resolved,
      baseUrl: baseUrl.trim(),
      adminPath: adminPath.trim() === '' ? null : adminPath.trim(),
      colour,
      protected: isProtected,
      readOnly,
    })
  }

  return (
    <section
      style={{
        border: `1px solid ${existing === undefined ? 'var(--mk-border-default)' : 'var(--mk-accent-border)'}`,
        borderRadius: 'var(--mk-radius-md)',
        padding: 12,
        marginBottom: 16,
        background: 'var(--mk-bg-surface)',
      }}
    >
      <strong style={{ display: 'block', fontSize: 14, marginBottom: 8 }}>
        {existing === undefined ? 'Add a mock server' : `Edit ${existing.name}`}
      </strong>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'grid', gap: 3, flex: '2 1 240px' }}>
          <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>Base URL</span>
          <input
            aria-label="Base URL"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            style={field}
          />
        </label>
        <label style={{ display: 'grid', gap: 3, flex: '1 1 160px' }}>
          <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>
            Admin path <span style={{ color: 'var(--mk-text-tertiary)' }}>(default /__admin)</span>
          </span>
          <input
            aria-label="Admin path"
            placeholder="/__admin"
            value={adminPath}
            onChange={(event) => setAdminPath(event.target.value)}
            style={field}
          />
        </label>
        <label style={{ display: 'grid', gap: 3, flex: '1 1 140px' }}>
          <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>
            Name <span style={{ color: 'var(--mk-text-tertiary)' }}>(optional)</span>
          </span>
          <input
            aria-label="Name"
            placeholder="from the URL"
            value={name}
            onChange={(event) => setName(event.target.value)}
            style={field}
          />
        </label>
      </div>

      <p
        className="mk-mono"
        data-testid="admin-url-preview"
        style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--mk-text-secondary)' }}
      >
        {preview === '' ? (
          <span style={{ color: 'var(--mk-danger-text)' }}>That is not a valid URL.</span>
        ) : (
          <>Mock Knight will call {preview}</>
        )}
      </p>

      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          margin: '10px 0',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>Colour</span>
          {COLOURS.map((option) => (
            <button
              key={option}
              type="button"
              aria-label={option}
              aria-pressed={colour === option}
              onClick={() => setColour(option)}
              style={{
                width: 26,
                height: 26,
                cursor: 'pointer',
                borderRadius: 'var(--mk-radius-sm)',
                border: `2px solid ${colour === option ? 'var(--mk-accent-solid)' : 'transparent'}`,
                background: 'var(--mk-bg-surface)',
              }}
            >
              <span
                style={{
                  display: 'block',
                  width: 12,
                  height: 12,
                  margin: '0 auto',
                  borderRadius: 9999,
                  background: `var(--mk-profile-${option})`,
                }}
              />
            </button>
          ))}
        </span>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={isProtected}
            onChange={(event) => setProtected(event.target.checked)}
            style={{ accentColor: 'var(--mk-accent-solid)' }}
          />
          Protected
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(event) => setReadOnly(event.target.checked)}
            style={{ accentColor: 'var(--mk-accent-solid)' }}
          />
          Read-only
        </label>
      </div>

      {failure !== null && (
        <div style={{ marginBottom: 8 }}>
          {/* Not just the sentence: a connection that fails against a corporate host usually
              fails for a reason only the upstream body names (design brief §6.11). */}
          <ErrorDisclosure sentence={failure.sentence} payload={failure.payload} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" disabled={pending || preview === ''} onClick={submit}>
          {pending
            ? existing === undefined
              ? 'Connecting…'
              : 'Saving…'
            : existing === undefined
              ? 'Add and connect'
              : 'Save changes'}
        </Button>
        {onCancel !== undefined && <Button onClick={onCancel}>Cancel</Button>}
      </div>
    </section>
  )
}
