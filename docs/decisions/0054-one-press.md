# 0054. One press: the gestures' times are named once

**Date:** 2026-10-24 (a10810b9).

## Decision

The app's hold, tap and double-tap times, and their slops, are named once,
in `GESTURE` (`lib/ui/press.js`). A new key that taps, double taps or holds
is a `pressMachine` / `bindPress`. `architecture.test.js` fails on a hold or
double-tap time written out anywhere else, and lists in `NOT_GESTURES` the
numbers that only look like one.

## Why

A components audit found eleven holds with four thresholds, three slops and
three double-tap rules, each a copy with its own number.

## What it rules out

A gesture time written as a literal; another hand-rolled press machine for a
new key.
