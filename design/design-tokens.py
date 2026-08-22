# Single source of truth for Mock Knight design tokens.
# Emits: contrast verification report, markdown tables, HTML specimen.

LIGHT = {
  # surfaces
  "bg-canvas":        "#F7F8FA",
  "bg-surface":       "#FFFFFF",
  "bg-raised":        "#FFFFFF",
  "bg-subtle":        "#F1F2F6",
  "bg-emphasis":      "#E7E8F4",
  # borders
  "border-subtle":    "#E6E8EE",
  "border-default":   "#D3D6E0",
  "border-strong":    "#888FA4",
  # text
  "text-primary":     "#14161F",
  "text-secondary":   "#4A5065",
  "text-tertiary":    "#666C82",
  "text-disabled":    "#A1A6B8",
  "text-inverse":     "#FFFFFF",
  # accent
  "accent-solid":       "#5B5BD6",
  "accent-on-solid":    "#FFFFFF",
  "accent-solid-hover": "#4E4EC4",
  "accent-solid-active":"#4242AE",
  "accent-text":        "#4B4BC4",
  "accent-bg-subtle":   "#EFEFFC",
  "accent-border":      "#C3C3F0",
  # semantic: matched / success
  "success-text":     "#0F7A46",
  "success-solid":    "#12884E",
  "success-on-solid": "#FFFFFF",
  "success-bg":       "#E6F6ED",
  "success-border":   "#9FD9BC",
  # semantic: unmatched / danger
  "danger-text":      "#C0272D",
  "danger-solid":     "#D32F35",
  "danger-on-solid":  "#FFFFFF",
  "danger-bg":        "#FDECEC",
  "danger-border":    "#F1B0B2",
  # semantic: warning
  "warning-text":     "#8A5200",
  "warning-solid":    "#E0940A",
  "warning-on-solid": "#241A00",
  "warning-indicator":"#A86400",
  "warning-bg":       "#FEF4E4",
  "warning-border":   "#EEC98C",
  # http methods (chip text on chip bg)
  # HTTP method chips follow Insomnia's hue assignment so the mapping is already familiar:
  # GET purple, POST green, PUT orange, PATCH yellow, DELETE red, HEAD/OPTIONS blue, QUERY
  # magenta. Every pair below is still held to 4.5:1 against its own chip fill.
  "method-get-text":     "#6E3BA8", "method-get-bg":     "#F4EDFB",
  "method-post-text":    "#0F7A46", "method-post-bg":    "#E6F6ED",
  "method-put-text":     "#9A4E14", "method-put-bg":     "#FDF0E6",
  "method-patch-text":   "#7A5B00", "method-patch-bg":   "#FBF3D9",
  "method-delete-text":  "#C0272D", "method-delete-bg":  "#FDECEC",
  "method-head-text":    "#0B6E8C", "method-head-bg":    "#E3F4F9",
  "method-options-text": "#1F5FBF", "method-options-bg": "#E9F0FE",
  "method-query-text":   "#A62A72", "method-query-bg":   "#FDECF6",
  "method-other-text":   "#4A5065", "method-other-bg":   "#F1F2F6",
  # code / json syntax
  "code-key":         "#2B4EC4",
  "code-string":      "#0F7A46",
  "code-number":      "#A6522A",
  "code-boolean":     "#7A3EA1",
  "code-null":        "#666C82",
  "code-punct":       "#666C82",
  "code-bg":          "#FBFBFD",
  # diff
  "diff-add-bg":      "#E6F6ED", "diff-add-text":  "#0F7A46",
  "diff-del-bg":      "#FDECEC", "diff-del-text":  "#C0272D",
  "diff-mod-bg":      "#FEF4E4", "diff-mod-text":  "#8A5200",
}

DARK = {
  "bg-canvas":        "#0B0D13",
  "bg-surface":       "#12141C",
  "bg-raised":        "#1A1D27",
  "bg-subtle":        "#1E212C",
  "bg-emphasis":      "#282C3B",
  "border-subtle":    "#23262F",
  "border-default":   "#2F333F",
  "border-strong":    "#5B6275",
  "text-primary":     "#E9EBF1",
  "text-secondary":   "#A9AFC0",
  "text-tertiary":    "#868C9E",
  "text-disabled":    "#575D6E",
  "text-inverse":     "#0B0D13",
  "accent-solid":       "#5D5DE0",
  "accent-on-solid":    "#FFFFFF",
  "accent-solid-hover": "#6E6EEA",
  "accent-solid-active":"#7C7CF2",
  "accent-text":        "#ABABF8",
  "accent-bg-subtle":   "#1D1D3C",
  "accent-border":      "#3C3C7C",
  "success-text":     "#4FCF88",
  "success-solid":    "#3FBF7A",
  "success-on-solid": "#06170D",
  "success-bg":       "#0E2A1C",
  "success-border":   "#265C3C",
  "danger-text":      "#FF8080",
  "danger-solid":     "#F26A6F",
  "danger-on-solid":  "#1C0708",
  "danger-bg":        "#2C1315",
  "danger-border":    "#6E2529",
  "warning-text":     "#F2B44A",
  "warning-solid":    "#E8A93A",
  "warning-on-solid": "#241A00",
  "warning-indicator":"#E8A93A",
  "warning-bg":       "#2A1F0A",
  "warning-border":   "#6B4A15",
  "method-get-text":     "#C79BE8", "method-get-bg":     "#241831",
  "method-post-text":    "#4FCF88", "method-post-bg":    "#0E2A1C",
  "method-put-text":     "#F0A868", "method-put-bg":     "#2E1D10",
  "method-patch-text":   "#E8C64A", "method-patch-bg":   "#2A2408",
  "method-delete-text":  "#FF8080", "method-delete-bg":  "#2C1315",
  "method-head-text":    "#57C7E8", "method-head-bg":    "#0D2630",
  "method-options-text": "#8FB0FF", "method-options-bg": "#101C33",
  "method-query-text":   "#F58AD0", "method-query-bg":   "#2E1024",
  "method-other-text":   "#A9AFC0", "method-other-bg":   "#1E212C",
  "code-key":         "#8FB0FF",
  "code-string":      "#7DD8A0",
  "code-number":      "#E8A87C",
  "code-boolean":     "#C79BE8",
  "code-null":        "#868C9E",
  "code-punct":       "#868C9E",
  "code-bg":          "#0E1017",
  "diff-add-bg":      "#0E2A1C", "diff-add-text":  "#4FCF88",
  "diff-del-bg":      "#2C1315", "diff-del-text":  "#FF8080",
  "diff-mod-bg":      "#2A1F0A", "diff-mod-text":  "#F2B44A",
}

# Profile / environment badge colours: must be distinct from semantics AND from each other.
PROFILE_LIGHT = {"slate":"#5B6478","indigo":"#5B5BD6","cyan":"#0B7A9B","violet":"#7A3EA1",
                 "rose":"#B4295C","olive":"#5F7A1E"}
PROFILE_DARK  = {"slate":"#98A0B4","indigo":"#9A9AF5","cyan":"#4FC3E8","violet":"#C79BE8",
                 "rose":"#F58AB0","olive":"#A8C95E"}

def srgb_to_lin(c):
    c = c/255.0
    return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055) ** 2.4

def luminance(hexs):
    h = hexs.lstrip("#")
    r,g,b = (int(h[i:i+2],16) for i in (0,2,4))
    return 0.2126*srgb_to_lin(r) + 0.7152*srgb_to_lin(g) + 0.0722*srgb_to_lin(b)

def contrast(a,b):
    la,lb = luminance(a), luminance(b)
    hi,lo = max(la,lb), min(la,lb)
    return (hi+0.05)/(lo+0.05)

# (foreground, background, required ratio, label)
def checks(T):
    S, C, R = T["bg-surface"], T["bg-canvas"], T["bg-raised"]
    out = []
    for fg,req,label in [
        ("text-primary",4.5,"body text on surface"),
        ("text-secondary",4.5,"secondary text on surface"),
        ("text-tertiary",4.5,"tertiary text on surface"),
        ("accent-text",4.5,"link/accent text on surface"),
        ("success-text",4.5,"matched text on surface"),
        ("danger-text",4.5,"unmatched text on surface"),
        ("warning-text",4.5,"warning text on surface"),
        ("code-key",4.5,"json key on code bg"),
        ("code-string",4.5,"json string on code bg"),
        ("code-number",4.5,"json number on code bg"),
        ("code-boolean",4.5,"json boolean on code bg"),
        ("code-null",4.5,"json null on code bg"),
    ]:
        bg = T["code-bg"] if fg.startswith("code-") else S
        out.append((label, T[fg], bg, contrast(T[fg],bg), req))
    # text on canvas too
    for fg,req in [("text-primary",4.5),("text-secondary",4.5),("text-tertiary",4.5)]:
        out.append((fg+" on canvas", T[fg], C, contrast(T[fg],C), req))
    # solid buttons
    for k in ["accent","success","danger","warning"]:
        out.append((f"label on {k}-solid", T[f"{k}-on-solid"], T[f"{k}-solid"],
                    contrast(T[f"{k}-on-solid"],T[f"{k}-solid"]), 4.5))
    # method chips: text on own tint
    for m in ["get","post","put","patch","delete","head","options","query","other"]:
        out.append((f"method {m.upper()} chip", T[f"method-{m}-text"], T[f"method-{m}-bg"],
                    contrast(T[f"method-{m}-text"],T[f"method-{m}-bg"]), 4.5))
    # semantic text on its own subtle bg (badges)
    for k in ["success","danger","warning"]:
        out.append((f"{k} text on {k} bg", T[f"{k}-text"], T[f"{k}-bg"], contrast(T[f"{k}-text"],T[f"{k}-bg"]), 4.5))
    out.append(("accent text on accent bg", T["accent-text"], T["accent-bg-subtle"], contrast(T["accent-text"],T["accent-bg-subtle"]), 4.5))
    # diff text on diff bg
    for k in ["add","del","mod"]:
        out.append((f"diff {k} text on bg", T[f"diff-{k}-text"], T[f"diff-{k}-bg"], contrast(T[f"diff-{k}-text"],T[f"diff-{k}-bg"]), 4.5))
    # NON-TEXT 3:1  (WCAG 1.4.11)
    out.append(("border-strong vs surface (input outline)", T["border-strong"], S, contrast(T["border-strong"],S), 3.0))
    out.append(("border-strong vs canvas", T["border-strong"], C, contrast(T["border-strong"],C), 3.0))
    out.append(("accent-solid vs surface (focus ring)", T["accent-solid"], S, contrast(T["accent-solid"],S), 3.0))
    out.append(("accent-solid vs canvas (focus ring)", T["accent-solid"], C, contrast(T["accent-solid"],C), 3.0))
    out.append(("success-solid vs surface (dot)", T["success-solid"], S, contrast(T["success-solid"],S), 3.0))
    out.append(("danger-solid vs surface (dot)", T["danger-solid"], S, contrast(T["danger-solid"],S), 3.0))
    out.append(("warning-indicator vs surface (dot)", T["warning-indicator"], S, contrast(T["warning-indicator"],S), 3.0))
    out.append(("warning-indicator vs canvas (dot)", T["warning-indicator"], C, contrast(T["warning-indicator"],C), 3.0))
    out.append(("success-solid vs canvas (dot)", T["success-solid"], C, contrast(T["success-solid"],C), 3.0))
    out.append(("danger-solid vs canvas (dot)", T["danger-solid"], C, contrast(T["danger-solid"],C), 3.0))
    out.append(("bg-emphasis vs surface (selected row)", T["bg-emphasis"], S, contrast(T["bg-emphasis"],S), 1.15))
    out.append(("bg-subtle vs surface (hover row)", T["bg-subtle"], S, contrast(T["bg-subtle"],S), 1.05))
    return out

def profile_checks(P, T):
    out=[]
    for name,hexv in P.items():
        out.append((f"profile {name}", hexv, T["bg-surface"], contrast(hexv,T["bg-surface"]), 3.0))
    return out

def emit_css():
    """Emit the Tailwind v4 @theme block. The token file *is* the theme, so no component ever
    needs a literal colour and no hex is ever retyped by hand (CLAUDE.md, design brief §3.1)."""
    lines = []
    lines.append('/* GENERATED by design/design-tokens.py — do not edit by hand.')
    lines.append(' * Regenerate with: pnpm tokens:css')
    lines.append(' *')
    lines.append(' * Every colour is defined on bare :root first, so no token exists only inside a')
    lines.append(' * media query or a [data-theme] block. Dark values are then redefined twice: once')
    lines.append(' * for the OS preference and once for an explicit choice, so the toggle wins in both')
    lines.append(' * directions. */')
    lines.append('')
    lines.append('@import \'tailwindcss\';')
    lines.append('')
    lines.append('@theme {')
    for name, value in LIGHT.items():
        lines.append(f'  --mk-{name}: {value};')
    for name, value in PROFILE_LIGHT.items():
        lines.append(f'  --mk-profile-{name}: {value};')
    lines.append('}')
    lines.append('')

    dark = []
    for name, value in DARK.items():
        dark.append(f'  --mk-{name}: {value};')
    for name, value in PROFILE_DARK.items():
        dark.append(f'  --mk-profile-{name}: {value};')
    body = chr(10).join(dark)

    lines.append('/* Dark, following the OS — unless an explicit light choice overrides it. */')
    lines.append('@media (prefers-color-scheme: dark) {')
    lines.append('  :root:not([data-theme=\'light\']) {')
    lines.append(chr(10).join('  ' + d for d in dark))
    lines.append('  }')
    lines.append('}')
    lines.append('')
    lines.append('/* Dark, chosen explicitly. */')
    lines.append('[data-theme=\'dark\'] {')
    lines.append(body)
    lines.append('}')
    return chr(10).join(lines) + chr(10)


if __name__ == "__main__":
    import sys
    if "--css" in sys.argv:
        print(emit_css(), end="")
        raise SystemExit(0)

    fails = 0
    for label, T, P in (("LIGHT", LIGHT, PROFILE_LIGHT), ("DARK", DARK, PROFILE_DARK)):
        print(f"\n===== {label} =====")
        for name, fg, bg, ratio, req in checks(T) + profile_checks(P, T):
            ok = ratio >= req
            if not ok: fails += 1
            print(f"{'PASS' if ok else 'FAIL':4}  {ratio:5.2f}  (need {req:.2f})  {name}  {fg} on {bg}")
    print(f"\n{fails} failure(s)")
