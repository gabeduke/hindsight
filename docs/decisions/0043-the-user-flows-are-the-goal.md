# 0043. The user flows are the goal

**Date:** 2026-10-18 (45f62b54).

## Decision

Before reporting any change to what the app does, run `node
scripts/flows.mjs` and put its table in the report. `docs/flows.md` is how
Gabe uses the app, as stories, each with a Playwright flow that drives the
demo like a user and fails on any page error. A core flow that fails is a
regression, the change's or already on main, and the report says which. A
flow's expectations change only when its story does, in `docs/flows.md` too.
A change to a journey adds or extends its flow; a story not built yet is a
`todo` flow.

## Why

The shell merged with 1,790 green unit tests and a Studio that threw on
every load; the flows caught it.

## What it rules out

Reporting a behaviour change without the flows' table; editing a flow to
pass.
