# 0016. Measure latency in use, first

**Date:** 2026-10-26 (`docs/plan/the-instrument.md`, *Decisions*).

## Decision

The instrument's first step is instrumentation, not a bench: every control
carries its times through the engine to the moment it is heard, and the app
keeps the numbers, on the Pi, never sent anywhere else. Every later step is
judged by them.

## Gabe's words

*"there is quite a bit of latency which makes it more of a novelty than an
actual instrument"*; *"instrumenting the app so we get these measurements
through usage."*

## Why

Played from a phone, the effects lagged enough to be a novelty rather than
an instrument, and the times were known only from the code's constants.

## What it rules out

Choosing the performance mode's buffers, priorities or kernel in advance of
the numbers; sending the numbers off the Pi.
