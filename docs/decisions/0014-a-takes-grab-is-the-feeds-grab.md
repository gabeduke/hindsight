# 0014. A take's GRAB is the feed's GRAB

**Date:** 2026-10-15 (the flow spec, decision 12).

## Decision

GRAB from a take works as GRAB from the feed does, with its length N
starting at the tape's loop in bars, so a grab fits the loop it is grabbed
for.

## Why

Two GRABs that behaved differently would be two verbs with one name.

## What it rules out

A take-only grab with its own picker or its own default length.

## See

`lib/rooms/grab.js`; `docs/architecture/rooms.md`, *Vocabulary*
