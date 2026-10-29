# 0017. The SMK-37 runs firmware of Hindsight's own

**Date:** 2026-10-26 (`docs/plan/the-instrument.md`, *Decisions* and step
7).

## Decision

The M-VAVE SMK-37 Elite gets firmware of our own, in a track of its own and
a repo of its own (`gabeduke/smk37-hindsight`, a fork of
`m-vave/smk37_open`): display, transport, FX, arranging, and its sound
engine over the tape. The keyboard is the hands and a screen to glance at;
the Pi is the brain. Until it lands everywhere, the stock firmware and the
controller profile (`internal/rig/profiles/smk-37-elite.json`) keep working.

## Gabe's words

*"transport, effects, clip arranging, and it even has its own audio engine
to play on top of our tape."*

## Why

A box you play needs a real-time control surface, and the SMK-37 has the
screen, pads, encoders and its own synth for it.

## What it rules out

The firmware's sources in this repo; a Hindsight that only works with the
custom firmware.

## See

`docs/architecture/keyboard.md`
