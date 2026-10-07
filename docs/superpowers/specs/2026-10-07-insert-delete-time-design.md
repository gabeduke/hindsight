# Insert and delete time (A7)

**Date:** 2026-10-07 · **Status:** step A7 of the
[DAW-style editing plan](2026-10-07-daw-editing-plan.md), approved by Gabe on
2026-10-07 · **Repo:** `hindsight`

## Why

The tape's Drop replaces what's underneath, as on the OP-1. That keeps the
tape's length, which suits laying a part over a loop, but arranging a song
needs a DAW's other two ways:
- putting a verse in *between* two others;
- taking bars out and closing the gap.

Sections (A6) name the parts. *Duplicate section* turns "the chorus again"
into one action.

These are the edits most likely to surprise, because they move everything
after them. So the plan's
[Making the edits obvious](2026-10-07-daw-editing-plan.md#making-the-edits-obvious)
is part of this step: the words, the paired icons, a preview, a confirm on a
phone, and a toast with Undo.

## What

### On the Pi (`internal/tape/timeedit.go`)

Three new ops on `POST /api/tapes/edit`. Each is one undo step, and each acts
on every track, the sections and the loop together, so the parts stay in time.

- **`insert {track, crate?}`**
  - Pushes everything from the playhead on later by the clipboard's length.
  - Lays the clipboard in the gap, from `track` down, as Drop would.
  - Before the push, `cutAt` splits a clip that runs across the playhead.
    The new edges have no fade.
  - A section or the loop after the playhead moves with everything else. One
    across the playhead stretches at its end.
  - With `crate`, a kept clip goes in instead of the clipboard (B1's crate
    gets its *Insert*).
  - When stopped, the playhead moves to the end of what went in, so a second
    Insert goes after the first.
  - Refused:
    - with an empty clipboard;
    - on an empty tape with no tempo: there's nothing to push, so Drop it;
    - when the push would take anything past the tape's end. The message
      names the room that's left and `TAPE_LENGTH_S`.
- **`delete-time`**
  - Cuts the loop's In to Out (the selection) out of every track, using the
    same `clearRange` as Lift, and moves everything after it earlier by the
    selection's length.
  - A section inside the selection is removed. One across an edge loses the
    part inside.
  - The loop stays where it is, so it now holds what followed: a second
    Delete time takes out the next bars of the same length.
  - Refused with no loop.
- **`duplicate-section {section}`**
  - Takes the section's span of every track (`window`), cuts at the
    section's end, pushes everything after it later by the section's length,
    and lays the copy in the gap.
  - The copy is laid base layer first, so parts stacked in the section stay
    stacked.
  - A section with the same name and colour goes over the copy.
  - Refused past the tape's end, and for a section that doesn't exist.
- **The answer:** `edit.at` and `edit.frames` give where and how much, for
  the toast. Duplicate's `edit.section` is the copy.

### On the page

- **Words and icons in pairs.**
  - **⤓ Drop** and **⇥ Insert** sit side by side in the clipboard row.
  - **✂ Lift** and **⇤ Delete time** sit side by side in the edit row.
  - Insert and Delete time carry a small *all tracks* label, because they
    ignore the Track N / All toggle. The `TIPS` say what each does to what's
    already there: *over*, *push*, *leaving a gap*, *close the gap*.
- **A preview while a key is hovered or focused** (`lib/tape/timeedit.js`,
  pure, tested).
  - `insertPreview` and `deletePreview` work out the tape as it would be.
    The lanes draw that (`shownTape`).
  - Insert's gap is shaded and outlined, with the clipboard drawn in it as
    ghosts. Delete time shades what goes, in red. Both draw everything after
    already moved, and the ruler says *+4 bars* or *−4 bars* at the point.
  - Drop outlines what it will cover on the tracks it lands on.
  - On the crate, a clip's *Insert* previews that clip.
- **A phone has no hover, so it asks first.**
  - A first tap on Insert or Delete time shows the preview, rings the key,
    and toasts *Tap again to …*. The second tap carries it out.
  - A tap anywhere else, or Escape, lets the preview go.
  - *Ask before Insert and Delete time* (the `tape.ask` preference, on by
    default) is a chip in the edit drawer that turns this off. Only a touch
    screen shows it.
- **A toast with Undo after each edit:**
  - *Inserted 4 bars at bar 9 · every track after it moved later*;
  - *Deleted bars 9–12 · everything after moved up*;
  - *Chorus twice in a row: bars 9–12 is a copy, and what followed moved 4
    bars later*.
- **Duplicate** in a section's sheet. **Insert** on each crate row, beside
  Drop.
- **Layout:** the clipboard's chip has the line beside its label to itself,
  with Drop, Insert, Keep and × on the line under it. This holds from the
  1024 bench to the desk.

### Not in this step

- Insert or delete on one track alone. It would knock the parts out of time,
  and Drop and Lift already do one track.
- Ripple for Lift. Lift keeps leaving a gap; Delete time is the
  close-the-gap version.

## Tests

- **Go** (`timeedit_test.go`):
  - Insert pushes every track, the sections and the loop. A clip across the
    point is cut, and the clipboard lands in the gap.
  - A section across the point stretches.
  - A push past the tape's end is refused.
  - Delete time closes the gap. A section inside goes, and one across an
    edge is trimmed.
  - Duplicate section makes the copy, its section, and the push.
  - Insert and Delete time are one undo step each.
  - Insert from the crate works.
  - `api/tape_test.go` covers insert and delete over the API.
- **Node** (`timeedit.test.js`):
  - both previews;
  - a section stretching;
  - the span in words, and the bar a frame is in.
- **Smoke** (`smoke-tape.mjs`):
  1. Hovering Insert changes the lanes.
  2. Insert puts the clipboard at the playhead and moves the rest on; ↶
     undoes it.
  3. Delete time takes a bar out and the gap closes.
  4. Duplicate section makes *Verse* twice in a row.
  5. On a phone, the first tap only previews, the second inserts, and ↶
     undoes it.
- **Guide:**
  - §8.5 gets *Replace, insert or close the gap*, with three before-and-after
    strips and [demo] checks.
  - Five new `TIPS` and §9 rows, and the Drop and Lift rows reworded.
  - `sw.js` goes to v46, with `/lib/tape/timeedit.js` in `SHELL`.
