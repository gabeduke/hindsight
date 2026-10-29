# 0052. The SMK-37's frames are at most 512 bytes

**Date:** 2026-10-29 (#202).

## Decision

A BATCH frame to the SMK-37 is at most 512 bytes (`MaxFrame`,
`internal/surface`): half the firmware's 1,024-byte mailbox.

## Why

On the unit, over the Pi's USB MIDI, the keyboard took a BATCH of 624 bytes
(acked in 2 ms) and silently lost one of 764 or more; from a Mac 953 got
through, paced by macOS at about 250 ms. None of it showed in the simulator.
A lost frame looks like a dead keyboard: after three tries the Pi forgets it
and takes the screen again, blank.

## What it rules out

Sizing frames by the mailbox alone; trusting the simulator for the link.
Where frames are lost is still to be measured
(`docs/plan/the-instrument.md`, step 7, *Next*).

## See

`docs/architecture/keyboard.md`, *Learnt on the unit*
