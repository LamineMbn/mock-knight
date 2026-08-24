# Contributing to Mock Knight

Thanks for looking. This document is short on ceremony and long on the things that will
actually get a pull request rejected.

## Getting set up

You need **Node ≥ 22** (`better-sqlite3` v13 requires it), **pnpm 10**, and Docker if you want
to run the integration or end-to-end suites.

```bash
pnpm install
pnpm test          # unit tests, no server needed
pnpm typecheck
pnpm lint
```

To actually run it:

```bash
# 1. a throwaway WireMock the test suites are allowed to overwrite
docker run -d --name mk-dev-wiremock -p 18099:8080 wiremock/wiremock:3.13.1 --verbose

# 2. build the SPA and the CLI
pnpm build

# 3. the server on :7777, serving the built SPA
pnpm dev:server --url http://localhost:18099

# 4. optional: Vite on :5173 with hot reload, proxying /api to :7777
pnpm dev:web
```

## Layout

| Package | What it is |
|---|---|
| `@mock-knight/core` | Domain model, canonical serialiser, capability registry, query language, match explainer, three-way merge. Depends on nothing else in the workspace |
| `@mock-knight/adapter-wiremock` | Everything WireMock-specific. Translates its JSON to and from the canonical model |
| `@mock-knight/server` | The BFF: SQLite mirror, query→SQL compiler, Hono routes, write path, audit trail |
| `@mock-knight/web` | The React SPA |
| `mock-knight` | The published CLI. Runs the server and serves the built SPA |

Unit tests run from the repo root through one Vitest project with the workspace packages
aliased to their **source**, so no build step stands between an edit and a test run.

## The four test tiers

| Tier | Command | Needs |
|---|---|---|
| Unit | `pnpm test` | nothing |
| Perf budgets (1k/5k/10k fixtures) | `pnpm test:perf` | nothing |
| Integration (BFF ↔ real WireMock) | `pnpm test:integration` | WireMock on `:18099` |
| Adapter conformance (contract ↔ real backend) | `pnpm test:conformance` | WireMock on `:18099` |
| End-to-end (browser ↔ built SPA) | `pnpm test:e2e` | the above, plus the CLI on `:7777` |

> **The last two replace the target WireMock's corpus wholesale.** Point them only at a
> throwaway instance. `MOCK_KNIGHT_TEST_WIREMOCK_URL` and `MOCK_KNIGHT_E2E_URL` override the
> defaults.

Playwright runs with `workers: 1`. That is not a performance oversight — every spec reseeds the
same WireMock, and parallel workers redefine each other's corpus mid-test. The symptom is a
suite that passes file-by-file and fails as a whole, which reads like a product bug and is not
one.

## Adding a backend

The adapter contract is executable. `packages/core/src/conformance.ts` holds the whole of it as
tests, and they are identical for every backend — an adapter is the **subject** of that suite,
not its author. Backend-specific tests written next to an adapter tend to assert what that
adapter already does, which is how a portable model quietly becomes one vendor's JSON with
different field names.

So a new backend is: an adapter, plus one `packages/adapter-<name>/src/<name>.conformance.test.ts`
that connects it and hands it over. That file should contain no assertions at all. If a test in
the shared suite cannot pass for a legitimate backend, the *contract* is wrong — change
`conformance.ts` and say why, rather than special-casing the adapter.

Every test skips itself when the capability it exercises is off, because a capability that is
off means the method is absent (invariant 5), and absence is an answer rather than a failure.

## Architecture invariants

Break one of these and the design stops working. They are not style preferences, and a pull
request that breaks one won't be merged even with green tests. The first two are enforced by
`pnpm lint`; the rest are on us.

1. **Layering.** `core` imports nothing from the workspace → `adapter-*` imports only `core` →
   `server` imports `core` and adapters → `web` imports only `@mock-knight/core/types`, the
   browser-safe entry point → `cli` composes `server` and the built SPA.

2. **Colour, spacing and elevation come from `--mk-*` tokens only.** Never a literal colour in
   a component; never a token whose only definition lives inside a `@media` or `[data-theme]`
   block. Tokens are generated — edit `design/design-tokens.py` and run `pnpm tokens:css`,
   don't retype a hex.

3. **Never key on a server id.** Use `client_key = server_id ?? hash(canonical(raw))`. Some
   backends have no stable ids at all.

4. **Never lose `raw`.** `toVendor` *patches* the retained vendor document; it does not rebuild
   it. Silently dropping a field the canonical model doesn't understand is the worst bug this
   application can have.

5. **Capabilities gate everything optional.** A capability that is off means the method is
   *absent* and the route returns **404**, not 403. Never render a control that can fail.

6. **Re-read and hash-compare immediately before every write.** This is the only thing
   preventing one developer silently overwriting another. Do not add a write path that skips
   it.

7. **The mock server is the source of truth.** SQLite is a disposable cache. If you find
   yourself treating the mirror as authoritative, that's a bug forming.

8. **zod at every boundary.** HTTP in, HTTP out, adapter in, adapter out, config load.

## Honesty rules

These are about what the UI is allowed to claim, and they matter as much as the invariants.

- **Never present something inferred as though the server said it.** Overlap detection and
  ranked near-misses are Mock Knight's own reasoning; they carry the inference marker and a
  tooltip explaining the method.
- **Anything derived from the request journal carries its window.** "Unused since 09:14 today",
  never "unused" — the journal is finite and resettable.
- **Never convey state by colour alone.** Always an icon or a label too. Green and red are
  reserved for matched / unmatched / destructive.
- **Never write a secret** into the audit table, a log line, or a URL.
- **Don't poll the mock server aggressively.** There is no delta endpoint, and a full corpus
  transfer per tick degrades the very server someone is debugging.

## Conventions

- TypeScript `strict`. **No `any`** in production code — `unknown` plus a zod parse instead.
  Tests are exempt, and the lint config says why.
- Hono routes must be **chained**, or `hc<AppType>` inference breaks.
- Tests live beside the code as `*.test.ts`.
- Don't add a dependency without saying why in the pull request.
- Commit messages: imperative and scoped — `core: make canonical output byte-stable`.
- Don't animate rows in the virtualised list. It's 10,000 rows and it has to hold 60fps.

## Traps that have already bitten this codebase

Each of these was found by running something, not by reading documentation.

- **FTS5 external-content columns must exist on the backing table.** Naming a missing one
  succeeds at `CREATE` and then fails every rebuild with `no such column`.
- **Trigram queries under 3 characters return zero rows, silently.** The planner has to fall
  back to `LIKE`.
- **`detail=full` is required** on the FTS table, or queries with tokens longer than 3
  characters break.
- **One `better-sqlite3` `Database` per thread.** Handles are not transferable via
  `postMessage`. WAL plus `busy_timeout` is mandatory.
- **`undici` cannot be bundled** into an ESM build. It stays external; bundling it produces a
  build that succeeds and then dies at startup.
- **`POST /__admin/mappings/import` merges by default.** Replace needs
  `importOptions.deleteAllNotInImport: true`, or `replaceAll` silently becomes a merge.
- **undici reports every transport failure as `TypeError: fetch failed`.** The real cause —
  DNS, refused, TLS — is a `code` buried in a `cause` chain.

## Pull requests

1. Open an issue first for anything that changes behaviour. For a bug, the most useful thing you
   can include is the failing request and what the server actually returned — the error
   disclosure in the UI has a **Copy details** button for exactly this.
2. `pnpm lint && pnpm typecheck && pnpm test` must pass. CI runs the integration and e2e tiers
   against a real WireMock too.
3. Add a test at the lowest tier that can catch the bug. A unit test beats an e2e test.
4. Say in the description how a reviewer can verify the change by running something.

## Releasing

Maintainers only. Tag and push:

```bash
npm version patch -w mock-knight   # or minor / major
git push --follow-tags
```

The tag triggers a workflow that checks the tag against the package version and the npm token
before anything else, then runs every test tier, publishes to npm with provenance, and attaches
the tarball to a GitHub Release. Tags must be `v*`.

The `NPM_TOKEN` secret is a **granular access token** — npm retired the non-expiring Automation
kind. It therefore expires, and the release will stop working on a date nobody remembers. The
preflight job fails in seconds with the reason rather than at the publish step ten minutes in.
To rotate: create a new token scoped to `mock-knight` with read *and* write, then
`gh secret set NPM_TOKEN`.
