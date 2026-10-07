# Split here on a take (B2)

**Date:** 2026-10-07 · **Status:** step B2 of the
[DAW-style editing plan](2026-10-07-daw-editing-plan.md), from
[the clips design](2026-10-07-clips-design.md), approved by Gabe on 2026-10-07
· **Repo:** `hindsight` · Builds on [the crate](2026-10-07-crate-design.md)
(B1)

## Why

The Zoom recorders *divide* a file at the playhead into two files. On
Hindsight that would mean two new takes, which is exactly what the crate
avoids. And a take's audio never changes.

## What

- **On the take page**, *More → **Split here*** keeps two clips on the
  crate:
  - the take before the playhead, named *take · A*;
  - the take from the playhead to its end, named *take · B*.

  **The take isn't changed.** The toast says where it split and names both
  clips, with *Open the crate*. The ◫ chip counts them.
- **The word matches the tape's Split**, a cut at the playhead. On a take it
  makes clips, because a take's audio never changes.
- **The edit:** `POST /api/crate/split {take, at}`, `Engine.SplitTake`.
  - It copies both halves into the pool, with handles (`takeClip`, shared
    with Keep as clip).
  - It adds both to the crate in one change, A listed above B.
  - Each half must be at least 10 ms, or it says to put the playhead inside
    the take.
- **Held back:** *Chop at flags*, one clip per gap between flags, is held
  with the pads idea until the MPC side is settled.

## Tests

- **Go:**
  - the split's two clips: their names, lengths and spans;
  - the crate lists A, then B;
  - the take file's size and time are unchanged;
  - refused at the start, at the end, and within 10 ms of either;
  - over the API: the split, at 0, and no such take.
- **Smoke:** on a take page, the playhead moved to 0:03, then More → Split
  here. Two clips on the crate, A (3 s) then B; the take is the same length;
  the ◫ chip counts them.
- **Guide:** a *Split here* bullet in §4, two [demo] checks in §8.11, and a
  `TIPS` and §9 row.
