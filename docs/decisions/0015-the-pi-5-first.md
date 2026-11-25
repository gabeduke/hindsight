# 0015. The instrument targets the Pi 5

**Date:** 2026-10-26 (`docs/plan/the-instrument.md`, *Decisions*); narrowed
to the Pi 5 alone by Gabe on 2026-10-28, recorded 2026-11-24.

## Decision

The instrument's target is the Pi 5. Latency, buffer and headroom decisions
consider only the Pi 5. A Pi 4 runs the same build, untuned, never a fork.

## Gabe's words

*"ignore the pi4 and only consider the pi5"*

## Why

The main rig is a Pi 5, and the Pi 4's headroom was being used as a reason
to keep latency high.

## What it rules out

A Pi 4 fork; sizing a buffer or choosing a default for the Pi 4.
