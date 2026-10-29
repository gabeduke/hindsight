# 0061. GRAB lands on the cue lane

**Date:** 2026-10-22 (`the-studio-on-one-screen.md`, agreed with Gabe);
built 2026-10-29. The three choices under *How* were left to settle when it
was built, and were built as recommended: Gabe may overrule any of them.

## Decision

The buffer stops being a panel of its own. GRAB lands on the cue lane as a
clip, and a cue clip's drawer, docked above the bar, is where it is
trimmed, shaped, auditioned, dropped on the armed track (↵), kept (K) or
tossed (⌫). A tap on a clip still launches it; a hold opens its drawer.

## How

- **A GRAB takes the place of the lane's newest clip while that clip is an
  untouched GRAB** (never launched, dropped, kept, trimmed, shaped or
  renamed), with Undo, the tape's. Otherwise it is added. A run of G
  presses doesn't fill the lane, and nothing used is ever replaced. The
  alternative was every GRAB a new clip, cleared by Toss.
- **A cue clip keeps its GRAB's inputs and handles**: a lane per input,
  each with a bar either side, so the drawer's input chips and IN/OUT work
  on the clip as they did on the buffer.
- **A range's Cut, Copy and Paste keep a clipboard of their own,** unseen,
  as a DAW's is. A range spans tracks; a cue clip is one lane's worth.

## Why

The audit of 2026-10-24: *"GRAB's buffer pushes the cue lane and the tracks
under the bar, so DROP is pressed blind."* With the drawer above the bar,
the tracks move up for it, and what is grabbed is somewhere to jam with as
well as to drop.

## What it rules out

A panel between the feed and the lanes; a GRAB that replaces something
that was used; the clipboard as a thing on screen.

## See

`docs/architecture/tape.md`, *The cue lane*; C1, J1.3, J1.6 and J3.1 in
`docs/flows.md`.
