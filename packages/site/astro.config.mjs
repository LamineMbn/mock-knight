import sitemap from '@astrojs/sitemap'
import tailwind from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

/**
 * A GitHub Pages *project* site: everything is served under `/mock-knight`, and `site` is the
 * origin without it. `@astrojs/sitemap` joins the two, so the sitemap holds absolute URLs that
 * actually resolve.
 *
 * `trailingSlash: 'always'` matches how Pages serves directories. Without it, half the internal
 * links take a redirect and the canonical URL disagrees with the one Google crawls.
 */
export default defineConfig({
  site: 'https://laminembn.github.io',
  base: '/mock-knight',
  trailingSlash: 'always',
  integrations: [sitemap()],
  vite: { plugins: [tailwind()] },
})
