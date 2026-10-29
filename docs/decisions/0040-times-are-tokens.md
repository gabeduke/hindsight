# 0040. Times are tokens, and a key goes down at once

**Date:** 2026-10-24 (d0ab8c83).

## Decision

A new transition or animation takes its time and its ease from the motion
tokens (`--t-*`, `--ease-*`, `--spring-*`), which are
`lib/objects/motion.js`'s, written by `scripts/motion-tokens.mjs`; they
change there, never in `styles.css`. A key's `:active` rule draws `.down` as
well, which `lib/ui/keys.js` adds under a finger; `lib/ui/keys.test.js`
fails on one that doesn't.

## Why

Chrome holds `:active` back under a touch, so a key pressed by a finger, or
tapped quickly, showed no press; times written out per rule drifted apart.

## What it rules out

A duration or an ease written into a rule; an `:active` rule without
`.down`.

## See

`docs/architecture/css-and-motion.md`, *Motion*
