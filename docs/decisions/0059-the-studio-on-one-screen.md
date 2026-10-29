# 0059. The Studio on one screen

**Date:** 2026-10-22 (`the-studio-on-one-screen.md`, agreed with Gabe);
built 2026-10-29.

## Decision

On a touch screen a track's head holds what a jam needs: its name, ● a
finger wide, its input and ›, which opens the track's inspector, where M,
S and the level are. With a mouse they stay in the head. On a tablet the
Studio, at rest, holds no more controls than its budget (`STUDIO_BUDGET`
in `scripts/flows/layout.mjs`, checked by J1.16), next to none under
32 px, and all four tracks above the bar. The budget's numbers only go
down.

## Gabe's words

*"moving unnecessary buttons into drawers or menus and focusing on the
handful of main user flows."*

## Why

On the tablet the Studio had 65 controls on screen, 30 of them under
32 px, and 1½ of its 4 tracks above the bar; each track's ●, M, S and
input chip were 26×30 px, the jam's own targets. What serves catching,
building and jamming stays on screen; the rest goes one tap away, never
out of reach.

## What it rules out

A new control in a track's head on a touch screen (it goes in the
inspector); raising `STUDIO_BUDGET` to let a change through
([decision 0021](0021-exceptions-are-gabes-decision.md)).

## See

`docs/architecture/tape.md`, *The track heads*; J1.5 and J1.16 in
`docs/flows.md`.
