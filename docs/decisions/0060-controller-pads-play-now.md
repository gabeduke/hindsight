# 0060. A controller's pads play now, not on a 16th

**Date:** 2026-10-29, at the rig.

## Decision

The Pi's controllers land their pads at once: `controls.json`'s `quantum`
is `now` on Gabe's Pi (`PUT /api/tapes/controls {"quantum": "now"}`). PLAY
and REC were never quantised.

## Why

Gabe played BREAK, ROLL and STOP from the SMK-37 over the tape, first on a
16th, the default, then on `now`, by ear (the instrument's P1). On a 16th:
*"I don't think that's going to be what I'm looking for"*; on `now`: *"much
better"*. A 16th waits up to 114 ms at 132 BPM, on top of the render's lead.
Measured in use the same afternoon (`GET /api/latency`), a pad on `now` is
heard 62 ms after its note at p50, 73 ms at p95, of which the render's lead
is about 59 ms.

## What it rules out

Quantising a controller's pads to the grid by default, on Gabe's rig. The
code's default is still a 16th, for a kit that hasn't chosen: whether every
kit starts on `now` is a separate decision.

## See

`docs/plan/the-instrument.md`, step 7, *The pads' timing*;
`docs/architecture/keyboard.md`.
