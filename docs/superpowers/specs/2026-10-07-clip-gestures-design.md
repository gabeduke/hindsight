# Clip gestures in a module of their own (A0)

**Date:** 2026-10-07 · **Status:** step A0 of the
[DAW-style editing plan](2026-10-07-daw-editing-plan.md), approved by Gabe on
2026-10-07 · **Repo:** `hindsight`

## Why

Steps A1–A4 each add a touch target to a clip's block on a tape lane: grips
on both edges to trim (A1), a drag across lanes (A2), a corner to repeat (A3),
and a selection of several clips (A4). Today the lane's gestures live inside
`wireLane` in `lib/tape/page.js`, a 2,400-line page with no unit tests, and a
clip is hit by x alone. Adding handles there would be hard to test, and each
could easily break the others.

So the gestures move first, unchanged, into a pure module with tests. Later
steps add zones and drags to it, and test them there.

## What

`web/static/lib/tape/clipgestures.js` is pure: no DOM, no timers, the clock
passed in. It holds two things.

**The zones of a block.** A block is `{x0, x1, top, h}` in CSS pixels on its
lane, as the lane draws it. `zonesOf(block, kinds)` names its parts:

| Zone | Where | For |
|---|---|---|
| `body` | the block | tap, hold and slide (today) |
| `in`, `out` | the left and right `HANDLE_PX` (24 px) | grips, when A1 asks for them |
| `repeat` | the top-right corner, 24 px wide and at most half the block's height | a grip, when A3 asks for it |

- Sizes are in CSS pixels, so a grip is 24 px at any zoom.
- A block narrower than `MIN_GRIPS_PX` (72 px: two grips and a body between)
  gets no grips. Its sheet does what they would.
- A page asks for grips per clip (`kindsFor(clip)`). In A0 no clip has any, so
  every hit is the body and nothing changes.
- The body and edges take the lane's whole height, as the x-only hit did.
  Only the corner looks at y.

`hitClip(blocks, x, y, kindsFor)` answers `{clip, zone, block}` or null.
Where blocks overlap, the one drawn last (the higher layer) is hit, as
`filter(…).pop()` did.

**The gesture state machine.** `ClipGesture` follows one pointer, by id:

| Gesture | What happens |
|---|---|
| Press and lift within 8 px | Nothing: the lane's click is the tap (the sheet, or the playhead) |
| Press and move 8 px before 300 ms | A swipe: the clip lets go, and the lanes pan it |
| Hold 300 ms, then drag | A slide: the clip follows, snapping as *Slide snaps to* says |
| Hold, then lift without moving 8 px | Nothing moves; the click opens the sheet |
| A second pointer | Ignored while the first is followed |
| Cancel or lost capture during a slide | Rolls it back, commits nothing |
| The click right after a slide (600 ms) | Ends the slide, not a tap |
| Press a grip and move 8 px | The grip drags at once, no hold (no grips in A0) |

The 300 ms hold and 8 px slop are the tape's today (the take page's hold is
350 ms; they're kept apart on purpose). Each call answers what the page should
do (`press`, `slideStart`, `slide`, `slideEnd`, `swipe`, `grip`, `gripMove`,
`gripEnd`, `release`), and `page.js` does it: capture the pointer, draw the
ghost, send the slide.

`page.js` keeps drawing, the view's pan and pinch (`wireView`) and every API
call. Its lane records each block's `top` and `h` beside `x0`/`x1` so the
module can place a corner.

## Not changed

Taps, hold to slide, the clip sheet, the snap, the pan and pinch, and the
click after a pan all behave as before. No control, tip, setting or API
changes.

## Tests

- **Node** (`clipgestures.test.js`): zones at three zooms (grips stay 24 px),
  narrow blocks with none, the corner's size, overlapping layers, any height
  hitting the body, grips only where asked; the machine's tap, swipe, hold and
  slide, the click grace and its expiry, a still hold, cancel and lost
  capture, one pointer by id, and a grip's drag, tap and cancel.
- **Smoke** (`scripts/smoke-tape.mjs`, the first gesture smoke test): a tap
  opens the clip's sheet; a quick drag leaves the clip where it is; hold, then
  drag a bar, slides it a bar; ↶ puts it back. The script now makes the tape it
  needs (96 BPM, 4 bars, a take's first 4 bars on track 1) when the demo has
  none, so it runs against a fresh `--demo`.
- **Guide:** [demo] checks for the tap, the swipe and the slide under step 7a.
