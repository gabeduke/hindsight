# 0001. The devices it is designed for

**Date:** Recorded 2026-10-19 (`docs/plan/STATE.md`, 3b59409b).

## Decision

The main device is an Android tablet, used by tap and stylus; the iPad is
second; the laptop is for desk work; a phone is for recording and for the
tape upstairs.

## Why

How the app is used. So every layout, target size and gesture is judged on
the tablet first. The flows run on a tablet profile and a desktop one
(`docs/flows.md`), and a frame's budget is set by a mid-range Android tablet
(`docs/architecture/css-and-motion.md`, *A frame's budget*).

## What it rules out

Designing for the desktop and shrinking down; a control that only works with
a mouse or a hover.

## See

`docs/flows.md`, *Who and where*
