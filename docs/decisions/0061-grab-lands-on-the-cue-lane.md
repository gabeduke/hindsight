# 0061. GRAB lands on the cue lane

**Date:** 2026-10-22 (`the-studio-on-one-screen.md`, agreed with Gabe);
built 2026-10-29; the drawer took its small-panel shape in the calm Studio
(decision 6). Takes in 0005 (the cue lane with the tape) and 0008 (the
Studio's keys), merged 2026-11-24. The three choices under *How* were built
as recommended: Gabe may overrule any of them.

## Decision

GRAB lands on the cue lane as a cue clip; there is no buffer panel. A tap
on a cue clip launches it; a hold opens its drawer, docked above the bar:
Drop (↵, onto the armed track), Trim and Toss (⌫). Trim holds Audition,
Repeat, IN/OUT, its inputs, gain and To the shelf (K). A new key for a cue
clip goes in Trim, never on the pad or the small panel.

The Studio's keys: C catches, G grabs, ↵ drops, K puts the clip on the
shelf.

The cue lane is stored with the tape (`/api/tapes/state`), not per browser,
so every device in the room sees the same lane. A cue clip launches on the
next bar line, timed by the Pi's transport, and loops until it is tapped
again; Shift starts it at once. Dropping it lays it on a track; it stays on
the lane. A launch is a performance: it stays out of the tape's state and
out of undo ([0006](0006-tape-mods-undo-tricks-held-only.md)).

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
that was used; the clipboard as a thing on screen; a cue lane kept in a
browser's storage; a launch timed by the page; a launch or a stop that adds
an undo step; reusing C, G, ↵ or K for anything else in the Studio.

## See

`docs/architecture/tape.md`, *The cue lane*; C1, J1.3, J1.6 and J3.1 in
`docs/flows.md`.
