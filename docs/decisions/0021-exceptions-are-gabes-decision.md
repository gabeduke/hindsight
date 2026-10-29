# 0021. An exception is Gabe's decision, not a fix

**Date:** 2026-10-26 (d8188577).

## Decision

Nobody adds an entry to an allow-list, a budget, `TYPED`,
`scripts/flows/layout-known.json` or a "still their own" list (`OWN_MENUS`,
`OWN_HISTORY`) to turn a check green. Report the failure,
and what it would take to fix it properly.

## Why

Those lists exist so the numbers only go down. Each was written as a ratchet
after a pass that cleaned up what had grown (the menus, the holds, the
glyphs, the CSS's costs).

## What it rules out

Growing a ratchet's list or budget in the same change that would fail it.
