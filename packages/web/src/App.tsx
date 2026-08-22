import { useCallback, useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api.js'
import type { Profile } from './api.js'
import type { QueryPlan } from '@mock-knight/core/types'
import { CorpusList } from './components/CorpusList.js'
import { FacetPane } from './components/FacetPane.js'
import { StubDetail } from './components/StubDetail.js'
import { TrafficScreen } from './components/TrafficScreen.js'
import { ScenariosScreen } from './components/ScenariosScreen.js'
import { Button, Chip } from './components/primitives.js'

/**
 * The app shell and the Corpus screen — design brief §6.1 and §6.2.
 *
 * The whole query lives in the URL rather than in a store, so a developer can paste "the stub
 * that's broken" into Slack and the recipient sees the same view (FR-UX-3).
 */

const PAGE_SIZE = 100

export type Screen = 'corpus' | 'traffic' | 'scenarios'

interface UrlState {
  screen: Screen
  query: string
  selectedKey: string | null
}

function useUrlState(): [UrlState, (next: Partial<UrlState>) => void] {
  const read = () => new URLSearchParams(window.location.search)
  const [params, setParams] = useState(read)

  useEffect(() => {
    const onPop = () => setParams(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const current: UrlState = {
    screen:
      params.get('screen') === 'traffic'
        ? 'traffic'
        : params.get('screen') === 'scenarios'
          ? 'scenarios'
          : 'corpus',
    query: params.get('q') ?? '',
    selectedKey: params.get('stub'),
  }

  const update = useCallback(
    (patch: Partial<UrlState>) => {
      const merged = { ...current, ...patch }
      const next = new URLSearchParams()
      if (merged.screen !== 'corpus') next.set('screen', merged.screen)
      if (merged.query !== '') next.set('q', merged.query)
      if (merged.selectedKey !== null) next.set('stub', merged.selectedKey)
      const search = next.toString()
      window.history.replaceState(null, '', search === '' ? window.location.pathname : `?${search}`)
      setParams(next)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current.screen, current.query, current.selectedKey],
  )

  return [current, update]
}

export function App() {
  const queryClient = useQueryClient()
  const [{ screen, query, selectedKey }, setUrlState] = useUrlState()
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
   * Apply a facet change by rewriting the query string, so the URL stays the single source of
   * truth for what is filtered.
   *
   * Takes adds *and* removes in one edit rather than a plain toggle, because a folder click is
   * not a toggle of one value: selecting a branch has to clear whatever is already selected
   * beneath it, or the branch's own checkbox can never turn that subtree back off.
   */
  const applyFacetTokens = useCallback(
    ({ add = [], remove = [] }: { add?: string[]; remove?: string[] }) => {
      const present = query.split(/\s+/).filter((part) => part !== '')
      const dropped = new Set([...remove, ...add])
      const next = [...present.filter((part) => !dropped.has(part)), ...add]
      const joined = next.join(' ')
      setDraft(joined)
      setUrlState({ query: joined })
    },
    [query, selectedKey, setUrlState],
  )

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
        screen={screen}
        onScreen={(next) => setUrlState({ screen: next })}
      />

      {screen === 'traffic' ? (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <TrafficScreen profileId={profile.id} baseUrl={profile.baseUrl} />
        </div>
      ) : screen === 'scenarios' ? (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <ScenariosScreen
            profileId={profile.id}
            profileName={profile.name}
            isProtected={profile.protected}
          />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <FacetPane
            facets={corpus.data?.facets}
            active={activeFacetTokens}
            onApply={applyFacetTokens}
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
                setUrlState({ query: draft })
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
              showHeaderColumn={(corpus.data?.facets.header?.length ?? 0) > 0}
              selectedKey={selectedKey}
              onSelect={(key) => setUrlState({ selectedKey: key === selectedKey ? null : key })}
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
              {corpus.data?.unused != null && (
                /**
                 * FR-FIND-8 makes this wording a requirement, not a caveat. The journal is
                 * bounded and resettable, so "unused" can only ever mean "nothing we can see
                 * used it" — and which boundary applies depends on who answered.
                 */
                <Chip
                  tone="warning"
                  title={
                    corpus.data.unused.provenance === 'server'
                      ? 'The mock server computed this from its own request journal, which is finite and resets when the server restarts.'
                      : 'Mock Knight derived this by joining the corpus against the traffic it has polled. It cannot see requests served before it connected.'
                  }
                >
                  {corpus.data.unused.provenance === 'server'
                    ? 'unused per the server’s journal'
                    : corpus.data.unused.earliestAt === null
                      ? 'unused — but no traffic has been observed yet'
                      : `unused since ${new Date(corpus.data.unused.earliestAt).toLocaleTimeString()}`}
                </Chip>
              )}
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

          <StubDetail
            profileId={profile.id}
            profileName={profile.name}
            canWrite={!profile.readOnly}
            clientKey={selectedKey}
          />
        </div>
      )}
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
  screen,
  onScreen,
}: {
  profile: Profile
  version: string | null
  connected: boolean
  count: number
  onRefresh: () => void
  refreshing: boolean
  screen: Screen
  onScreen: (next: Screen) => void
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
        {/* Three of the four destinations exist. Sync is deliberately not drawn: a nav item
            that goes nowhere is a control that fails. */}
        {(
          [
            ['corpus', 'Corpus'],
            ['traffic', 'Traffic'],
            ['scenarios', 'Scenarios'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-current={screen === value ? 'page' : undefined}
            onClick={() => onScreen(value)}
            style={{
              padding: '4px 8px',
              font: 'inherit',
              cursor: 'pointer',
              border: 'none',
              borderRadius: 'var(--mk-radius-sm)',
              background: screen === value ? 'var(--mk-bg-emphasis)' : 'transparent',
              color: screen === value ? 'var(--mk-text-primary)' : 'var(--mk-text-secondary)',
            }}
          >
            {label}
          </button>
        ))}
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
