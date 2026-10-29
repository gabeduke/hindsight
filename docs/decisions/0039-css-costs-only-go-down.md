# 0039. The stylesheets' costs only go down

**Date:** 2026-10-24 (1f883916).

## Decision

`lib/css-budget.test.js` counts hex and rgba literals outside the token
blocks, z-index numbers, `!important`, `@media` conditions, written-in
durations and font-weights with no face. Reuse a token, a condition or a
z-index rather than add one; when a count drops, the test prints the number
to lower it to.

## Why

Each of those makes the CSS more expensive to change, and they had grown one
change at a time.

## What it rules out

Raising a budget to make room for a change ([decision 0021](0021-exceptions-are-gabes-decision.md)).
