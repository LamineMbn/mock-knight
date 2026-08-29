import { describe, expect, it } from 'vitest'
import { ROUTES } from './routes.js'

describe('ROUTES', () => {
  it('has one entry per page in the spec', () => {
    expect(ROUTES).toHaveLength(7)
  })

  it('has unique paths', () => {
    const paths = ROUTES.map((route) => route.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  /**
   * Two pages sharing a title is the specific failure this site exists to avoid: it tells a
   * search engine they are the same page competing for the same query, which is what the
   * README already does.
   */
  it('has unique titles', () => {
    const titles = ROUTES.map((route) => route.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('keeps every title short enough that Google does not truncate it', () => {
    for (const route of ROUTES) {
      expect(route.title.length, `${route.path}: "${route.title}"`).toBeLessThanOrEqual(60)
    }
  })

  it('keeps every description within the length a result snippet shows', () => {
    for (const route of ROUTES) {
      expect(route.description.length, route.path).toBeLessThanOrEqual(160)
      expect(route.description.length, route.path).toBeGreaterThan(50)
    }
  })

  it('starts and ends every path with a slash, so trailingSlash: always holds', () => {
    for (const route of ROUTES) {
      expect(route.path.startsWith('/'), route.path).toBe(true)
      expect(route.path.endsWith('/'), route.path).toBe(true)
    }
  })
})
