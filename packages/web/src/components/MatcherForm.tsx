import type { Matcher, MockDraft, RequestMatcher, UrlMatchKind } from '@mock-knight/core/types'
import { URL_MATCH_KINDS } from '@mock-knight/core/types'
import { Button, Chip } from './primitives.js'

/**
 * The Matcher tab — FR-EDIT-1, FR-EDIT-2.
 *
 * Until this existed the only way to change a stub was hand-editing WireMock's JSON, which is
 * close to the thing this tool exists to avoid. It matters most on a corpus where stubs are
 * told apart by a request header: that is a nested object three levels down, and getting a
 * brace wrong there is a 422 from the server rather than a mistake the editor catches.
 *
 * **The form edits a canonical draft, never the vendor document.** The browser cannot import an
 * adapter (the layering rule), so it cannot turn a form field back into vendor JSON. It sends
 * the draft and the server renders it through `adapter.render`, which patches the retained
 * `raw` — that is what keeps a field this form cannot display from being dropped by an edit
 * made here (invariant 4).
 *
 * Anything the form does not understand is shown and left alone rather than hidden. An operator
 * it cannot edit renders read-only with its value; the model deliberately keeps `operator` an
 * open string because backends add matchers between minor versions, and a form that silently
 * dropped an unrecognised one would be the worst bug available.
 */

/** Operators whose value is a plain string. */
const STRING_OPERATORS = [
  'equalTo',
  'contains',
  'doesNotContain',
  'matches',
  'doesNotMatch',
  'equalToXml',
] as const

/** Operators that take no value at all. */
const VALUELESS_OPERATORS = ['absent'] as const

/** Operators whose value is a JSON document. */
const JSON_OPERATORS = ['equalToJson', 'matchesJsonPath'] as const

const EDITABLE_OPERATORS = [
  ...STRING_OPERATORS,
  ...VALUELESS_OPERATORS,
  ...JSON_OPERATORS,
] as string[]

const METHODS = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE']

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

function MatcherRow({
  matcher,
  disabled,
  onChange,
}: {
  matcher: Matcher
  disabled: boolean
  onChange: (next: Matcher) => void
}) {
  const editable = EDITABLE_OPERATORS.includes(matcher.operator)
  const takesValue = !(VALUELESS_OPERATORS as readonly string[]).includes(matcher.operator)
  const isJson = (JSON_OPERATORS as readonly string[]).includes(matcher.operator)
  const optionCount = Object.keys(matcher.options).length

  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1, minWidth: 0 }}>
      {editable ? (
        <select
          aria-label="Operator"
          disabled={disabled}
          value={matcher.operator}
          onChange={(event) => onChange({ ...matcher, operator: event.target.value })}
          style={{ ...field, flex: '0 0 132px' }}
        >
          {EDITABLE_OPERATORS.map((operator) => (
            <option key={operator} value={operator}>
              {operator}
            </option>
          ))}
        </select>
      ) : (
        // Shown, not hidden, and not editable: the operator vocabulary is open by design and a
        // form that dropped one it did not recognise would lose a matcher silently.
        <Chip
          tone="warning"
          title="Mock Knight does not know how to edit this operator. It is kept exactly as it is; use the Raw JSON tab to change it."
        >
          {matcher.operator}
        </Chip>
      )}

      {!takesValue ? (
        <span style={{ flex: 1, fontSize: 12, color: 'var(--mk-text-tertiary)' }}>no value</span>
      ) : editable && !isJson ? (
        <input
          aria-label="Value"
          disabled={disabled}
          value={typeof matcher.value === 'string' ? matcher.value : ''}
          onChange={(event) => onChange({ ...matcher, value: event.target.value })}
          style={{ ...field, flex: 1 }}
        />
      ) : (
        <code
          className="mk-mono"
          style={{
            flex: 1,
            fontSize: 12,
            padding: '4px 6px',
            background: 'var(--mk-bg-subtle)',
            borderRadius: 'var(--mk-radius-sm)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {JSON.stringify(matcher.value)}
        </code>
      )}

      {optionCount > 0 && (
        <Chip
          tone="neutral"
          title={`Preserved and not editable here: ${Object.keys(matcher.options).join(', ')}`}
        >
          +{optionCount}
        </Chip>
      )}
    </span>
  )
}

/** One `name → [matcher]` group: request headers, query parameters, or cookies. */
function MatcherMap({
  label,
  entries,
  disabled,
  noun,
  onChange,
}: {
  label: string
  entries: Record<string, Matcher[]>
  disabled: boolean
  noun: string
  onChange: (next: Record<string, Matcher[]>) => void
}) {
  const names = Object.keys(entries)

  const rename = (from: string, to: string) => {
    // Rebuilt in order so renaming does not silently reorder the list under the cursor.
    const next: Record<string, Matcher[]> = {}
    for (const name of names) next[name === from ? to : name] = entries[name]!
    onChange(next)
  }

  return (
    <Section title={label}>
      {names.length === 0 && (
        <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
          None — this stub matches any {noun}.
        </p>
      )}
      <div style={{ display: 'grid', gap: 6 }}>
        {names.map((name) => (
          <div key={name} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              aria-label={`${label} name`}
              disabled={disabled}
              value={name}
              onChange={(event) => rename(name, event.target.value)}
              className="mk-mono"
              style={{ ...field, flex: '0 0 150px' }}
            />
            <MatcherRow
              matcher={entries[name]![0] ?? { operator: 'equalTo', value: '', options: {} }}
              disabled={disabled}
              onChange={(matcher) =>
                onChange({ ...entries, [name]: [matcher, ...entries[name]!.slice(1)] })
              }
            />
            {entries[name]!.length > 1 && (
              <Chip
                tone="neutral"
                title={`${entries[name]!.length} matchers on this ${noun}; only the first is editable here.`}
              >
                +{entries[name]!.length - 1}
              </Chip>
            )}
            <Button
              variant="quiet"
              disabled={disabled}
              onClick={() => {
                const next = { ...entries }
                delete next[name]
                onChange(next)
              }}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 6 }}>
        <Button
          disabled={disabled || Object.hasOwn(entries, '')}
          onClick={() =>
            onChange({ ...entries, '': [{ operator: 'equalTo', value: '', options: {} }] })
          }
        >
          Add {noun}
        </Button>
      </div>
    </Section>
  )
}

export function MatcherForm({
  draft,
  disabled,
  onChange,
}: {
  draft: MockDraft
  disabled: boolean
  onChange: (next: MockDraft) => void
}) {
  const request = draft.request
  const patch = (next: Partial<RequestMatcher>) =>
    onChange({ ...draft, request: { ...request, ...next } })

  return (
    <div>
      <Section title="Method and URL">
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            aria-label="Method"
            disabled={disabled}
            value={request.method ?? 'ANY'}
            onChange={(event) =>
              // `null`, not the string "ANY": the canonical model says a stub with no method
              // matches every one, and writing "ANY" would make it match a literal verb.
              patch({ method: event.target.value === 'ANY' ? null : event.target.value })
            }
            style={{ ...field, flex: '0 0 96px' }}
          >
            {METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>

          <select
            aria-label="URL match kind"
            disabled={disabled}
            value={request.url?.kind ?? 'urlPath'}
            onChange={(event) =>
              patch({
                url: { kind: event.target.value as UrlMatchKind, value: request.url?.value ?? '' },
              })
            }
            style={{ ...field, flex: '0 0 132px' }}
          >
            {URL_MATCH_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>

          <input
            aria-label="URL"
            disabled={disabled}
            className="mk-mono"
            value={request.url?.value ?? ''}
            onChange={(event) =>
              patch({ url: { kind: request.url?.kind ?? 'urlPath', value: event.target.value } })
            }
            style={{ ...field, flex: 1 }}
          />
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
          {/* The distinction people get wrong, and it changes what matches. */}
          {request.url?.kind === 'urlPath' || request.url?.kind === 'urlPathPattern'
            ? 'Path only — the query string is matched separately, below.'
            : 'Whole URL including the query string.'}
          {(request.url?.kind === 'urlPattern' || request.url?.kind === 'urlPathPattern') &&
            ' Value is a regular expression.'}
        </p>
      </Section>

      <MatcherMap
        label="Request headers"
        noun="header"
        entries={request.headers}
        disabled={disabled}
        onChange={(headers) => patch({ headers })}
      />
      <MatcherMap
        label="Query parameters"
        noun="parameter"
        entries={request.queryParameters}
        disabled={disabled}
        onChange={(queryParameters) => patch({ queryParameters })}
      />
      <MatcherMap
        label="Cookies"
        noun="cookie"
        entries={request.cookies}
        disabled={disabled}
        onChange={(cookies) => patch({ cookies })}
      />

      <Section title="Body patterns">
        {request.bodyPatterns.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
            None — this stub matches any body.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {request.bodyPatterns.map((matcher, index) => (
              <div key={index} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <MatcherRow
                  matcher={matcher}
                  disabled={disabled}
                  onChange={(next) =>
                    patch({
                      bodyPatterns: request.bodyPatterns.map((m, i) => (i === index ? next : m)),
                    })
                  }
                />
                <Button
                  variant="quiet"
                  disabled={disabled}
                  onClick={() =>
                    patch({ bodyPatterns: request.bodyPatterns.filter((_, i) => i !== index) })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
