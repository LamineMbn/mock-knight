/**
 * Light, dark, or whatever the OS says — FR-UX-2.
 *
 * The tokens and the brand mark already honoured `[data-theme]`; only the control was missing,
 * so this sets one attribute and everything else follows. Nothing here knows a colour.
 *
 * `system` is the default and is not the same as recording today's OS setting: someone whose
 * machine switches at sunset expects the app to switch with it, and a tool that latched onto
 * whichever mode it first saw would be wrong every evening.
 */

export const THEMES = ['system', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

const STORAGE_KEY = 'mock-knight.theme'

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

/**
 * Read the stored choice.
 *
 * Storage throws outright in some privacy configurations rather than returning null, so this
 * never lets that break the app — a theme is a preference, and failing to read one is not worth
 * a blank screen.
 */
export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isTheme(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function writeTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Not being able to remember the choice is survivable; not applying it would not be.
  }
}

/**
 * Put the choice on the document.
 *
 * `system` **removes** the attribute rather than writing a resolved value, because the CSS is
 * built around its absence: the dark block is `@media (prefers-color-scheme: dark)` guarded by
 * `:root:not([data-theme='light'])`. Writing `data-theme="light"` for "system" would pin the
 * app to light on a dark machine.
 *
 * `color-scheme` goes with it so form controls, scrollbars and the canvas behind the page match.
 * Without it a dark app keeps white scrollbars and a white flash between paints.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') {
    root.removeAttribute('data-theme')
    root.style.colorScheme = 'light dark'
  } else {
    root.setAttribute('data-theme', theme)
    root.style.colorScheme = theme
  }
}
