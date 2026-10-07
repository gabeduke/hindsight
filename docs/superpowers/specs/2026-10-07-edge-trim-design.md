# Edge trim, with handles (A1)

**Date:** 2026-10-07 · **Status:** step A1 of the
[DAW-style editing plan](2026-10-07-daw-editing-plan.md), approved by Gabe on
2026-10-07 · **Repo:** `hindsight` · Builds on
[clip gestures](2026-10-07-clip-gestures-design.md) (A0)

## Why

A clip's length is fixed by how it was made: a catch is the pass or the bars,
a drop is the clipboard's span. Shortening one means a split and a remove;
lengthening one is impossible. On the R20, and in any DAW, you drag a region's
edge. The tape can express that already (`Clip.Src`, `Frames`, `At`), but a
pool file has only 10 ms past its clip, so a trimmed clip could never grow
back.

## What

### Handles: room to grow back

New pool files keep **handles**: up to `TAPE_HANDLE_S` seconds of the source
either side of the clip (default **2**, 0–10, an environment setting like
every other, in `internal/config`). The crossfades' 10 ms overhang stays the
minimum.

| Writer | Handles |
|---|---|
| A copy from a take (`CopyTake`), a drop or send of one (`copyTake`) | Both sides, as far as the take goes |
| A copy from the ring (`CopyRing`), a catch or a punch (`catchSpan`), a free loop's taps | Before: as far as the ring holds, keeping a second clear of its oldest frame (which the capture may overwrite while it's copied). After: what the ring has when it's written. A catch never waits for more |
| A reversed copy (`reverseClip`) | Both sides of the source, so a reversed clip trims too |

- A clip's `peak_db` stays its own: the clip and its overhang, as before.
  It isn't the handles'. (`audio.WriteSpanMeasured` and
  `CopyWAVSpanMeasured` measure a window of what they write.) A quiet catch
  between loud handles still says it's quiet.
- **Cost:** about 0.38 MB a second of stereo float, on disk and in RAM. At
  2 s either side that's about 1.5 MB per clip.
- Clips from before, and edges at a recording's very start or end, can only
  trim inward.
- Split halves share one file, so each can grow back over the other's audio
  once that's moved.

### The `trim` edit

`POST /api/tapes/edit` `{op: "trim", clip, edge: "in"|"out", at}`. It's one
undo step.

- **In** moves `At` and `Src` together, so the audio stays where it was
  played.
- **Out** changes `Frames`.

The Pi clamps the edge:
- either edge out no further than where the file still has the 10 ms
  overhang beyond it (or where the clip already starts or ends, if further).
  The Out edge's is what a crossfade out of it reads. The In edge's is kept
  too, because reversing the clip makes its start an end;
- neither edge past the clip beside it **on its layer**, nor past the tape's
  ends;
- at least 10 ms left.

It answers the clip as trimmed (`edit.clip`). A clip whose file changed
meanwhile (a reverse) is refused, so the bound used is never another file's.

Rendering needs nothing new. An edge that now meets audio on its layer
crossfades into it, and one beside silence declicks, by the rules the
renderer already has.

### The page

- **Picking.** A tap on a clip opens its sheet, as before, and now also
  **picks** it. The clip stays picked when the sheet closes. A tap on an empty
  part of a lane, or Escape, lets go of it. The picked clip shows a grip, a
  pill, inside each edge.
  - Why not "tap selects, tap again opens the sheet"? Because A4's multi-select
    starts from the sheet (*Select more*). Keeping one tap to the sheet
    changes nothing for anyone not trimming.
- **Dragging a grip** (lib/tape/clipgestures.js `in`/`out` zones, 24 px,
  only on blocks of 72 px or more):
  - The grip moves that edge, snapped to the **Slide snaps to** grid. Hold ⌥
    (Alt), or set Off, to move it freely.
  - The page bounds it as the Pi will (`geometry.js` `trimBounds`, `trimTo`,
    `trimmed`), and draws the block with its new edge.
  - It draws the audio the edge can still reach faintly past it, in a dashed
    outline.
  - At a bound, the grip and a line at the edge turn amber.
  - Letting go sends one `trim` and toasts where the edge went, with Undo.
- **A clip too narrow for grips** has **Start here** and **End here** in its
  sheet, which trim that edge to the playhead (where it's heard, the clip's
  nudge taken off). Each is disabled when the playhead is outside that edge's
  reach.
- A mouse over a grip shows the ↔ cursor.
- While a grip is held, the lanes don't pan or pinch, and the view doesn't
  follow the playhead.

## Tests

- **Go**:
  - config: `TAPE_HANDLE_S`'s default and range;
  - audio: the measured peak;
  - handles: in the middle of a take, at its start and end, and none with 0;
  - a catch's handles: the ring before it, what's arrived after;
  - a clip's peak with loud handles;
  - trim in and out: the audio stays put, the file's start, the overhang at
    its end, the 10 ms minimum, and four undos;
  - the neighbours on the layer and not another layer's, and split halves
    growing back;
  - refusals;
  - a trimmed edge declicking beside silence and crossfading into the next
    clip;
  - the API's trim.
- **Node**: `trimBounds` (file, neighbours, unknown file, no room), `trimTo`
  (snaps, free, bounds), `trimmed`.
- **Smoke**: tap, close the sheet, drag the right grip a bar left → a bar
  shorter; ↶ → back.
- **Guide**: the Trim row in §8.5, handles under it, and five [demo] checks.
  `TIPS` gains *Start here, End here (clip)*, and *A lane* says a picked clip's
  edges trim it, with the same rows in §9.
