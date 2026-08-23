# Changelog

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
