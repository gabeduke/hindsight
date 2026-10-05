# Reel-to-Reel Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Solarized 4-track look with the approved Reel-to-reel design: brushed aluminium by day, black anodised by night, black windows for audio, takes as cassettes, and controls with real depth.

**Architecture:** As in the Solarized restyle, every colour is a CSS custom property on `:root`, redefined under `@media (prefers-color-scheme: dark)`, and canvas code reads tokens at draw time and redraws on a scheme flip (`lib/theme.js`). This plan adds depth tokens (faces, highlights, shadows, rings and glows) and a small set of raised and recessed control styles that every page shares. Audio windows become black in both themes, so text drawn on them gets its own tokens. The work ships as six stacked PRs, each usable on its own. This plan details PR 1 and scopes PRs 2–6; each later PR is detailed here when it starts.

**Tech Stack:** Plain CSS, ES modules, canvas 2D, node's built-in test runner (`node --test`), Go `net/http` static server, service worker shell cache.

**Spec:** the approved design canvas, https://claude.ai/artifact/HdDR7jgUu2LTHneD6AB5bg, page **Reel-to-reel**:
- **Laptop rows:** Capture, Takes (cassettes), A take, Tape, Capture on the bench tablet; aluminium on top, black below.
- **Phone row:** Capture, Takes, a take as a cassette, Tape.

Waveform choices are on page **Waveform options** (H is the one picked). The token values below are copied from the canvas classes `.pa-reel-l` / `.pa-reel-d`.

## Global Constraints

- **The device decides the theme:** light and dark follow `prefers-color-scheme`. There is no in-app switch.
- **Colours mean one thing each:**
  - orange: the one main action on a screen
  - red: recording only, plus a destructive confirm
  - green: playing or healthy
  - yellow: loop, flags and mute
- **Track colours:** tracks 1–4 are `#3a96dd`, `#2fb3a7`, `#d9a114`, `#e0559a`, and are always numbered as well.
- **Audio windows are black in both themes:** wells, lanes, the ribbon and the take view. Anything drawn on them uses `--well-ink` / `--well-dim` / `--well-rule`, never `--ink`.
- **Inputs:** fields sit on `--field`, not on `--well`.
- **Contrast:** body text ≥ 4.5:1 against what is behind it, in both themes. Text ≥ 24px may be 3:1.
- **Fonts:** vendored only, in `web/static/fonts`. Barlow Condensed 600/700, IBM Plex Sans 400/600, IBM Plex Mono 400/600, Permanent Marker 400. No other weights, no network fonts.
- **Hover:** hover styles live only inside `@media (hover: hover)`, so a tap never leaves a sticky hover.
- **Focus:** every control shows a `:focus-visible` ring: `0 0 0 2px <ground>, 0 0 0 4px var(--focus)`.
- **Motion:** `@media (prefers-reduced-motion: reduce)` turns off lifts, glows that pulse, reel spin and slide-ins.
- **Above the fold:** on an 844×390 landscape phone the Capture button stays fully visible without scrolling, and on Tape so does Catch.
- **No new hex literals in JS** except token fallbacks.
- **Key behaviour:** keys latch. Pressed or latched, the key sits low (inset shadow, `translateY(1px)`) and its LED lights:
  - green for play
  - yellow for loop, click and snap
  - red for record
  - orange for the chosen capture length

## Review Focus

- **Canvas text and lines on the black wells in the light theme** (lane labels, bar numbers, grid lines, flag labels, rising-notes labels) must stay readable. Today they use `--ink` and `--rule`, which are dark in the light theme.
- **Text inputs** (rename, tempo, search, flag names) must be readable in both themes, with a visible caret and placeholder, on `--field`.
- **An 844×390 landscape phone after the restyle:** Capture still ends at or above 390px. Raised keys use shadows, not extra height.
- **On a touch screen**, tapping a button must not leave it lifted or highlighted afterwards.
- **Moving by keyboard alone**, every focused control must show the ring, including segmented switches and the Capture key.

---

## File map (PR 1)

- `web/static/styles.css`
  - token blocks (`:root` and the dark `@media`)
  - shared control rules: `.appbar`, `.appnav`, `.panel`, `.icon-btn`, `.chip`, `.nudge`, `.phone-btn`, `.seg`, keys, `.capture-btn`, `.icon-btn.primary`, inputs, menus, sheets, toasts
- `web/static/lib/styles.test.js` (new): parses `styles.css` and checks tokens, contrast, hover and focus rules
- `web/static/lib/wave/view.js`, `lanes.js`, `overview.js`, `rising.js`; `web/static/lib/tape/page.js`: canvas inks that draw on wells move to the well tokens
- `web/static/*.html` and `manifest.json`: the `theme-color` values
- `web/static/sw.js`: bump `CACHE`
- `.github/workflows/*.yml`: nothing to change. `web/static/lib/*.test.js` is already in the CI glob.

---

## PR 1: tokens and depth (branch `claude/reel-1-tokens`)

### Task 1: A stylesheet test that pins tokens, contrast, hover and focus

**Files:**
- Create: `web/static/lib/styles.test.js`

**Interfaces:**
- Produces (used by later tasks' runs): `node --test web/static/lib/styles.test.js`. The test reads `web/static/styles.css` itself; nothing to import.

- [ ] **Step 1: Write the failing test**

```js
// web/static/lib/styles.test.js
// The stylesheet's promises, checked without a browser: both schemes define
// the same tokens, text is readable on what it sits on, hover never sticks
// on a touch screen, and every control shows focus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// The body of the first block opening at `start` (brace-matched).
function block(start) {
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unbalanced');
}
function tokens(body) {
  const out = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = tokens(block(css.indexOf(':root')));
const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
const dark = { ...light, ...tokens(block(darkAt)) };

function rgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `not a 6-digit hex: ${hex}`);
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
function lum(hex) {
  const [r, g, b] = rgb(hex).map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const NEW = ['--face-hi', '--face-lo', '--panel-hi', '--card-hi', '--card-lo', '--edge', '--edge-soft', '--edge-strong',
  '--hl', '--sh', '--sh-strong', '--track', '--thumb-hi', '--thumb-lo', '--key-hi', '--key-lo', '--field', '--field-sh',
  '--accent-hi', '--accent-lo', '--accent-glow', '--go-glow', '--warn-glow', '--focus',
  '--well-hi', '--well-ink', '--well-dim', '--well-rule', '--lane', '--lane-hi', '--case-hi', '--case-lo'];

test('both schemes define the depth tokens', () => {
  for (const t of NEW) assert.ok(light[t], `light lacks ${t}`);
});

const PAIRS = [
  ['--ink', '--bg'], ['--ink-dim', '--bg'], ['--ink-faint', '--bg'], ['--ink', '--panel'], ['--ink-dim', '--panel'],
  ['--ink', '--field'], ['--on-accent', '--accent'], ['--on-accent', '--accent-lo'], ['--lcd-ink', '--lcd'],
  ['--well-ink', '--well'], ['--well-dim', '--well'], ['--danger-ink', '--bg'], ['--link', '--bg']
];
for (const [scheme, t] of [['light', light], ['dark', dark]]) {
  test(`${scheme}: text is readable on what it sits on`, () => {
    for (const [fg, bg] of PAIRS) {
      const c = contrast(t[fg], t[bg]);
      assert.ok(c >= 4.5, `${scheme} ${fg} on ${bg} is ${c.toFixed(2)}:1`);
    }
  });
}

test('hover lives only inside @media (hover: hover)', () => {
  const hoverBlocks = [...css.matchAll(/@media \(hover: hover\)/g)].map((m) => block(m.index));
  let outside = css;
  for (const b of hoverBlocks) outside = outside.replace(b, '');
  const stray = outside.split('\n').filter((l) => /:hover/.test(l) && !/^\s*(\/\*|\*)/.test(l));
  assert.deepEqual(stray, []);
});

test('every control shows a focus ring', () => {
  const rules = [...css.matchAll(/([^{}]*:focus-visible[^{}]*)\{/g)].map((m) => m[1]).join(',');
  for (const sel of ['.icon-btn', '.chip', '.seg button', '.appnav a', '.capture-btn', '.nudge', '.phone-btn', '.mark-btn'])
    assert.ok(rules.includes(sel), `no :focus-visible rule for ${sel}`);
});

test('inputs sit on the field, not the well', () => {
  const at = css.indexOf('.take-name-input, .take-bpm-input, .take-title-input');
  assert.ok(at > 0);
  assert.match(block(at), /background:\s*var\(--field\)/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test web/static/lib/styles.test.js`
Expected: FAIL. `light lacks --face-hi`, `no :focus-visible rule for .icon-btn`, and the input test fails because inputs still sit on `var(--well)`. The contrast tests may pass today; they're there to guard the new values.

- [ ] **Step 3: Commit the test (red)**

```bash
git add web/static/lib/styles.test.js
git commit -m "A stylesheet test: tokens in both schemes, contrast, hover, focus"
```

### Task 2: The Reel-to-reel palette and the depth tokens

**Files:**
- Modify: `web/static/styles.css`, the `:root` block (lines ~15–110) and the dark block (lines ~112–160)
- Modify: `web/static/index.html`, `takes.html`, `tape.html`, `wave.html`, `guide.html` (the `theme-color` metas), and `web/static/manifest.json`

**Interfaces:**
- Produces: every token in the table below, with these exact names. Later tasks use them.

- [ ] **Step 1: Replace the values and add the new tokens.** In each pair, light comes first and dark is in brackets. A single value means the same in both themes.

| token | light [dark] |
|---|---|
| `--bg` | `#e4e3dd` [`#141516`] |
| `--face-hi` / `--face-lo` | `#f2f1ec` / `#d9d8d1` [`#242528` / `#1a1b1d`] |
| `--panel` / `--panel-hi` / `--panel-2` | `#d8d7d0` / `#e7e6e0` / `#dddcd5` [`#1d1e21` / `#26272b` / `#222326`] |
| `--card-hi` / `--card-lo` | `#f6f5f1` / `#e9e8e2` [`#27282c` / `#1f2023`] |
| `--line` / `--rule` | `#c5c4bd` / `#b9b8b1` [`#2c2d31` / `#38393c`] |
| `--edge` / `--edge-soft` / `--edge-strong` | `rgba(20,22,24,.16)` / `.08` / `.32` [`rgba(255,255,255,.08)` / `.045` / `.18`] |
| `--hl` | `rgba(255,255,255,.9)` [`rgba(255,255,255,.07)`] |
| `--sh` / `--sh-strong` | `rgba(20,22,24,.14)` / `rgba(20,22,24,.36)` [`rgba(0,0,0,.4)` / `rgba(0,0,0,.72)`] |
| `--ink` / `--ink-dim` / `--ink-faint` | `#1b1d1f` / `#53575a` / `#5d6164` [`#ecebe6` / `#a3a29c` / `#8f8e88`] |
| `--track` / `--seg-hover` | `#cfcec7` / `rgba(20,22,24,.06)` [`#0e0f10` / `rgba(255,255,255,.05)`] |
| `--thumb-hi` / `--thumb-lo` | `#fcfcfa` / `#e3e2dc` [`#3b3c40` / `#2d2e32`] |
| `--key` / `--key-hi` / `--key-lo` | `#f1f0eb` / `#fbfbf8` / `#e2e1db` [`#303135` / `#37383c` / `#2a2b2e`] |
| `--key-edge` / `--key-down` / `--key-bed` | `#a9a8a1` / `#d5d4cd` / `#cfcec7` [`#08090a` / `#1f2023` / `#0e0f10`] |
| `--field` / `--field-sh` | `#eeede8` / `rgba(20,22,24,.2)` [`#0f1011` / `rgba(0,0,0,.6)`] |
| `--well` / `--well-hi` / `--well-line` | `#161718` / `#0e0f10` / `rgba(0,0,0,.6)` [`#0a0a0b` / `#060607` / `rgba(0,0,0,.7)`] |
| `--well-ink` / `--well-dim` / `--well-rule` | `#f2e6c8` / `#a39d90` / `rgba(242,230,200,.14)` [`#f2e6c8` / `#958f83` / `rgba(242,230,200,.14)`] |
| `--lane` / `--lane-hi` | `#101114` / `#16171a` [`#0b0c0e` / `#111215`] |
| `--accent` / `--accent-hi` / `--accent-lo` | `#b84a1b` / `#c9531f` / `#a83f14` (a shade under the canvas's `#c8501e`, which was 4.3:1 behind 14px legends; this is 4.9:1) |
| `--accent-edge` | `#7e2e0e` [`#5e220a`] |
| `--on-accent` / `--accent-glow` | `#fff7ea` / `rgba(201,83,31,.7)` |
| `--rec` / `--danger` / `--on-danger` | `#dc322f` / `#dc322f` / `#fff7ea` |
| `--danger-ink` | `#b3261e` [`#ff8a7a`] |
| `--go` / `--go-glow` | `#6faa32` / `rgba(111,170,50,.85)` [`#7dbb3c` / `rgba(125,187,60,.85)`] |
| `--warn` / `--flag` / `--warn-glow` | `#d99a0a` / `#d99a0a` / `rgba(217,154,10,.9)` [`#e5a50a` / `#e5a50a` / `rgba(229,165,10,.9)`] |
| `--on-flag` | `#1b1d1f` |
| `--wave` / `--wave-hot` / `--wave-dim` / `--sel` | `#4ebeb4` / `#7fe6dc` / `#2f5f5b` / `#4ebeb4` |
| `--lcd` / `--lcd-ink` / `--lcd-edge` | `#0b0905` / `#ffb547` / `rgba(0,0,0,.7)` [`#060503` / `#ffb547` / `rgba(0,0,0,.7)`] |
| `--focus` / `--link` | `#2f6fb3` / `#24609e` [`#5b9be0` / `#6aa8e8`] (link is text: 5.0:1 on the light ground; focus is a 3:1 ring) |
| `--t1` / `--t2` / `--t3` / `--t4` | `#3a96dd` / `#2fb3a7` / `#d9a114` / `#e0559a` |
| `--case-hi` / `--case-lo` / `--case-edge` | `#eef0f2` / `#c6c9ce` / `rgba(20,22,24,.28)` [`#303135` / `#141517` / `rgba(0,0,0,.75)`] |
| `--label` | `#f8f1de` (cassette paper, an object: the same in both) |
| `--grease` | `#f0c419` (grease pencil on black windows) |
| `--shadow` / `--scrim` | `rgba(20,22,24,.18)` / `rgba(20,22,24,.45)` [`rgba(0,0,0,.5)` / `rgba(0,0,0,.7)`] |

Leave every other existing token in place (`--vu-*`, machine, stage, ivory and the rest). Their pages change in PRs 4–6.

- [ ] **Step 2: Theme colours.** In every HTML file set `theme-color` to `#e4e3dd` (light) and `#141516` (dark). In `manifest.json` set `background_color` and `theme_color` to `#e4e3dd`.

- [ ] **Step 3: Run the token tests.**

Run: `node --test web/static/lib/styles.test.js`
Expected: the token and contrast tests PASS. Hover, focus and inputs still FAIL; Task 3 fixes those.

- [ ] **Step 4: Commit**

```bash
git add web/static/styles.css web/static/*.html web/static/manifest.json
git commit -m "Reel-to-reel palette: aluminium by day, black by night, and depth tokens"
```

### Task 3: Controls with depth: raised, recessed, pressed, focused

**Files:**
- Modify: `web/static/styles.css`:
  - replace lines 2032–2105, from `/* Buttons: flat and outlined. */` through `.icon-btn.primary:active {…}`
  - replace the `.menu, .sheet-inner` rule (line 2136)
  - replace the inputs rule (line 2140)
  - keep everything between them as it is: the flag pennant, the recording keys, the take label stripe, the track heads, the sheet headings
  - `.appbar` (~1637) and `.panel` (~261) keep their layout properties; only their surface lines move into the new block

**Interfaces:**
- Consumes: the Task 2 tokens.
- Produces these class contracts, which later PRs rely on and must not rename:
  - `.icon-btn`, `.chip`, `.nudge`, `.phone-btn` are raised
  - `.seg` is a recessed track whose `button[aria-pressed="true"]` is a raised thumb
  - the keys keep their selectors
  - `.capture-btn` and `.icon-btn.primary` are the orange action
  - `.panel` is raised

- [ ] **Step 1: Write the shared rules.** Replace lines 2032–2105 with the block below. Delete the old `.menu, .sheet-inner` and inputs rules, since the block below redefines them. Then add `@media (prefers-reduced-motion: reduce)` at the end.

```css
/* ---------- surfaces ---------- */
.appbar {
  background: linear-gradient(180deg, var(--face-hi), var(--face-lo));
  border-bottom: 1px solid var(--edge);
  box-shadow: inset 0 1px 0 var(--hl), 0 10px 20px -16px var(--sh-strong);
  backdrop-filter: none;
}
.panel, .menu, .sheet-inner {
  background: linear-gradient(180deg, var(--panel-hi), var(--panel));
  border: 1px solid var(--edge);
  border-radius: 14px;
  box-shadow: inset 0 1px 0 var(--hl), 0 16px 30px -24px var(--sh-strong);
}

/* ---------- raised: buttons and chips ---------- */
.icon-btn, .chip, .nudge, .phone-btn, .passes-row .pass {
  background: linear-gradient(180deg, var(--key-hi), var(--key-lo));
  color: var(--ink);
  border: 1px solid var(--edge);
  border-radius: 10px;
  box-shadow: inset 0 1px 0 var(--hl), 0 1px 0 var(--key-edge), 0 2px 4px -2px var(--sh);
  font: 600 14px var(--font);
  transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease, background .16s ease;
}
.chip, .phone-btn { border-radius: 999px; }
a.chip, a.icon-btn { text-decoration: none; }
.icon-btn:active, .chip:active, .nudge:active, .phone-btn:active, .passes-row .pass:active,
.icon-btn[aria-pressed="true"], .chip[aria-pressed="true"] {
  background: linear-gradient(180deg, var(--key-down), var(--key-lo));
  border-color: var(--edge-strong);
  box-shadow: inset 0 2px 4px var(--sh), inset 0 0 0 1px var(--edge-soft);
  transform: translateY(1px);
}
.icon-btn.danger, .menu > .danger, .take-flag-rm { color: var(--danger-ink); }
.take-actions .icon-btn.danger { background: transparent; border-color: transparent; box-shadow: none; }

/* ---------- keys: what you press while playing ---------- */
.seg button, .mark-btn, .icon-btn.play,
.tb-row.transport .icon-btn, .tape-toolbar .tb-row.catch .icon-btn, .tape-toolbar .tb-row.edit .icon-btn {
  background: linear-gradient(180deg, var(--key-hi), var(--key-lo));
  border: 1px solid var(--edge);
  border-radius: 11px;
  box-shadow: inset 0 1px 0 var(--hl), 0 1px 0 var(--key-edge), 0 3px 8px -4px var(--sh-strong);
  color: var(--ink);
  font: 600 14px var(--font);
}
.seg button:active, .mark-btn:active, .icon-btn.play:active,
.tb-row.transport .icon-btn:active, .tape-toolbar .tb-row.catch .icon-btn:active, .tape-toolbar .tb-row.edit .icon-btn:active,
.tb-row.transport .icon-btn[aria-pressed="true"], .tb-play.playing {
  background: linear-gradient(180deg, var(--key-down), var(--key-lo));
  border-color: var(--edge-strong);
  box-shadow: inset 0 2px 4px var(--sh), inset 0 0 0 1px var(--edge-soft);
  transform: translateY(1px);
}

/* A segmented switch: a recessed track with a raised thumb. */
.seg { background: var(--track); border-radius: 12px; padding: 3px; gap: 2px;
  box-shadow: inset 0 1px 2px var(--sh), inset 0 0 0 1px var(--edge-soft); }
.seg button { background: transparent; border-color: transparent; box-shadow: none; color: var(--ink-dim); border-radius: 9px; }
.seg button[aria-pressed="true"] {
  background: linear-gradient(180deg, var(--thumb-hi), var(--thumb-lo));
  box-shadow: 0 1px 2px var(--sh-strong), 0 0 0 1px var(--edge), inset 0 1px 0 var(--hl);
  color: var(--ink); transform: none;
}

/* The page switch is the same kind of switch. */
.appnav { background: var(--track); border: 0; border-radius: 12px; box-shadow: inset 0 1px 2px var(--sh), inset 0 0 0 1px var(--edge-soft); }
.appnav a { color: var(--ink-dim); border-radius: 9px; }
.appnav a[aria-current="page"] {
  background: linear-gradient(180deg, var(--thumb-hi), var(--thumb-lo)); color: var(--ink);
  box-shadow: 0 1px 2px var(--sh-strong), 0 0 0 1px var(--edge), inset 0 1px 0 var(--hl);
}

/* LEDs: a latched key says so with a light as well as by sitting low. */
.tb-play.playing::before { background: var(--go); box-shadow: 0 0 0 2px color-mix(in srgb, var(--go) 22%, transparent), 0 0 9px var(--go-glow); }
#dur-seg button[aria-pressed="true"]::before { background: var(--accent); box-shadow: 0 0 9px var(--accent-glow); }
.tb-loop[aria-pressed="true"]::before, .tb-click[aria-pressed="true"]::before,
.wave-page #snap[aria-pressed="true"]::before { background: var(--warn); box-shadow: 0 0 9px var(--warn-glow); }

/* The one main action: orange, lit from above. */
.capture-btn, .icon-btn.primary {
  background: linear-gradient(180deg, var(--accent-hi), var(--accent-lo));
  color: var(--on-accent);
  border: 1px solid var(--accent-edge);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.28), 0 1px 0 var(--accent-edge), 0 8px 18px -10px var(--accent-glow);
  text-shadow: 0 1px 0 rgba(0,0,0,.18);
}
.capture-btn { border-radius: 16px; }
.capture-btn:active, .icon-btn.primary:active { filter: brightness(.94); box-shadow: inset 0 2px 5px rgba(0,0,0,.28); transform: translateY(1px); }
.capture-btn[disabled] { background: var(--key); color: var(--ink-faint); border-color: var(--edge); box-shadow: none; transform: none; filter: none; }

/* Fields: pressed into the panel. */
.take-name-input, .take-bpm-input, .take-title-input, .take-sub-input, .tape-tempo-row input, .phone-field select, #flag-sheet input, .take-flag-edit input, .shelf-search input {
  background: var(--field); color: var(--ink);
  border: 1px solid var(--edge-soft); border-radius: 10px;
  box-shadow: inset 0 1px 3px var(--field-sh);
}

/* ---------- hover: only where there is a pointer to hover with ---------- */
@media (hover: hover) {
  .icon-btn:not([aria-pressed="true"]):not(:disabled):hover, .chip:not([aria-pressed="true"]):hover,
  .nudge:hover, .phone-btn:hover, .mark-btn:not([disabled]):hover, .icon-btn.play:hover {
    border-color: var(--edge-strong);
    box-shadow: inset 0 1px 0 var(--hl), 0 1px 0 var(--key-edge), 0 8px 16px -8px var(--sh-strong);
    transform: translateY(-1px);
  }
  .seg button:not([aria-pressed="true"]):hover, .appnav a:not([aria-current="page"]):hover { background: var(--seg-hover); color: var(--ink); }
  .capture-btn:not([disabled]):hover, .icon-btn.primary:hover { filter: brightness(1.07); transform: translateY(-1px); }
  .menu > button:hover, .menu > a:hover { background: var(--seg-hover); }
}

/* ---------- focus: always visible from the keyboard ---------- */
.icon-btn:focus-visible, .chip:focus-visible, .seg button:focus-visible, .appnav a:focus-visible,
.capture-btn:focus-visible, .nudge:focus-visible, .phone-btn:focus-visible, .mark-btn:focus-visible,
.menu > button:focus-visible, .menu > a:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--focus);
}

@media (prefers-reduced-motion: reduce) {
  .icon-btn, .chip, .nudge, .phone-btn, .seg button, .capture-btn, .mark-btn { transition: none; }
  .icon-btn:hover, .chip:hover, .capture-btn:hover { transform: none; }
}
```

- [ ] **Step 2: Move the five existing `:hover` rules** (`grep -n ":hover" web/static/styles.css`) into the `@media (hover: hover)` block. If an equivalent rule is already there, delete the stray one.

- [ ] **Step 3: Run the tests**

Run: `node --test web/static/lib/styles.test.js`
Expected: every test PASSes.

- [ ] **Step 4: Check the layout invariant in a browser.**
  - Start the demo with `preview_start {name: "hindsight-demo"}` (`.claude/launch.json`; pick a free `PORT`, since other sessions use 15173).
  - Resize to 844×390 and open `/`.
  - In the console, `document.querySelector('#capture-btn').getBoundingClientRect().bottom` must be ≤ 390.
  - Repeat at 390×844 and 1440×900.

- [ ] **Step 5: Commit**

```bash
git add web/static/styles.css
git commit -m "Controls with depth: raised keys, recessed switches, the orange key lit from above"
```

### Task 4: Canvases draw on black windows with the window inks

**Files:**
- Modify (each line listed by `grep -rn "col('--ink\|col('--rule\|col('--ink-dim\|col('--ink-faint" web/static/lib`):
  - `web/static/lib/wave/view.js` (~282, 348–376)
  - `web/static/lib/wave/lanes.js` (~269–274)
  - `web/static/lib/wave/overview.js` (~127–129)
  - `web/static/lib/tape/page.js` (~1076, 1190)
- Test: `web/static/lib/wave/inks.test.js`

**Interfaces:**
- Consumes: `--well-ink`, `--well-dim`, `--well-rule` (Task 2).

- [ ] **Step 1: Write the failing test.** No canvas file may draw with page inks.

```js
// web/static/lib/wave/inks.test.js
// Waveform windows are black in both themes, so canvas drawing on them uses
// the window inks. The page inks are dark in the light theme and would vanish.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = ['./view.js', './lanes.js', './overview.js', './rising.js', '../tape/page.js'];
test('canvas code draws with window inks, not page inks', () => {
  for (const f of FILES) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    const bad = src.split('\n').filter((l) => /col\('--(ink|ink-dim|ink-faint|rule)'/.test(l));
    assert.deepEqual(bad, [], `${f} still draws with page inks`);
  }
});
```

- [ ] **Step 2: Run it.** `node --test web/static/lib/wave/inks.test.js` should FAIL, listing the lines above.

- [ ] **Step 3: Swap the inks.**
  - `col('--ink', …)` becomes `col('--well-ink', '#f2e6c8')`.
  - `col('--ink-dim', …)` and `col('--ink-faint', …)` become `col('--well-dim', '#a39d90')`.
  - `col('--rule', …)` becomes `col('--well-rule', 'rgba(242,230,200,.14)')`.
  - Keep each `withAlpha(…)` wrapper as it is. For example, `withAlpha(col('--ink', '#073642'), 0.07)` becomes `withAlpha(col('--well-ink', '#f2e6c8'), 0.07)`.

- [ ] **Step 4: Run the whole JS suite**

Run: `node --test 'web/static/lib/*.test.js' 'web/static/lib/wave/*.test.js' 'web/static/lib/phone/*.test.js' 'web/static/lib/help/*.test.js' 'web/static/lib/tape/*.test.js'`
Expected: PASS, the same set CI runs.

- [ ] **Step 5: Check in the browser, light theme.** Open a take (`/wave.html?…` from the takes list) and the tape page. Bar numbers, flag labels, grid lines and lane names must read on the black windows. Then switch the OS to dark and back: the canvases redraw without a reload.

- [ ] **Step 6: Commit**

```bash
git add web/static/lib
git commit -m "Canvases draw on black windows with the window inks"
```

### Task 5: Ship-ready: cache bump, screenshots, review

**Files:**
- Modify: `web/static/sw.js` (`CACHE` → `hindsight-shell-v19`), `docs/images/*.png` (refresh if the README shows them)

- [ ] **Step 1:** Bump `CACHE` so installed PWAs pick up the new stylesheet.
- [ ] **Step 2:** Run `go vet ./... && go test ./...` and the node suite. Both must PASS.
- [ ] **Step 3:** Take screenshots of Capture, Takes, a take and Tape, at 390×844, 844×390 and 1440×900, in light and dark. Save them under `.superpowers/sdd/2026-10-04-reel-to-reel/pr1/` for the review. Don't commit them.
- [ ] **Step 4:** Commit: `git commit -am "PR 1: cache bump"`.

---

## PRs 2–6 (scoped; each is detailed here when it starts)

**PR 2: waveform drawing** (`lib/wave/draw.js`, `lib/wave/tape-strip.js`)
- **Bars:** `drawBars(ctx, levels, {x0, pitch, cy, half, color, cap: 'round'})` draws the rounded bars of the cassette windows and Tape blocks.
- **Trace on tape:** `drawTrace(ctx, top, bot, {cy, half, line, fill, glow})` draws it, and `paintOxide(ctx, w, h)` draws the brown strip with its sheen and grain.
- **Levels:** `levelsFor(peaks, n)` folds stored peaks into n bars.
- **Tests:** pure tests on path and level maths.
- **No page changes in this PR.**

**PR 3: takes as cassettes** (`lib/shelf*.js`, `takes.html`, `styles.css`)
- **The rack:** each row becomes a spine: a case edge with a J-card, a coloured side-A band, the name in Permanent Marker, the length, small bars and an LED.
- **The picked take:** a full cassette with a label, a window, hubs that turn while playing (CSS `animation-play-state`), and packs that follow the playhead.
- **Phone:** a spine opens the cassette view.
- **Stripe colour:** each take keeps a stable stripe colour (from a hash of its name).

**PR 4: Capture** (`index.html`, `lib/ribbon.js`, `lib/vu.js`, `app.js`)
- **The ribbon:** trace on tape on its log axis, with a red record head at "now", the chosen length lit orange, and the length markers as pills.
- **Monitor:** backlit amber VU meters and amber LCD stats.
- **Capture key:** larger; it glows on save.
- **The shelf:** "On the shelf" spines replace the latest-take card. A new capture slides in with a NEW sticker.
- **Bench tablet** layout.

**PR 5: Tape** (`tape.html`, `lib/tape/*.js`)
- **Deck:** a brushed-metal deck with reels that turn and reverse on loop wrap, and the amber counter.
- **Meters:** backlit VU meters that follow each track.
- **Lanes:** black windows with clip blocks of rounded bars (labels such as pass −n, repeat, split), and red A/M/S states.
- **Phone:** Play / Loop / Rec / Catch pinned above the tabs, so Catch is always reachable.

**PR 6: a take** (`wave.html`, `lib/wave/view.js`, `rising.js`)
- **The zoomed view:** trace on tape, with an overview window, grease-pencil IN/OUT on the tape, and keys with LEDs.
- **The edit strip:** an amber LCD.
- **MIDI lanes:** on black windows.
- **Rising notes:** over a lit keyboard.
