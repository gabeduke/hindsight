# 0006. Tape mods go through undo; tricks are held-only

**Date:** Recorded 2026-10-15 (the rooms specs, 821f184e); the AGENTS.md
rule since 2026-10-14 (5564ab5b).

## Decision

A change to the tape (its mods, an edit) is one undo step. Tricks and
punch-in FX are held-only: they last while a pad is held and never touch
undo or the tape. Any momentary gesture bypasses undo. `lib/play/` is a
performance surface, and Play mode has been audible on that footing since
v2026.10.15.3.

## Why

The track-mute PATCH goes through the undo stack, so wiring a momentary pad
to it would leave tens of undo entries behind after one jam.

## What it rules out

A performance path that writes the tape or the undo stack; a pad wired to an
editing endpoint.

## See

AGENTS.md, *Momentary gestures must not touch undo*
