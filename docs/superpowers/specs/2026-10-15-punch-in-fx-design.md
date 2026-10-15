# Punch-in FX and tape mods (P4)

**Date:** 2026-10-15 · **Status:** proposed; the direction is agreed in
[Two rooms and a rig](2026-10-15-rooms-design.md) · **Repo:** `hindsight` ·
**Canvas:** *Studio · performing* on the *Play & FX* page of
[Hindsight — Room, Studio & Rig](https://claude.ai/artifact/Ls32s93iBGoT7jUcHQb54Y)
· Builds on [the sound spec](2026-10-14-play-mode-sound-design.md). Brings in
two things it left out: wow, flutter and saturation, and MIDI-driven amounts.

## Why

The tricks move the tape's read head. That covers half of what the OP-1
Field's tape and the K.O.'s punch-in FX do. The other half is sound:

- **effects you hold** and let go: a filter sweep, a beat repeat, a delay
  throw, a crush;
- **the character of the tape**: wow, flutter, saturation, a dull top end.

Gabe asked for both by name, *"punch in fx and tape mods"*. The earlier
specs agree on where they belong:

- the tape spec's *software FX per track… rendered in the same render-ahead
  path*;
- Play mode's *tape styles… are a property of a tape rather than a thing you
  hold*.

## What

### Two families

| | Punch-in FX | Tape mods |
|---|---|---|
| **What** | ROLL, FILTER, ECHO, CRUSH, and the varispeed bend | Formula, WOW, FLUTTER, DRIVE, AGE |
| **Played** | Held, quantised like a trick, with an amount | Latched: set and left |
| **Belongs to** | Nobody: playback state | The tape: saved in it |
| **Undo** | Never | Yes: one entry per gesture |
| **In a mixdown** | Refused, as tricks are | Printed, because they are the tape's sound |
| **Keys and MIDI** | T Y U I, notes 46–49, velocity, CC1 or aftertouch, pitch bend | CC 21–24; program change 0–3 for the formula |

### Where they sit

Today's playing path in `advance` (`engine.go`) is `perf.render` (tricks) or
`m.render`, then `renderClick`, then `ToInt32`. The new stages go between the
tape and the click, so **the click stays dry**:

```
read head ─→ mix ─→ tape character ─→ punch-in FX ─→ click ─→ ToInt32
tricks, ROLL,  tracks, AGE,              FILTER, CRUSH,  dry
bend, WOW,     mutes,  DRIVE             ECHO
FLUTTER        track keys
```

- **Per channel.** The output is four channels: bus A L/R and bus B L/R. Each
  stage keeps state per channel and treats both buses alike.
- **State crosses splits.** `advance` splits a block at every pending action.
  The stages run per span and carry their state, so a split is inaudible.
- **A late render** (`advance(nil, …)`, the tape counting on with no buffer)
  steps each stage's clock by the frames skipped. An echo's tail is dropped,
  not delayed.
- **Bypass is free.** A stage with nothing engaged, and no tail ringing, costs
  one branch. A tape with no mods and no FX renders exactly as today, sample
  for sample.

### Punch-in FX

Each one is a pad with an id on the play socket, pressed and released like a
trick. It lands on the grid the same way, and is refused in a mixdown the
same way. It carries an **amount**, `v` from 0 to 1:

- read from velocity at the press (`press {pad, q, v}`);
- moved while held by aftertouch or the mod wheel (`set {pad, v}`; see P3).

Amounts aren't quantised. A `set` applies from the next block rendered, and
is heard after the lead, like everything else.

| Pad | Stage | Sound | The amount is |
|---|---|---|---|
| `roll` | read head | Beat repeat: a slice from the grid line where it lands, repeated. CHOP's sibling; CHOP repeats the slice *before* | The slice: under .25 is 1/4, under .5 is 1/8, under .75 is 1/16, otherwise 1/32 |
| `filter` | FX | Resonant low-pass, a state-variable filter per channel. On release it sweeps back open over a 1/16 note, then bypasses | Cutoff, exponential, from open (20 kHz) down to 200 Hz |
| `echo` | FX | A delay throw at 3/16 of a bar (a dotted 8th), capped at 2 s, with 0.55 feedback. Only what plays while held is sent; on release the tail rings out until it is 60 dB down | The send level |
| `crush` | FX | Fewer bits and a lower rate: 12 bits down to 4, the rate down to an eighth | How far |
| `bend` | read head | Varispeed nudge, ±8 % at full bend, while the pitch wheel is off centre. On return the head rejoins the transport, crossfaded over 5 ms, as every trick does | The bend, −1 to 1 |

- **No clicks.** Every engage, release and amount move is smoothed: a one-pole
  over about 10 ms for amounts, and 5 ms crossfades for engage and release.
  These are the same bounds as the trick tests' `maxJump`.
- **They stack.** FILTER under ROLL under REV is three things held. The read
  head composes the head tricks, as `perf.apply` does now, and the FX run in
  their fixed order.
- **"Hindsight is the tape, not the voice"** still holds. The sound spec's
  kinds table puts *slow sweeps: a filter, a tape-style amount* under *ports
  with care*. A sweep you can hear arriving a quarter second late is fine for
  a filter on a loop; it would not be for a lead line.

### Tape mods

- **In the tape's state,** so undo covers them:
  - `Tape.State.Style`: `{formula, wow, flutter, drive, age}`, each amount
    from 0 to 1;
  - `PATCH /api/tapes?id=` `{style: {...}}`, through `Engine.Edit`, like a
    track's gain.
- **One undo per gesture,** not per value:
  - **a drag on screen** previews over the socket (`set {pad: "mod.wow", v}`)
    and commits one PATCH when the finger lifts;
  - **a knob on a controller** previews the same way, and the Pi commits after
    a second without movement.
- **Formulas** are starting points. Choosing one sets the four amounts;
  moving any knob afterwards keeps them, and the formula reads *custom*.

  | Formula | wow | flutter | drive | age |
  |---|---|---|---|---|
  | CLEAN | 0 | 0 | 0 | 0 |
  | CHROME | .1 | .1 | .15 | .05 |
  | FERRIC | .2 | .15 | .3 | .25 |
  | WORN | .5 | .4 | .4 | .6 |

  These values are a first guess, to be tuned by ear on the rig.

| Mod | Stage | Sound |
|---|---|---|
| WOW | read head | A slow, zero-mean wobble in where the head reads: about 0.8 Hz, up to ±0.5 % in pitch. Zero-mean, so the head never drifts from the transport |
| FLUTTER | read head | The same, fast and small: about 8 Hz, up to ±0.1 %, with a little randomness so it doesn't sound like a vibrato |
| DRIVE | tape character | Soft saturation, `tanh(g·x)/tanh(g)` with g from 1 to 10, level-matched. Its aliasing is accepted, as 2×'s is |
| AGE | tape character | The top end falls: a one-pole low-pass from open down to about 4 kHz |

- **WOW and FLUTTER keep the head reading through the Hermite path**
  (`plan → readHead → readRun`) whenever they're up, not just while a trick is
  held. That is the costly part, and the benchmark below has a case for it.
- **The clock, catches and punches don't move.** The transport counts as it
  does under a trick. MIDI clock out and `at` are unaffected, and so is what
  Catch reads: the ring holds the room's sound, mods and all, as with tricks.

## Decisions (recommended picks)

1. **Tape character, then FX, then a dry click.** A tape's sound comes off the
   tape before anything is done to it, and the click is for the player, not
   the take.
2. **ROLL and the bend are read-head tricks,** not DSP: they are cheaper and
   exact, and they compose with what exists.
3. **FX are refused in a mixdown, mods are printed.** FX are the same kind of
   thing as tricks; mods are part of the tape.
4. **One undo per gesture,** with the Pi coalescing a controller's knob after
   a second's quiet.
5. **A CPU budget before merging:** on a Pi 4B, the whole chain (four FX,
   four mods and a trick) renders a block in under a quarter of its 21 ms.
   Measure plain first; if it doesn't fit, WOW and FLUTTER move to a cheaper
   reader before anything is cut.

## Not in this

- **Reverb**, and FX per track: one bus of FX for the whole tape, as the
  K.O.'s punch-in FX work on its output.
- **Tape hiss.** Noise under a loop is tiring; AGE is the top end only.
- **Choosing FX for the four pads.** The four are fixed in v1, as the tricks
  are.

## Checks

The trick tests' methods, extended (`trick_test.go`: the ramp rig,
`firstDiff`, `maxJump`, the random jam):

- **Back to identical:**
  - after an FX is released and its tail has died (FILTER's reopen, ECHO's
    −60 dB), the output is sample-identical to an untouched twin;
  - with every mod at 0, a tape renders bit-identically to today's.
- **No clicks:** `maxJump` across every engage, release and amount step,
  under the existing bound.
- **The shape of each:**
  - FILTER: a sine rig at four times the cutoff is at least 20 dB down;
  - ECHO: an impulse rig returns at 3/16 of a bar, each repeat 0.55 of the
    last;
  - CRUSH: no more than 2^bits levels;
  - DRIVE: always within ±1, and odd harmonics on a sine;
  - AGE: attenuation above its corner;
  - WOW: the ramp rig's read position never strays more than its depth, and
    averages to zero over a cycle.
- **The tape:**
  - FX never write `tape.json` (its mtime is unchanged, as for tricks);
  - mods write it once per gesture, and undo restores them.
- **A mixdown:** FX are refused, and a mixdown with mods is not identical to
  one without.
- **`BenchmarkRenderABlock`:** new cases for each FX, for all four, for mods
  on, and for everything at once.
- **By ear,** on the rig, with the SMK-37: every pad, both ways in (MIDI on
  the Pi and the page), and the formulas tuned.
