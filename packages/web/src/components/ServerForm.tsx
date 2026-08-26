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
 * The authentication methods, and how to ask for each one's variable names.
 *
 * Every one of them takes the **name of an environment variable**, never a secret: the value is
 * read from the environment in the server process when a connection is made, and never stored,
 * logged, or sent to the browser (PRD §12). The labels say so because a field asking for
 * "credentials" invites someone to paste a token straight into the state database.
 */
const AUTH_CHOICES = [
  { kind: 'none', label: 'None' },
  {
    kind: 'bearer',
    label: 'Bearer token',
    field: 'Variable holding the token',
    placeholder: 'WIREMOCK_TOKEN',
    hint: 'The name of an environment variable. Mock Knight sends its value as a Bearer token.',
  },
  {
    kind: 'basic',
    label: 'Basic auth',
    field: 'Two variables, user:password',
    placeholder: 'WIREMOCK_USER:WIREMOCK_PASS',
    hint: 'Two environment variable names separated by a colon — not the username and password themselves.',
  },
  {
    kind: 'headers',
    label: 'Custom headers',
    field: 'Header=VARIABLE pairs',
    placeholder: 'Authorization=WM_TOKEN,X-Api-Key=WM_KEY',
    hint: 'Comma-separated. Each pair is a header name and the environment variable holding its value.',
  },
] as const

/**
 * Whether what was typed looks like a secret rather than a variable name.
 *
 * Deliberately loose, and it only warns. Environment variable names are conventionally
 * `UPPER_SNAKE_CASE`; a JWT, a hex key or anything with the punctuation of a real credential is
 * not one. The cost of a false negative is a secret in the state database, so the check leans
 * towards asking.
 */
export function looksLikeSecret(kind: string, value: string): boolean {
  const trimmed = value.trim()
  if (kind === 'none' || trimmed === '') return false
  // Split on the separators each kind legitimately uses, and judge the variable names alone.
  const names = trimmed
    .split(/[:,]/)
    .map((part) => (part.includes('=') ? part.slice(part.indexOf('=') + 1) : part))
  return names.some((name) => {
    const candidate = name.trim()
    if (candidate === '') return false

    // Punctuation an identifier cannot contain: `:` and `,` are already split on, so anything
    // left is a credential's alphabet, not a name's.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) return true
    // Nothing anyone names a variable is this long.
    if (candidate.length > 40) return true
    /*
     * Mixed case past twenty characters.
     *
     * A JWT header segment — `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9` — is *entirely
     * alphanumeric*, so it passes the identifier test above and slipped through the first
     * version of this check. Variable names are conventionally one case throughout;
     * base64 is not.
     */
    if (candidate.length > 20 && /[a-z]/.test(candidate) && /[A-Z]/.test(candidate)) return true
    // A long run with no underscore and digits mixed in: hex keys and API tokens look like this,
    // and variable names of that length almost always separate words.
    if (candidate.length > 24 && !candidate.includes('_') && /\d/.test(candidate)) return true
    return false
  })
}

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
  const [authRef, setAuthRef] = useState(existing?.authRef ?? '')
  const document = chosen?.corpusDocument ?? null
  const documentMissing = document !== null && documentPath.trim() === ''

  // Shown live, because the composed URL is the thing that is actually wrong when a context
  // path is missing, and it is not obvious from the two fields that produce it.
  //
  // The *same* function the transport calls, not a second implementation of it. A preview
  // computed separately can drift from where the request actually goes, and it would drift on
  // precisely the input this exists to catch. Empty while the base URL is still half-typed and
  // does not parse.
  const choice = AUTH_CHOICES.find((entry) => entry.kind === authKind)
  // `none` carries no variable field, so the input is absent rather than disabled.
  const auth = choice !== undefined && 'field' in choice ? choice : null
  const looksLikeASecret = looksLikeSecret(authKind, authRef)

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
      authKind,
      // The *name* of an environment variable, never a secret. Empty means no auth configured
      // even if a kind is selected, which the transport reads as `none`.
      authRef: authKind === 'none' || authRef.trim() === '' ? null : authRef.trim(),
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

      <fieldset
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          margin: '8px 0 0',
          padding: 0,
          border: 0,
          minWidth: 0,
        }}
      >
        <legend
          style={{ padding: 0, fontSize: 12, color: 'var(--mk-text-secondary)', marginBottom: 3 }}
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
            {AUTH_CHOICES.map((choice) => (
              <option key={choice.kind} value={choice.kind}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        {auth !== null && (
          <label style={{ display: 'grid', gap: 3, flex: '2 1 260px', minWidth: 0 }}>
            <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>{auth.field}</span>
            <input
              aria-label={auth.field}
              placeholder={auth.placeholder}
              value={authRef}
              onChange={(event) => setAuthRef(event.target.value)}
              style={field}
            />
            <span style={{ fontSize: 12, color: 'var(--mk-text-tertiary)', minWidth: 0 }}>
              {auth.hint}
            </span>
          </label>
        )}
      </fieldset>

      {/*
        A warning, not a refusal: the rule is a convention, not a law, and someone with a
        lowercase variable name should not be blocked. But a pasted secret would be stored in the
        state database and shown in every profile listing, so it is worth saying loudly.
      */}
      {looksLikeASecret && (
        <p
          role="status"
          style={{
            margin: '6px 0 0',
            padding: '6px 8px',
            fontSize: 12,
            color: 'var(--mk-warning-text)',
            background: 'var(--mk-warning-bg)',
            border: '1px solid var(--mk-warning-border)',
            borderRadius: 'var(--mk-radius-sm)',
          }}
        >
          That does not look like an environment variable name. This field takes the{' '}
          <strong>name of a variable</strong> — <code>WIREMOCK_TOKEN</code> — and Mock Knight reads
          the value from the environment when it connects. A secret typed here would be stored in
          the state database and shown in the servers list.
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
