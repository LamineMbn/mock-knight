import { expect, test } from '@playwright/test'
import { ROUTES } from '../src/lib/routes.js'

/**
 * The page shell, asserted on every page.
 *
 * Eleven tasks built this site and each component was reviewed on its own; nothing looked at
 * the assembled page, and that is where all of the damage was. Tailwind's preflight — pulled in
 * by `tokens.generated.css`'s `@import 'tailwindcss'` — zeroes every margin and strips every
 * link's colour and underline, and `site.css` styled the components without ever styling the
 * shell around them. So: no gutter, links indistinguishable from body text, the skip link as
 * the first visible line of all seven pages, and the FAQ as one undifferentiated slab.
 *
 * Every assertion below is a computed style or a measured box, because that is the only kind of
 * evidence that would have caught it.
 */
for (const route of ROUTES) {
  const at = route.path === '/' ? './' : `.${route.path}`

  test(`${route.path} has a gutter and a container, aligned across header, main and footer`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(at)

    const edges = await page.evaluate(() => {
      const contentLeft = (element: Element | null): number | null => {
        if (element === null) return null
        const box = element.getBoundingClientRect()
        return box.x + parseFloat(getComputedStyle(element).paddingLeft)
      }
      return {
        header: contentLeft(document.querySelector('header .container')),
        main: contentLeft(document.querySelector('main')),
        footer: contentLeft(document.querySelector('footer .container')),
        mainWidth: document.querySelector('main')!.getBoundingClientRect().width,
      }
    })

    // Body text hard against the viewport edge is the defect this replaces.
    expect(edges.main).toBeGreaterThan(16)
    // One measure, not the full 1280.
    expect(edges.mainWidth).toBeLessThanOrEqual(1100)
    // The three rows share one left edge, or the page reads as three unrelated bands.
    expect(edges.header).toBe(edges.main)
    expect(edges.footer).toBe(edges.main)
  })

  test(`${route.path} keeps a gutter at 360px`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await page.goto(at)
    const left = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('main')!).paddingLeft),
    )
    expect(left).toBeGreaterThan(8)
  })

  /**
   * Never colour alone — the project's rule about state, applied to affordances. A reader who
   * cannot separate the accent from the body text must still see which words are links, so
   * every link carries an underline as well as its own colour.
   */
  test(`${route.path} makes every link distinguishable without colour`, async ({ page }) => {
    await page.goto(at)
    const undecorated = await page.evaluate(() =>
      [...document.querySelectorAll('nav a, main .prose a, footer a')]
        .filter((anchor) => getComputedStyle(anchor).textDecorationLine === 'none')
        .map((anchor) => anchor.textContent?.trim() ?? ''),
    )
    expect(undecorated, 'links that read exactly like the text around them').toEqual([])
  })

  /**
   * Off-screen, not `display: none` — which would take it out of the tab order and remove the
   * only thing it is for — and not visible, which is what put "Skip to content" above the
   * wordmark on all seven pages.
   */
  test(`${route.path} hides the skip link until it is focused`, async ({ page }) => {
    await page.goto(at)
    const skip = page.locator('a.skip')
    await expect(skip).not.toBeInViewport()

    await page.keyboard.press('Tab')
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport()
  })
}

/**
 * The mark, from `mock-knight-logo-kit/` via `public/brand/`, swapped with the theme the way the
 * application's top bar swaps it. `naturalWidth` is the assertion that matters: a `<picture>`
 * pointing at a path the base path broke renders as nothing and reports zero.
 */
for (const colorScheme of ['light', 'dark'] as const) {
  test(`the top bar carries the ${colorScheme} mark`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await page.goto('./')
    const mark = await page.evaluate(() => {
      const image = document.querySelector<HTMLImageElement>('header .brand img')
      return image === null ? null : { src: image.currentSrc, width: image.naturalWidth }
    })
    expect(mark, 'no mark in the top bar').not.toBeNull()
    expect(mark!.width, 'the mark did not load').toBeGreaterThan(0)
    expect(mark!.src).toContain(
      colorScheme === 'dark' ? 'mock-knight-mark-dark.svg' : 'mock-knight-mark.svg',
    )
  })
}

/**
 * The FAQ is the highest-intent page on the site, and it is pure flowed prose — so it is the one
 * that fails hardest when the preflight's `* { margin: 0 }` is never answered.
 */
test('the FAQ separates its questions from its answers', async ({ page }) => {
  await page.goto('./faq/')
  const rhythm = await page.evaluate(() => {
    const headings = [...document.querySelectorAll('main .prose h2')]
    const paragraphs = [...document.querySelectorAll('main .prose p')]
    return {
      headings: headings.length,
      headingTop: Math.min(...headings.map((h) => parseFloat(getComputedStyle(h).marginTop))),
      paragraphBottom: Math.min(
        ...paragraphs.map((p) => parseFloat(getComputedStyle(p).marginBottom)),
      ),
    }
  })
  expect(rhythm.headings).toBeGreaterThan(4)
  expect(rhythm.headingTop).toBeGreaterThan(8)
  expect(rhythm.paragraphBottom).toBeGreaterThan(8)
})

/**
 * Spec §5.1: the semantic green and red appear on this site only where they mean matched and
 * unmatched. `--mk-method-post-*` is byte-identical to `--mk-success-*` in the generated
 * palette, so a decorative method badge rendered with it put the page's loudest green four rows
 * above two rows reading "✓ matched" in exactly that colour.
 */
test('the hero method badge does not wear the colour that means matched', async ({ page }) => {
  await page.goto('./')
  const colours = await page.evaluate(() => {
    const style = (selector: string) => {
      const element = document.querySelector(selector)!
      const computed = getComputedStyle(element)
      return { color: computed.color, background: computed.backgroundColor }
    }
    return {
      method: style('.explainer .request .method'),
      matched: style('[data-state="pass"] .result'),
    }
  })
  expect(colours.method.color).not.toBe(colours.matched.color)
})
