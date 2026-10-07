# Select several clips (A4)

**Date:** 2026-10-07 · **Status:** step A4 of the
[DAW-style editing plan](2026-10-07-daw-editing-plan.md), approved by Gabe on
2026-10-07 · **Repo:** `hindsight` · Builds on A0–A3

## Why

Every edit on the tape acts on one clip, or on the loop's span by time. To
move a verse's three parts together, each has to be slid alone, and they drift
apart. A DAW picks several and moves them as one.

## What

### Picking several

- **Select more**, in a clip's sheet, starts with that clip. On a computer,
  **Shift** with a click starts from the clip already picked, if any, and adds
  the one clicked.
- Then a tap on a clip adds it or takes it off; the sheet doesn't open. A tap
  on an empty stretch still moves the playhead and keeps the clips picked.
  Taking the last one off ends it.
- The picked clips are outlined in ink, like the one clip picked. They show
  no grips: trimming and repeating stay one clip's.
- A bar docks above the transport, where the Align editor docks:

| Key | Does | Edit |
|---|---|---|
| *N clips* | How many are picked | |
| **Move here** | Moves them so the first starts at the playhead, keeping their spacing and tracks | `move` |
| **Copy** | Copies them as they lie, on their tracks: **Drop** lays them out again from the selected track | `copy` with `clips` |
| **Reverse** | Turns each round | `reverse` with `clips` |
| **Remove** | Takes them off | `remove` |
| **Done** | Lets go of them (Escape too) | |

The plan named the bar's first key *Move*. It's **Move here** because
dragging already moves them; the key does what a drag on a phone does
badly, putting them at the playhead.

### Moving them

Hold any of them, then drag: they all go, by the same time and the same
number of tracks.
- Time snaps as a slide does, by the clip held.
- Tracks change a lane at a time, half a lane over, as in A2.
- `geometry.js` `groupMove` holds the move inside the tape and its tracks,
  so none goes before the start, past the end, or off the tracks.
- Each picked clip's landing box is drawn on its own target lane, and those
  lanes are outlined.
- Letting go sends one `move {clips, dt, dtrack}`, which is one undo step.

### The edits

All are one undo step. A missing clip refuses the whole edit, and nothing
changes.

- **`move {clips, dt, dtrack}`** takes the clips off. It places each `dt`
  later and `dtrack` down, the lowest layers first, so parts stacked on one
  another stay stacked. It's refused whole if any would go off the tape or
  its tracks.
- **`remove {clips}`**.
- **`duplicate {clips}`** lays a copy of them right after them: the
  selection's span later, on the same tracks, layered.
- **`copy {clips}`** builds a clipboard as they lie: one clipboard track for
  each tape track from the highest of them to the lowest (empty in
  between), each clip at its distance from the first. It's the multi-track
  clipboard that Lift and Copy of All already make, so **Drop** lays them out
  from the selected track.
- **`reverse {clips}`** turns each round. The reversed files are all written
  before the one edit. If it fails, the files are removed. (`reverseClip`
  is now `reverseClips` and `reversal`.)

### Keys

These work with several picked, or with the one clip picked:
- **Delete** (or Backspace) removes them;
- **⌘C / Ctrl-C** copies them, unless there's text selected;
- **⌘D / Ctrl-D** duplicates them.

**S** splits at the playhead (the Split key). None of them fire while you're
typing or a sheet is open.

Align stays one clip's. This lifts the tape-align spec's "no multi-clip moves"
for moving only.

## Tests

- **Go:**
  - a move of two clips a bar and a track, and one undo;
  - moves refused whole: off the fourth track, above the first, before the
    start, past the end, a missing clip, no clips;
  - stacked clips moved stay stacked;
  - remove, with undo and a missing clip;
  - duplicate after the last, with undo;
  - copy keeps the tracks (an empty one between) and the spacing, and leaves
    the tape alone;
  - reverse of two in one undo, with a missing clip leaving no file behind;
  - over the API: duplicate, move, refused move, copy, remove, empty remove.
- **Node:** `groupMove` (within the tracks and the tape, the start and the
  end, nothing picked).
- **Smoke:**
  1. Select more shows the bar;
  2. ⌘D lays a copy after the clip;
  3. Shift-click adds it: *2 clips*;
  4. dragging one moves both a lane down;
  5. ↶ puts both back;
  6. Delete removes both and hides the bar;
  7. ↶ ↶ brings back the clip alone.
- **Guide:** §8.5 gains *Several clips at once*, with its table and five
  [demo] checks. §8.2's keys list gains S, Delete, ⌘C, ⌘D and Shift.
  **TIPS** and §9 gain the bar's six keys and Select more. The *A lane* tip
  names Shift and Select more, and Split's tip names S.
