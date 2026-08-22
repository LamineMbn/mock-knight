import { useEffect, useRef, useState } from 'react'
import type { Profile } from '../api.js'
import { Chip } from './primitives.js'

/**
 * The environment badge and switcher — design brief §6.1.
 *
 * §6.1 calls this "the most important thing in this bar", and the reason is blunt: the same
 * destructive button means something very different on localhost and on staging. So the profile
 * name is *always* visible — the colour dot is an accelerant for recognition, never the signal
 * itself — and `protected` / read-only state travels with it rather than living on some other
 * screen.
 *
 * A dropdown rather than the command palette (§6.1 left that open): the palette does not exist
 * yet, and a visible control is the more discoverable of the two.
 */

export interface ProfileSwitcherProps {
  profiles: Profile[]
  active: Profile
  connected: boolean
  onSelect: (id: string) => void
  onManage: () => void
}

export function ProfileSwitcher({
  profiles,
  active,
  connected,
  onSelect,
  onManage,
}: ProfileSwitcherProps) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (container.current !== null && !container.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={container} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Profile: ${active.name}. Switch environment.`}
        onClick={() => setOpen((value) => !value)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 26,
          padding: '0 8px',
          font: 'inherit',
          fontSize: 13,
          cursor: 'pointer',
          borderRadius: 'var(--mk-radius-sm)',
          border: '1px solid var(--mk-border-default)',
          background: 'var(--mk-bg-surface)',
          color: 'var(--mk-text-primary)',
        }}
      >
        <Dot colour={active.colour} connected={connected} />
        <span style={{ fontWeight: 500 }}>{active.name}</span>
        {active.protected && <Chip tone="warning">protected</Chip>}
        {active.readOnly && <Chip>read-only</Chip>}
        {!connected && <Chip tone="warning">reconnecting…</Chip>}
        <span aria-hidden="true" style={{ color: 'var(--mk-text-tertiary)' }}>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Environments"
          style={{
            position: 'absolute',
            top: 30,
            left: 0,
            minWidth: 280,
            zIndex: 40,
            padding: 4,
            borderRadius: 'var(--mk-radius-md)',
            background: 'var(--mk-bg-raised)',
            border: '1px solid var(--mk-border-default)',
            boxShadow: '0 1px 2px rgb(16 18 27 / .06), 0 2px 8px rgb(16 18 27 / .08)',
          }}
        >
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              role="option"
              // The name alone: two profiles may point at one URL (a read-only view of the same
              // server is a legitimate setup), so the URL cannot identify the option.
              aria-label={profile.name}
              aria-selected={profile.id === active.id}
              onClick={() => {
                onSelect(profile.id)
                setOpen(false)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '6px 8px',
                font: 'inherit',
                fontSize: 13,
                textAlign: 'left',
                cursor: 'pointer',
                border: 'none',
                borderRadius: 'var(--mk-radius-sm)',
                background: profile.id === active.id ? 'var(--mk-bg-emphasis)' : 'transparent',
                color: 'var(--mk-text-primary)',
              }}
            >
              <Dot colour={profile.colour} connected />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 500 }}>{profile.name}</span>
                <span
                  className="mk-mono"
                  style={{
                    display: 'block',
                    fontSize: 11,
                    color: 'var(--mk-text-tertiary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {profile.baseUrl}
                </span>
              </span>
              {profile.protected && <Chip tone="warning">protected</Chip>}
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--mk-border-subtle)', margin: '4px 0' }} />
          <button
            type="button"
            onClick={() => {
              onManage()
              setOpen(false)
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '6px 8px',
              font: 'inherit',
              fontSize: 13,
              textAlign: 'left',
              cursor: 'pointer',
              border: 'none',
              borderRadius: 'var(--mk-radius-sm)',
              background: 'transparent',
              color: 'var(--mk-accent-text)',
            }}
          >
            Add or manage servers…
          </button>
        </div>
      )}
    </div>
  )
}

/** Hollow when disconnected, per §6.1 — shape carries the state, not just the colour. */
function Dot({ colour, connected }: { colour: string; connected: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 8,
        height: 8,
        flex: '0 0 8px',
        borderRadius: 9999,
        background: connected ? `var(--mk-profile-${colour})` : 'transparent',
        border: `2px solid var(--mk-profile-${colour})`,
      }}
    />
  )
}
