# Clip gestures in a module of their own (A0) — implementation plan

**Goal:** Move the tape lane's clip gestures out of `page.js` into a pure,
tested module, with zones for the grips later steps add, without changing
behaviour.

**Architecture:** `lib/tape/clipgestures.js` exports `zonesOf`, `hitClip` and
`ClipGesture`. `page.js` builds a `ClipGesture` per lane, feeds it pointer
events, schedules the hold, and acts on its answers. Drawing, `wireView`'s pan
and pinch, and the API stay in `page.js`.

**Tech Stack:** vanilla ES modules, `node --test`, Playwright for the smoke.

**Spec:** `docs/superpowers/specs/2026-10-07-clip-gestures-design.md`

## Global Constraints

- Behaviour doesn't change: the 300 ms hold, 8 px slop, one pointer by id,
  600 ms click grace, `lostpointercapture` ending only a held slide, and the
  hold skipped while a pinch is on.
- The module is pure: the clock is injected, the page owns the timer.
- `sw.js`: `SHELL` gains `/lib/tape/clipgestures.js`; `CACHE` → `v37`.
- No new control, so no `TIPS` row; the guide gains [demo] checks only.

## Review Focus

1. **A second finger lifting during a press** must not cancel the first
   finger's hold: the page clears its timer only when the machine ended a
   gesture (`release`, `slideEnd`, `gripEnd`), never on `null`.
2. **The click after a slide** is swallowed, and only that one.
3. **A lost capture before the hold** leaves the press alone.

---

### Task 1: The module and its tests

**Files:** create `web/static/lib/tape/clipgestures.js`,
`web/static/lib/tape/clipgestures.test.js`.

- [x] `zonesOf(block, kinds)`: body; `in`/`out` 24 px edges; `repeat` the
  top-right 24 px, at most half the height; none below 72 px wide.
- [x] `hitClip(blocks, x, y, kindsFor)`: last drawn wins; x decides the
  block, y only the corner.
- [x] `ClipGesture`: `down`, `hold`, `move`, `up`, `cancel`, `lost`,
  `clickIsTap`, `dragging`, `held`.
- [x] Tests for each zone and transition (20).

### Task 2: The page delegates

**Files:** modify `web/static/lib/tape/page.js`.

- [x] Lanes record `top` and `h` with each hit.
- [x] `laneHit(lane, e)` uses `hitClip` with `gripsOf` (no grips yet), for
  `wireLane` and `laneTap` alike.
- [x] `wireLane` holds a `ClipGesture`, sets the hold timer on `press`,
  captures on `slideStart`, follows `slide` with `slideTo`, and sends
  `slide` on a committed `slideEnd`.

### Task 3: Smoke, guide, cache

**Files:** modify `scripts/smoke-tape.mjs`, `docs/guide.md`,
`web/static/sw.js`.

- [x] The smoke makes its tape when the demo has none: 96 BPM, 4 bars, a
  take's first 4 bars on track 1.
- [x] Gesture smoke at 1440×900: tap → sheet; quick drag → not moved; hold
  and drag a bar → a bar later; ↶ → back; no page errors.
- [x] Guide step 7a: [demo] checks for the tap, the swipe and the slide.
- [x] `sw.js` v37 with the module in `SHELL`.
