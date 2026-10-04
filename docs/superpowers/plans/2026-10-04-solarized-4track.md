# Solarized 4-Track Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the green-on-slate UI with Solarized Light and Dark, following the device's setting, dressed as a 4-track cassette deck.

**Architecture:** Every colour is a CSS custom property on `:root`, redefined for dark under `@media (prefers-color-scheme: dark)`. Canvas code reads the same properties through one helper (`lib/theme.js`) and redraws when the scheme flips. Fonts are vendored woff2 files under `web/static/fonts`, because the Pi is often offline. The work ships in four PRs, each usable on its own; this plan details PR 1 and scopes PRs 2–4.

**Tech Stack:** Plain CSS, ES modules, canvas 2D, node's built-in test runner, Go `net/http` file server.

**Spec:** the approved design canvas, https://claude.ai/artifact/HdDR7jgUu2LTHneD6AB5bg (boards Main, Takes, Take, Tape, Kit; light and dark rows).

## Global Constraints

- Palette (Solarized): base03 `#002b36`, base02 `#073642`, base01 `#586e75`, base1 `#93a1a1`, base2 `#eee8d5`, base3 `#fdf6e3`, yellow `#b58900`, orange `#cb4b16`, red `#dc322f`, magenta `#d33682`, blue `#268bd2`, cyan `#2aa198`, green `#859900`.
- Colour meanings: orange = the one main action per screen; red = recording only (and destructive confirm); green = playing / healthy; yellow = loop, flags, mute; tracks 1–4 = blue, cyan, yellow, magenta.
- Body text contrast ≥ 4.5:1 in both themes. Light dim ink is `#52666d`, not base00/base01.
- No network fonts: `@font-face` points at `/fonts/*.woff2`.
- Keys: at rest a 4 px bottom edge; pressed/latched drops to 1 px and its LED lights.
- Layout invariant (existing): on a 844×390 landscape phone the Capture button is above the fold. Nothing in PR 1 may push it down.
- Colours change only through tokens; no new hex literals in JS except token fallbacks.

## Review Focus

- Device flips light↔dark while a page is open → every canvas (ribbon, rows, waveform, overview, lanes, rising notes, tape lanes) redraws in the new scheme without a reload.
- 844×390 landscape phone → Capture fully visible without scrolling (keys got taller edges).
- A token holding `rgb()` or 3-digit hex reaching `withAlpha` → still a valid colour, never `NaN`.
- Help mode outlines, toasts, sheets, menus and the guide page → readable in light (they were tuned on dark).
- Recording states (phone record, tape Rec armed/recording) → still red, still obviously different from idle.

---

## PR 1 — tokens, fonts, keys (this branch)

### Task 1: Vendored fonts, served with the right type

**Files:**
- Create: `web/static/fonts/*.woff2` (Barlow Condensed 600/700, IBM Plex Sans 400/600, IBM Plex Mono 400/600; latin subsets from `@fontsource`), `web/static/fonts/OFL.txt`
- Modify: `cmd/hindsight/main.go` (register `.woff2` → `font/woff2`), `cmd/hindsight/main_test.go`
- Modify: `web/static/sw.js` (add fonts to `SHELL`, bump `CACHE`)

- [ ] Write a failing Go test: a request for `/fonts/x.woff2` through the static handler returns `Content-Type: font/woff2`.
- [ ] Run `go test ./cmd/hindsight -run Font` → FAIL.
- [ ] Add `mime.AddExtensionType(".woff2", "font/woff2")` in an `init()` in `main.go`.
- [ ] Run the test → PASS. Download the six woff2 files and the licence. Add them to `SHELL`; bump `CACHE` to `hindsight-shell-v13`.
- [ ] Commit.

### Task 2: `lib/theme.js` — token colours for canvas code

**Files:** Create `web/static/lib/theme.js`, `web/static/lib/theme.test.js`

**Produces:**
- `withAlpha(color: string, a: number): string` — `#rgb`, `#rrggbb` or `rgb(r,g,b)` → `rgba(r,g,b,a)`; anything else is returned unchanged.
- `token(name: string, fallback: string, el = document.documentElement): string`
- `onSchemeChange(cb: () => void): void` — calls `cb` when `prefers-color-scheme` flips.

- [ ] Tests: `withAlpha('#cb4b16', .5) === 'rgba(203,75,22,0.5)'`; `withAlpha('#abc', 1) === 'rgba(170,187,204,1)'`; `withAlpha('rgb(1, 2, 3)', .2) === 'rgba(1,2,3,0.2)'`; `withAlpha('nonsense', .2) === 'nonsense'`.
- [ ] Run `node --test web/static/lib/theme.test.js` → FAIL, implement, → PASS. Add `theme.js` to `SHELL`. Commit.

### Task 3: Tokens and the Solarized palette

**Files:** Modify `web/static/styles.css` (`:root`, a dark `@media` block, every literal colour)

Light `:root` (dark values in brackets):
`--bg #fdf6e3 [#002b36]`, `--panel #eee8d5 [#073642]`, `--panel-2 #e4ddc8 [#0a3d49]`, `--line #d3cab0 [#00222b]`, `--rule #c9c0a4 [#2c5964]`, `--ink #073642 [#eee8d5]`, `--ink-dim #52666d [#93a1a1]`, `--ink-faint #6f8187 [#7f9393]`, `--accent #cb4b16`, `--accent-edge #8f3410 [#7a2a0c]`, `--on-accent #fdf6e3`, `--rec #dc322f`, `--danger #dc322f`, `--go #859900`, `--warn #b58900`, `--flag #b58900`, `--wave #268bd2 [#2aa198]`, `--wave-dim #a3b0ae [#2c5964]`, `--sel` (= `--wave`), `--well #e9e2cd [#00212b]`, `--well-line #d3cab0 [#0e3f4b]`, `--key #fbf6e8 [#0b4250]`, `--key-edge #bdb397 [#001c24]`, `--key-down #e6dfc9 [#06323d]`, `--key-bed #ddd5bd [#00212b]`, `--led-off #cfc6ab [#1b4f5b]`, `--lcd #002b36 [#00212b]`, `--lcd-ink #b58900`, `--t1 #268bd2`, `--t2 #2aa198`, `--t3 #b58900`, `--t4 #d33682`, `--label #fffcf2 [#0b4250]`, `--shadow rgba(7,54,66,.18) [rgba(0,0,0,.45)]`. Plus `color-scheme: light dark`.

- [ ] Replace `:root`; add the dark block; replace every `rgba(52,211,153,…)`, `#060b16`, `#062015`, `rgba(6,11,22,…)` etc. with `color-mix(in srgb, var(--token) N%, transparent)` or the token itself.
- [ ] `grep -nE '#[0-9a-f]{3,6}|rgba?\(' web/static/styles.css` shows only `:root`/dark-block lines and shadows. Commit.

### Task 4: Canvas code reads tokens and redraws on a scheme flip

**Files:** Modify `lib/wave/{view,overview,lanes,rising,rowwave,draw,page}.js`, `lib/tape/page.js`, `lib/ribbon.js` (if it paints colours), `lib/takes.js` (row redraw)

- [ ] Every hard-coded colour becomes `token('--name', fallback)` / `withAlpha(token(...), a)`: waveform and played columns → `--wave`, unplayed → `--wave-dim`, selections → `--sel`, playhead and grips → `--accent`, loop → `--warn`, cursor → `--ink`, canvas grounds → `--well`, lanes' text → `--ink`.
- [ ] `MELODIC_COLORS` → `['#268bd2', '#2aa198', '#d33682', '#6c71c4']`, `DRUM_COLOR` → `'#b58900'` (the existing tests compare by identity, so they still pass).
- [ ] Each page subscribes `onSchemeChange(() => redraw())`.
- [ ] `node --test …` (the CI command) passes. Commit.

### Task 5: The deck — keys, faceplates, silkscreen, LCDs

**Files:** Modify `web/static/styles.css`

- [ ] Type: `--font: 'IBM Plex Sans', system-ui…`, `--mono: 'IBM Plex Mono', ui-monospace…`, `--label-font: 'Barlow Condensed', …`. Panel headings, stat keys, `.tb-label`, brand → `--label-font`, caps, tracking .14–.16em.
- [ ] Keys: `.icon-btn`, `.seg button`, `.chip`, `.nudge`, `.mark-btn`, `.phone-btn` get `--key` faces, a 1 px `--key-edge` border with a 4 px bottom; `[aria-pressed=true]` / `.playing` drop to 1 px with `translateY(3px)` and `--key-down`. `.seg` sits on `--key-bed`.
- [ ] Main action: `.capture-btn`, `.icon-btn.primary` → `--accent` face, `--accent-edge` 6 px bottom, `--on-accent` Barlow caps.
- [ ] Readouts: `.stat .v` and `.tape-where .readout` → LCD (`--lcd` / `--lcd-ink`).
- [ ] Wells: `.viz-wrap`, `.overview-canvas`, `.wave-canvas`, `.tt-lane`, `.tape-overview` → `--well` with an inset edge.
- [ ] Top bar: `--bg` ground, 3 px double `--rule` underneath; health dot `ok` → `--go`.
- [ ] Check in the demo at 390×844, 844×390, 1024×768, 1440×900 in both schemes: Capture above the fold at 844×390; nothing clipped. Commit.

### Task 6: Ship PR 1

- [ ] `gofmt -l .`, `go vet ./...`, `go test -race ./...`, the node tests.
- [ ] Refresh `docs/images/*.png` with `scripts/screenshots.mjs` if Playwright is available; otherwise say so in the PR.
- [ ] Push, open the PR against `main`.

---

## PR 2 — main page and the takes shelf (scope)

VU meters replace the L/R bars (needle driven by the existing level feed; the landscape invariant still holds); capture tiers become latching keys with LEDs; the takes list moves to a new `takes.html` (search, Starred/MIDI/Phone/Tape filters, newest/longest, grouped by day, cassette rows); the main page keeps the latest take and an ALL TAKES key. `lib/takes.js` is split so the list renders on either page.

## PR 3 — take page (scope)

Grease-pencil In/Out marks drawn in `view.js`; In/Out times in LCD readouts; VARISPEED label on the speed segment; Share is the orange key; rising-notes stage stays dark in both schemes.

## PR 4 — tape machine (scope)

A reel-to-reel strip over the lanes: reels whose angular speed follows the playhead and the pack radius, eased so a jump back (loop wrap, ruler tap) spins them backwards; meter bridge with one VU per track; masking-tape track names (Permanent Marker, vendored); RECORDING sign lit only while recording.
