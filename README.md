<div align="center">
  <img src="packages/web/public/brand/mock-knight-mark.svg" width="72" alt="">
  <h1>Mock Knight</h1>
  <p><strong>A local-first web UI for HTTP mock servers.</strong></p>
  <p>
    <a href="https://github.com/LamineMbn/mock-knight/actions/workflows/ci.yml"><img src="https://github.com/LamineMbn/mock-knight/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="https://www.npmjs.com/package/mock-knight"><img src="https://img.shields.io/npm/v/mock-knight.svg" alt="npm"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache 2.0"></a>
  </p>
</div>

Mock Knight connects to a mock server you already run and helps you **find** a stub among
thousands, **understand** why a request didn't match it, and **change** it safely on a server
your whole team shares.

It is **not a mock server**. It never serves mock traffic. Point it at your WireMock or
MockServer and it gives you a UI; stop it and your mocks carry on exactly as before.

```bash
npx mock-knight --url http://localhost:8080
```

---

## Why

A mock server with three stubs needs no tool. A mock server with three thousand — shared by a
team, edited by everyone, driving the tests that gate your release — is a different thing. The
admin API answers questions one `curl` at a time, and the questions that actually matter are the
ones it answers worst:

- **Which stub answered this request?** And if none did, *how close* did each one get?
- **Which of these four stubs on `/v1/rates` actually wins?** They differ only by a header.
- **Did my edit just silently drop a field** the UI didn't know about?
- **Is this stub dead**, or has it just not been called since the journal was last cleared?

## What it does

| | |
|---|---|
| **Find** | Full-text and structured search (`method:POST status:5xx header:X-Tenant`), faceted filters with live counts, a folder tree, and a virtualised list that stays fluid at 10,000 rows |
| **Explain** | For any unmatched request, the closest stubs ranked, with a field-by-field comparison of what matched and what didn't — and one click to create a stub that would have matched |
| **Priority** | Which stub on a path actually answers, and which are shadowed. Invisible in a flat list, decisive on a corpus where stubs differ only by header |
| **Edit safely** | Every write re-reads and hash-compares first, so two people editing the same stub get a three-way merge instead of a lost update |
| **Watch** | A live request journal with match state, filters, and the match explainer one keystroke away |
| **Scenarios** | Stateful stubs as a state graph, with unreachable states and dead ends flagged |
| **Keyboard first** | `⌘K` reaches every action, screen, server and stub; `/` focuses search; `?` publishes the whole map |
| **Light and dark** | Follows the OS by default, or pin either. It is a debugging tool; it gets used at both ends of the day |

Two principles shape all of it:

- **Your mock server is the source of truth.** Mock Knight keeps a local SQLite mirror purely as
  a cache. Delete it and nothing is lost.
- **Nothing inferred is presented as fact.** Anything Mock Knight worked out itself — overlap
  detection, ranked near-misses — is labelled as its own inference. Anything derived from the
  request journal carries the window it came from, because that journal is finite and
  resettable. A tool that presents a guess with the confidence of a fact gets abandoned the
  first time the guess is wrong.

## Install

Requires **Node 22 or newer** (`better-sqlite3` v13 needs it).

```bash
# one-off
npx mock-knight --url http://localhost:8080

# or keep it around
npm install -g mock-knight
mock-knight --url http://localhost:8080
```

It starts a local server, opens on `http://127.0.0.1:7777`, connects to the mock server you
named, and mirrors its corpus.

### Options

| Flag | Default | |
|---|---|---|
| `--url <url>` | — | Mock server to connect to on startup. A context path is kept: `https://host/ctx` calls `https://host/ctx/__admin` |
| `--port <n>` | `7777` | |
| `--host <addr>` | `127.0.0.1` | Anything else prints a warning — there is no authentication |
| `--state <path>` | OS data dir | Where the SQLite mirror lives |
| `--name <name>` | the URL's host | Profile name |
| `--no-refresh` | | Skip the initial corpus mirror |
| `--mode <local\|deployed>` | `local` | `deployed` disables actions that assume a single trusted user |
| `--config <path>` | `./mock-knight.json` if present | See below |
| `--no-config` | | Ignore any config file |

Servers you connect to are remembered in the state database and stay in the list until you
remove them (Servers → Remove). `--url` always decides which one the browser opens, whatever
else is in there, and naming one that is already known simply opens it rather than adding a
second copy.

One address, one server: two profiles reaching the same admin URL are refused, since both would
mirror the same corpus and the switcher would offer a choice that changes nothing. The
comparison is on the composed address, so a trailing slash or a spelled-out `/__admin` does not
sneak a duplicate past.

### `mock-knight.json`

Optional. Picked up from the working directory, or named with `--config`. **A flag always wins
over the file** — a flag is what you typed just now.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/LamineMbn/mock-knight/main/schema/mock-knight.schema.json",
  "port": 7777,
  "state": "./mirror.db",            // relative to this file, not your shell's directory
  "allowedHosts": ["wiremock.internal:8080"],
  "profiles": [
    {
      "name": "staging",
      "adapter": "wiremock",
      "baseUrl": "${env:STAGING_MOCK_URL}",
      "authKind": "bearer",
      "authRef": "STAGING_TOKEN",     // the NAME of an env var, never a value
      "readOnly": true
    }
  ]
}
```

- **`allowedHosts`** restricts where this instance may connect. Absent means no restriction;
  an empty array means nothing is reachable. Worth setting whenever you use `--host`.
- **`profiles`** are reconciled by name on every start, so edit and restart. They are the way
  to share a set of servers with a team through version control.
- **`${env:VAR}`** is interpolated into string values, and refuses to start if the variable is
  unset rather than substituting an empty string. It is deliberately **not** applied to
  `authRef`, which names a variable rather than holding one — so a token cannot end up in a
  file you commit.
- The `$schema` line gives you completion and validation in any editor that reads JSON Schema.
- YAML is not implemented yet; a `.yaml` file is reported, not ignored.

## Supported backends

| Backend | Status |
|---|---|
| **WireMock 3.x** | Supported. Read, write, journal, scenarios, near-miss |
| WireMock 2.x | Read paths work; some admin routes are probed and gracefully absent |
| **MockServer** | Supported. Read and write. No traffic log and no scenarios — it records no attribution for a served request and has no named states, so both screens are absent rather than empty |
| **Mockoon** | Read, edit and traffic. Its corpus is an environment JSON file — the admin API cannot read routes — so point a profile at the file. Editing rewrites that file surgically, leaving everything it did not touch byte-identical; run Mockoon with `--watch` and it serves the change about a second later. Adding and deleting stubs are not offered: both also rewrite `rootChildren`, where a mistake silently unserves a route |
| **Prism** | Read-only. Its corpus is the OpenAPI document it serves — Prism has no control API — so point a profile at the file. An operation becomes one stub per declared response, ranked the way Prism picks: lowest 2xx first |
| Hoverfly, JSON Server | Not yet. JSON Server in particular is a poor fit: it has no matchers, no journal and no stubs — its `db.json` holds data, and its routes are generated rather than declared |

Pick one with `--adapter`, or per server on the Servers screen:

```bash
npx mock-knight --url http://localhost:1080 --adapter mockserver
```

A Mockoon profile also needs the path to its environment JSON file — the Servers screen asks for
it once Mockoon is chosen as the backend, because its admin API cannot read routes. Start Mockoon
with `--watch` and the file is authoritative: edit it and the server follows.

```bash
mockoon-cli start --data ./env.json --port 3000 --watch --admin-api-token <token>
```

The traffic log needs that token; set it as an environment variable and name the variable in the
profile's auth field, which is where every secret is referenced rather than stored.

Mock Knight probes each server on connect and derives a **capability set**. A capability that is
off means the control is *absent*, never a button that fails when you press it. The Servers
screen shows the full report and explains what each one being off costs you.

## Security

Mock Knight is **unauthenticated** and binds to loopback by default. It is a developer tool for
a machine you control.

- It fetches arbitrary URLs by design, so an exposed instance is a relay into whatever network
  it can see. Binding to a non-loopback address prints a warning; put a reverse proxy in front
  of it if you must.
- **It never stores a secret.** A profile holds the *name* of an environment variable, never its
  value. Nothing sensitive reaches the database, a log line, a URL, or the browser.
- Configured headers are redacted before a request journal entry is stored.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). It covers the layout, the four test tiers, and the
architecture invariants — those are load-bearing, and a change that breaks one won't be merged
even if the tests pass.

## License

[Apache-2.0](LICENSE) © Lamine Bendib
