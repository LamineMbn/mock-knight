import { describe, expect, it } from 'vitest'
import { joinBase, joinBaseAsset } from './href.js'

describe('joinBase', () => {
  it('joins a path onto the base with exactly one slash between them', () => {
    expect(joinBase('/mock-knight/', '/wiremock/')).toBe('/mock-knight/wiremock/')
    expect(joinBase('/mock-knight', 'wiremock')).toBe('/mock-knight/wiremock/')
  })

  it('returns the base itself for the site root', () => {
    expect(joinBase('/mock-knight/', '/')).toBe('/mock-knight/')
    expect(joinBase('/mock-knight/', '')).toBe('/mock-knight/')
  })

  // A site served from the domain root — what a custom domain would look like — must not
  // acquire a doubled slash.
  it('handles a bare root base', () => {
    expect(joinBase('/', '/faq/')).toBe('/faq/')
    expect(joinBase('/', '/')).toBe('/')
  })

  // trailingSlash: 'always'. A link without one costs a redirect on every click.
  it('always emits a trailing slash', () => {
    expect(joinBase('/mock-knight/', 'config')).toBe('/mock-knight/config/')
  })
})

describe('joinBaseAsset', () => {
  // The one thing this function exists for: a file keeps its extension as the last
  // character. `joinBase` would turn this into `.svg/`, which 404s on a real static host.
  it('keeps a file path free of the trailing slash a route would get', () => {
    expect(joinBaseAsset('/mock-knight', '/brand/mock-knight-mark-mono.svg')).toBe(
      '/mock-knight/brand/mock-knight-mark-mono.svg',
    )
  })

  // A nested asset directory resolves under the base the same way a route does.
  it('resolves a nested asset path under the base', () => {
    expect(joinBaseAsset('/mock-knight', '/images/corpus.png')).toBe(
      '/mock-knight/images/corpus.png',
    )
  })

  // A site served from the domain root must not acquire a doubled slash either, the same
  // edge case `joinBase` handles for routes.
  it('handles a bare root base without doubling the slash', () => {
    expect(joinBaseAsset('/', '/images/corpus.png')).toBe('/images/corpus.png')
  })
})
