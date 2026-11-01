# 0063. On a phone, a cue clip's drawer docks above the mini player

**Date:** 2026-10-30, a call taken for Gabe and built as recommended
(`b5a2a4bf`, PR #236): Gabe may overrule it.

## Decision

On a phone, a cue clip's drawer docks above the mini player and brings the cue lane and the armed track into
sight, so ▶ is never under it.

## Why

0061 put the drawer above the bar. On a phone the bar is the mini
player: with the drawer open ▶ was out of reach and tracks 3 and 4 sat
under it.

## What it rules out

A drawer that covers the mini player; a phone drawer of its own design.

## See

`docs/architecture/bar.md`; [0061](0061-grab-lands-on-the-cue-lane.md).
