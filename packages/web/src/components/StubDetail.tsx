import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api.js'
import { describeStanding } from '@mock-knight/core/types'
import type { JsonObject, MockDraft } from '@mock-knight/core/types'
import {
  Button,
  Chip,
  ErrorDisclosure,
  InferenceLabel,
  MethodChip,
  PriorityCell,
  Skeleton,
  StatusCode,
  toFailure,
} from './primitives.js'
import type { Failure } from './primitives.js'
import { ConflictDialog } from './ConflictDialog.js'
import { MatcherForm } from './MatcherForm.js'

/**
 * The detail pane — design brief §6.3.
 *
 * Overview is the landing tab because most visits are reads, not edits. Raw JSON is the same
 * object, always reachable: if the rendered view cannot express something, the JSON can, and it
 * is the verbatim payload from the server rather than anything reconstructed.
 */

export interface StubDetailProps {
  profileId: string
  profileName: string
  /** Writes are absent, not disabled, where the profile or backend forbids them (§7.1). */
  canWrite: boolean
  clientKey: string | null
}

type Tab = 'overview' | 'matcher' | 'raw' | 'history'

export function StubDetail({ profileId, profileName, canWrite, clientKey }: StubDetailProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['mock', profileId, clientKey],
    queryFn: () => api.mock(profileId, clientKey!),
    enabled: clientKey !== null,
  })

  const loaded = query.data?.mock
  const serverDraft = query.data?.draft ?? null
  const loadedText = useMemo(
    () => (loaded === undefined ? '' : JSON.stringify(loaded.raw, null, 2)),
    [loaded],
  )
  const [draft, setDraft] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{
    theirs: JsonObject
    mine: JsonObject
    /**
     * The hash of what the server holds *now*. Retrying a merge with the hash we originally
     * loaded is guaranteed to be refused again — the whole reason we are here is that it went
     * stale. The retry has to be rebased onto the version the conflict just showed us.
     */
    currentHash: string
  } | null>(null)
  const [error, setError] = useState<Failure | null>(null)
  /** Unsaved edits made through the form tabs, as a canonical draft. */
  const [formDraft, setFormDraft] = useState<MockDraft | null>(null)

  // Selecting a different stub abandons an untouched draft; a touched one is kept until the
  // user resolves it, so switching rows cannot silently discard typing.
  //
  // Adjusted during render rather than in an effect (react.dev, "You Might Not Need an
  // Effect"). An effect would commit the *previous* stub's draft against the new stub's id
  // first and correct it on a second pass — one wasted render, and a frame in which the pane
  // shows one stub's edits under another stub's heading. A `key` on this component would also
  // work but resets the active tab, so clicking through rows would throw you back to Overview
  // every time.
  const [shownKey, setShownKey] = useState(clientKey)
  if (shownKey !== clientKey) {
    setShownKey(clientKey)
    setDraft(null)
    setFormDraft(null)
    setConflict(null)
    setError(null)
  }

  /**
   * Two edit channels, deliberately exclusive.
   *
   * The form edits a canonical draft and the Raw tab edits the vendor document, and the browser
   * cannot convert between them — rendering a draft needs an adapter, which lives on the server
   * (the layering rule). Keeping both live would mean showing two documents that disagree and
   * silently picking one on save. So whichever channel is dirty locks the other, and the locked
   * tab says why rather than looking inexplicably read-only.
   */
  const rawDirty = draft !== null && draft !== loadedText
  const formDirty = formDraft !== null
  const dirty = rawDirty || formDirty

  /**
   * Shared by both write channels, so a conflict opens the same merge dialog whichever tab the
   * edit came from. Two handlers here would be two subtly different conflict stories.
   */
  const handleWriteError = (caught: unknown): void => {
    // A 409 is not an error to report — it is the three-way merge's cue. Discriminate on the
    // payload, not the status: `not_connected` is also a 409, and treating that as a merge
    // conflict opens the dialog with no documents in it.
    const payload = caught instanceof ApiError ? (caught.payload as { error?: string }) : null
    if (caught instanceof ApiError && caught.status === 409 && payload?.error === 'conflict') {
      const conflictPayload = caught.payload as {
        current: JsonObject
        currentHash: string
        message: string
        /** Present for a form write, which never had a vendor document of its own to offer. */
        attempted?: JsonObject
      }
      setConflict({
        theirs: conflictPayload.current,
        mine: conflictPayload.attempted ?? parseDraft(draft) ?? {},
        currentHash: conflictPayload.currentHash,
      })
      return
    }
    if (caught instanceof ApiError && payload?.error === 'not_connected') {
      setError({
        sentence: 'Not connected to the mock server. Reconnect, then save again.',
        payload: null,
      })
      return
    }
    setError(describeError(caught))
  }

  const save = useMutation({
    mutationFn: async ({ raw, baseHash }: { raw: JsonObject; baseHash: string }) => {
      if (loaded === undefined) throw new Error('nothing loaded')
      return api.updateMock(profileId, loaded.clientKey, raw, baseHash)
    },
    onSuccess: () => {
      setDraft(null)
      setConflict(null)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['mock', profileId] })
      void queryClient.invalidateQueries({ queryKey: ['corpus'] })
    },
    onError: (caught: unknown) => handleWriteError(caught),
  })

  const saveDraft = useMutation({
    mutationFn: async ({ draft: next, baseHash }: { draft: MockDraft; baseHash: string }) => {
      if (loaded === undefined) throw new Error('nothing loaded')
      return api.updateMockDraft(profileId, loaded.clientKey, next, baseHash)
    },
    onSuccess: () => {
      setFormDraft(null)
      setConflict(null)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['mock', profileId] })
      void queryClient.invalidateQueries({ queryKey: ['corpus'] })
    },
    // The same handler as the raw path, so a conflict opens the same merge dialog rather than
    // becoming a second, subtly different conflict story.
    onError: (caught: unknown) => handleWriteError(caught),
  })

  const remove = useMutation({
    mutationFn: async () => {
      if (loaded === undefined) throw new Error('nothing loaded')
      return api.deleteMock(profileId, loaded.clientKey, loaded.contentHash)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['corpus'] })
    },
    onError: (caught: unknown) => setError(describeError(caught)),
  })

  const attemptSave = () => {
    if (formDraft !== null) {
      // The form channel: send the canonical draft and let the server patch the document.
      saveDraft.mutate({ draft: formDraft, baseHash: loaded?.contentHash ?? '' })
      return
    }
    const parsed = parseDraft(draft)
    if (parsed === null) {
      setError({
        sentence: 'That is not valid JSON, so nothing was sent to the server.',
        payload: null,
      })
      return
    }
    setError(null)
    save.mutate({ raw: parsed, baseHash: loaded?.contentHash ?? '' })
  }

  if (clientKey === null) {
    return (
      <aside style={paneStyle}>
        <div style={{ padding: 24, color: 'var(--mk-text-tertiary)', fontSize: 14 }}>
          Select a stub to see how it matches and what it returns.
        </div>
      </aside>
    )
  }

  if (query.isPending) {
    return (
      <aside style={paneStyle}>
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          <Skeleton width="60%" height={18} />
          <Skeleton width="90%" />
          <Skeleton width="75%" />
          <Skeleton width="80%" height={120} />
        </div>
      </aside>
    )
  }

  if (query.isError) {
    return (
      <aside style={paneStyle}>
        <div style={{ padding: 16, fontSize: 13, color: 'var(--mk-danger-text)' }}>
          Could not load this stub.
          <details style={{ marginTop: 8, color: 'var(--mk-text-secondary)' }}>
            <summary style={{ cursor: 'pointer' }}>Details</summary>
            <pre className="mk-mono" style={preStyle}>
              {String(query.error)}
            </pre>
          </details>
        </div>
      </aside>
    )
  }

  const mock = query.data.mock

  return (
    <aside style={paneStyle}>
      <header
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--mk-border-default)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <MethodChip method={mock.method} />
        <span
          className="mk-mono"
          style={{
            fontSize: 12,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {mock.url?.value ?? '—'}
        </span>
        <StatusCode status={mock.status} />
      </header>

      <div
        role="tablist"
        style={{ display: 'flex', borderBottom: '1px solid var(--mk-border-default)' }}
      >
        {(
          [
            ['overview', 'Overview'],
            ['matcher', 'Matcher'],
            ['raw', 'Raw JSON'],
            ['history', 'History'],
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
            {/* An unsaved draft is a filled accent dot on the tab (design brief §7.3), on the
                tab that actually holds the edit. */}
            {((value === 'raw' && rawDirty) || (value === 'matcher' && formDirty)) && (
              <span
                aria-label="unsaved changes"
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  marginLeft: 6,
                  borderRadius: 9999,
                  background: 'var(--mk-accent-solid)',
                }}
              />
            )}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {tab === 'overview' ? (
          <dl
            style={{
              margin: 0,
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '8px 12px',
              fontSize: 13,
            }}
          >
            <Row label="Name">{mock.name ?? <Muted>unnamed</Muted>}</Row>
            <Row label="Match">
              <span className="mk-mono" style={{ fontSize: 12 }}>
                {mock.url === null ? <Muted>any</Muted> : `${mock.url.kind} ${mock.url.value}`}
              </span>
            </Row>
            <Row label="Headers">
              {mock.headers.length === 0 ? (
                <Muted>matches on no header</Muted>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
                  {mock.headers.map((header, index) => (
                    <li
                      key={`${header.name}-${index}`}
                      className="mk-mono"
                      style={{ fontSize: 12, overflowWrap: 'anywhere' }}
                    >
                      <span style={{ color: 'var(--mk-code-key)' }}>{header.name}</span>{' '}
                      <span style={{ color: 'var(--mk-text-tertiary)' }}>{header.operator}</span>
                      {header.value !== null && (
                        <>
                          {' '}
                          <span style={{ color: 'var(--mk-code-string)' }}>{header.value}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Row>
            <Row label="Status">
              <StatusCode status={mock.status} />
            </Row>
            <Row label="Priority">
              {/* The same cell the list uses, so "1 of 3" means one thing in both places. The
                  detail pane is where someone lands after spotting the flag in the row. */}
              <PriorityCell standing={mock.standing} />
            </Row>
            {describeStanding(mock.standing) !== null && (
              <Row label="">
                <InferenceLabel title="Mock Knight compares stubs that share a URL matcher and whose methods can overlap. Stubs that overlap by pattern alone are not detected.">
                  {describeStanding(mock.standing)}
                </InferenceLabel>
              </Row>
            )}
            <Row label="Scenario">
              {mock.scenario === null ? (
                <Muted>none</Muted>
              ) : (
                <Chip tone="accent">{mock.scenario}</Chip>
              )}
            </Row>
            <Row label="Folder">
              {mock.folder.length === 0 ? (
                <Muted>none</Muted>
              ) : (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <span className="mk-mono" style={{ fontSize: 12 }}>
                    {mock.folder.join('/')}
                  </span>
                  {mock.folderSource === 'path' && (
                    <InferenceLabel title="No folder was stored on this stub, so Mock Knight grouped it by its URL path. The server did not say this.">
                      from the path
                    </InferenceLabel>
                  )}
                </span>
              )}
            </Row>
            <Row label="Tags">
              {mock.tags.length === 0 ? (
                <Muted>none</Muted>
              ) : (
                <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                  {mock.tags.map((tag) => (
                    <Chip key={tag}>{tag}</Chip>
                  ))}
                </span>
              )}
            </Row>
            <Row label="Enabled">
              {/* `null` is not `false`: WireMock Java has no disabled flag, so the honest answer
                  is that this server has no such concept — not that the stub is switched on. */}
              {mock.enabled === null ? (
                <Muted>this server has no enabled/disabled concept</Muted>
              ) : (
                String(mock.enabled)
              )}
            </Row>
            <Row label="Server id">
              <span className="mk-mono" style={{ fontSize: 12 }}>
                {mock.serverId ?? <Muted>none — identified by content</Muted>}
              </span>
            </Row>
          </dl>
        ) : tab === 'history' ? (
          <History profileId={profileId} clientKey={mock.clientKey} />
        ) : tab === 'matcher' ? (
          serverDraft === null ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--mk-text-secondary)' }}>
              {/* Not a form with a Save that cannot work: interpreting the document needs the
                  adapter, and without a connection there is nothing to save to. */}
              Not connected to the mock server, so this stub cannot be read as a form. Reconnect
              from Servers, or read the document on the Raw JSON tab.
            </p>
          ) : (
            <>
              {rawDirty && (
                <p
                  role="status"
                  style={{
                    margin: '0 0 12px',
                    padding: '6px 8px',
                    fontSize: 12,
                    color: 'var(--mk-warning-text)',
                    background: 'var(--mk-warning-bg)',
                    border: '1px solid var(--mk-warning-border)',
                    borderRadius: 'var(--mk-radius-sm)',
                  }}
                >
                  You have unsaved edits on the Raw JSON tab, so this form is read-only until they
                  are saved or discarded. The two edit the same stub in different shapes and cannot
                  both be live.
                </p>
              )}
              <MatcherForm
                draft={formDraft ?? serverDraft}
                disabled={!canWrite || rawDirty}
                onChange={setFormDraft}
              />
            </>
          )
        ) : canWrite ? (
          <>
            {formDirty && (
              <p
                role="status"
                style={{
                  margin: '0 0 8px',
                  padding: '6px 8px',
                  fontSize: 12,
                  color: 'var(--mk-warning-text)',
                  background: 'var(--mk-warning-bg)',
                  border: '1px solid var(--mk-warning-border)',
                  borderRadius: 'var(--mk-radius-sm)',
                }}
              >
                You have unsaved edits on the Matcher tab. This shows the document as the server
                holds it, and is read-only until those are saved or discarded.
              </p>
            )}
            <textarea
              aria-label="Raw JSON"
              spellCheck={false}
              readOnly={formDirty}
              value={draft ?? loadedText}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 's') {
                  event.preventDefault()
                  if (dirty) attemptSave()
                }
                if (event.key === 'Escape' && dirty) {
                  event.preventDefault()
                  setDraft(null)
                  setFormDraft(null)
                }
              }}
              className="mk-mono"
              style={{ ...preStyle, width: '100%', minHeight: 340, resize: 'vertical' }}
            />
          </>
        ) : (
          <pre className="mk-mono" style={preStyle}>
            {loadedText}
          </pre>
        )}
      </div>

      {error !== null && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--mk-danger-border)' }}>
          {/* A refused write is the case where the upstream body matters most: WireMock answers
              422 with the property it did not recognise, and that names the fix exactly. */}
          <ErrorDisclosure sentence={error.sentence} payload={error.payload} />
        </div>
      )}

      {canWrite && (tab === 'raw' || tab === 'matcher') && (
        <footer
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderTop: '1px solid var(--mk-border-default)',
          }}
        >
          {dirty ? (
            <>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--mk-text-secondary)' }}>
                ⌘S save · esc discard
              </span>
              <Button
                onClick={() => {
                  setDraft(null)
                  setFormDraft(null)
                }}
              >
                Discard
              </Button>
              <Button variant="primary" disabled={save.isPending} onClick={attemptSave}>
                {save.isPending || saveDraft.isPending ? 'Saving…' : 'Save'}
              </Button>
            </>
          ) : (
            <>
              <span style={{ flex: 1 }} />
              <DeleteButton
                name={mock.name ?? mock.url?.value ?? 'this stub'}
                pending={remove.isPending}
                onConfirm={() => remove.mutate()}
              />
            </>
          )}
        </footer>
      )}

      {conflict !== null && (
        <ConflictDialog
          profileName={profileName}
          base={(mock.raw ?? {}) as JsonObject}
          theirs={conflict.theirs}
          mine={conflict.mine}
          saving={save.isPending}
          onCancel={() => setConflict(null)}
          onResolve={(merged) => {
            // Rebased onto the version the conflict reported, not the one originally loaded.
            // The freshness check still runs server-side, so a third writer arriving between
            // the dialog opening and this click is caught exactly the same way.
            setDraft(JSON.stringify(merged, null, 2))
            save.mutate({ raw: merged, baseHash: conflict.currentHash })
          }}
        />
      )}
    </aside>
  )
}

/**
 * Delete needs the target named and typed back (design brief §7.2). Muscle memory defeats a
 * double-click confirm, and this is the one action with nothing left on screen afterwards.
 */
function DeleteButton({
  name,
  pending,
  onConfirm,
}: {
  name: string
  pending: boolean
  onConfirm: () => void
}) {
  const [arming, setArming] = useState(false)
  const [typed, setTyped] = useState('')
  if (!arming) {
    return (
      <Button onClick={() => setArming(true)} title={`Delete ${name}`}>
        Delete…
      </Button>
    )
  }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
      <span style={{ fontSize: 12, color: 'var(--mk-text-secondary)' }}>
        Type <code className="mk-mono">{name}</code>
      </span>
      <input
        autoFocus
        aria-label="Type the stub name to confirm deletion"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        style={{
          flex: 1,
          minWidth: 0,
          height: 24,
          padding: '0 6px',
          font: 'inherit',
          fontSize: 12,
          color: 'var(--mk-text-primary)',
          background: 'var(--mk-bg-surface)',
          border: '1px solid var(--mk-border-strong)',
          borderRadius: 'var(--mk-radius-sm)',
        }}
      />
      <Button onClick={() => setArming(false)}>Cancel</Button>
      <button
        type="button"
        disabled={typed !== name || pending}
        onClick={onConfirm}
        style={{
          height: 26,
          padding: '0 10px',
          font: 'inherit',
          fontSize: 13,
          borderRadius: 'var(--mk-radius-sm)',
          cursor: typed === name ? 'pointer' : 'not-allowed',
          opacity: typed === name ? 1 : 0.5,
          color: 'var(--mk-danger-on-solid)',
          background: 'var(--mk-danger-solid)',
          border: '1px solid var(--mk-danger-solid)',
        }}
      >
        {pending ? 'Deleting…' : 'Delete'}
      </button>
    </span>
  )
}

/** The local audit trail for one stub, with the scope note the API insists on. */
function History({ profileId, clientKey }: { profileId: string; clientKey: string }) {
  const query = useQuery({
    queryKey: ['audit', profileId, clientKey],
    queryFn: () => api.audit(profileId, clientKey),
  })
  if (query.isPending) return <Skeleton width="80%" height={60} />
  if (query.data === undefined || query.data.entries.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--mk-text-tertiary)' }}>
        No changes recorded. {query.data?.scope ?? ''}
      </p>
    )
  }
  return (
    <>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {query.data.entries.map((entry) => (
          <li key={entry.id} style={{ fontSize: 13 }}>
            <span style={{ color: 'var(--mk-text-primary)' }}>{entry.summary}</span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
              {entry.actor} · {new Date(entry.at).toLocaleString()} · {entry.action}
            </span>
          </li>
        ))}
      </ul>
      <p style={{ marginTop: 12, fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
        {query.data.scope} A change made with curl leaves no trace here.
      </p>
    </>
  )
}

function parseDraft(draft: string | null): JsonObject | null {
  if (draft === null) return null
  try {
    const parsed: unknown = JSON.parse(draft)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : null
  } catch {
    return null
  }
}

function describeError(caught: unknown): Failure {
  const fallback =
    caught instanceof ApiError
      ? `The server refused the write (${caught.status}).`
      : 'The write failed.'
  return toFailure(caught, fallback)
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt style={{ color: 'var(--mk-text-secondary)', whiteSpace: 'nowrap' }}>{label}</dt>
      <dd style={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</dd>
    </>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--mk-text-tertiary)' }}>{children}</span>
}

const paneStyle: React.CSSProperties = {
  width: 440,
  flex: '0 0 440px',
  borderLeft: '1px solid var(--mk-border-default)',
  background: 'var(--mk-bg-surface)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: 10,
  fontSize: 12,
  lineHeight: '20px',
  background: 'var(--mk-code-bg)',
  border: '1px solid var(--mk-border-subtle)',
  borderRadius: 'var(--mk-radius-md)',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
}
