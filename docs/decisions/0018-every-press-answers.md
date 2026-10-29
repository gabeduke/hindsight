# 0018. Every press answers, at once, where the player is looking

**Date:** 2026-10-28 (`docs/plan/the-instrument.md`, step 7).

## Decision

Each press on the keyboard answers on its own screen (a banner) and on the
tablet's bar (a note over the display), whatever the bar holds and in every
room with the shell's bar. A refused press says why.

## Gabe's words

*"often when playing an instrument you develop an intuitive feel by watching
something and feeling out the notes"*

## Why

Playing by feel needs something to watch that answers each press.

## What it rules out

A press that answers in one place only; a refusal that says nothing.

## See

`docs/architecture/push.md`, *The keyboard's press*; J1.15
