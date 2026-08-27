import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.js'
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

/**
 * The credential fields, shown only where the chosen backend accepts one.
 *
 * Entered directly rather than as the name of an environment variable, which was the previous
 * design and could not be used from a UI at all: adding a credential meant stopping the process
 * and restarting it with the variable exported.
 *
 * The value is stored in the state database in plain text, and the form says so. Encrypting it
 * with a key kept beside it would stop someone reading over your shoulder and nothing else, so
 * it is not claimed. A shared `mock-knight.json` can still say `"authSecret": "${env:VAR}"` and
 * keep the secret out of the file.
 */

export function ServerForm({ existing, pending, failure, onSubmit, onCancel }: ServerFormProps) {
  const adapters = useQuery({ queryKey: ['adapters'], queryFn: api.adapters })
  const kinds = adapters.data?.adapters ?? []
  const [adapter, setAdapter] = useState(existing?.adapter ?? 'wiremock')
  const chosen = kinds.find((kind) => kind.id === adapter)

  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? 'http://localhost:8080')
  const [adminPath, setAdminPath] = useState(existing?.adminPath ?? '')
  const [name, setName] = useState(existing?.name ?? '')
  const [colour, setColour] = useState<string>(existing?.colour ?? 'indigo')
  const [isProtected, setProtected] = useState(existing?.protected ?? false)
  const [readOnly, setReadOnly] = useState(existing?.readOnly ?? false)
  /**
   * The corpus document, for a backend that reads one.
   *
   * Asked of the adapter rather than hardcoded against an id: a backend declares
   * `corpusDocument` when its corpus is a file, and the field appears for exactly those. Without
   * it a Mockoon profile could be saved and then failed to connect with "a Mockoon server needs
   * the path to its environment JSON file" — an error naming something the form never asked for.
   */
  const [documentPath, setDocumentPath] = useState(existing?.mappingsDir ?? '')
  const [authKind, setAuthKind] = useState<string>(existing?.authKind ?? 'none')
  const [authUsername, setAuthUsername] = useState(existing?.authUsername ?? '')
  /**
   * Always starts empty, even when a password is stored.
   *
   * The browser never receives it — `redactProfile` withholds it — so there is nothing to
   * prefill, and an empty box on an edit means "leave it as it is" rather than "clear it".
   */
  const [authSecret, setAuthSecret] = useState('')
  /**
   * Off unless this profile already has a stored credential.
   *
   * The default matters: a password held only for this run cannot be read out of a backup, a
   * synced home directory, or the state database, so persisting is the user's decision to make
   * rather than the one they get by not noticing a checkbox.
   */
  const [rememberSecret, setRememberSecret] = useState(existing?.authSecretRemembered ?? false)
  const document = chosen?.corpusDocument ?? null
  const documentMissing = document !== null && documentPath.trim() === ''

  // Shown live, because the composed URL is the thing that is actually wrong when a context
  // path is missing, and it is not obvious from the two fields that produce it.
  //
  // The *same* function the transport calls, not a second implementation of it. A preview
  // computed separately can drift from where the request actually goes, and it would drift on
  // precisely the input this exists to catch. Empty while the base URL is still half-typed and
  // does not parse.
  // Offered only where the backend accepts one: a field that cannot do anything is worse than
  // no field, and only WireMock secures its control plane among the backends here.
  const authentication = chosen?.authentication ?? null
  const wantsCredential = authentication !== null && authKind !== 'none'

  const preview = (() => {
    try {
      // The default follows the backend: /__admin is WireMock's and would 404 on MockServer.
      return composeAdminUrl(
        baseUrl,
        adminPath.trim() === '' ? (chosen?.defaultAdminPath ?? null) : adminPath,
      )
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
      adapter,
      name: resolved,
      baseUrl: baseUrl.trim(),
      adminPath: adminPath.trim() === '' ? null : adminPath.trim(),
      colour,
      protected: isProtected,
      readOnly,
      // A backend that takes no credential never stores one, whatever was typed before the
      // backend was switched.
      authKind: authentication === null ? 'none' : authKind,
      authUsername: wantsCredential && authUsername !== '' ? authUsername : null,
      // Empty on an edit means "unchanged": the server keeps what it holds rather than clearing
      // it, because the browser was never given the value to send back.
      authSecret: wantsCredential && authSecret !== '' ? authSecret : null,
      rememberSecret: wantsCredential && rememberSecret,
      // Only for a backend that reads one, so switching a profile to an API-driven backend
      // clears a path that would otherwise sit in the database meaning nothing.
      mappingsDir: document === null || documentPath.trim() === '' ? null : documentPath.trim(),
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
        {/* Only worth asking when there is a choice; one backend is not a decision. */}
        {kinds.length > 1 && (
          <label style={{ display: 'grid', gap: 3, flex: '0 1 150px' }}>
            <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>Backend</span>
            <select
              aria-label="Backend"
              value={adapter}
              onChange={(event) => setAdapter(event.target.value)}
              style={field}
            >
              {kinds.map((kind) => (
                <option key={kind.id} value={kind.id}>
                  {kind.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label style={{ display: 'grid', gap: 3, flex: '1 1 160px' }}>
          <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>
            Admin path{' '}
            <span style={{ color: 'var(--mk-text-tertiary)' }}>
              (default {chosen?.defaultAdminPath ?? '/__admin'})
            </span>
          </span>
          <input
            aria-label="Admin path"
            placeholder={chosen?.defaultAdminPath ?? '/__admin'}
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

      {/* `minWidth: 0` because a grid item defaults to `min-width: auto` and will not shrink below
          its content: without it the hint ran off the side of the card instead of wrapping. */}
      {document !== null && (
        <label style={{ display: 'grid', gap: 3, marginTop: 8, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>
            {document.label} <span style={{ color: 'var(--mk-warning-text)' }}>(required)</span>
          </span>
          <input
            aria-label={document.label}
            placeholder="/absolute/path/to/environment.json"
            value={documentPath}
            onChange={(event) => setDocumentPath(event.target.value)}
            style={field}
          />
          <span style={{ fontSize: 12, color: 'var(--mk-text-tertiary)', minWidth: 0 }}>
            {document.hint}
          </span>
        </label>
      )}

      {/*
        Only where the backend accepts a credential. WireMock secures its admin API with basic
        auth; the others here take none, and a field that cannot do anything is worse than none.
      */}
      {authentication !== null && (
        <fieldset
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            // `flex-start`, not `flex-end`. With the hint line under one field the boxes are
            // different heights, and aligning their *bottoms* pushed the labels out of line with
            // each other. Tops line up because every label here is one row.
            alignItems: 'flex-start',
            margin: '8px 0 0',
            padding: 0,
            border: 0,
            minWidth: 0,
          }}
        >
          <legend
            style={{
              padding: 0,
              fontSize: 12,
              color: 'var(--mk-text-secondary)',
              marginBottom: 3,
            }}
          >
            Authentication
          </legend>
          <label style={{ display: 'grid', gap: 3, flex: '0 1 150px' }}>
            <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>Method</span>
            <select
              aria-label="Authentication"
              value={authKind}
              onChange={(event) => setAuthKind(event.target.value)}
              style={field}
            >
              <option value="none">None</option>
              {authentication.kinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind === 'basic' ? 'Basic auth' : kind === 'bearer' ? 'Bearer token' : kind}
                </option>
              ))}
            </select>
          </label>

          {wantsCredential && authKind === 'basic' && (
            <label style={{ display: 'grid', gap: 3, flex: '1 1 200px', minWidth: 0 }}>
              <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>Username</span>
              <input
                aria-label="Username"
                autoComplete="off"
                value={authUsername}
                onChange={(event) => setAuthUsername(event.target.value)}
                style={field}
              />
            </label>
          )}

          {wantsCredential && (
            <label style={{ display: 'grid', gap: 3, flex: '1 1 200px', minWidth: 0 }}>
              <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>
                {authKind === 'basic' ? 'Password' : 'Token'}{' '}
                {existing?.authSecretSet === true && (
                  <span style={{ color: 'var(--mk-text-tertiary)' }}>(leave blank to keep)</span>
                )}
              </span>
              <input
                aria-label={authKind === 'basic' ? 'Password' : 'Token'}
                type="password"
                autoComplete="new-password"
                placeholder={existing?.authSecretSet === true ? '••••••••' : ''}
                value={authSecret}
                onChange={(event) => setAuthSecret(event.target.value)}
                style={field}
              />
            </label>
          )}
          {wantsCredential && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                // Aligned to the inputs rather than to their labels: this control has no label
                // row of its own, so without the offset it floats a row too high.
                marginTop: 20,
                fontSize: 13,
                whiteSpace: 'nowrap',
              }}
            >
              <input
                type="checkbox"
                checked={rememberSecret}
                onChange={(event) => setRememberSecret(event.target.checked)}
              />
              Remember on this machine
            </label>
          )}
        </fieldset>
      )}

      {wantsCredential && (
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 12,
            color: 'var(--mk-text-tertiary)',
          }}
        >
          {authentication?.note}{' '}
          {rememberSecret
            ? 'Remembered means written to Mock Knight’s state database on this machine, in plain text — the file is not readable by other accounts, but it is not encrypted.'
            : 'Kept for this run only and never written to disk; you will re-enter it after a restart.'}{' '}
          A shared <code>mock-knight.json</code> can use <code>{'${env:VAR}'}</code> instead.
        </p>
      )}

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
        {/* Disabled rather than absent: unlike a capability the backend does not have, this is a
            field the user can fill in, and the label says which one. */}
        <Button
          variant="primary"
          disabled={pending || preview === '' || documentMissing}
          onClick={submit}
        >
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
