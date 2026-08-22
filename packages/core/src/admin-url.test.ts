import { describe, expect, it } from 'vitest'
import { composeAdminUrl } from './admin-url.js'

/**
 * A mock server behind a context path is completely ordinary — an ALB routing `/wcboo/*` to it,
 * a Spring app with `server.servlet.context-path`. Resolving the admin path as a URL against the
 * base discarded that context, and the tool then reported whatever the load balancer said about
 * a path nobody had asked for.
 */
describe('composeAdminUrl', () => {
  it('appends the default admin path to a bare host', () => {
    expect(composeAdminUrl('http://localhost:8080')).toBe('http://localhost:8080/__admin')
  })

  it('keeps a context path in the base URL', () => {
    expect(composeAdminUrl('https://host/wcboo')).toBe('https://host/wcboo/__admin')
  })

  it('keeps the context path however the slashes fall', () => {
    expect(composeAdminUrl('https://host/wcboo/')).toBe('https://host/wcboo/__admin')
    expect(composeAdminUrl('https://host/wcboo', '__admin')).toBe('https://host/wcboo/__admin')
    expect(composeAdminUrl('https://host/wcboo', '/__admin/')).toBe('https://host/wcboo/__admin')
  })

  it('keeps a multi-segment context path', () => {
    expect(composeAdminUrl('https://host/a/b/c', '/__admin')).toBe('https://host/a/b/c/__admin')
  })

  it('accepts a custom admin path', () => {
    expect(composeAdminUrl('http://localhost:1080', '/mockserver')).toBe(
      'http://localhost:1080/mockserver',
    )
  })

  it('allows an empty admin path, for a server whose admin API is the base URL', () => {
    expect(composeAdminUrl('https://host/api', '')).toBe('https://host/api')
  })

  it('drops the port only when the URL does', () => {
    expect(composeAdminUrl('https://host:8443/ctx')).toBe('https://host:8443/ctx/__admin')
  })

  it('ignores a query string or fragment on the base URL', () => {
    expect(composeAdminUrl('http://localhost:8080/ctx?a=1#x')).toBe(
      'http://localhost:8080/ctx/__admin',
    )
  })
})
