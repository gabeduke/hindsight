# 0015. The instrument targets the Pi 5

**Date:** 2026-10-26 (`docs/plan/the-instrument.md`, *Decisions*).

## Decision

The instrument's target is the Pi 5. The Pi 4B stays supported: the same
build, with larger buffers if its numbers say so, never a fork.

## Why

The spec gives the target, not its reasons; the performance mode's numbers
are chosen from step 1's measurements on both Pis.

## What it rules out

A Pi 4B fork; tuning the performance path for the Pi 4B first.
