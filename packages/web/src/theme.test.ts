import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, isTheme, readTheme, writeTheme } from './theme.js'

/** A document and a storage, since this module's whole job is to touch both. */
const root = { attributes: new Map<string, string>(), style: { colorScheme: '' } }
const store = new Map<string, string>()
let storageThrows = false

beforeEach(() => {
  root.attributes.clear()
  root.style.colorScheme = ''
  store.clear()
  storageThrows = false
  vi.stubGlobal('document', {
    documentElement: {
      style: root.style,
      setAttribute: (k: string, v: string) => root.attributes.set(k, v),
      removeAttribute: (k: string) => root.attributes.delete(k),
    },
  })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => {
      if (storageThrows) throw new Error('denied')
      return store.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      if (storageThrows) throw new Error('denied')
      store.set(k, v)
    },
    removeItem: (k: string) => {
      if (storageThrows) throw new Error('denied')
      store.delete(k)
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('theme', () => {
  it('defaults to following the OS', () => {
    expect(readTheme()).toBe('system')
  })

  it('removes the attribute for system rather than resolving it', () => {
    // The CSS dark block is `@media (prefers-color-scheme: dark)` guarded by
    // `:root:not([data-theme='light'])`. Writing "light" for system would pin a dark machine
    // to light, which is the opposite of following the OS.
    applyTheme('dark')
    applyTheme('system')
    expect(root.attributes.has('data-theme')).toBe(false)
    expect(root.style.colorScheme).toBe('light dark')
  })

  it('sets colour-scheme with the attribute, so controls and scrollbars follow', () => {
    applyTheme('dark')
    expect(root.attributes.get('data-theme')).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
  })

  it('stores an explicit choice and forgets it again for system', () => {
    writeTheme('light')
    expect(readTheme()).toBe('light')
    writeTheme('system')
    // Absent, not the string "system": absence is what "follow the OS" means everywhere else
    // in this module, and one representation is easier to reason about than two.
    expect(store.has('mock-knight.theme')).toBe(false)
    expect(readTheme()).toBe('system')
  })

  it('survives storage that refuses to answer', () => {
    // Private windows throw on access rather than returning null. A theme preference is not
    // worth a blank screen.
    storageThrows = true
    expect(() => writeTheme('dark')).not.toThrow()
    expect(readTheme()).toBe('system')
  })

  it('ignores a stored value that is not a theme', () => {
    store.set('mock-knight.theme', 'solarized')
    expect(readTheme()).toBe('system')
  })

  it('recognises exactly the three themes', () => {
    expect(isTheme('system') && isTheme('light') && isTheme('dark')).toBe(true)
    expect(isTheme('Dark')).toBe(false)
    expect(isTheme(null)).toBe(false)
  })
})
