# 0012. An agent installs releases; Gabe does not pull them by hand

**Date:** Recorded 2026-10-19 (`docs/plan/STATE.md`, 3b59409b).

## Decision

Releases are installed on the Pi by an agent with `POST /api/update`
(AGENTS.md, *Getting code onto a Pi*). An auto-install trigger is open
(`docs/plan/backlog.md`: "the hub does it" was the pick).

## Why

A merge of code is a release ([decision 0027](0027-what-cuts-a-release.md)); the repo records who installs
it, not why.

## What it rules out

Leaving a release uninstalled for Gabe to pull; installing over a take being
saved or a phone recording (the endpoint answers 409).
