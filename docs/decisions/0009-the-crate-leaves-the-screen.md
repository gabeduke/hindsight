# 0009. The crate leaves the screen, not the Pi

**Date:** 2026-10-15 (the flow spec, decision 9 and question 3, answered by
Gabe); its HTTP API removed 2026-10-18.

## Decision

The crate stops being shown; its clips stay on the Pi, nothing converted or
deleted. The safety net is an Undo instead, not a growing crate: GRAB
lands on the cue lane and replaces only the newest untouched grab, which the
tape's Undo brings back, and a Cut or Copy that replaces the clipboard keeps
the one it replaced (`internal/tape/replaced.go`). Records aren't written any more
(`Meta.Record` on existing takes is ignored, not migrated): a bounce is a
take. The ring stays in the code and in `RING_SECONDS`, never on screen,
where it is *the feed*. The crate's HTTP API was removed on 2026-10-18
(Gabe); whether to retire `internal/tape/crate.go` is open in
`docs/plan/backlog.md`.

## Why

The crate was a third place to keep audio beside takes and tapes, and the
two nouns leave no room for it.

## What it rules out

A crate, a record or the ring on screen; a GRAB that adds to a growing store
instead of replacing one with an Undo.

## See

`docs/architecture/rooms.md`, *Vocabulary*; `internal/tape/replaced.go`
