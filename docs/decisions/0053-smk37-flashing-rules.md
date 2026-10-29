# 0053. Gabe's rules for flashing the SMK-37

**Date:** 2026-10-26 (`docs/plan/the-instrument.md`, step 7).

## Decision

Never write the unit's three regions (Bluetooth pairing at 0xC0000, factory
calibration at 0xC1000, the chip key and MAC at 0xFF000); back up the whole
flash twice, and check the dumps match, before anything is flashed; keep the
dumps out of every repo; install m-bootloader before any build of ours, so
there is a way back; flash nothing without Gabe at the keyboard, confirming
each step; the firmware lives in its own repo, a fork of
`m-vave/smk37_open`, not here. The one exception was the first install, over
SMK-37+VA by M-VAVE's own update with no backup first (2026-10-27); the
rules hold for every write after it.

## Gabe's words

On the first install, 2026-10-27: *"I'm really not worried about one
person's failed update"* (the dongle the way back).

## Why

A bricked or recalibrated keyboard is not something software can fix, and
the unit's own regions can't be rebuilt from a build.

## What it rules out

An unattended flash; a write without a matching pair of backups; firmware
sources or dumps in this repo.

## See

`docs/plan/the-instrument.md`, step 7, for the regions and the tools
