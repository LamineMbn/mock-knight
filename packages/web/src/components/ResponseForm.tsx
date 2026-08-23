import type { Json, MockDraft, ResponseBodyKind, ResponseSpec } from '@mock-knight/core/types'
import { RESPONSE_BODY_KINDS } from '@mock-knight/core/types'
import { Button, Chip, StatusCode } from './primitives.js'

/**
 * The Response tab — FR-EDIT-1, FR-EDIT-2.
 *
 * Same contract as the Matcher tab: this edits a canonical draft and the server renders it by
 * patching the retained vendor document, so a field this form cannot show is not deleted by an
 * edit made here.
 *
 * The part worth more than the fields is the conflict warning. WireMock's `fault` closes the
 * connection *instead of* replying, and `proxyBaseUrl` forwards the request *instead of*
 * serving a body — so a stub carrying a fault and a carefully written body returns none of that
 * body, silently, and looks correct in every list. Reading the JSON does not make it obvious
 * either. Saying so is most of the value of rendering this as a form at all.
 */

/** WireMock's connection-level faults. Open-ended: an unknown value is kept and shown. */
const KNOWN_FAULTS = [
  'CONNECTION_RESET_BY_PEER',
  'EMPTY_RESPONSE',
  'MALFORMED_RESPONSE_CHUNK',
  'RANDOM_DATA_THEN_CLOSE',
]

const field: React.CSSProperties = {
  height: 26,
  padding: '0 6px',
  font: 'inherit',
  fontSize: 12,
  color: 'var(--mk-text-primary)',
  background: 'var(--mk-bg-surface)',
  border: '1px solid var(--mk-border-default)',
  borderRadius: 'var(--mk-radius-sm)',
  minWidth: 0,
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <h3
        style={{
          margin: '0 0 6px',
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--mk-text-secondary)',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  )
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </p>
  )
}

/** Render the body value as text for editing, whatever shape it is held in. */
function bodyText(kind: ResponseBodyKind, value: Json | null): string {
  if (value === null || value === undefined) return ''
  if (kind === 'json') return JSON.stringify(value, null, 2)
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function ResponseForm({
  draft,
  disabled,
  onChange,
}: {
  draft: MockDraft
  disabled: boolean
  onChange: (next: MockDraft) => void
}) {
  const response = draft.response
  const patch = (next: Partial<ResponseSpec>) =>
    onChange({ ...draft, response: { ...response, ...next } })

  const hasBody = response.body.kind !== 'none'
  const headerNames = Object.keys(response.headers)

  // Typed but unparseable JSON is kept as text so a half-finished edit is not thrown away on
  // every keystroke; the save is what refuses it.
  const bodyIsBrokenJson =
    response.body.kind === 'json' &&
    typeof response.body.value === 'string' &&
    (() => {
      try {
        JSON.parse(response.body.value as string)
        return false
      } catch {
        return true
      }
    })()

  return (
    <div>
      {response.fault !== null && hasBody && (
        <Warning>
          This stub sets a fault <strong>and</strong> a body. A fault closes the connection instead
          of replying, so the body is never sent — remove one of them.
        </Warning>
      )}
      {response.proxy !== null && hasBody && (
        <Warning>
          This stub proxies <strong>and</strong> defines a body. The request is forwarded to{' '}
          <code className="mk-mono">{response.proxy.baseUrl}</code> and the body here is never used.
        </Warning>
      )}
      {bodyIsBrokenJson && (
        <Warning>That body is not valid JSON yet. Saving will be refused until it is.</Warning>
      )}

      <Section title="Status">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            aria-label="Status code"
            type="number"
            disabled={disabled}
            value={response.status ?? ''}
            onChange={(event) =>
              patch({ status: event.target.value === '' ? null : Number(event.target.value) })
            }
            className="mk-tabular"
            style={{ ...field, flex: '0 0 80px' }}
          />
          <StatusCode status={response.status} />
          <input
            aria-label="Status message"
            disabled={disabled}
            placeholder="Reason phrase (optional)"
            value={response.statusMessage ?? ''}
            onChange={(event) =>
              patch({ statusMessage: event.target.value === '' ? null : event.target.value })
            }
            style={{ ...field, flex: 1 }}
          />
        </div>
      </Section>

      <Section title="Response headers">
        {headerNames.length === 0 && (
          <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--mk-text-tertiary)' }}>None.</p>
        )}
        <div style={{ display: 'grid', gap: 6 }}>
          {headerNames.map((name) => {
            const value = response.headers[name]!
            const multiple = Array.isArray(value)
            return (
              <div key={name} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  aria-label="Response header name"
                  disabled={disabled}
                  value={name}
                  onChange={(event) => {
                    // Rebuilt in order, so renaming does not reorder the list under the cursor.
                    const next: ResponseSpec['headers'] = {}
                    for (const key of headerNames)
                      next[key === name ? event.target.value : key] = response.headers[key]!
                    patch({ headers: next })
                  }}
                  className="mk-mono"
                  style={{ ...field, flex: '0 0 150px' }}
                />
                <input
                  aria-label="Response header value"
                  disabled={disabled || multiple}
                  value={multiple ? (value as string[]).join(', ') : (value as string)}
                  onChange={(event) =>
                    patch({ headers: { ...response.headers, [name]: event.target.value } })
                  }
                  className="mk-mono"
                  style={{ ...field, flex: 1 }}
                />
                {multiple && (
                  <Chip
                    tone="neutral"
                    title="This header is sent more than once. Editing repeated values is not supported here; use the Raw JSON tab."
                  >
                    ×{(value as string[]).length}
                  </Chip>
                )}
                <Button
                  variant="quiet"
                  disabled={disabled}
                  onClick={() => {
                    const next = { ...response.headers }
                    delete next[name]
                    patch({ headers: next })
                  }}
                >
                  Remove
                </Button>
              </div>
            )
          })}
        </div>
        <div style={{ marginTop: 6 }}>
          <Button
            disabled={disabled || Object.hasOwn(response.headers, '')}
            onClick={() => patch({ headers: { ...response.headers, '': '' } })}
          >
            Add header
          </Button>
        </div>
      </Section>

      <Section title="Body">
        <select
          aria-label="Body kind"
          disabled={disabled}
          value={response.body.kind}
          onChange={(event) => {
            const kind = event.target.value as ResponseBodyKind
            // Switching kind keeps the text where that is meaningful and clears it where it is
            // not, rather than carrying a base64 blob into a JSON editor.
            const keep = kind !== 'none' && response.body.kind !== 'none' && kind !== 'json'
            patch({
              body: { kind, value: keep ? response.body.value : kind === 'none' ? null : '' },
            })
          }}
          style={{ ...field, marginBottom: 6, flex: '0 0 120px' }}
        >
          {RESPONSE_BODY_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>

        {response.body.kind === 'none' ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
            No body is returned.
          </p>
        ) : response.body.kind === 'file' ? (
          <input
            aria-label="Body file name"
            disabled={disabled}
            className="mk-mono"
            value={typeof response.body.value === 'string' ? response.body.value : ''}
            onChange={(event) => patch({ body: { kind: 'file', value: event.target.value } })}
            style={{ ...field, width: '100%' }}
          />
        ) : (
          <textarea
            aria-label="Body"
            disabled={disabled}
            spellCheck={false}
            value={bodyText(response.body.kind, response.body.value)}
            onChange={(event) =>
              // Held as text while typing even for `json`, so a half-written document is not
              // discarded on every keystroke. The save is where it has to parse.
              patch({ body: { kind: response.body.kind, value: event.target.value } })
            }
            className="mk-mono"
            style={{
              width: '100%',
              minHeight: 140,
              resize: 'vertical',
              padding: 8,
              fontSize: 12,
              color: 'var(--mk-text-primary)',
              background: 'var(--mk-bg-surface)',
              border: `1px solid ${bodyIsBrokenJson ? 'var(--mk-warning-border)' : 'var(--mk-border-default)'}`,
              borderRadius: 'var(--mk-radius-sm)',
            }}
          />
        )}
      </Section>

      <Section title="Delay">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            aria-label="Delay milliseconds"
            type="number"
            disabled={disabled}
            placeholder="none"
            value={response.delay?.milliseconds ?? ''}
            onChange={(event) =>
              patch({
                delay:
                  event.target.value === ''
                    ? null
                    : {
                        kind: response.delay?.kind ?? 'fixed',
                        milliseconds: Number(event.target.value),
                        options: response.delay?.options ?? {},
                      },
              })
            }
            className="mk-tabular"
            style={{ ...field, flex: '0 0 100px' }}
          />
          <span style={{ fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
            ms
            {response.delay !== null && response.delay.kind !== 'fixed' && (
              <> · {response.delay.kind} distribution, its parameters preserved</>
            )}
          </span>
        </div>
      </Section>

      <Section title="Fault">
        <select
          aria-label="Fault"
          disabled={disabled}
          value={response.fault ?? ''}
          onChange={(event) =>
            patch({ fault: event.target.value === '' ? null : event.target.value })
          }
          style={{ ...field, flex: '0 0 240px' }}
        >
          <option value="">None — reply normally</option>
          {KNOWN_FAULTS.map((fault) => (
            <option key={fault} value={fault}>
              {fault}
            </option>
          ))}
          {/* An unrecognised fault is offered back to itself so selecting nothing else keeps it. */}
          {response.fault !== null && !KNOWN_FAULTS.includes(response.fault) && (
            <option value={response.fault}>{response.fault}</option>
          )}
        </select>
      </Section>

      {response.proxy !== null && (
        <Section title="Proxy">
          <input
            aria-label="Proxy base URL"
            disabled={disabled}
            className="mk-mono"
            value={response.proxy.baseUrl}
            onChange={(event) =>
              patch({ proxy: { ...response.proxy!, baseUrl: event.target.value } })
            }
            style={{ ...field, width: '100%' }}
          />
          {Object.keys(response.proxy.additionalHeaders).length > 0 && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
              Adds {Object.keys(response.proxy.additionalHeaders).join(', ')} to the forwarded
              request. Preserved; edit on the Raw JSON tab.
            </p>
          )}
        </Section>
      )}

      {draft.response.transformers.length > 0 && (
        <Section title="Transformers">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {draft.response.transformers.map((name) => (
              <Chip key={name} tone="neutral">
                {name}
              </Chip>
            ))}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
            {/* Templating changes what the body means, so it is worth naming rather than hiding. */}
            The body is processed by these before it is sent. Preserved; edit on the Raw JSON tab.
          </p>
        </Section>
      )}
    </div>
  )
}
