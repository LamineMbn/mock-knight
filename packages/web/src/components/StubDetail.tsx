import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.js'
import { Chip, InferenceLabel, MethodChip, Skeleton, StatusCode } from './primitives.js'

/**
 * The detail pane — design brief §6.3.
 *
 * Overview is the landing tab because most visits are reads, not edits. Raw JSON is the same
 * object, always reachable: if the rendered view cannot express something, the JSON can, and it
 * is the verbatim payload from the server rather than anything reconstructed.
 */

export interface StubDetailProps {
  profileId: string
  clientKey: string | null
}

type Tab = 'overview' | 'raw'

export function StubDetail({ profileId, clientKey }: StubDetailProps) {
  const [tab, setTab] = useState<Tab>('overview')

  const query = useQuery({
    queryKey: ['mock', profileId, clientKey],
    queryFn: () => api.mock(profileId, clientKey!),
    enabled: clientKey !== null,
  })

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
            ['raw', 'Raw JSON'],
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
              {mock.priority === null ? (
                <Muted>default</Muted>
              ) : (
                <span className="mk-tabular">{mock.priority}</span>
              )}
            </Row>
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
        ) : (
          <pre className="mk-mono" style={preStyle}>
            {JSON.stringify(mock.raw, null, 2)}
          </pre>
        )}
      </div>
    </aside>
  )
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
