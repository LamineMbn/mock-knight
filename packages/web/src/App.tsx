import { useCallback, useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api.js'
import type { Profile } from './api.js'
import type { QueryPlan } from '@mock-knight/core/types'
import { CorpusList } from './components/CorpusList.js'
import { NewStub } from './components/NewStub.js'
import { SavedSearches } from './components/SavedSearches.js'
import { CommandPalette } from './components/CommandPalette.js'
import { Shortcuts, modifierKey } from './components/Shortcuts.js'
import type { Command } from './components/CommandPalette.js'
import { FacetPane } from './components/FacetPane.js'
import { StubDetail } from './components/StubDetail.js'
import { TrafficScreen } from './components/TrafficScreen.js'
import { ScenariosScreen } from './components/ScenariosScreen.js'
import { ProfilesScreen } from './components/ProfilesScreen.js'
import { ProfileSwitcher } from './components/ProfileSwitcher.js'
import { FirstRun } from './components/FirstRun.js'
import { Button, Chip } from './components/primitives.js'

/**
 * The app shell and the Corpus screen — design brief §6.1 and §6.2.
 *
 * The whole query lives in the URL rather than in a store, so a developer can paste "the stub
 * that's broken" into Slack and the recipient sees the same view (FR-UX-3).
 */

const PAGE_SIZE = 100

export type Screen = 'corpus' | 'traffic' | 'scenarios' | 'profiles'

const SCREENS: Screen[] = ['corpus', 'traffic', 'scenarios', 'profiles']

interface UrlState {
  screen: Screen
  query: string
  selectedKey: string | null
  /**
   * Which environment this view is of.
   *
   * In the URL rather than in a store because a pasted link has to reproduce the *whole* view,
   * and "the stub that's broken" (FR-UX-3) means nothing without saying which server it is
   * broken on.
   */
  profileId: string | null
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
    screen: (SCREENS.find((name) => name === params.get('screen')) ?? 'corpus') as Screen,
    query: params.get('q') ?? '',
    selectedKey: params.get('stub'),
    profileId: params.get('profile'),
  }

  const update = useCallback(
    (patch: Partial<UrlState>) => {
      const merged = { ...current, ...patch }
      const next = new URLSearchParams()
      if (merged.profileId !== null) next.set('profile', merged.profileId)
      if (merged.screen !== 'corpus') next.set('screen', merged.screen)
      if (merged.query !== '') next.set('q', merged.query)
      if (merged.selectedKey !== null) next.set('stub', merged.selectedKey)
      const search = next.toString()
      window.history.replaceState(null, '', search === '' ? window.location.pathname : `?${search}`)
      setParams(next)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current.screen, current.query, current.selectedKey, current.profileId],
  )

  return [current, update]
}

export function App() {
  const queryClient = useQueryClient()
  const [{ screen, query, selectedKey, profileId }, setUrlState] = useUrlState()
  const [draft, setDraft] = useState(query)
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  /**
   * ⌘K anywhere, and `/` to jump to the search box — design brief §8.
   *
   * Bound on the document rather than a wrapper so it works with focus anywhere, and ignored
   * while focus is in a field so typing a `/` in a path matcher does not steal it away.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      } else if (event.key === '/' && !typing) {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('input[aria-label="Search stubs"]')?.focus()
      } else if (event.key === '?' && !typing) {
        event.preventDefault()
        setShortcutsOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const profiles = useQuery({ queryKey: ['profiles'], queryFn: api.profiles })
  const all = useMemo(() => profiles.data?.profiles ?? [], [profiles.data])
  // Fall back rather than blank the screen: a link to a profile that has since been removed
  // should land somewhere useful, not on an error.
  const profile: Profile | undefined = all.find((p) => p.id === profileId) ?? all[0]

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

  const searches = useQuery({
    queryKey: ['searches', profile?.id],
    queryFn: () => api.searches(profile!.id),
    enabled: profile !== undefined,
  })
  const savedSearches = searches.data?.searches ?? []

  const commands = useMemo<Command[]>(() => {
    if (profile === undefined) return []
    const go = (name: Screen, label: string): Command => ({
      id: `go:${name}`,
      label,
      section: 'Go to',
      run: () => setUrlState({ screen: name }),
    })
    return [
      ...(profile.readOnly || screen !== 'corpus'
        ? []
        : [
            {
              id: 'action:new-stub',
              label: 'New stub',
              section: 'Actions' as const,
              run: () => setCreating(true),
            },
          ]),
      {
        id: 'action:refresh',
        label: 'Refresh the corpus',
        section: 'Actions',
        hint: `from ${profile.baseUrl}`,
        run: () => refresh.mutate(),
      },
      /**
       * Listed, but it navigates rather than acting — §6.10 says destructive actions appear in
       * the palette and still route through their typed confirmation. Reaching the control is
       * the point; skipping the confirmation would not be.
       */
      ...(profile.readOnly || profile.protected
        ? []
        : [
            {
              id: 'action:clear-journal',
              label: 'Clear the request journal…',
              section: 'Actions' as const,
              hint: 'opens the confirmation on Traffic',
              destructive: true,
              run: () => setUrlState({ screen: 'traffic' }),
            },
          ]),
      ...savedSearches.map((saved): Command => ({
        id: `search:${saved.id}`,
        label: saved.name,
        section: 'Saved searches',
        hint: saved.query,
        run: () => setUrlState({ screen: 'corpus', query: saved.query }),
      })),
      go('corpus', 'Corpus'),
      go('traffic', 'Traffic'),
      go('scenarios', 'Scenarios'),
      go('profiles', 'Servers'),
      ...all
        .filter((candidate) => candidate.id !== profile.id)
        .map((candidate): Command => ({
          id: `profile:${candidate.id}`,
          label: candidate.name,
          section: 'Switch profile',
          hint: candidate.baseUrl,
          colour: candidate.colour,
          run: () => setUrlState({ profileId: candidate.id, query: '', selectedKey: null }),
        })),
    ]
  }, [profile, screen, all, setUrlState, refresh, savedSearches])

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
    [query, setUrlState],
  )

  // The search box follows the URL — back/forward and a token pill both rewrite the query, and
  // the input has to catch up. During render, not in an effect: an effect renders the old text
  // against the new URL first, which reads as the box briefly ignoring a Back press.
  const [shownQuery, setShownQuery] = useState(query)
  if (shownQuery !== query) {
    setShownQuery(query)
    setDraft(query)
  }

  if (profiles.isPending) return <Splash>Starting…</Splash>

  // First run, no profile — design brief §6.11. A setup card, not an instruction to go and
  // restart the process in a terminal.
  if (profile === undefined) return <FirstRun onAdded={(id) => setUrlState({ profileId: id })} />

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
        onPalette={() => setPaletteOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
        profiles={all}
        onSelectProfile={(id) =>
          // Switching environment abandons the current query and selection: a stub key from one
          // server means nothing on another, and carrying it over would show a confident 404.
          setUrlState({ profileId: id, query: '', selectedKey: null })
        }
      />

      {shortcutsOpen && <Shortcuts onClose={() => setShortcutsOpen(false)} />}

      {paletteOpen && (
        <CommandPalette
          profileId={profile.id}
          profiles={all}
          commands={commands}
          onClose={() => setPaletteOpen(false)}
          onOpenStub={(clientKey) => setUrlState({ screen: 'corpus', selectedKey: clientKey })}
        />
      )}

      {screen === 'traffic' ? (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <TrafficScreen
            profile={profile}
            onOpenStub={async (clientKey, refreshFirst) => {
              // The journal can name a stub the mirror has not seen — the mirror is a cache and
              // an import reissues every id. Refreshing first turns the common case into a
              // working link instead of a dead end.
              if (refreshFirst) await refresh.mutateAsync().catch(() => undefined)
              setUrlState({ screen: 'corpus', selectedKey: clientKey })
            }}
          />
        </div>
      ) : screen === 'profiles' ? (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <ProfilesScreen
            profiles={all}
            active={profile}
            onSelect={(id) => setUrlState({ profileId: id, query: '', selectedKey: null })}
          />
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
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <QueryPlanPills plan={corpus.data?.plan} strategy={corpus.data?.textStrategy} />
                </div>
                <SavedSearches
                  profileId={profile.id}
                  query={query}
                  onApply={(saved) => {
                    setDraft(saved)
                    setUrlState({ query: saved })
                  }}
                />
              </div>
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
                    {!profile.readOnly && (
                      <div style={{ marginTop: 12 }}>
                        {/* An empty corpus used to be a dead end: the screen said this and
                            offered no way to change it. */}
                        <Button variant="primary" onClick={() => setCreating(true)}>
                          Create the first stub
                        </Button>
                      </div>
                    )}
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
              {!profile.readOnly && <Button onClick={() => setCreating(true)}>New stub</Button>}
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

          {creating && (
            <NewStub
              profileId={profile.id}
              onClose={() => setCreating(false)}
              onCreated={(clientKey) => {
                setCreating(false)
                // Select what was just written, so the next thing on screen is the stub rather
                // than the list it disappeared into.
                setUrlState({ selectedKey: clientKey })
              }}
            />
          )}
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
  onPalette,
  onShortcuts,
  profiles,
  onSelectProfile,
}: {
  profile: Profile
  version: string | null
  connected: boolean
  count: number
  onRefresh: () => void
  refreshing: boolean
  screen: Screen
  onScreen: (next: Screen) => void
  onPalette: () => void
  onShortcuts: () => void
  profiles: Profile[]
  onSelectProfile: (id: string) => void
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

      <span style={{ marginLeft: 8 }}>
        <ProfileSwitcher
          profiles={profiles}
          active={profile}
          connected={connected}
          onSelect={onSelectProfile}
          onManage={() => onScreen('profiles')}
        />
      </span>

      <nav style={{ marginLeft: 16, display: 'flex', gap: 4 }} aria-label="Screens">
        {/* Three of the four destinations exist. Sync is deliberately not drawn: a nav item
            that goes nowhere is a control that fails. */}
        {(
          [
            ['corpus', 'Corpus'],
            ['traffic', 'Traffic'],
            ['scenarios', 'Scenarios'],
            ['profiles', 'Servers'],
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
      {/*
        The palette is only useful to someone who knows it exists, which is nobody on their
        first run — so it gets a control, showing the modifier for *this* platform. Printing
        the wrong one is worse than printing nothing: it names a combination that does not work
        on the machine in front of you (design brief §6.1).
      */}
      <button
        type="button"
        onClick={onPalette}
        title="Command palette — every action, screen, server and stub"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 26,
          padding: '0 8px',
          font: 'inherit',
          fontSize: 12,
          cursor: 'pointer',
          color: 'var(--mk-text-secondary)',
          background: 'var(--mk-bg-subtle)',
          border: '1px solid var(--mk-border-default)',
          borderRadius: 'var(--mk-radius-sm)',
        }}
      >
        Search
        <kbd style={{ font: 'inherit', fontSize: 11, color: 'var(--mk-text-tertiary)' }}>
          {modifierKey()}K
        </kbd>
      </button>

      <button
        type="button"
        onClick={onShortcuts}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        style={{
          width: 26,
          height: 26,
          font: 'inherit',
          fontSize: 13,
          cursor: 'pointer',
          color: 'var(--mk-text-secondary)',
          background: 'transparent',
          border: '1px solid var(--mk-border-default)',
          borderRadius: 'var(--mk-radius-sm)',
        }}
      >
        ?
      </button>

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
