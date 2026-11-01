# 0066. Open's selection bar docks above the bar

**Date:** 2026-10-30, settled by recommendation in PR #220
(`the-studio-space.md`, step 10), not built there: Gabe may overrule it.

## Decision

While a selection is held on Open, its ends, length and Clear dock above
the bar, as the Studio's action bar does. GRAB and KEEP stay under the
waveform, where they already say what they do to the selection
(*GRAB SELECTION*, *KEEP 41s*).

## Why

So that no verb is on the screen twice. The Studio already docks its action bar above
the bar; Open does the same.

## What it rules out

GRAB and KEEP repeated in the action bar; a selection bar of Open's own
design.

## See

`docs/plan/the-studio-space.md` (the Open row); `docs/plan/STATE.md`.
