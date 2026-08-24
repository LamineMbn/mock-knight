# Backend logos

Drop a backend's logo here as `<adapter id>.svg` and it appears beside the server's **name**
everywhere that name is shown — the profile switcher (open and closed), the Servers list, and the
command palette. Nothing else to change, and no code knows about any particular backend.

Optionally add `<adapter id>-dark.svg` beside it. The dark theme swaps to it, the same way the
app's own mark does; a single-colour mark that reads on white usually disappears otherwise. With
no dark variant the one file is used in both themes.

Current ids: `wiremock`, `mockserver`. A backend with no file here shows a two-letter mark
(`WM`, `MS`) instead.

## How the app finds them

The **server** checks whether the file exists and tells the browser, rather than the browser
requesting the URL and reacting to a 404. Badges live in lists that remount on every keystroke,
so probing meant a broken-image glyph on screen and a fresh request for a known-missing file on
every render. The consequence: **adding a file needs a rebuild**, like any other static asset.

## If you replace these with a project's real marks

The files here are simple original drawings, not the projects' trademarks. If you swap in the
real ones for your own build:

1. Take the file from the project's own brand or press page, not from a search result.
2. Check its terms. Most permit *nominative* use — identifying the product you interoperate
   with — while forbidding anything implying endorsement, and most forbid alteration. Both
   WireMock and MockServer are Apache-2.0 projects, which licenses the *code* and not the marks.
3. Record where each file came from and under what terms in a `NOTICE.md` beside it.
4. Keep them recognisable at **16px**, which is the size they are actually drawn at. A detailed
   mark becomes a smudge. Prefer the icon-only variant where a project offers one.

## Requirements

- SVG, legible at 16px tall.
- Any aspect ratio: only the height is fixed, the width is capped at 44px and the ratio is kept.
- Readable on both themes, or shipped with a `-dark.svg` variant.
