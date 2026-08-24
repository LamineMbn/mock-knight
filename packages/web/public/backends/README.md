# Backend logos

Drop a backend's logo here as `<adapter id>.svg` and it appears beside every server of that
kind — in the profile switcher and the Servers list. Nothing else to change: the badge looks for
`/backends/<id>.svg` and falls back to a two-letter mark when the file is absent.

Current ids: `wiremock`, `mockserver`.

## Nothing is checked in here, deliberately

These are other projects' trademarks. A redrawn approximation is worse than no logo — it is
wrong, it is theirs, and it is the kind of thing a project gets asked to take down. So the
repository ships the lettermarks (`WM`, `MS`) and leaves this folder empty.

If you want the real marks in your own build:

1. Take the file from the project's own brand or press page, not from a search result.
2. Check its terms. Most permit *nominative* use — identifying the product you interoperate
   with — while forbidding anything implying endorsement, and most forbid alteration. Both
   WireMock and MockServer are Apache-2.0 projects, which licenses the *code* and not the marks.
3. Record where each file came from and under what terms in `NOTICE.md` beside it.
4. Keep them recognisable at **16px**, which is the size they are actually drawn at. A detailed
   mark becomes a smudge; a wordmark becomes a line. Prefer the icon-only variant where a
   project offers one.

## Requirements

- SVG, square-ish, and legible at 16px.
- No fixed `width`/`height` on the root element — the badge sizes them.
- Readable on both themes. A mark that is dark-on-transparent disappears in dark mode, so use a
  variant that carries its own background or works in both.
