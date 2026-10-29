# 0005. The cue lane lives with the tape and launches on the bar line

**Date:** Recorded 2026-10-16 (the shell and cue lane spec, c162da80).

## Decision

The cue lane is stored with the tape (`/api/tapes/state`), not per browser.
A clip launches on the next bar line and loops until it is tapped again;
Shift starts it at once. Dragging a clip to a track copies it. Launching is
a performance, so it stays out of the state and out of undo.

## Why

Every device in the room should see the same lane, and a launch has to land
in time with the tape, which only the Pi's transport knows.

## What it rules out

A cue lane kept in a browser's storage; a launch timed by the page; a launch
or a stop that adds an undo step.

## See

`docs/architecture/tape.md`, *The cue lane*
