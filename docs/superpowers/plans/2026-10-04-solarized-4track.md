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

## PR 2 — main page and the takes shelf

**Goal:** the main page is about capturing — VU meters, capture keys, the latest take — and the takes live on a page of their own (`takes.html`) with search, filters, sort and day groups.

**Review Focus (PR 2):**
- 844×390 landscape phone → Capture still fully visible: the VU faces give way to the slim bars there.
- A take with no `created`, no BPM, no label, or a `created` in another year → a sensible day header and row, never "Invalid Date".
- Filters that match nothing → "No takes match" rather than "No takes yet".
- Opening a take from the shelf, then ◂ ▸ → steps through the takes as the shelf showed them (filtered and sorted).
- Deleting a take on its page, then Back → lands on the shelf with the Undo toast.

### Task 7: Takes say where they came from

**Files:** `internal/audio/meta.go`, `internal/audio/save.go` (Take), `internal/audio/phone.go`, `internal/tape/mixdown.go`, tests beside each.

**Produces:** `Meta.Origin string \`json:"origin,omitempty"\`` and `Take.Origin` (same tag): `"phone"` for a phone take, `"tape"` for a tape mixdown, empty otherwise. Constants `audio.OriginPhone`, `audio.OriginTape`.

- [ ] Failing tests: a finished phone take's `ReadMeta(...).Origin == "phone"`; a take built from a sidecar with `Origin: "tape"` lists with `Origin == "tape"`; a mixdown's sidecar has `Origin == "tape"`.
- [ ] Implement; `go test ./internal/audio ./internal/tape` → PASS. Commit.

### Task 8: `lib/shelf.js` — what the shelf shows, as pure functions

**Files:** create `web/static/lib/shelf.js`, `web/static/lib/shelf.test.js`

**Produces:**
- `matches(take, { query, starred, midi, phone, tape }) → boolean` — `query` matched case-insensitively against the label, the name's timestamp, and the BPM's text; each filter that is on must hold (`phone`/`tape` read `take.origin`).
- `shelve(takes, opts, now = Date.now()) → Array<{ label: string, takes: Take[] }>` — filtered; `opts.sort === 'longest'` gives one group `LONGEST FIRST` sorted by duration, else groups by local day of `created` newest first: `TODAY · SUN 4 OCT`, `YESTERDAY · SAT 3 OCT`, `THU 1 OCT`, and `12 MAR 2025` for another year; a take without a readable `created` goes in `EARLIER`.
- `latest(takes) → Take | null` — the newest by `created` (the list itself puts starred takes first).

- [ ] Tests for each case above, including the empty and invalid-date ones. RED, implement, GREEN. Commit.

### Task 9: TakesList renders groups

**Files:** `web/static/lib/takes.js`

**Consumes:** `shelve`, `latest` from Task 8.
**Produces:** `new TakesList(container, emptyEl, { …, shape })` where `shape(takes) → Array<{label, takes}>`; a group with an empty label draws no header. Headers are `<h3 class="shelf-day">` keyed by label and reconciled in place like rows. The step order the take page uses (`hindsight.order`) is the order shown. `refresh()` keeps the raw list in `this.all` so a filter change re-renders without a fetch (`reshape()`).

- [ ] `node --test` stays green; check by hand on both pages. Commit with Task 10.

### Task 10: The takes page

**Files:** create `web/static/takes.html`, `web/static/lib/shelf-page.js`; modify `web/static/sw.js`, `web/static/lib/help/tips.js`, `docs/guide.md` (§ on takes, §9 table), `web/static/wave.html` (Back → `/takes.html`).

- Header: ‹ (to `/`), TAKES, an LCD count of what is shown, Select, ?.
- Search field, latching filter keys ★ Starred · MIDI · Phone · Tape, a Newest / Longest rocker, and `N takes · X GB · Y GB free`.
- The list (day groups), Recently deleted, the select bar, toasts, the confirm sheet, the scroll restore, the Undo toast from a deleted take.
- Filter state kept per device in `localStorage` (try/catch).

- [ ] The help test (`every control in the UI that names a tip has one`, guide table = tips.js) stays green with the new tips. Commit.

### Task 11: The main page keeps the latest take

**Files:** `web/static/index.html`, `web/static/app.js`, `web/static/styles.css`

- [ ] The Takes panel becomes LATEST TAKE (one row, `shape: (t) => [{label: '', takes: [latest(t)]}]`) and an ALL TAKES key with the count, linking `/takes.html`. Select, the select bar and Recently deleted move to the takes page. Commit.

### Task 12: VU meters

**Files:** create `web/static/lib/vu.js`, `web/static/lib/vu.test.js`; modify `index.html`, `app.js`, `styles.css`

**Produces:** `vuAngle(dbfs, ref = -18) → degrees` in [-48, 48] on the VU law (0 VU = `ref` dBFS, scale −20…+3 VU); `vuScale() → { arc, redArc, ticks, redTicks, labels }` for a 160×96 face; `class VUMeters { constructor(container, { labels }); update(rms, peak, clip) }` — a needle per channel (CSS transform, eased), a PEAK lamp lit on clip or a peak ≥ −1 dBFS, and the dBFS value under it.

- [ ] Tests: `vuAngle(-18) ≈ 18.6`, `vuAngle(-38) === -48` (clamped), `vuAngle(0) === 48`, `vuAngle(-Infinity) === -48`, monotonic. RED, GREEN.
- [ ] The faces replace the bars; in `(orientation: landscape) and (max-height: 440px)` the faces hide and the bars return. 844×390: Capture's bottom edge (shadow included) ≤ 390. Commit.

### Task 13: Ship PR 2

- [ ] Full suite; 390×844, 844×390, 1280×800 light and dark; README screenshots refreshed if a headless browser is available. Merge on approval.

## PR 3 — take page (scope)

Grease-pencil In/Out marks drawn in `view.js`; In/Out times in LCD readouts; VARISPEED label on the speed segment; Share is the orange key; rising-notes stage stays dark in both schemes.

## PR 4 — the tape machine

**Goal:** the tape page reads as a studio: a reel-to-reel machine above the lanes whose reels turn with the playhead (and spin back on a rewind or a loop wrap), a meter bridge with a VU per track, track names on masking tape, and a RECORDING sign lit while a punch records. Retro but quiet (the calm pass): flat colours, no glow except the sign.

**Review Focus (PR 4):**
- A loop wrap, a ruler tap back, or Undo moving the playhead → the reels spin backwards to it, quickly, then play on; never a jump of the reel angle.
- A tape with no clips, an empty track, a muted track, a clip whose peaks haven't loaded → the meter rests at the stop, no NaN, no error.
- Polls arrive late or the tab was hidden → the reels don't run away: extrapolation stops at the next poll's position and never past the tape's end.
- 1024×600 and 390×844 → the lanes still fit; the machine shrinks or the bridge hides rather than pushing the transport off a phone.
- prefers-reduced-motion → the reels jump instead of spinning.

### Task 14: `lib/tape/reels.js` — reel motion, pure

**Produces:**
- `packRadii(pos, length, hub = 17, full = 64) → { left, right }` — area-conserving tape packs: all on the left at 0, all on the right at `length`.
- `class ReelMotion { constructor({ sampleRate }); poll(pos, playing, at); frame(now) → { pos, left, right, angleL, angleR, moving } }` — between polls a playing tape is extrapolated at `sampleRate` from the last poll, capped at the next poll's span (never more than one poll interval ahead); a jump of more than half a second eases to its target over 450 ms; each reel turns by the tape that crossed it divided by its pack radius; `moving` is `'play' | 'wind' | 'rewind' | 'stop'`.

- [ ] Tests: radii at 0 / length / half conserve area; extrapolation between polls; a stopped tape stays; a jump back reports `rewind`, both angles decrease, and lands on the target after 450 ms; a run never passes the tape's length. RED, GREEN, commit.

### Task 15: `levelAt` — what each track has under the playhead

**Files:** `web/static/lib/tape/geometry.js` (+ test)

**Produces:** `levelAt(track, frame, peaksOf, sampleRate) → dBFS` — the loudest clip sounding at `frame` on the track (nudge included), from its pool file's peaks bucket under that frame, through the clip's and the track's gain; a muted track, no clip, or peaks not loaded give `-Infinity`.

- [ ] Tests for each case. RED, GREEN, commit.

### Task 16: The machine strip and the meter bridge

**Files:** create `web/static/lib/tape/machine.js`; modify `tape.html`, `lib/tape/page.js`, `styles.css`, `sw.js`.

- An SVG reel-to-reel (reels with see-through flanges, tape path over guides and the E/R/P heads, the record head red while a punch records) and, beside it, the meter bridge: one `VUMeters` face per track (lib/vu.js), its foot the track's number.
- Driven by `requestAnimationFrame` from `ReelMotion` while the page is visible; paused when hidden.
- ≥1000 px: the strip spans the lanes' column above the overview, the lanes' height calc gives it its room. Below 700 px: the reels only, short; the bridge hides.

- [ ] By hand in the demo: play, loop wrap, ruler tap back, stop, record (sign and head), reduced motion. Commit.

### Task 17: Masking tape and the RECORDING sign

**Files:** `web/static/fonts/permanent-marker-400.woff2` (+ licence), `styles.css`, `tape.html`, `lib/tape/page.js`, `sw.js`, `lib/help/tips.js` + `docs/guide.md` (a tip for the sign).

- Track names on a strip of masking tape in Permanent Marker; the selected track's strip gets a red REC dot.
- A RECORDING sign in the header: dim when not, lit red while `live.record.state === 'on'` and playing.

- [ ] Help test green; check by hand. Commit.

### Task 18: Ship PR 4

- [ ] Full suite; 1280×800, 1024×600, 390×844 in both schemes; README screenshots refreshed (deferred from PR 1/2). Review, merge and deploy on approval.
