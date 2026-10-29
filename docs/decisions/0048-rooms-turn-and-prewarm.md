# 0048. Moving between rooms is a camera turn, and a prewarmed room keeps out of sight

**Date:** 2026-10-25 (c1fd472f), from `the-studio-space.md` (agreed
2026-10-24).

## Decision

A switch between rooms is the router's View Transition, drawn by
`css/rooms-motion.css`; the header and the bar hold still by view-transition
names given only while a switch is drawn. The switch's update only flips
classes and what is shown; a view's `show()` runs after the turn. A view
marked `prewarm` mounts out of sight: no class on `<body>`, nothing in the
header, the dock or the bar but through its slots, nothing to the room
shown. Its `hide()` runs before its first `show()`, so every show puts back
what hide put away, and what it runs outside `ctx` stops in hide and starts
in show.

## Why

Work done while the page turns holds up the turn's first frames on a tablet.
Capture once came up with dead meters on its first visit, and asked for its
ribbon once a second from every other room.

## What it rules out

Heavy work in the switch; a prewarmed mount touching the room shown; a timer
outside `ctx` left running while hidden.

## See

`docs/architecture/shell.md`, *Moving between rooms*
