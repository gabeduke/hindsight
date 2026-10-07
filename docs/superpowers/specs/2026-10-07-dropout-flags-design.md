# Dropout flags (C4)

**Date:** 2026-10-07 · **Status:** step C4 of the
[DAW-style editing plan](2026-10-07-daw-editing-plan.md), approved by Gabe on
2026-10-07 · **Repo:** `hindsight`

## Why

The capture can lose audio in two ways:

- the interface overruns, because the Pi fell behind reading it;
- the ring's writer falls behind, and a block is dropped.

The main page counts these as *dropped*, but nothing says which takes they
landed in or where. A take with a gap sounds like a glitch in the playing.
A recorder like the Zoom marks where it happened, so you know it was the
machine, and can check whether the take is still usable.

## What

### On the Pi

- **The capture remembers where:**
  - Each dropped block, and each overflow the interface reports, marks a
    dropout at the ring frame where the gap is: the frame after the last
    one handed over.
  - A burst of drops at one frame is one dropout.
  - The interface's count from before the capture first heard from it isn't
    one.
- **Storage:** a fixed ring of the newest 64, written on the delivery
  goroutine without a lock or an allocation (`Capture.markDropout`).
  `Capture.Dropouts(start, end)` answers those strictly inside a span, in its
  frames. A gap at the span's first frame is before it.
- **Saving:**
  - A save, or a span saved from the ring, writes the dropouts inside it to
    the take's sidecar as `Meta.Dropouts` (frames from the take's start) and
    logs them.
  - A cut keeps the ones inside it.
  - `GET /api/take` and `/api/jams` carry them as `dropouts`.
- **Not flags.** The plan said "flags with `kind: "dropout"`". They're kept
  in a field of their own instead:
  - Edits replace a take's flags wholesale (the whole-array PATCH, undo),
    so a dropout among them could be moved, renamed or dropped by an edit
    that never meant to.
  - In their own field, nothing edits them, and they need no exception in
    the 512-flag cap, the flag endpoints or the undo history.
  - On screen they look as the plan said: ⚠, not editable, not counted.
- **The demo** has no interface to overrun. In `--demo`, `SIGUSR1` makes the
  demo source report an overflow, as an interface does (`kill -USR1
  <pid>`). It's a local signal, not an endpoint.

### On the pages

- **The take page:**
  - ⚠ in the ruler, and a dashed line through the waveform, at each
    dropout. Neither can be tapped or dragged.
  - The header line says *⚠ 2 dropouts*.
  - ⚑ N's list (C3) has the dropouts among the flags, in time, as ⚠
    *dropout*. A tap plays from a second before one, to hear the gap.
    ⚑ N's count is flags only.
- **The takes page:**
  - the cassette wears a *⚠ 2 dropouts* sticker by its foot;
  - the pane's line says *⚠ 2 dropouts* after the size and MIDI.
- `dropoutsText` in `lib/shelf.js`, tested.

## Not in this step

- Dropouts on the spines in the list. They're on the cassette, and in the
  pane, when a take is picked.
- Repairing a gap. The audio isn't there, and the take's audio never
  changes.

## Tests

- **Go** (`dropout_test.go`):
  - a dropped block is a dropout where the gap is, with a burst counted
    once and the span's edges excluded;
  - a device overflow is one, but an old count isn't;
  - the ring keeps the newest 64;
  - a save, a range save and a cut carry theirs;
  - the take's JSON has them.
- **Node:** `dropoutsText` in `shelf.test.js`.
- **Smoke:** `smoke-takes.mjs`, given `HINDSIGHT_PID`:
  1. `SIGUSR1`, then capture: the take has one dropout;
  2. its page says so;
  3. ⚑ N lists it without counting it;
  4. the cassette wears the sticker.
- **Guide:**
  - §4: *⚠ Dropouts*, a [demo] check (with `kill -USR1`) and a [rig] check
    (stop the process for a second while it records);
  - §10: a row for *⚠ 2 dropouts*;
  - api.md: `dropouts`;
  - `sw.js` goes to v50.
