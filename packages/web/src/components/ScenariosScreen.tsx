import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.js'
import type { ScenarioAnalysis } from '../api.js'
import { Button, Chip, InferenceLabel, Skeleton } from './primitives.js'

/**
 * Scenarios — FR-STATE-1/2/3/4, design brief §6.6.
 *
 * Rendered as a **transition table**, not a state graph. §6.6 explicitly leaves that open and
 * observes that a table of `from → stub → to` delivers most of the value; a layered graph is the
 * highest-effort, lowest-frequency screen in the product. The analysis behind this produces
 * everything a graph would need, so that stays a rendering decision rather than a rewrite.
 *
 * The warnings are the reason this screen earns its place. A scenario exists only as a property
 * of the stubs referencing it, so an unreachable state or a dead end is invisible until someone
 * reads every stub together — which is exactly what a person cannot do by grepping.
 */

function StatePill({
  state,
  onSelect,
  disabled,
}: {
  state: ScenarioAnalysis['states'][number]
  onSelect: () => void
  disabled: boolean
}) {
  const tone = state.isCurrent
    ? {
        bg: 'var(--mk-accent-bg-subtle)',
        fg: 'var(--mk-accent-text)',
        bd: 'var(--mk-accent-solid)',
      }
    : !state.reachable
      ? { bg: 'var(--mk-warning-bg)', fg: 'var(--mk-warning-text)', bd: 'var(--mk-warning-border)' }
      : { bg: 'var(--mk-bg-surface)', fg: 'var(--mk-text-primary)', bd: 'var(--mk-border-default)' }

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || state.isCurrent}
      title={
        state.isCurrent
          ? 'The scenario is in this state now'
          : disabled
            ? 'This server does not support setting scenario state'
            : `Set ${state.name}`
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 24,
        padding: '0 8px',
        font: 'inherit',
        fontSize: 12,
        cursor: disabled || state.isCurrent ? 'default' : 'pointer',
        borderRadius: 'var(--mk-radius-sm)',
        border: `1px solid ${tone.bd}`,
        background: tone.bg,
        color: tone.fg,
      }}
    >
      {/* Never colour alone: the current state says so, and so does an unreachable one. */}
      {state.isCurrent && <span aria-hidden="true">●</span>}
      {state.name}
      {!state.reachable && <span style={{ fontSize: 11 }}>unreachable</span>}
      {state.terminal && state.reachable && (
        <span style={{ fontSize: 11, color: 'var(--mk-text-tertiary)' }}>dead end</span>
      )}
    </button>
  )
}

function Scenario({
  profileId,
  scenario,
  canSetState,
}: {
  profileId: string
  scenario: ScenarioAnalysis
  canSetState: boolean
}) {
  const queryClient = useQueryClient()
  const set = useMutation({
    mutationFn: (state: string | null) => api.setScenarioState(profileId, scenario.name, state),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scenarios', profileId] })
      // A state change alters which stubs match, so anything derived from that is now stale.
      void queryClient.invalidateQueries({ queryKey: ['events'] })
    },
  })

  return (
    <section
      style={{
        border: '1px solid var(--mk-border-default)',
        borderRadius: 'var(--mk-radius-md)',
        marginBottom: 12,
        background: 'var(--mk-bg-surface)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderBottom: '1px solid var(--mk-border-subtle)',
        }}
      >
        <strong style={{ fontSize: 14 }}>{scenario.name}</strong>
        <span style={{ fontSize: 12, color: 'var(--mk-text-tertiary)' }}>
          {scenario.states.length} states · {scenario.transitions.length} transitions
        </span>
        <span style={{ flex: 1 }} />
        {canSetState && (
          <Button variant="quiet" onClick={() => set.mutate(null)} disabled={set.isPending}>
            Reset to Started
          </Button>
        )}
      </header>

      <div style={{ padding: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {scenario.states.map((state) => (
            <StatePill
              key={state.name}
              state={state}
              disabled={!canSetState || set.isPending}
              onSelect={() => set.mutate(state.name)}
            />
          ))}
        </div>

        {scenario.warnings.length > 0 && (
          <ul
            style={{ listStyle: 'none', margin: '0 0 10px', padding: 0, display: 'grid', gap: 4 }}
          >
            {scenario.warnings.map((warning) => (
              <li key={warning}>
                <Chip tone="warning">{warning}</Chip>
              </li>
            ))}
          </ul>
        )}

        {scenario.transitions.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--mk-text-tertiary)' }}>
            No stub advances this scenario.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['From', 'Stub', 'To'].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    style={{
                      textAlign: 'left',
                      padding: '4px 8px',
                      fontSize: 11,
                      fontWeight: 500,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: 'var(--mk-text-secondary)',
                      borderBottom: '1px solid var(--mk-border-default)',
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenario.transitions.map((transition) => (
                <tr
                  key={transition.clientKey}
                  style={{ borderBottom: '1px solid var(--mk-border-subtle)' }}
                >
                  <td className="mk-mono" style={{ padding: '5px 8px' }}>
                    {transition.from ?? (
                      <span style={{ color: 'var(--mk-text-tertiary)' }}>any state</span>
                    )}
                  </td>
                  <td style={{ padding: '5px 8px' }}>
                    {transition.stubName ?? (
                      <span style={{ color: 'var(--mk-text-tertiary)' }}>unnamed stub</span>
                    )}
                  </td>
                  <td className="mk-mono" style={{ padding: '5px 8px' }}>
                    {transition.to ?? (
                      <span style={{ color: 'var(--mk-text-tertiary)' }}>no change</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

export function ScenariosScreen({
  profileId,
  profileName,
  isProtected,
}: {
  profileId: string
  profileName: string
  isProtected: boolean
}) {
  const [confirm, setConfirm] = useState('')
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['scenarios', profileId],
    queryFn: () => api.scenarios(profileId),
  })

  const resetAll = useMutation({
    mutationFn: () => api.resetAllScenarios(profileId, confirm),
    onSuccess: () => {
      setConfirm('')
      void queryClient.invalidateQueries({ queryKey: ['scenarios', profileId] })
    },
  })

  return (
    <main style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 14 }}>
      {query.isPending && <Skeleton width="100%" height={140} />}

      {query.data !== undefined && query.data.scenarios.length === 0 && (
        <div
          style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--mk-text-secondary)' }}
        >
          <strong style={{ display: 'block', fontSize: 16, marginBottom: 6 }}>
            No scenarios on this server.
          </strong>
          A scenario appears when a stub sets <code className="mk-mono">scenarioName</code>.
        </div>
      )}

      {query.data?.scenarios.map((scenario) => (
        <Scenario
          key={scenario.name}
          profileId={profileId}
          scenario={scenario}
          canSetState={query.data.canSetState}
        />
      ))}

      {query.data !== undefined && query.data.scenarios.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <InferenceLabel title="The states and transitions are read from the stubs that reference each scenario. The server reports only the name and the current state.">
            shape derived from the corpus by Mock Knight
          </InferenceLabel>
        </div>
      )}

      {/* Danger zone: absent entirely on a protected profile, not merely disabled (§9.6). */}
      {query.data?.canResetAll === true && !isProtected && query.data.scenarios.length > 0 && (
        <section
          style={{
            marginTop: 24,
            padding: 12,
            border: '1px solid var(--mk-danger-border)',
            borderRadius: 'var(--mk-radius-md)',
          }}
        >
          <strong style={{ display: 'block', fontSize: 13, color: 'var(--mk-danger-text)' }}>
            Reset every scenario on {profileName}
          </strong>
          <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--mk-text-secondary)' }}>
            Returns all {query.data.scenarios.length} scenarios to “Started”. This affects everyone
            using this server and cannot be undone.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              aria-label="Type the profile name to confirm"
              placeholder={profileName}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              style={{
                height: 26,
                padding: '0 8px',
                font: 'inherit',
                fontSize: 13,
                color: 'var(--mk-text-primary)',
                background: 'var(--mk-bg-surface)',
                border: '1px solid var(--mk-border-strong)',
                borderRadius: 'var(--mk-radius-sm)',
              }}
            />
            <button
              type="button"
              disabled={confirm !== profileName || resetAll.isPending}
              onClick={() => resetAll.mutate()}
              style={{
                height: 26,
                padding: '0 10px',
                font: 'inherit',
                fontSize: 13,
                borderRadius: 'var(--mk-radius-sm)',
                cursor: confirm === profileName ? 'pointer' : 'not-allowed',
                opacity: confirm === profileName ? 1 : 0.5,
                color: 'var(--mk-danger-on-solid)',
                background: 'var(--mk-danger-solid)',
                border: '1px solid var(--mk-danger-solid)',
              }}
            >
              {resetAll.isPending ? 'Resetting…' : 'Reset all scenarios'}
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
