import { describe, expect, it } from 'vitest'
import { joinBase } from './href.js'

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
