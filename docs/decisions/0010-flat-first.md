# 0010. Flat first

**Date:** Recorded 2026-10-15 (the rooms specs, 821f184e); reaffirmed
2026-10-24 (`the-studio-space.md`).

## Decision

The app draws in DOM, SVG and canvas. three.js is only for the Rig, loaded
lazily, behind a flag, as one pinned ES module under
`web/static/vendor/three/`. The studio as a place is CSS 3D transforms and
View Transitions on the compositor, not a 3D engine.

## Why

No bundler and no CDN, a mid-range tablet's main thread, and a page that
must stay smooth while it feeds a phone's stream.

## What it rules out

A 3D engine for the rooms; three.js loaded eagerly or outside the Rig.

## See

`docs/architecture/css-and-motion.md`, *The scene contract*
