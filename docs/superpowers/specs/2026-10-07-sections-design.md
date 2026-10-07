# Sections (A6)

**Date:** 2026-10-07 · **Status:** step A6 of the
[DAW-style editing plan](2026-10-07-daw-editing-plan.md), approved by Gabe on
2026-10-07 · **Repo:** `hindsight`

## Why

The loop is the tape's only span. Arranging a song means thinking in parts,
an intro, a verse, a chorus, and today they live only in Gabe's head. A
DAW's arrangement markers, and the R20's, name them and select them in one
tap. They also prepare A7: *Duplicate section* is "the chorus again".

## What

- **Model:** `State.Sections []Section{ID, Name, At, End, Color}`, part of
  the tape's state, so each change is one undo step and every device sees
  it.
  - **Bar lines:** on a tape with a tempo, a section sits on bar lines
    (`snapSection`), at least a bar long. Without one, it sits where it was
    drawn.
  - **Validation:** sections don't overlap, a name is 1–40 characters, and a
    colour is one of six (`amber, red, green, blue, violet, cyan`, drawn in
    the theme's tokens).
- **Edits:** `section-add {name, at, end, color?}`,
  `section-set {section, name?, color?, at?, end?}` and
  `section-remove {section}` on `POST /api/tapes/edit`. Each answers
  `edit.section`.
- **Export:** each section is a MIDI marker in the stems' `.mid`, named for
  it, where it starts. Where no section begins at a section's end, an
  *End of …* marker goes there. The events are in order, and the track ends
  after the last marker.
- **The page:** a thin strip, *Sections*, over the ruler, drawn in the lanes'
  view.
  - **Hold, then drag** across bars to make a section. It's named the first
    of *Intro, Verse, Chorus, Drop, Bridge, Outro* not yet used, or
    *Section N*, and its sheet opens.
  - **Tap a section** to select its bars: they become the loop's In and Out
    (the loop's on/off is left alone), so Lift, Copy and ×2 act on it. The
    section is outlined while it's the loop.
  - **Tap it again** for its sheet: the six names, a name of your own, six
    colours, and Remove (the audio under it stays).
  - **Drag an edge** to resize it, a bar at a time with a tempo. An edge
    stops at the section beside it, as the Pi would refuse an overlap.
  - `lib/tape/sections.js` holds the pure parts: the hit test (edges within
    10 px, on a section wide enough), the next name, whether it's the loop,
    and its bars as words.
- **Later:**
  - A7 moves sections with *Insert* and *Delete time*, and adds *Duplicate
    section*.
  - Sending a program change to the instruments at a section's start waits
    on the rig roles.

## Tests

- **Go:**
  - sections snapped to bar lines, with names trimmed;
  - less than a bar becomes a bar;
  - refusals: an overlap, a blank name, an unknown colour, past the end, no
    end;
  - rename, recolour and resize; a resize into the next is refused;
  - remove, and undo of each step;
  - no tempo: kept where drawn;
  - export markers, in order, with *End of* the last;
  - over the API: add, rename, overlap, remove, and remove twice.
- **Node:** `sections.test.js` (the hit test, a narrow section, names, the
  loop, bars, colours).
- **Smoke:**
  1. hold and drag makes a section on bar lines;
  2. its sheet opens;
  3. *Verse* names it;
  4. a tap selects its bars;
  5. Remove takes it away;
  6. ↶ brings it back.
- **Guide:** §8.5's *Sections* paragraph and five [demo] checks; §8.6's
  markers; five `TIPS` and §9 rows.
