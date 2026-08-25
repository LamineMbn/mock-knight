# Changelog

## Unreleased

### Fixed

- **The Priority column named the wrong winner on MockServer.** MockServer ranks the opposite way
  to WireMock — an unset priority is 0 rather than 5, and the *higher* number wins — while the
  standing was computed with WireMock's rule inlined for every backend. So on a MockServer
  profile the column marked the losing expectation as the one that answers, which is the exact
  question it exists to answer. Ranking is now a property of the backend.

  Mockoon and Prism have no priority number at all; an uncontested stub there now shows an em
  dash rather than WireMock's default presented as theirs, and the advice for resolving a tie
  names the direction that actually works on the backend you are looking at.

### Added

- **Prism reads the specifications people actually have.** The first parser choice rejected a real
  OpenAPI document that Prism itself served without complaint, over a multi-line quoted string
  indented at its key rather than deeper. Being right about the YAML specification is worth
  nothing against a file the backend is answering from.

- **A fourth backend: Prism**, read-only. The first whose corpus was never written as mocks at
  all: Prism serves an OpenAPI document, and mock behaviour is derived from it. An operation
  becomes one stub per declared response, ranked the way Prism actually picks — the lowest 2xx,
  verified by running it — with tags as folders and required parameters as matchers.

  Read-only on purpose and for a different reason than Mockoon: a write here would mean editing
  an API specification, which changes the contract other people generate clients from. That is a
  product decision, not a missing feature.

- **A third backend: Mockoon**, read-only for now. It is the first that is not an admin API:
  Mockoon's corpus lives in an environment JSON file and its admin API cannot read routes at all,
  so a profile points at the file. Folders come from Mockoon's own tree rather than being guessed
  from a URL prefix, and a route holding several rule-selected responses is read as one stub per
  response, ranked in the order Mockoon consults them.

  Editing is deliberately absent rather than half-built: Mockoon's only write is a whole-document
  `PUT` that never reaches the file, so an edit would vanish on restart. Writing the file is the
  right path and comes next.

### Fixed

- **The Servers form asks for a document-backed backend's file.** Adding a Mockoon server saved a
  profile that then refused to connect, complaining about a path no field had ever asked for. The
  field appears for exactly the backends that declare they read one, and Save is blocked until it
  is filled.
- **Write controls are gated on what the backend can actually do.** New stub, Duplicate and
  Delete were drawn whenever the *profile* was not read-only, which was accidentally right while
  every backend could write. Against a read-only backend they were three buttons that could only
  fail.

- **A connection that stops working is noticed.** Once connected, the app kept reporting healthy
  however long the server had been gone — the badge stayed clean while every action failed on
  its own, which is the app lying about the one thing the badge exists to say. A VPN going down
  mid-session is the ordinary way to see this. Detection is by use rather than by probing: a
  transport failure against a live connection drops it, the badge says "unreachable" with the
  reason, and the reconnect loop takes it from there. No extra traffic reaches a mock server the
  whole team shares.

## 0.5.0

### Added

- **A second backend: MockServer.** Selectable from the Servers screen and with `--adapter
  mockserver`. It exists to prove the adapter contract is a contract rather than a description
  of WireMock — the same conformance suite runs against both, and the one test that failed had
  been asserting on a stub's *name*, which MockServer has no concept of. That was the suite's
  WireMock habit, not a MockServer gap, and it is fixed in the contract.

  The traffic log and scenarios are absent on a MockServer profile, not disabled: it records no
  attribution for a served request and has no named states, so both screens would be empty by
  construction.

- **Each server is marked with the backend it is**, beside its name — in the switcher open and
  closed, the Servers list, and the command palette. An address says nothing about what is on
  the other end, and the two backends differ in what they can answer.

  Drop an SVG in `packages/web/public/backends/<adapter id>.svg` to use a real logo, and
  `<id>-dark.svg` beside it for the dark theme. A backend with no file shows a two-letter mark.

### Fixed

- **It reconnects on its own.** A connection was opened at startup for the server named on the
  command line, and by an explicit Refresh — nowhere else. So switching to any other server, or
  starting while the target was still down, left "reconnecting…" on the badge indefinitely with
  nothing reconnecting behind it. Clicking Refresh was the only way out, which had quietly made
  a status badge into a control.

  Attempts now happen when the UI asks after a profile's health, on a 0/2/5/15/30s backoff, and
  the browser polls only while disconnected. The badge says what is true: "connecting…" while an
  attempt is outstanding, "unreachable" with the transport message once one has failed. A server
  that comes back is picked up within seconds, corpus included, with nothing to click.

- **An unreachable server is no longer reported as an empty one.** The corpus read "This server
  has no stubs yet" and offered "Create the first stub" for a server nobody had reached —
  stating as fact something unchecked, and offering a button that could only fail. It names the
  address it cannot reach and why.

- **The backend mark never flashes a broken image.** Whether a logo file exists is answered by
  the server rather than probed by the browser, which was requesting a known-missing file on
  every render of a list that remounts on every keystroke.

## 0.4.0

### Fixed

- **One address, one server.** Adding a profile that reaches an address another already reaches
  is refused, naming the one that has it. Two profiles on one server both mirror the same
  corpus, an edit through one looks stale in the other, and the switcher offers a choice that
  changes nothing. The comparison is the composed admin URL, so a trailing slash or a
  spelled-out `/__admin` cannot slip a duplicate past — while two context paths on one host stay
  the two different servers they are.
- **`npx mock-knight --url <a server you already added>` opens it** rather than adding a second
  copy. It matched on the raw base URL before, so a trailing slash made a duplicate — which the
  rule above would then have refused outright.

### Added

- **A theme switch.** Light, dark, or whatever the machine is set to. The default still follows
  the OS, and stays following it: a machine that switches at sunset takes the app with it. The
  choice is applied before the first paint, so there is no flash of the wrong theme on load.
- **Icons for the actions you repeat**, with their words on hover and as their accessible name.
  A toolbar of five verbs eats the width the corpus needs. Confirmations and dialog primary
  actions keep their words, because a tooltip is invisible to a keyboard user until focus lands
  and invisible to touch entirely — the moment of committing a write is not the place for a
  button you have to guess at.

## 0.3.0

### Fixed

- **`--url` now decides which server the browser opens.** Servers are remembered in a state
  database shared by every run, and the browser fell back to the first profile it held — which
  is the *oldest*. Anyone who had run against a local WireMock and later named a staging URL was
  shown the local one, so the flag did not decide what they saw. The process now reports the
  server it was started for, and the browser prefers it.

### Added

- **Saved searches**, per profile. A structured query is the fastest way to find one stub among
  thousands and the thing nobody remembers the syntax of a week later. They appear beside the
  search box and in the command palette, with the query shown next to the name. Applying one and
  then refining it offers **Update**, so keeping the name does not mean retyping it.
- **A clear control on the search box**, and `esc` does the same. Emptying a query used to mean
  selecting the text and deleting it, which is worst on exactly the long structured queries the
  box is for.
- **An adapter conformance suite.** The contract is now executable: one set of tests, living in
  `core`, that any backend must pass. An adapter is the subject of that suite rather than its
  author, because backend-specific tests tend to assert what the adapter already does — which is
  how a portable model quietly becomes one vendor's JSON with different field names. Adding a
  backend means one file that connects an adapter and hands it over, containing no assertions of
  its own.

### Changed

- The query pills under the search box report what was actually applied. They rendered
  `field: value`, which dropped the operator and the header name, so `header:X-Tenant` read as
  "header: null" and `priority:<5` as "priority: 5" — each naming a filter that was not applied.

## 0.2.1

Fixes a reported bug: clicking the stub that served a request opened the corpus without opening
the stub.

- **A stub is now identified by what it does, as well as by its id.** WireMock assigns a fresh
  id to any mapping imported without one — and creates a duplicate rather than updating, so two
  imports of the same stub leave two stubs. `client_key` is that id, so an import run outside
  Mock Knight renamed every stub from its point of view and the journal filled with references
  nothing held. Events now also record a hash of the stub's matcher, response, scenario binding
  and priority, which an import does not change, and resolve through it when the id is gone.
  The match must be unique: two stubs may legitimately behave identically, and ambiguity is
  reported rather than guessed at.
- **Response time is shown in the traffic log**, with any configured delay disclosed separately.
  It had been a database column written as `null` on every row since the first release, while
  the server reported the timing all along. A slow mock is usually slow on purpose, and a total
  without that context reads as a problem rather than a setting.
- Opening a stub that genuinely is not in the corpus explains that, instead of reporting a
  failure that sends you looking for a fault that is not there.

Migrations 4 and 5 are additive; the local mirror survives them. Rows recorded before this
release have no timing and no fingerprint, which reads as "not recorded" rather than as zero or
as a false match.

## 0.2.0

Everything published as 0.1.0 reported its version as `0.0.0` — the number was a literal in the
source while the package said otherwise. It is now inlined from `package.json` at build time.
That fix is the reason this release exists; the rest came with it.

### Editing

- **Matcher and Response tabs.** A stub can be changed as a form rather than as WireMock JSON:
  method, URL and its four match kinds, request headers, query parameters, cookies, body
  patterns, status, response headers, body, delay, fault, proxy. The form edits a canonical
  draft and the server patches the retained vendor document with it, so a field the form cannot
  display is not deleted by an edit made here.
- **New stub and Duplicate.** An empty server was a dead end — capturing an unmatched request
  was the only route to a stub. A duplicate carries the original's untouched vendor fields with
  its identifiers stripped, and says that a copy will contend with what it copied.
- The Response tab warns when a fault or a proxy makes the body unreachable, which is silent in
  the JSON and looks correct in every list.

### Finding

- **Priority standing.** Which stub on a path actually answers, and which are shadowed —
  invisible in a flat list and decisive on a corpus where stubs differ only by header.
- **Command palette** (`⌘K`), reaching every action, screen, server and stub. Destructive
  actions appear but route to their confirmation rather than running.
- `/` focuses search; `?` publishes the whole keyboard map.

### Traffic

- **Filters** for method, status class, path and correlation id, on top of matched/unmatched.
- **Correlation ids are shown** and clickable. They had been stored on every event since the
  journal existed and never rendered.
- **Response time is shown**, with the configured delay disclosed separately — a slow mock is
  usually slow on purpose.
- The stub that answered a request is now a link to that stub.
- **Clear view** hides what is on screen without touching the server; **Clear journal** empties
  it for everyone and keeps its typed confirmation.

### Connecting

- **`mock-knight.json` is read.** Two messages had told people to configure it and nothing did.
  It carries `allowedHosts`, shared profiles and flag defaults, with `${env:VAR}` interpolation
  that is never applied to `authRef`. A published JSON Schema comes with it.
- A connection that fails explains why — DNS, refused, timeout, or an untrusted certificate —
  with the upstream method, URL, status and body in a copyable disclosure.
- A context path in the base URL is kept.

### Fixed

- A `__proto__` key in a stub was silently dropped from the canonical form, which made two
  different stubs hash to one `client_key`.
- Dark mode drew light mode's scrims and shadows.
- The corpus list's Path column could collapse to nothing at laptop widths.

## 0.1.0

First public release.
