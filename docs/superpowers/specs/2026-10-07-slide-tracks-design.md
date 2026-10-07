# Slide onto another track (A2)

**Date:** 2026-10-07 · **Status:** step A2 of the
[DAW-style editing plan](2026-10-07-daw-editing-plan.md), approved by Gabe on
2026-10-07 · **Repo:** `hindsight` · Builds on
[clip gestures](2026-10-07-clip-gestures-design.md) (A0)

## Why

A slide keeps its track. Moving a part to another track today takes a lift
or copy, a track change and a drop, and the clip loses its own level and
nudge on the way. On the R20 you drag a region onto another track.

## What

**The edit.** `slide` takes `to`, the track it lands on. Left out, or 0, it
means the clip's own track. It lands on the lowest layer free there, as a
slide always has. It's one undo step, and it works on a muted or soloed track
too. A track that doesn't exist is refused (400).

The plan called the field `track`. It's `to` instead, because every edit
already sends `track` as the selected track: a page that knew nothing of this
would otherwise move clips onto whatever track was selected.

**The page.**
- A held clip follows the finger up and down as well as along. While it's
  over another track, that track's lane is outlined amber, and the dashed
  landing box is drawn in that lane.
- It changes track only once the finger is half a lane (lane top to lane
  top) up or down: `laneShift` and `targetTrack` in `clipgestures.js`. So a
  sideways slide with a wandering finger stays on its track.
- Letting go sends one `slide` with `at` and `to`. If the clip changed
  track, that track is selected, and the toast says so: *Slid to track 2,
  bar 3.1*.

## Tests

- **Go:**
  - a move onto a muted track, on its base layer;
  - a move onto a track with audio under it (the next layer);
  - undo, one step a move;
  - track 5 on a four-track tape: refused, nothing moved;
  - over the API: `to` moves the clip, and `track` doesn't.
- **Node:** `laneShift` (nothing until half a lane, symmetric, never −0, no
  pitch with one lane) and `targetTrack` (held to the tape's tracks). The
  machine's `slide` effect carries `dy`.
- **Smoke:** hold a clip on track 1 and drag it a lane down. Track 2 is
  outlined, and the clip lands on track 2 at the same place. ↶ puts it back
  on track 1.
- **Guide:** §8.5's Slide row, and three [demo] checks. The *A lane* tip, in
  `TIPS` and §9, says a clip can slide onto another track.
