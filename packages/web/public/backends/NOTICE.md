# Notice — third-party marks in this folder

The SVGs here are the logos of the mock servers Mock Knight connects to. They are used
**nominatively**: to identify, in a list of servers, which product is on the other end of an
address. Mock Knight is not affiliated with, sponsored by, or endorsed by any of them.

Each mark remains the property of its owner. Nothing in this repository's licence applies to
them — a project's Apache-2.0 or MIT licence covers its *code*, never its trademark.

None of this is load-bearing. A backend with no file here falls back to a two-letter mark, so
this folder can be emptied without touching any code.

| File | Product | Owner | What the owner publishes about reuse |
|---|---|---|---|
| `wiremock.svg` | WireMock | WireMock Inc. / the WireMock community | The community logo repository states the official logos "can be reused in the community and for WireMock related content and presentations". **No formal licence is stated** — the permission is a sentence, not a document. |
| `mockoon.svg` | Mockoon | Mockoon — EU trademark **018918009** | The clearest of the four, and it permits this use explicitly: you may use the logos "to indicate that your project integrates with Mockoon". Forbidden: implying partnership or endorsement, using the mark in your own product's name, and **altering the logo in any way**. |
| `prism.svg` | Prism (Stoplight) | Stoplight, Inc. (SmartBear) | The most restrictive. Stoplight's website terms state that use of the site "grants you no right or license to reproduce or otherwise use any Stoplight or third-party trademarks". No permission is granted; this file is used on the footing of nominative fair use, which does not require a licence but is a weaker basis than Mockoon's explicit grant. See the note below. |
| `mockserver.svg`, `mockserver-dark.svg` | MockServer | — | A plain letter-M drawing rather than a downloaded brand asset, which is why a recoloured dark variant was made for it. **Confirm this before relying on it**: if the file did come from MockServer's own materials, it belongs under the same rules as the others and the dark variant must be removed rather than kept. |

## Alteration

Mockoon forbids altering its logo, and it is the safest assumption for all of them. The single
recoloured file here is `mockserver-dark.svg`, made only because that mark appears to be a plain
drawing. **Do not recolour a real logo for dark mode** — ask its owner for a variant, or let the
badge fall back to the lettermark.

## If you would rather not ship these

Delete them, or add `packages/web/public/backends/*.svg` to `.gitignore` and keep them locally.
The UI shows `WM`, `MS`, `MO` and `PR` instead, and nothing else changes.

## Sources

- Mockoon brand guidelines — <https://mockoon.com/brand/>
- WireMock community logos — <https://github.com/wiremock/community/blob/main/logo/README.md>
- Stoplight website terms — <https://stoplight.io/website-terms>
