# Extra inputs: a second interface that only records

**Status: decided, not built (2026-11-02).** Gabe handed the implementation
calls to the agents; decisions 1 and 3–7 are settled as written below.
Decision 2 is his wiring, so it is the recommendation, his to change.
The build waits for its place in the queue (`STATE.md`).

On 2026-11-02 Gabe chose the Zoom AMS-24 as the Interface in Settings to get
his guitar in. The capture fell back to the EP-136 (it wants 8 channels), the
tape's output moved to the AMS-24 and stalled, and ▶ did nothing. That bug is
its own fix. This is what he wanted instead, in his words: *"I don't want to
listen to audio through the Zoom AMS, I just want to read in audio to the
Hindsight audio bus."*

So:

- **The EP-136 stays the main interface**: the tape plays out of it, it is
  the monitor, its 8 inputs are channels 1–8, and its clock is the ring's.
- **The AMS-24's 2 inputs join the bus** as channels 9 and 10: in the ring,
  in a take, and as sources a catch or ● Rec can take from.
- **Nothing ever plays out of the AMS-24.** Its playback endpoint is never
  opened.
- **The rig draws the AMS-24's USB into the kit**, input only.

## Where things are today

- The capture opens one PortAudio input (`DEVICE_MATCH`, `CHANNELS`) and
  one writer goroutine owns the ring (`docs/architecture/capture.md`). The
  callback never blocks; a stall of 2 s restarts the source; a rescan
  (`paLifecycle.Rescan`) is the only way to see a replugged device, and it
  closes **every** open stream.
- The tape's output opens on the capture's own card and nothing else
  (`internal/audio/outpick.go`); Δ is measured between that output and the
  EP-136's taps, which share one crystal (`docs/architecture/tape.md`,
  *Alignment*).
- `TAPE_SOURCES` and `SAVE_CHANNELS` are 1-indexed channels of the one
  interface. A mono source is already expressible as `gtr=9,9`.
- The rig draws one interface (`Role: "interface"`, `interfaceDevice` in
  `internal/rig/graph.go`); any other card shows up only by its MIDI port.
  `internal/rig/profiles/zoom-ams-24.json` is a placeholder with no USB id
  and no taps.
- `internal/audio/resample.go` is a windowed-sinc resampler for phone
  recordings, at a fixed integer ratio.

## Read off the Pi (2026-11-02, read-only)

| | EP-136 | AMS-24 |
| --- | --- | --- |
| USB id (`/proc/asound/card*/usbid`) | `2367:9420` | **`1686:067f`** |
| ALSA card id | `EP136` | `AMS24` |
| USB controller | `xhci-hcd.0` | `xhci-hcd.1` (its own: no shared bandwidth) |
| Capture | 8 ch, S32_LE, 48 kHz only, async | **2 ch, S32_LE (24 bits used), 44.1/48/88.2/96 kHz, async**, channel map FL FR |
| Playback | 4 ch, 48 kHz | 4 ch (altset 1) or 2 ch (altset 2) — never opened |
| MIDI port (`amidi -l`) | `EP-136 MIDI 1` | `AMS-24 ZOOM AMS-24 Reserved Por` (a reserved port: no musical MIDI) |

The Pi is a Pi 5 with 8 GB; Hindsight averages about 2% of one core; no
under-voltage, `get_throttled=0x0`. Not yet confirmed: that capture channel 1
is IN 1 and 2 is IN 2 (FL FR suggests it; it needs a signal into IN 1 alone
and a look at the meters), and the power budget with phantom power on (a
guitar doesn't need it: leave it off).

## Decisions

Settled unless marked otherwise. An alternative named under one is what
was weighed and left.

### 1. The EP-136 is the clock; the AMS-24 is resampled into it

Two USB interfaces run on two crystals, ±50–100 ppm apart: left alone, the
AMS-24's channels would slide up to 90 ms against the EP-136's over a
15-minute ring, and a catch from the guitar would land late on the tape.

- **The ring's frames are the EP-136's.** The AMS-24 opens as a second input
  stream, at 48 kHz, with its own clock bridge (`ClockBridge`, as every
  stream has).
- **An adaptive resampler** turns its frames into EP-136 frames: the
  `resample.go` kernel, its ratio steered rather than fixed. The ratio starts
  from the two clock bridges (their slopes over the last ~30 s) and is
  trimmed by how full the hand-over FIFO is, slowly (a time constant of
  seconds) and within ±200 ppm, which is 0.35 cents: no audible wobble.
- **The extra channels are written behind the head, aligned.** The ring
  writer stays the one writer. Each EP-136 block goes in at the head, as now;
  the resampled AMS-24 frames for the *same moments* (placed by the two
  bridges) go into channels 9–10 a fixed `L` behind it, about 150 ms (one
  EP block plus the AMS stream's latency plus slack). So in the ring, frame
  *n* is the same instant on all ten channels, to within the bridges'
  few milliseconds. The cost: the newest `L` of channels 9–10 is not
  written yet; readers of an extra channel stop at head − `L` (see 4).
- **The offset left over** (the two ADC and USB paths' different delays,
  which the bridges can't see) is measured once and kept as a Pi setting,
  `EXTRA_INPUT_OFFSET_MS`, unless decision 2's wiring lets it be measured
  all the time.

**When one side fails:**

- *The AMS-24 overflows, stalls or is unplugged*: the EP-136 and the tape
  never notice. Channels 9–10 are written as zeros and the span is marked
  as an extra-input gap (as `Dropouts` marks the capture's); a catch from
  an AMS-24 source across a gap is refused, as a span with a slip is today;
  a take records its gaps. The resampler re-seeds when frames come back.
- *Replugging the AMS-24*: PortAudio can't see it again without a rescan,
  and a rescan closes the EP-136's stream too: a hole in the dashcam, the
  one failure that can't be repaired. **So the extra input opens through
  ALSA directly** (`hw:CARD=AMS24`, found by its USB id), outside
  PortAudio, so a replug is just an open that starts working again, with no
  rescan. (Left: PortAudio, where a replugged AMS-24 would come back only
  at the capture's next rescan or a restart.)
- *The EP-136 overflows or is unplugged*: as today, the capture restarts;
  the ring doesn't advance, so nothing is written to 9–10 either, and the
  joiner re-places itself from the bridges when the ring moves again.
- *The EP-136 is absent and the AMS-24 present*: nothing records, because
  the main interface is the clock. (Left: the AMS-24 recording alone,
  which would make the ring's clock change with what's plugged in.)

### 2. How Gabe hears the guitar (recommended; his wiring, his to change)

The Pi never monitors. Two ways, both outside Hindsight. Nothing in the
build depends on which, except how the offset is measured (step 5):

- **Recommended: AMS-24 DIRECT MONITOR on, its OUTPUT A into the
  Sidekick's AUX.** The guitar is then in the Sidekick's MAIN, heard with
  everything else, and also lands on channels 7–8 (`aux`). That's hardware
  passing audio through, not Hindsight playing out of the AMS-24. And it
  gives the offset for free: the guitar on 9 and the same guitar on 7–8 can
  be correlated, as the tape's Δ is, so `EXTRA_INPUT_OFFSET_MS` locks and
  stays locked.
- Headphones on the AMS-24's PHONES jack, with direct monitor on. Then the
  offset is measured once by hand (a clap into both), and the Sidekick's
  mix doesn't have the guitar in it.

LOOPBACK must stay off (it would mix the computer's playback into the
recording; with nothing played to it this is moot, but say so on the rig).
MUSIC mode, not STREAMING, so IN 1 and IN 2 stay apart.

### 3. Numbering and naming

- **Extra channels number on from the main interface's**: the EP-136 is
  1–8, the AMS-24 9–10. One numbering for the whole bus, everywhere a
  person types a channel.
- **The ring is sized for the extra input while it is unplugged**: the
  numbering never moves with what's plugged in, and 9–10 are silence
  until it is.
- **`SAVE_CHANNELS`** is checked against 10, not 8: `9,10` keeps the
  AMS-24's pair; `SAVE_ALL_CHANNELS` writes all ten. `SetChannels`'s fall-
  back counts the extra channels too.
- **`TAPE_SOURCES`** gains two mono sources, one per input: `ams1=9,9
  ams2=10,10`, hearing no bus (the tape never reaches the AMS-24, so they
  are always clean). While `TAPE_SOURCES` is the default, they're added to
  it when an extra input is set, as `FitSources` trims it for a smaller
  interface today. A rig label (`rig.json`, "guitar") names them on screen,
  as it does the Sidekick's jacks.
- **The profile's taps stay device-relative** (`in1` is the AMS-24's USB
  channel 1); the rig adds the main interface's channel count when it
  matches them to sources.

Two mono sources, since the guitar is mono. A stereo `ams=9,10` can be
added to `TAPE_SOURCES` by hand if a stereo synth ever goes into it.

### 4. What reads the extra channels late

Only readers that want the newest audio see `L`:

- **A catch or ● Rec from `ams1`/`ams2`** waits until head − `L` has passed
  the span's end (at most 150 ms longer than a catch from the Sidekick).
- **A take or KEEP** already runs late by the capture's latency
  (`save.go`); it waits for `L` too when it includes 9–10.
- **The meters and the ribbon** for 9–10 take their levels from the AMS-24's
  own callback, as the capture's do, so they move at once.

### 5. Settings

A Pi setting (shared, applied on restart: [0050](../decisions/0050-per-device-switches-and-pi-settings.md)),
in the *Input* group, right after *Interface*:

- **Interface** stays what it is, and its help says what it means now:
  *"The main interface: the tape plays out of it, and its clock is the
  ring's."*
- **Extra inputs** (`EXTRA_INPUTS`): a choice of the other cards with
  inputs that are plugged in (`ListInputs` already lists them), or *none*.
  Help: *"Records its inputs too, as channels after the main interface's.
  Nothing plays out of it."* One extra interface for now; the setting is a
  list so a third card needs no new setting.
- `DEVICE_MATCH=auto` never picks the extra input, and choosing one card as
  both is refused by `Check`.
- The output never opens on an extra input's card: `pickOutput` already only
  matches `DEVICE_MATCH`'s card; a test pins it.

### 6. What the rig draws

- **The AMS-24 is a device of its own, role `input`** (beside `interface`,
  `midi`, `kit`, `listener`), found by its USB id, with its MIDI port folded
  into the same box (the profile's `match.midi` "AMS-24" matches the port).
- **Its USB cable goes to a kit socket of its own**, `kit.usb.<id>`,
  labelled *USB IN*, fixed, writing `EXTRA_INPUTS`: *"USB audio: 2 in,
  resampled onto the EP-136's clock; channels 9–10. Nothing plays out."*
- **Its IN 1 and IN 2 show the tap they land on** (`kit.tap.ams1`,
  `kit.tap.ams2`), as the Sidekick's jacks do; its outputs are drawn
  unwired, *"Hindsight never plays here."*
- When it's set but unplugged, the box is drawn dimmed with the cable
  pending, as a pending setting is today; while the resampler hasn't locked,
  the cable says so.

**The profile, filled in** (`internal/rig/profiles/zoom-ams-24.json`):
`match.usb` `"1686:067f"`, `match.midi` `"AMS-24"`, `rate` 48000, `format`
`S32_LE`; taps `in1` `usb:[1,1]` from `in1` and `in2` `usb:[2,2]` from `in2`,
`hears` none; **no `returns`**, on purpose; `hardware.usb` `captured`; the
settled `unknowns` deleted; `hindsight.behavior` and its note rewritten for
the extra input. `placeholder` is dropped once IN 1 = channel 1 is
confirmed with a signal.

### 7. The Pi 5's budget

- **CPU**: the second input stream, at `INPUT_LATENCY_MS` 100, about 1% of
  a core, as the first; the resampler, 2 channels × 48 kHz × 48 taps ≈ 5 M
  multiply-adds a second, well under 1%; levels and envelope for two more
  channels, a quarter more of that work. Under 3% of one core in all,
  against about 2% now.
- **Memory**: the ring grows by a quarter, 1.38 GB → 1.73 GB at 900 s
  (int32 × 10 channels). Fine on the 8 GB Pi; on the 4 GB kit it isn't set,
  and the Settings sheet's memory line already says what the ring takes.
- **Latency**: nothing anyone hears changes; the Pi never monitors, and the
  tape still plays out of the EP-136. Only a catch from the AMS-24 waits
  `L` (4).
- **USB**: the two are on separate controllers on this Pi; both
  high speed, 2 + 8 channels at 48 kHz is far inside either.

## Build order

Each step its own PR; Go steps run on the Pi before they merge (0026).

1. **The profile** (`zoom-ams-24.json`, as in 6, `placeholder` kept until
   the channel check). Cuts a release; harmless alone.
2. **The steered resampler** (`internal/audio/resample.go`): a ratio that can
   change between blocks, with tests that a ±100 ppm drift held for an hour
   of frames stays within a sample, and that a step in the ratio leaves no
   click.
3. **The extra input** (`internal/audio`): `EXTRA_INPUTS` in config and
   Settings; a second input on its own supervisor that never rescans,
   opened through ALSA directly (decision 1); the
   joiner in the ring writer, at head − `L`; gaps marked; `Channels` = main
   + extra everywhere the ring is sized; `SAVE_CHANNELS` checked over the
   bus, and the Settings sheet's ring note (`ringNote`) counts them; a demo extra input with a deliberate +80 ppm drift, so the demo and
   CI exercise it. `docs/architecture/capture.md` gets *Extra inputs*.
4. **The tape**: per-source "newest frame" (head − `L` for an extra
   channel); default `TAPE_SOURCES` gains `ams1`/`ams2`; a catch across an
   extra-input gap refused. `docs/architecture/tape.md`, *Sources*.
5. **The offset**: `EXTRA_INPUT_OFFSET_MS`, measured once by hand; and,
   if Gabe wires it as decision 2 recommends, the correlation lock against
   `aux`.
6. **The rig** (`internal/rig/graph.go`, `web/static/lib/rig`): the `input`
   device, `kit.usb.<id>`, its taps; a flow that the demo's rig draws the
   extra input joined to the kit and Settings shows *Extra inputs*.
7. **At the rig**: IN 1 → channel 9 checked with a signal, `placeholder`
   dropped; a guitar caught onto the tape over a 15-minute session lands on
   the bar as a Sidekick input does.
8. **A decision record**: a second interface records, never plays; the main
   interface is the ring's clock.

This spec is deleted when step 8 lands (0057).
