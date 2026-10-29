# 0013. The tape's state is pushed as a nudge, not the state

**Date:** 2026-10-28 (the push spec, da9e8439).

## Decision

The Pi tells a page that the tape changed (`/api/tapes/changes`: the
revision), and the page polls `/api/tapes/state` at once through the poll it
already has. The state itself is sent only if the nudge still feels slow. A
Pi touch display, which would take out the Wi-Fi hop, is parked. The
fallback poll's rate is Gabe's to decide once the push is timed at the rig
(`docs/plan/STATE.md`).

## Gabe's words

J1.14's story: *"could we start pushing state to the UI"* (`docs/flows.md`).

## Why

A tablet following a controller's press waited for its next 200 ms poll, up
to 235 ms; a nudge brings that to about 30–50 ms while the page keeps one
way in for its state.

## What it rules out

A second way for a page to receive the tape's state; a diff protocol before
the nudge is shown to be too slow.

## See

`docs/architecture/push.md`
