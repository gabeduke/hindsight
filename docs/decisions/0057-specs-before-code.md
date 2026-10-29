# 0057. Specs before code, deleted when they land

**Date:** In AGENTS.md since 2026-10-14 (5564ab5b).

## Decision

A non-trivial change starts as a short spec in `docs/plan/`: the decisions,
agreed with Gabe, then the build order. When it lands, what lasts goes into
`docs/architecture/` (or `docs/flows.md`, for a journey, or a record here,
for a decision), `docs/plan/STATE.md` is updated, and the spec is deleted.
Specs merge without cutting a release.

## Why

A pile of landed specs is what agents then read as current.

## What it rules out

Building a non-trivial change with no agreed spec; keeping a landed spec.
