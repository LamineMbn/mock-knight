# Backend logos

Drop a backend's logo here as `<adapter id>.svg` and it appears beside the server's **name**
everywhere that name is shown — the profile switcher (open and closed), the Servers list, and the
command palette. Nothing else to change, and no code knows about any particular backend.

Optionally add `<adapter id>-dark.svg` beside it. The dark theme swaps to it, the same way the
app's own mark does; a single-colour mark that reads on white usually disappears otherwise. With
no dark variant the one file is used in both themes.

Current ids: `wiremock`, `mockserver`, `mockoon`, `prism`. A backend with no file here shows a two-letter mark
(`WM`, `MS`) instead.

## How the app finds them

The **server** checks whether the file exists and tells the browser, rather than the browser
requesting the URL and reacting to a 404. Badges live in lists that remount on every keystroke,
so probing meant a broken-image glyph on screen and a fresh request for a known-missing file on
every render. The consequence: **adding a file needs a rebuild**, like any other static asset.

## These are other projects' marks

Several files here are the backends' **own logos**, not drawings made for this repository. Treat
them accordingly:

1. **Record provenance.** Where each file came from and under what terms is recorded in
   `NOTICE.md` beside this file. Add a row when you add a logo — without it, nobody downstream
   can tell which files they may keep.
2. **Check the terms.** Most projects permit *nominative* use — identifying the product you
   interoperate with — while forbidding anything that implies endorsement, and most forbid
   alteration. An Apache-2.0 licence on a project's *code* says nothing about its mark.
3. **Take the file from the project's own brand or press page**, never from a search result.
4. **Do not alter them.** The one exception in this folder is `mockserver-dark.svg`, which is a
   recolour of `mockserver.svg` — safe only because that file is a plain drawing rather than a
   registered mark. Do not do the same to a real logo; ask its owner for a dark variant.
5. Keep them recognisable at **16px**, the size they are actually drawn at. A detailed mark
   becomes a smudge; prefer the icon-only variant where a project offers one.

Nothing here is load-bearing: a backend with no file falls back to a two-letter mark, so this
folder can be emptied — or git-ignored, and the logos kept locally — without touching any code.

## Requirements

- SVG, legible at 16px tall.
- Any aspect ratio: only the height is fixed, the width is capped at 44px and the ratio is kept.
- Readable on both themes, or shipped with a `-dark.svg` variant.
