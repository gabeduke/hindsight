# Play mode: the tape as an instrument

**Date:** 2026-10-14 · **Status:** proposed to Gabe · **Repo:** `hindsight`

## Why

Gabe, 2026-10-14: *"We have certainly got the DAW feel down."* That's the
problem, stated as a compliment. Hindsight edits beautifully and plays
nothing. Every surface in the app — the action bar, the inspector, the
library, the ⌗ picker — answers the question *what do I want to change?*
None of them answers *what do I want to do right now, while it's running?*

That isn't a polish gap. More easing curves and nicer springs on an editing
surface make a prettier DAW. The OP-1 Field doesn't feel like an instrument
because its animations are good; it feels like one because of four things
Hindsight has none of:

- **Momentary controls.** You *hold* break, reverse, chop. Let go and it's
  gone. Nothing in Hindsight is held — everything is a committed edit with an
  undo entry behind it.
- **One screen, one purpose.** No dialog ever opens over the OP-1's tape.
  Hindsight's tape page is correct and dense and has seven places a control
  can live.
- **The picture is the control.** The OP-1's reels aren't decoration; they're
  the scrub. Hindsight's reels turn, which is lovely, and do nothing.
- **Mistakes land in time.** Quantise means a late hand still sounds right.

The irony is that all of this is already written down — in Gabe's own OP-1
study (`2026-10-03-op1-tape-study.md`), where **trick pads** are called
*"the most performative part of the OP-1"* and adopted outright. Nothing was
built. `grep -i trick` across `web/` and `internal/` returns nothing. So does
`varispeed`. The next level isn't a new idea; it's the one idea in that study
that never got a plan.

## What

**Play mode:** a full-screen performance surface over the loaded tape, behind
a per-device flag. The tape stays loaded underneath; Esc or ⏏ drops back into
editing with the playhead where you left it.

Play mode draws six things and nothing else:

- **Four track keys**, full height, one per tape track. Held = that track
  drops out. This *is* per-track break, and it's the gesture people already
  make on a mixer. Tap-hold-release, never a toggle.
- **Trick pads** along the bottom: **Break**, **Reverse**, **Chop**,
  **Stop** (tape-stop ramp), **½×/2×** (varispeed). All momentary. Break
  keeps the loop running underneath, as the study says.
- **A quantise readout** — next 16th by default, with off / 16th / beat / bar
  behind the same ⌗ key the ruler uses. A pad lights *dim* the instant you
  press it and *bright* on the 16th where it actually lands, so the latency
  you can hear becomes a thing you can see and play around.
- **The loop, as a ring.** The current loop drawn as a circle with the
  playhead sweeping it — the one readout you can follow from across the room
  while your hands are on the Orchid. Bars tick around the outside.
- **The crate's top row as launch pads** (phase 2, below).
- **Nothing else.** No app bar, no inspector, no library. Exiting is the only
  non-musical gesture on the screen.

### One surface, three inputs

The architectural point, and the answer to the keybed question:

```
touch  ─┐
keys   ─┼─→  lib/play/surface.js  ─→  {press,release,pad,at}  ─→  engine
MIDI   ─┘     (one event bus)
```

`surface.js` takes `press(padId)` / `release(padId)` and knows nothing about
where they came from. Touch handlers, a PC keyboard map and — later — Web MIDI
are three thin adapters over the same bus. Quantise, pad lighting, choke
groups and the engine calls all live below the bus, so they're written once.

This is why **no hardware is required now and the SMK-37 costs nothing later**.
When the keyboard arrives, Web MIDI is a ~100-line adapter that calls
`press`/`release`. Not a rewrite, not a second interaction model.

**The PC keyboard map** (fixed in v1, `lib/play/keymap.js`):

| Keys | What |
|---|---|
| `1` `2` `3` `4` | Track keys 1–4, held |
| `Q` `W` `E` `R` | Break, Reverse, Chop, Stop |
| `Z` `X` | ½× , 2× |
| `Space` | Play/stop |
| `A`–`L` | Crate launch pads (phase 2) |
| `Esc` | Leave Play mode |

Momentary = `keydown`/`keyup`, with `e.repeat` dropped. A laptop becomes a
real controller, which is what Gabe asked for and also what makes the thing
testable on a desk with no rig attached.

### The flag

`hindsight.play` in `localStorage`, read through the existing try/catch
pref pattern (`lib/nav.js`, `lib/wave/lanes.js`). **Off by default.** Turned
on under ⋯ → *Play mode (preview)*, which also shows the keyboard map.

Per-device, not a server setting, because that's what the testing situation
calls for: Gabe's brother and brother-in-law pull releases onto their own kits
through the updater. A localStorage flag means every release ships the code
and none of them ever sees it until they choose to. No release gating, no
settings migration, no divergent builds on three Pis. When it's ready the flag
flips to on-by-default in one line, and stays as the escape hatch.

## Decisions (recommended picks, as usual)

1. **Build the trick pads before the launch pads.** Tricks need no new data
   model — they're playback-side effects on a tape that already plays. Launch
   pads need clip→pad assignment, choke groups and a persistence story. Tricks
   give the whole instrument feeling in one PR; pads are phase 2.
   *Alternative: pads first, if the virtual-MPC idea is the thing you actually
   want to be holding.*
2. **Full-screen overlay, not a fourth tab.** The tape stays loaded; Play is a
   state of the tape page, not a sibling of it. Keeps one tape, one playhead,
   one undo stack, and Esc always means "back to editing".
3. **Fixed keyboard map in v1.** Remapping is a settings surface, and settings
   surfaces are what Play mode exists to get away from. Revisit once MIDI
   learn arrives, where remapping actually matters.
4. **Quantise to the next 16th by default**, off available. The study's
   reasoning holds: a phone on Wi-Fi is late, and quantising turns that
   latency into "in time" rather than into a bug report.
5. **Keep the engine honest about what's momentary.** Trick pads are playback
   state, never tape content, and never touch undo. If you want to keep what
   a trick did, that's Mixdown, which already exists.

## Not in this

- **FM-1 custom firmware.** Parked, and worth saying why rather than just
  "later": it's a different product. The FM-1 is a sound source; Hindsight is
  the tape. Custom firmware would make the FM-1 a better FM synth, which
  BaudGirl's firmware already does well, and would not move Hindsight one inch
  closer to feeling like an instrument. The version that *would* earn its
  place is the FM-1's screen and encoders acting as a Hindsight remote — a
  real idea, a separate project, and strictly downstream of the event bus
  above. Nothing here blocks it; everything here makes it cheaper.
- **Web MIDI.** Deliberately not in v1, so that "no hardware required" is
  true and testable. The adapter seam is specified so it stays a small job.
- **Audible scrub on the ring.** The study already skipped audible scrub —
  the render pipeline makes it laggy. The ring is a readout and a silent
  scrub, same as the ruler handle.
- **Tape styles** (wow, flutter, saturation). Separate spec, and they're a
  property of a tape rather than a thing you hold.

## Build order

1. `lib/play/surface.js` — the event bus, quantise clock, pad state. Pure
   logic, fully unit-tested with a fake clock, no DOM.
2. `lib/play/keymap.js` + touch adapter — both calling `press`/`release`.
3. The screen: track keys, trick pads, the loop ring, the ⌗ readout.
4. Engine work in `internal/tape` for break, reverse, chop, stop, varispeed,
   checked for CPU on the Pi 4B (the study flags this for the renderer).
5. Phase 2: crate launch pads, choke groups, pad assignment from the crate.
6. Phase 3 (own session): Web MIDI adapter, SMK-37 and FM-1 as sources.

## Checks

- Unit tests on `surface.js` against a fake clock: a press at 0.49 of a 16th
  and one at 0.51 land on the same grid line; release during the pending
  window still fires a held gesture of the right length; `e.repeat` is ignored.
- Reduced motion: the ring still sweeps (it's a readout, not decoration); pad
  flashes become instant state changes.
- With the flag off, `web/static` ships the modules and no page imports them —
  checked by a test that the tape page's DOM has no `#play-*` node.
