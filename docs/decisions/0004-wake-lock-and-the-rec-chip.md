# 0004. A wake lock while it plays or records, and the REC chip

**Date:** Recorded 2026-10-17 (the shell audit and handoff, a3a03137,
e7c07b80).

## Decision

The screen is kept awake while the tape plays or a recording runs, in either
room. Leaving the Studio during a recording shows a REC chip with Stop in
the header; it never refuses the move.

## Why

The repo records the decision but not its reasons. What it guards against is
in `docs/architecture/shell.md`, *Waking up*: a tablet that sleeps freezes
its page.

## What it rules out

Refusing to leave the Studio while recording; letting the screen sleep
during a take.
