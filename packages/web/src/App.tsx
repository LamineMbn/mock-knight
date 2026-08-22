import { useCallback, useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api.js'
import type { Profile } from './api.js'
import type { QueryPlan } from '@mock-knight/core/types'
import { CorpusList } from './components/CorpusList.js'
import { FacetPane } from './components/FacetPane.js'
import { StubDetail } from './components/StubDetail.js'
import { Button, Chip } from './components/primitives.js'

/**
 * The app shell and the Corpus screen — design brief §6.1 and §6.2.
 *
 * The whole query lives in the URL rather than in a store, so a developer can paste "the stub
 * that's broken" into Slack and the recipient sees the same view (FR-UX-3).
 */

const PAGE_SIZE = 100

function useUrlState(): [string, string | null, (query: string, key: string | null) => void] {
  const read = () => new URLSearchParams(window.location.search)
  const [params, setParams] = useState(read)

  useEffect(() => {
    const onPop = () => setParams(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const update = useCallback((query: string, key: string | null) => {
    const next = new URLSearchParams()
    if (query !== '') next.set('q', query)
    if (key !== null) next.set('stub', key)
    const search = next.toString()
    window.history.replaceState(null, '', search === '' ? window.location.pathname : `?${search}`)
    setParams(next)
  }, [])

  return [params.get('q') ?? '', params.get('stub'), update]
}

export function App() {
  const queryClient = useQueryClient()
  const [query, selectedKey, setUrlState] = useUrlState()
  const [draft, setDraft] = useState(query)
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(new Set())

  const profiles = useQuery({ queryKey: ['profiles'], queryFn: api.profiles })
  const profile: Profile | undefined = profiles.data?.profiles[0]

  const mirror = useQuery({
    queryKey: ['mirror', profile?.id],
    queryFn: () => api.mirror(profile!.id),
    enabled: profile !== undefined,
  })

  const corpus = useQuery({
    queryKey: ['corpus', profile?.id, query],
    queryFn: () => api.corpus(profile!.id, query, PAGE_SIZE, 0),
    enabled: profile !== undefined,
    // Hold the previous page while the next one loads. Without this the whole middle of the
    // screen — facets included — unmounts on every keystroke and every facet click.
    placeholderData: keepPreviousData,
  })

  const refresh = useMutation({
    mutationFn: () => api.refresh(profile!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['corpus'] })
      void queryClient.invalidateQueries({ queryKey: ['mirror'] })
    },
  })

  /**
   * Which facet tokens are on, read from the URL rather than from the server's echoed plan.
   *
   * The plan would be more authoritative, but it arrives a round-trip late, so a checkbox
   * ticked by the user would sit unticked until the fetch returned. A control that lags the
   * click is worse than one that is briefly optimistic — and the plan still has the last word
   * on anything it *rejected*, which renders as a warning pill.
   */
  const activeFacetTokens = useMemo(
    () => new Set(query.split(/\s+/).filter((part) => part.includes(':'))),
    [query],
  )

  /**
   * Toggle a facet by rewriting the query string, so the URL stays the single source of truth
   * for what is filtered. Takes a *set* of tokens because selecting a folder branch needs two:
   * one for stubs filed directly in it, one glob for everything beneath.
   */
  const toggleFacet = (tokens: string[]) => {
    const present = query.split(/\s+/).filter((part) => part !== '')
    const allPresent = tokens.every((token) => present.includes(token))
    const next = allPresent
      ? present.filter((part) => !tokens.includes(part))
      : [...present.filter((part) => !tokens.includes(part)), ...tokens]
    const joined = next.join(' ')
    setDraft(joined)
    setUrlState(joined, selectedKey)
  }

  useEffect(() => setDraft(query), [query])

  if (profiles.isPending) return <Splash>Starting…</Splash>

  if (profile === undefined) {
    // First run, no profile — design brief §6.11.
    return (
      <Splash>
        <strong style={{ display: 'block', fontSize: 20, marginBottom: 8 }}>
          No mock server connected.
        </strong>
        Start Mock Knight with a URL to connect one:
        <pre className="mk-mono" style={{ marginTop: 12, fontSize: 12 }}>
          npx mock-knight --url http://localhost:8080
        </pre>
      </Splash>
    )
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        // The environment edge runs the full height of the window: a colour-coded reminder of
        // whether you are on localhost or staging that stays visible wherever you scroll.
        borderLeft: `3px solid var(--mk-profile-${profile.colour})`,
      }}
    >
      <TopBar
        profile={profile}
        version={mirror.data?.version ?? null}
        connected={mirror.data?.connected ?? false}
        count={mirror.data?.count ?? 0}
        onRefresh={() => refresh.mutate()}
        refreshing={refresh.isPending}
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <FacetPane
          facets={corpus.data?.facets}
          active={activeFacetTokens}
          onToggle={toggleFacet}
          expandedFolders={expandedFolders}
          onExpandedFoldersChange={setExpandedFolders}
        />

        <main
          style={{
            flex: 1,
            minWidth: 480,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--mk-bg-surface)',
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              setUrlState(draft, selectedKey)
            }}
            style={{ padding: 8, borderBottom: '1px solid var(--mk-border-default)' }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search paths and bodies, or filter: method:POST status:5xx scenario:checkout"
              aria-label="Search stubs"
              style={{
                width: '100%',
                height: 30,
                padding: '0 10px',
                fontSize: 13,
                fontFamily: 'inherit',
                color: 'var(--mk-text-primary)',
                background: 'var(--mk-bg-surface)',
                border: '1px solid var(--mk-border-strong)',
                borderRadius: 'var(--mk-radius-sm)',
              }}
            />
            <QueryPlanPills plan={corpus.data?.plan} strategy={corpus.data?.textStrategy} />
          </form>

          <CorpusList
            items={corpus.data?.items ?? []}
            total={corpus.data?.total ?? 0}
            selectedKey={selectedKey}
            onSelect={(key) => setUrlState(query, key === selectedKey ? null : key)}
            loading={corpus.isPending}
            emptyMessage={
              query === '' ? (
                <>
                  <strong style={{ display: 'block', fontSize: 16, marginBottom: 6 }}>
                    This server has no stubs yet.
                  </strong>
                  Nothing has been mirrored from {profile.baseUrl}.
                </>
              ) : (
                <>
                  <strong style={{ display: 'block', fontSize: 16, marginBottom: 6 }}>
                    Nothing matched that search.
                  </strong>
                  Try removing a filter.
                </>
              )
            }
          />

          <footer
            style={{
              height: 28,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '0 10px',
              borderTop: '1px solid var(--mk-border-default)',
              fontSize: 12,
              color: 'var(--mk-text-tertiary)',
            }}
          >
            <span className="mk-tabular">
              {corpus.data?.total ?? 0} stubs
              {corpus.data !== undefined && corpus.data.total > corpus.data.items.length
                ? ` · ${corpus.data.items.length} shown`
                : ''}
            </span>
            {corpus.data?.bodyIndexTruncated === true && (
              <Chip
                tone="warning"
                title="Some response bodies were too large to index in full, so a body: search may be incomplete."
              >
                partial body index
              </Chip>
            )}
          </footer>
        </main>

        <StubDetail profileId={profile.id} clientKey={selectedKey} />
      </div>
    </div>
  )
}

function TopBar({
  profile,
  version,
  connected,
  count,
  onRefresh,
  refreshing,
}: {
  profile: Profile
  version: string | null
  connected: boolean
  count: number
  onRefresh: () => void
  refreshing: boolean
}) {
  return (
    <header
      style={{
        height: 44,
        flex: '0 0 44px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 12px',
        background: 'var(--mk-bg-surface)',
        borderBottom: '1px solid var(--mk-border-default)',
      }}
    >
      <img
        className="mk-mark-light"
        src="/brand/mock-knight-mark.svg"
        alt=""
        width={18}
        height={18}
      />
      <img
        className="mk-mark-dark"
        src="/brand/mock-knight-mark-dark.svg"
        alt=""
        width={18}
        height={18}
      />
      <span style={{ fontWeight: 600, letterSpacing: '-0.01em' }}>Mock Knight</span>

      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: 9999,
            background: connected ? `var(--mk-profile-${profile.colour})` : 'transparent',
            border: `2px solid var(--mk-profile-${profile.colour})`,
          }}
        />
        {/* Colour is never the only signal: the profile name is always visible beside the dot. */}
        <span style={{ fontWeight: 500 }}>{profile.name}</span>
        {profile.protected && <Chip tone="warning">protected</Chip>}
        {profile.readOnly && <Chip>read-only</Chip>}
        {!connected && <Chip tone="warning">disconnected</Chip>}
      </span>

      <nav style={{ marginLeft: 16, display: 'flex', gap: 4 }} aria-label="Screens">
        {/* Only Corpus exists yet. The other three destinations are deliberately not drawn:
            a nav item that goes nowhere is a control that fails. */}
        <span
          aria-current="page"
          style={{
            padding: '4px 8px',
            borderRadius: 'var(--mk-radius-sm)',
            background: 'var(--mk-bg-emphasis)',
            color: 'var(--mk-text-primary)',
          }}
        >
          Corpus
        </span>
      </nav>

      <span style={{ flex: 1 }} />

      <span className="mk-tabular" style={{ fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
        {count} mirrored{version !== null ? ` · WireMock ${version}` : ''}
      </span>
      <Button onClick={onRefresh} disabled={refreshing}>
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </Button>
    </header>
  )
}

/**
 * Show exactly which tokens were applied, and which were refused.
 *
 * A rejected token is the important half: a filter that silently does nothing is worse than an
 * error, so it renders as a warning pill naming the capability the backend is missing.
 */
function QueryPlanPills({
  plan,
  strategy,
}: {
  plan: QueryPlan | undefined
  strategy: string | undefined
}) {
  if (plan === undefined) return null
  if (plan.filters.length === 0 && plan.rejected.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
      {plan.filters.map((filter, index) => (
        <Chip key={`${filter.field}-${index}`} tone="accent">
          {filter.field}: {String(filter.value)}
        </Chip>
      ))}
      {plan.rejected.map((rejection, index) => (
        <Chip key={`rejected-${index}`} tone="warning" title={rejection.reason}>
          {rejection.text} — not supported here
        </Chip>
      ))}
      {strategy === 'like' && (
        <span style={{ fontSize: 11, color: 'var(--mk-text-tertiary)' }}>
          short term — scanned rather than indexed
        </span>
      )}
    </div>
  )
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--mk-text-secondary)',
        fontSize: 14,
      }}
    >
      <div style={{ maxWidth: 460, textAlign: 'center' }}>{children}</div>
    </div>
  )
}
