# Drag to repeat (A3)

**Date:** 2026-10-07 · **Status:** step A3 of the
[DAW-style editing plan](2026-10-07-daw-editing-plan.md), approved by Gabe on
2026-10-07 · **Repo:** `hindsight` · Builds on
[clip gestures](2026-10-07-clip-gestures-design.md) (A0) and
[edge trim](2026-10-07-edge-trim-design.md) (A1, the picked clip)

## Why

There are two ways to repeat a clip today:
- *Repeat to the loop's end*, in its sheet, which fills the loop;
- drop, drop, drop from the clipboard.

On the R20 you drag a region's corner to lay copies end to end, as many as
you drag past.

## What

**The edit.** `repeat {clip, count}` lays `count` copies (1–64) end to end
after the clip on its track. It's one undo step.
- All the copies go on one layer: the clip's own, if it's free for all of
  them, else the lowest layer free for all of them (`PlaceTogether`). That's
  the renderer's rule: only clips that meet on one layer crossfade.
  Across layers both edges declick, which would be a dip at every seam,
  every time round.
- A copy is a new clip of the same audio (the same pool file, `src`,
  level, nudge, reversal), with its own id. Copies aren't linked: changing
  one leaves the others.
- Copies that would run past the end of the tape are refused, not cut short.

The PATCH's `tile` (*Repeat to the loop's end*) stays as it is: it fills the
free room on the clip's own layer up to the loop's Out.

**The page.**
- The picked clip (A1) shows a ⟳ in its top-right corner. That's the
  `repeat` zone in `clipgestures.js`: 24 px wide, at most half the block's
  height. The trim grips' pills sit below it.
- Dragging it right shows a dashed ghost of each copy after the clip, with
  its waveform faint, and the count as *×N*: the clip and its copies.
- A copy is added each time the drag passes half a clip's length
  (`geometry.js` `repeatCount`), up to what fits before the tape's end
  (`repeatRoom`). Dragging back takes them off.
- Letting go with one or more lays them (one `repeat`), and toasts with
  Undo. Letting go with none changes nothing.
- While the corner is held, the lanes don't pan, pinch or follow the
  playhead, and the wheel does nothing (`gripHeld`). Another finger's hold
  doesn't start a slide.
- Held within 32 px of either end of the lane (`EDGE_PX`), the view scrolls
  that way a little each frame. The count follows the tape frame under the
  finger, not just its travel, so it keeps growing as the view moves. A
  clip that fills the view would otherwise need a drag past the screen's
  edge for its first copy. Trim grips scroll the same way.

## Tests

- **Go:**
  - three copies end to end, with the clip's file, `src` and layer;
  - ids of their own;
  - one copy's level changed alone;
  - a copy over audio on the next layer up;
  - one undo takes them all back;
  - counts 0, −1 and 65 refused, and no such clip;
  - exactly two fit before the tape's end, and three are refused;
  - over the API, with an undo.
- **Node:** `repeatRoom` (fits, none, at most 64) and `repeatCount` (half a
  copy, none dragged back, up to the room, a zero-length clip).
- **Smoke:** the ⟳ corner dragged most of a clip's length lays one copy at
  its end; ↶ takes it back.
- **Guide:** §8.5's Repeat row and three [demo] checks. *A lane*, in `TIPS`
  and §9, names the ⟳ corner.
