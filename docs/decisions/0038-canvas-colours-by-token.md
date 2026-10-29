# 0038. A canvas reads its colours by token, with the light value as fallback

**Date:** 2026-10-24 (1f883916).

## Decision

A canvas reads its colours by token, and its fallback is the token's light
value. `lib/css-tokens.test.js` fails on a token no stylesheet defines and
on a fallback that has drifted from the palette.

## Why

The buffer's playhead drew in an undefined `--ok`'s fallback from the day it
shipped.

## What it rules out

A colour literal in canvas code; a token used before it is defined.
