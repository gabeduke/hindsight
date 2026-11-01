# 0064. ▶ in the Studio, with nothing playing, plays the tape

**Date:** 2026-10-30, a call taken for Gabe and built as recommended
(`e93a4ef8`, PR #239): Gabe may overrule it.

## Decision

Coming to the Studio from the Listening Room, where a take was played and
stopped, the bar gives back to the tape: ▶ plays the tape, the bar says
TAPE, and the playhead moves on the lanes and ruler. A take still playing
when the room changes keeps playing (J2.2).

## Why

On a Mac, ▶ played the stopped take again (*"BAR -1.4 · SOURCE: TAKE"*)
and the tape, never moving, showed no playhead. In the Studio ▶ means
the tape.

## What it rules out

A source left over from another room deciding what ▶ plays; stopping a
take that is playing just because the room changed.

## See

`docs/architecture/bar.md`; J1.17 in `docs/flows.md`.
