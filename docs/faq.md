## Does WireMock have a UI?

Not in the open-source distribution. WireMock ships an admin REST API — `GET /__admin/mappings`
and friends — and leaves the interface to you. WireMock Cloud is a separate commercial hosted
product with its own UI. Mock Knight is an open-source UI you run yourself, pointed at the
WireMock you already have.

## How is this different from WireMock Cloud?

WireMock Cloud is a hosted service you move your mocks *to*. Mock Knight is a local tool you point
*at* a mock server you already run — your own laptop, your CI, your team's shared instance — and
it never becomes part of your stack. It is also not WireMock-only: the same UI drives MockServer,
Mockoon and Prism.

## Can I edit WireMock stubs in a browser with it?

Yes, on backends whose admin API supports writes (WireMock and MockServer). You can edit the
matcher and response through forms or as raw JSON, create a stub from scratch, duplicate one, or
build one from a request that didn't match. Every write re-reads the stub and compares hashes
first, so if a colleague changed it since you opened it you get a three-way merge rather than a
silent overwrite.

## Will it rewrite or reformat my mapping files?

No. Mock Knight talks to the admin API, and it never rebuilds a stub from its own model — it
patches the vendor JSON it read, so a field it doesn't understand survives the round trip
untouched. For the file-backed backends (Mockoon, Prism) it reads the file, and for Mockoon's
edits it rewrites surgically, leaving everything it didn't touch byte-identical.

## Is it safe to point at a mock server my team shares?

That is the case it is built for. Writes are hash-checked against the current server state,
destructive actions name who else they affect and require typing the profile name, a profile can
be marked read-only, and `--mode deployed` disables the actions that assume a single trusted
user. Read paths never mutate anything.

## Does it work with MockServer, Mockoon or Prism?

Yes — see [Supported mock servers](https://github.com/LamineMbn/mock-knight#supported-mock-servers) for exactly what each one can and
can't do. Where a backend cannot answer a question (MockServer records no attribution for a
served request, so there is no traffic log), the screen is absent rather than empty or wrong.

## Does it need Docker, an account, or a config file?

None of the three. `npx mock-knight --url <your mock server>` is the whole setup. Node 22 or
newer is the only requirement.

## Does it replace my mock server?

No, and it never serves mock traffic. Stop Mock Knight and your mocks behave exactly as they did
before you started it.
