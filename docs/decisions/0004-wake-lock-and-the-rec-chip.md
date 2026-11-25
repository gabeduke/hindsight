# 0004. A wake lock while it plays or records

**Date:** Recorded 2026-10-17 (the shell audit and handoff, a3a03137,
e7c07b80); the REC chip it also promised was dropped on 2026-11-24 (never
built).

## Decision

The screen is kept awake while the tape plays or a recording runs, in either
room (`lib/wakelock.js`). Leaving the Studio during a recording never refuses
the move: the recording goes on.

## Why

What it guards against is in `docs/architecture/shell.md`, *Waking up*: a
tablet that sleeps freezes its page.

## What it rules out

Refusing to leave the Studio while recording; letting the screen sleep
during a take.
