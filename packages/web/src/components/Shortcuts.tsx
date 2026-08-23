import { useEffect } from 'react'
import { Button } from './primitives.js'

/**
 * The keyboard map, published — design brief §8.
 *
 * Every shortcut this app has was invisible: `⌘K` in particular is only useful to someone who
 * already knows it exists, which is nobody on their first run. The brief asks for a `?` sheet
 * and a `⌘K` affordance in the top bar, and both exist because a keyboard-first tool that
 * never says so is a mouse-driven tool with extra steps.
 */

/**
 * `⌘` on Apple platforms, `Ctrl` elsewhere. Printing the wrong one is worse than printing
 * nothing: it tells someone a key combination that does not work on the machine in front of
 * them, and they conclude the feature is broken.
 *
 * `navigator.platform` is deprecated but is still the only synchronous answer; `userAgentData`
 * is checked first where it exists, and the user agent string is the last resort.
 */
export function modifierKey(): string {
  if (typeof navigator === 'undefined') return 'Ctrl'
  const data = (navigator as { userAgentData?: { platform?: string } }).userAgentData
  const platform = data?.platform ?? navigator.platform ?? navigator.userAgent
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl'
}

interface Shortcut {
  readonly keys: readonly string[]
  readonly what: string
  readonly where?: string
}

function shortcuts(mod: string): { group: string; items: Shortcut[] }[] {
  return [
    {
      group: 'Anywhere',
      items: [
        { keys: [mod, 'K'], what: 'Command palette — every action, screen, server and stub' },
        { keys: ['/'], what: 'Focus the search box' },
        { keys: ['?'], what: 'This sheet' },
        { keys: ['esc'], what: 'Close whatever is open' },
      ],
    },
    {
      group: 'Lists',
      items: [
        { keys: ['j'], what: 'Move down', where: 'Traffic' },
        { keys: ['k'], what: 'Move up', where: 'Traffic' },
        { keys: ['↵'], what: "Explain why a request didn't match", where: 'Traffic' },
      ],
    },
    {
      group: 'Editing a stub',
      items: [
        { keys: [mod, 'S'], what: 'Save' },
        { keys: ['esc'], what: 'Discard unsaved changes' },
      ],
    },
  ]
}

function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {keys.map((key) => (
        <kbd
          key={key}
          style={{
            font: 'inherit',
            fontSize: 11,
            minWidth: 18,
            textAlign: 'center',
            padding: '1px 5px',
            color: 'var(--mk-text-secondary)',
            background: 'var(--mk-bg-subtle)',
            border: '1px solid var(--mk-border-default)',
            borderRadius: 'var(--mk-radius-sm)',
          }}
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}

export function Shortcuts({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const mod = modifierKey()

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--mk-scrim)',
        display: 'grid',
        placeItems: 'center',
        padding: 32,
        zIndex: 95,
      }}
    >
      <div
        style={{
          width: 'min(520px, 100%)',
          maxHeight: '80vh',
          overflow: 'auto',
          background: 'var(--mk-bg-raised)',
          border: '1px solid var(--mk-border-strong)',
          borderRadius: 'var(--mk-radius-lg)',
          boxShadow: 'var(--mk-shadow-modal)',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 14px',
            borderBottom: '1px solid var(--mk-border-default)',
          }}
        >
          <strong style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>Keyboard shortcuts</strong>
          <Button onClick={onClose}>Close</Button>
        </header>

        <div style={{ padding: 14 }}>
          {shortcuts(mod).map((section) => (
            <section key={section.group} style={{ marginBottom: 14 }}>
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
                {section.group}
              </h3>
              <dl style={{ margin: 0, display: 'grid', gap: 6 }}>
                {section.items.map((item) => (
                  <div
                    key={`${item.keys.join('')}-${item.what}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}
                  >
                    <dt style={{ flex: '0 0 72px' }}>
                      <Keys keys={item.keys} />
                    </dt>
                    <dd style={{ margin: 0, flex: 1 }}>
                      {item.what}
                      {item.where !== undefined && (
                        <span style={{ marginLeft: 6, color: 'var(--mk-text-tertiary)' }}>
                          · {item.where}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
