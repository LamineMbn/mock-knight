# Mock Knight documentation site — design

**Date:** 2026-08-29
**Status:** proposed, awaiting review
**Supersedes / amends:** nothing. `design/DESIGN-BRIEF.md` §11 lists a marketing site as out of
scope, so no existing document governs this artefact.

---

## 1. Why this exists

Mock Knight does not appear in a search for *"UI for wiremock"*, *"wiremock ui"* or *"UI for
mocks"* — the queries its actual audience types. Work already landed (2026-08-29) fixed the two
cheapest causes: the repository had no description and no topics, and the README did not name
WireMock until fifteen lines in. Those win GitHub search, npm search, and the long tail.

They do not win the head term. A README on github.com competes for *"UI for wiremock"* against
`wiremock.org` and Stack Overflow from a page whose title Google renders as
`GitHub - LamineMbn/mock-knight: …`, whose H1 belongs to the repository chrome rather than the
content, and which is one page trying to rank for six different query clusters at once.

A site fixes the structural problem: **one page per query cluster**, each with its own `<title>`,
its own H1, and content that answers that query and no other.

### Success criteria

1. `laminembn.github.io/mock-knight/` is indexed and ranks for the brand query *"mock knight
   wiremock"* within weeks.
2. The four backend pages are each indexed under their own backend name.
3. Lighthouse SEO 100 and Performance ≥ 95 on the landing page, mobile profile.
4. The site cannot state a configuration fact that disagrees with the program (see §7).

### Explicit non-goal

Ranking #1 for *"UI for wiremock"* is not promised. It is a competitive head term owned by the
vendor whose product it names. The site makes the attempt structurally possible; nothing here
guarantees the outcome.

---

## 2. Decisions taken before this document

| Decision | Choice | Consequence |
|---|---|---|
| Host | GitHub Pages **project site**, `laminembn.github.io/mock-knight/` | Every URL carries a `/mock-knight` base path. Free, no DNS. Authority is shared with anything else published under that user |
| Generator | **Astro** | Zero JS by default, full control of `<head>`, markdown content collections |
| Scope | Landing + four backend pages + config reference + FAQ | Seven pages, each owning one query cluster |

A custom domain was considered and declined. Should that change, §6.2 keeps the base path in one
configuration value.

---

## 3. How the existing design brief applies

`design/DESIGN-BRIEF.md` governs the application. §11 places both *"marketing site"* and
*"Mobile and tablet layouts"* out of its scope. This spec therefore takes it as follows:

| Section of the brief | Applies here? | Reason |
|---|---|---|
| §9 Brand — mark, wordmark, voice, vocabulary | **Yes, fully** | §9 names *docs* as a place brand appears |
| §3.1 Colour tokens | **Yes** | One palette or the site is visibly a different product |
| §3.2 Typography families | **Yes** — families. **No** — the 13px scale | The app's dense scale is for a 30-row table. Prose at 13px is a readability defect |
| §3.3 Spacing, radius | **Yes** | 4px scale, small radii |
| §2.1 "Colour means something or it isn't there" | **Yes** | Enforced: see §5.1 |
| §1 "Not mobile. Desktop only ≥1280px" | **No** | Scoped to the app, and §11 excludes this artefact |
| §1 "Not a dashboard, no hero metrics" | **Yes, in spirit** | The hero is the product's real output, not a stat card |

**The one genuine tension, stated rather than resolved silently:** the brief says desktop only.
Google has indexed mobile-first since 2019 — the mobile rendering of a page *is* what gets ranked.
A desktop-only site would undermine the single reason this site exists. The brief's rule is about
a dense debugging UI that nobody uses on a phone; this is a public page whose whole job is to be
found. It is responsive.

---

## 4. Information architecture

Seven pages. Each targets one cluster and does not compete with its siblings.

| Page | URL | Query cluster | `<title>` (≤60ch so Google does not truncate) | H1 |
|---|---|---|---|---|
| Landing | `/mock-knight/` | UI for wiremock · wiremock ui · mock server ui | `Mock Knight — a web UI for WireMock` | A web UI for WireMock |
| WireMock | `/mock-knight/wiremock/` | wiremock ui · wiremock gui · wiremock admin ui · browse wiremock stubs · edit wiremock mappings | `WireMock UI — browse and edit stubs in a browser` | A UI for WireMock |
| MockServer | `/mock-knight/mockserver/` | mockserver ui · mockserver dashboard | `MockServer UI — search and edit expectations` | A UI for MockServer |
| Mockoon | `/mock-knight/mockoon/` | mockoon ui · mockoon traffic log · shared mockoon environment | `Mockoon environments in a shared web UI` | Mockoon, from a browser |
| Prism | `/mock-knight/prism/` | prism mock ui · stoplight prism ui · openapi mock ui | `Prism UI — read an OpenAPI mock's stubs` | A UI for Prism |
| Config | `/mock-knight/config/` | mock-knight.json · configuration reference | `Configuring Mock Knight — mock-knight.json` | Configuration |
| FAQ | `/mock-knight/faq/` | does wiremock have a ui · wiremock cloud alternative | `Mock Knight FAQ` | Questions |

### 4.1 Honesty constraint on the Mockoon page

**Mockoon ships its own desktop GUI.** A page titled "the UI for Mockoon" would be a false claim
and the first Mockoon user to arrive would bounce. That page is about what Mock Knight adds and
nothing else: reading an environment file a team shares from version control or CI, a traffic
log, surgical edits that leave the rest of the document byte-identical, and one interface across
four backends. It links to Mockoon's own app rather than competing with it.

The same discipline applies elsewhere. The Prism page says **read-only** above the fold, because
Prism has no control API. The MockServer page says there is **no traffic log and no scenarios**,
because MockServer records no attribution for a served request. A capability that is off is
stated, not omitted — that is invariant 4 applied to marketing copy.

---

## 5. Visual design

### 5.1 Colour

The application's tokens, imported rather than restated. Light: `--mk-bg-canvas #F7F8FA`,
`--mk-bg-surface #FFFFFF`, accent `--mk-accent #5B5BD6` (dark `#5D5DE0`). Dark mode arrives free:
`tokens.css` already redefines every value twice, once for `prefers-color-scheme` and once for an
explicit `[data-theme]`.

**No site-only decorative hue.** The semantic green and red appear on this site *only* where they
mean matched and unmatched — the hero table, the capability matrices. This keeps §2.1 of the brief
true across both artefacts, and it means the one place the page uses colour loudly is the one
place colour carries information.

### 5.2 Typography

Two families, three roles, no third webfont — a font request is a measurable ranking cost.

| Role | Family | Size | Used for |
|---|---|---|---|
| Display | **JetBrains Mono** 500 | 40–56px, tight tracking | Hero thesis, page H1s, section eyebrows |
| Body | **Inter** 400/500 | 16 / 26, measure ≤ 68ch | Prose |
| Data | **JetBrains Mono** 400 | 12–13, `tabular-nums` | Predicate tables, capability matrices, code |

Making the *monospace* face the display face inverts the usual dev-docs treatment. It is justified
by the subject rather than by taste: this product's content is paths, headers and predicates,
which are monospace by nature. The app already loads both families, so the site adds no new font.

Both are self-hosted from the existing `@fontsource-variable` packages — no Google Fonts request,
which is one fewer third-party connection and one less thing to be slow.

### 5.3 The hero — thesis, and the one risk

Not a headline over a gradient, not a screenshot, not a stat card. **The hero is a live match
explanation** rendered in real HTML with the app's own tokens: a request on the left, the closest
stub's predicates on the right, the failing row loud and the passing rows quiet.

```
┌────────────────────────────────────────────────────────────────┐
│  ◈ mock-knight                    WireMock  MockServer  … FAQ  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  A web UI for WireMock.       │  POST /payments/v2/charges     │
│                               │  X-Tenant:  [ initech    ▾ ]   │
│  Your mock server returned    │  ────────────────────────────  │
│  404 and will not say why.    │  FIELD     EXPECTED   ACTUAL   │
│  This says why.               │  method    POST       POST   ✓ │
│                               │  url       /v2/char…  /v2/…  ✓ │
│  $ npx mock-knight --url …    │  X-Tenant  acme       initech✗ │
│                               │  ✗ 1 of 3 predicates failed    │
└────────────────────────────────────────────────────────────────┘
```

**Behaviour.** The `X-Tenant` control is a native `<select>` with four values — `acme`, `globex`,
`umbrella`, `initech`. Three match a stub in the demo corpus; `initech` matches none. Changing it
recomputes the three rows and the verdict line in place.

**Constraints on it:**

- **Server-rendered in the failing state.** The interaction is progressive enhancement. With
  JavaScript off — which is how a crawler that does not execute scripts sees it — the table is
  fully present and meaningful. No content depends on the script.
- **Native `<select>`**, so it is keyboard reachable and screen-reader labelled without work.
- **`aria-live="polite"`** on the verdict line, so the change is announced rather than silent.
- **Triple-encoded**, per brief §2.2: hue, glyph (`✓` / `✗`), and a text label. Never colour alone.
- **`prefers-reduced-motion`** removes the row transition.
- **Roughly 40 lines of inline vanilla JavaScript.** No framework, no hydration, no island. The
  site's zero-JS default is broken exactly once, deliberately, for the thing the product is.

This is the single risk in the design. Everything around it stays quiet: no scroll-jacking, no
parallax, no ambient animation, no gradient.

### 5.4 Structure

The organising device is **capability presence and absence** — what each backend can and cannot
answer — not `01 / 02 / 03` numbering. This is a real typed structure in the product rather than
decoration applied to it, it is the same grammar as the app's capability report, and it gives the
four backend pages a spine that is honest by construction.

Below the hero the landing page runs: the four screens as real screenshots with a one-line claim
each (reusing `docs/images/`, already committed) · the capability matrix linking to the four
backend pages · install · a short FAQ excerpt linking to the full page.

### 5.5 Quality floor

Responsive to 360px. Visible keyboard focus using the app's focus-ring token. Reduced motion
respected. Colour contrast inherited from a palette whose contrast report CI already asserts at
zero failures. Every image carries the alt text written for the README.

---

## 6. Engineering

### 6.1 Package

A new workspace package, `packages/site`. It **imports nothing from the workspace** — the cleanest
position in the layering rule (invariant 1), and it needs nothing: its only structured input is a
committed JSON file (§7), read at build time rather than imported.

```
packages/site/
  astro.config.mjs
  package.json
  src/
    layouts/Base.astro        ← <head>, nav, footer, JSON-LD
    components/
      MatchHero.astro         ← §5.3
      CapabilityMatrix.astro
      Screenshot.astro
    pages/
      index.astro
      wiremock.astro  mockserver.astro  mockoon.astro  prism.astro
      config.astro    faq.astro
    styles/site.css           ← imports the generated tokens.css
  public/
    robots.txt
```

**The screenshots live outside this package.** `docs/images/` is at the repository root, where
the README needs it, and Astro serves only its own `public/`. A `prebuild` step copies the six
PNGs into `packages/site/public/images/` — copied rather than symlinked, because a symlink
survives a local build and does not survive `upload-pages-artifact`. The copies are gitignored;
`docs/images/` stays the one committed home, regenerated by `scripts/capture-screenshots.mts`.

### 6.2 Base path

```js
// astro.config.mjs
site: 'https://laminembn.github.io',
base: '/mock-knight',
```

Every internal link and asset goes through `import.meta.env.BASE_URL`. A hardcoded `/wiremock/`
resolves correctly in `astro dev` and 404s in production, which is the failure mode of every
GitHub Pages project site; §9 tests for it. Moving to a custom domain later is a change to these
two values plus a `CNAME` file.

### 6.3 Token reuse

`src/styles/site.css` imports `packages/web/src/styles/tokens.css` directly. That file begins with
`@import 'tailwindcss'` and declares its values in a Tailwind 4 `@theme static` block, so the site
uses `@tailwindcss/vite` as the web package already does. One generated palette, one generator
(`design/design-tokens.py`), and CI's existing staleness check covers both consumers.

The site adds **no `--mk-*` token of its own.** If it needs a value that does not exist, the value
goes in `design/design-tokens.py` and `pnpm tokens:css` is re-run — the same rule the app follows.

### 6.4 Repository integration

| Concern | Change |
|---|---|
| Layering lint | `eslint.config.js` gains a `packages/site/**` entry banning every `@mock-knight/*` import |
| Invariant 8 | The literal-colour rule is extended to `packages/site/**/*.{ts,astro}` where the parser allows. If ESLint cannot parse `.astro` without a plugin this is stated as a known gap rather than silently dropped |
| Prettier | `prettier-plugin-astro`, so `pnpm lint`'s format check covers the new files rather than ignoring them |
| Typecheck | `packages/site` gets a `typecheck` script running `astro check`; `pnpm -r typecheck` picks it up |
| Build | Root `pnpm build:site`. Deliberately **not** added to `pnpm build`, which produces the CLI tarball and must not slow down or gain a failure mode for something the tarball does not contain |

### 6.5 Deployment

A new `.github/workflows/pages.yml`, triggered on push to `main` when `packages/site/**`,
`docs/images/**`, `design/**` or `packages/web/src/styles/tokens.css` change, plus
`workflow_dispatch`. That last path matters and is easy to miss: the palette the site renders from
is the generated file in the *web* package, so a token change that does not touch `design/` would
otherwise never redeploy the site. Standard
`actions/configure-pages` → `upload-pages-artifact` → `deploy-pages`, Node 22, pnpm.

`ci.yml`'s `check` job gains a `pnpm build:site` step, so a broken site fails a pull request rather
than failing after merge on a workflow nobody is watching.

**Manual prerequisite:** Pages must be switched to *Source: GitHub Actions* in repository
settings. This is a one-time click and the deploy workflow cannot do it for itself.

---

## 7. The configuration page is generated, not written

The single largest drift risk in a docs site is a configuration reference that slowly stops
describing the program. This repository already solved that problem for a different consumer:
`schema/mock-knight.schema.json` is emitted from the zod schema the loader actually validates
against, and CI fails if the committed copy is stale.

The config page renders **from that file**, at build time. Every field, its type, whether it is
required, and its description come from the schema. Prose that cannot be derived — worked
examples, the `${env:VAR}` rules — is hand-written around the generated table.

The result: a field cannot be added to the config without appearing on the site, and the site
cannot document a field the program does not accept.

**Not extended to the capability matrix.** Adapter capabilities are resolved at runtime after
probing a live server, so there is no static artefact to generate from. The matrices are
hand-written and their correctness rests on review, which is stated here rather than left as an
assumption.

---

## 8. Content, and where it lives

| Content | Canonical home | Consequence |
|---|---|---|
| Install, quick start, options | README | Site restates the quick start only; deep options link to the README |
| Configuration reference | Site (generated, §7) | README keeps its short example and links onward |
| Per-backend detail | Site | README's backend table becomes a summary with links |
| FAQ | Both | Deliberate duplication: it is short, it is the highest-intent content, and both surfaces need it. Reviewed together or not at all |

The README stays a complete document. Someone who reaches the repository and never visits the site
must still be able to install and use the tool — a README that is a stub pointing elsewhere is a
worse artefact than the one that exists today.

---

## 9. Verification

| What | How |
|---|---|
| Every internal link resolves under the base path | A build-time link check over `dist/`, failing on any `href` that does not exist as a file. This catches the base-path mistake, which is invisible in `astro dev` |
| The hero works without JavaScript | A Playwright spec with `javaScriptEnabled: false` asserting the predicate table and its verdict are present |
| The hero works with it | A Playwright spec selecting `acme` and asserting the verdict flips to matched, and that the live region announced |
| No page ships without title, description, canonical, OG | A test over `dist/**/*.html` asserting all four on every page, and that no two pages share a title |
| Config page matches the program | Already guaranteed by §7 plus CI's existing schema staleness check |
| Performance and SEO | Lighthouse CI on the landing page, mobile profile, budget SEO 100 / Performance ≥ 95 |
| Accessibility | `axe` over each built page in the same Playwright run |

**Where these live.** `playwright.config.ts` at the root is tier 4 — it points at
`packages/web/e2e` and needs the CLI, WireMock and a built SPA running. The site tests need none
of that: they run against `packages/site/dist` served statically. They therefore get their own
`playwright.site.config.ts` with a `webServer` block serving that directory, a `test:site` script,
and their specs in `packages/site/e2e`. Folding them into tier 4 would make a static-site
assertion depend on a Docker container, which is how a suite becomes one people skip.

**In CI** they run in the `check` job, which gains `pnpm exec playwright install --with-deps
chromium` — a cost `check` does not pay today and should be measured before it is accepted.

---

## 10. Dependencies

Per the convention in `TECH-DESIGN.md` §5, each is argued rather than assumed. All are
`devDependencies` of a `private` package that is never published.

| Dependency | Why, and what was rejected |
|---|---|
| `astro` | Zero JS by default, per-page `<head>` control, file-based routing, static output. VitePress was rejected: faster to stand up, but its shell is recognisable and per-page head control is harder — and looking like every other VitePress site is a cost when the goal is to look like a product |
| `@astrojs/sitemap` | `sitemap.xml` and `sitemap-index.xml` generated from the route list. Hand-maintaining a sitemap across seven pages is a file that goes stale the first time a page is added |
| `prettier-plugin-astro` | Without it, `.astro` files must be added to `.prettierignore` and the format gate silently stops covering the newest code in the repository |
| `@tailwindcss/vite` | Already in the repository. `tokens.css` is a Tailwind 4 `@theme static` block; consuming it any other way means a second copy of the palette |
| `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` | The two families the app already uses, self-hosted. Not workspace imports — the site declares them itself, which keeps it importing nothing from the workspace (§6.1). The alternative, a Google Fonts `<link>`, adds a third-party connection on the critical path and is a measurable performance cost on the one page that has to be fast |
| `@lhci/cli` *(CI only)* | The performance and SEO budget in §9. Could be dropped if the budget is judged not worth a dependency |

No runtime dependency is added to anything a user installs. `mock-knight`'s published
`dependencies` are unchanged.

---

## 11. Out of scope

A live in-browser demo of the actual application (an MSW-backed BFF running the real SPA) — the
strongest possible conversion device and several times the work of everything above; revisit once
the site exists · a blog or changelog feed · search over the site · versioned documentation ·
i18n · a custom domain · analytics.

---

## 12. Open questions

1. **Lighthouse CI** adds a dependency and roughly a minute to `check`. Keep it, or assert the
   budget by hand at review time?
2. **The FAQ is duplicated** between README and site by decision, not accident. If that proves
   annoying to maintain, the fallback is to generate both from one markdown file — deferred
   because the machinery costs more than the duplication until it actually drifts.
