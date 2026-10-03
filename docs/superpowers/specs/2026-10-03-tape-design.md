# Tape — layered loops on the Pi, played back through the Sidekick

**Date:** 2026-10-03 · **Status:** design, awaiting owner review · **Repo:** `hindsight`

## Goal

OP-1-style tape built from the rig that's already here. Play something, put it
on tape, hear it come back through the mixer, play over it with the next
instrument, put that on tape too. Copy and splice bars into a song. Run it all
from the phone, with the audio staying in the jam space.

The bedtime-Orchid session is the test case, and it hits three walls today:

1. **The Orchid sleeps after five minutes**, and the moment goes with it.
2. **The Orchid has one engine.** Chords and a lead can't sound at once.
3. **Variations.** A good loop needs to grow into a part with changes, and step
   sequencing is too rigid for that.

The idea that makes this cheap: the Pi already holds the last 15 minutes of
every Sidekick input in RAM. Tape is built *on* that ring rather than beside
it. Recording to tape means copying bars out of the ring, so it can happen
after the fact. Playback goes back into the Sidekick over the four USB channels
mapped this morning, onto the two channel strips, so the tape is mixed and
effected on hardware with real knobs.

## A session, start to finish

1. Orchid in jack 2, Bento in aux ([the patch](#the-patch)). Open the tape
   page on the phone. A new tape has four empty tracks, all on bus A.
2. Play the Orchid until a progression sounds right. Nothing is armed;
   Hindsight is recording everything, as it always is.
3. **Lift the first loop.** Tap where the progression starts and again where it
   comes round. The taps snap to the attacks on channel 2, the loop starts
   playing out of strip 1 in phase with you, and its length sets the tempo.
   The tempo is a label you can change afterwards — 4 bars at 84 or 8 at 168 —
   because nothing is stretched. Prefer starting from a tempo? Set one, and
   the Pi plays a count-in and click on bus A; after a few passes, tap
   *Lift ▸ 4 bars*.
4. **The Orchid can sleep now.** The chords are on tape. Wake it, switch to a
   bass voice and play along. Every pass of the loop is already in the ring,
   and the passes row shows the last eight. Tap the one you like and it becomes
   track 2. One synth, many tracks.
5. **Guitar** into jack 2 through a pedal or DI ([why](#hardware-notes)). Tap
   *Rec* on track 3; it punches in at the next loop start and out at the loop
   end.
6. **Variations** (phase 2). Multiply the four bars to eight, overdub a change
   in bars 5–8, copy the eight into a longer section, mute the chords for a
   breakdown, splice.
7. **FX.** Strip 1's FX knob is the tape's FX send from day one. Phase 3 has
   the Pi recall each bus's strip settings with the tape; phase 4 loops your
   knob moves.

## What the Sidekick gives us

From [sidekick-routing.md](../../sidekick-routing.md), measured this morning:

| Direction | USB channels | Lands in / carries |
|---|---|---|
| Playback | 1/2 (`1 L/R`) | **CH1 strip**, before the CH1 tap, then MAIN |
| Playback | 3/4 (`2 L/R`) | **CH2 strip**, before the CH2 tap, then MAIN |
| Capture | 1/2 | MAIN: everything, after the faders |
| Capture | 3/4 | CH1 tap: jack 1 + playback 1/2, before the fader |
| Capture | 5/6 | CH2 tap: jack 2 + playback 3/4, before the fader |
| Capture | 7/8 | AUX jack only; digital zero when idle |

Four facts shape everything below.

1. **Two hardware buses.** Bus A is playback 1/2 into strip 1; bus B is
   playback 3/4 into strip 2. Each strip has its own gain, EQ, compressor,
   fader and FX (six types), and the strips take MIDI CC for all of them (the
   guide's incoming CC table). So each bus is a real FX send with hands-on
   control. Two is this interface's limit.
2. **A strip that carries tape can't be recorded clean.** The return enters
   the strip *before* the tap, so the CH1 tap contains bus A and the CH2 tap
   contains bus B. AUX never contains either. MAIN contains everything. The
   engine knows which bus is sounding and labels each source clean or not.
3. **The Pi can hear itself.** The returns reach the taps digitally, linearly,
   with no bleed (below −120 dB). So the Pi can find its own output in the
   ring, to the sample. That's how playback and capture are lined up
   ([alignment](#alignment-the-pi-hears-itself)) without a calibration step.
4. **The strips add gain to the returns.** They read +1.1 dB and +2.7 dB at
   the taps this morning, and a hot live source already clipped at the CH2
   tap. A full-scale loop sent back in would clip, so tracks start at −6 dB.

### The patch

| Input | Plug in | Records as |
|---|---|---|
| Jack 1 | nothing — strip 1 is tape bus A | — |
| Jack 2 | the instrument being layered now: Orchid, guitar (through a DI), GO:KEYS | `ch2`, clean while bus B is silent |
| Aux | Bento | `aux`, always clean. No fader, so set the level on the Bento (this morning's aux test source came in at −50 dBFS RMS) |

Every track defaults to bus A, so `ch2` stays clean however many layers there
are. Bus B is spare: useful for a second FX treatment while arranging, at the
price of making `ch2` not clean while it sounds. A two-tape-bus patch, with aux
as the only clean live input, is a config change. Jack 1 can still take
something you only ever want in the mix, never on tape.

## Principles

- **Recording to tape is lifting from the ring.** There is one write path:
  copy a range of absolute ring frames, for one stereo source, into a new file
  that never changes. *Lift the last 4 bars*, *keep pass −3* and a punch-in are
  all that. A punch is just a lift scheduled for when the punch ends. This is
  what makes a lost moment recoverable and punch recording almost free.
- **The Pi never monitors.** Live instruments are heard through the Sidekick,
  in hardware, with no latency. The Pi only plays tape, which is known in
  advance, so it can render ahead behind generous buffers. The 1%-of-a-core
  stance behind `INPUT_LATENCY_MS` carries over to output.
- **Tape can never cost a recording.** The capture path changes in three
  small, named places — a shared PortAudio lifecycle, reading PortAudio's
  status flags, and a range copy that picks one pair — and with `TAPE=false`
  it runs exactly as today. Tape reads the ring in bounded chunks, recovers its
  own panics, never memory-maps a file that could vanish, and drives its output
  stream under its own supervisor. If the tape engine falls over, the dashcam
  keeps rolling.
- **Quantized by default.** A phone on Wi-Fi jitters by tens of milliseconds.
  Every tape action lands on the next bar, beat or loop start, and the Pi
  executes it at that exact frame. The one action that needs human timing is
  the first loop with no grid, and that snaps to the attacks you played.
- **Non-destructive.** Recordings are immutable files. A track is a list of
  regions pointing into them. Copy, splice and undo are edits to a JSON file.
- **One USB clock.** Input and output both run off the Sidekick's crystal, so
  they cannot drift apart. The player opens the capture's ALSA card or
  nothing. A second USB interface for more buses would add a second clock, and
  drift, and this design doesn't do that.

## Architecture

```
Hindsight
├── audio      (existing, extended)
│     ├── capture         PortAudio input → block pool → ring writer → Ring (8 ch, 900 s)
│     ├── Sink (new)      output twin of Source: deviceSink (PortAudio), demoSink
│     └── lifecycle       one PortAudio lifecycle and stream registry, shared
├── saver      (existing)  takes, previews, MIDI sidecars
├── midi       (existing)  watcher, event ring, clock with pulse index since Start
│     └── out (new)       rawmidi writer: clock to followers, CC to the Sidekick
└── tape       (new)
      ├── model           tape.json: tempo, loop, tracks, regions, buses, undo
      ├── transport       tape position ↔ output frames, quantized actions, loop cycles
      ├── renderer        regions → bus A/B blocks, rendered ahead
      ├── player          supervises the Sink; history of what was delivered
      ├── aligner         Δ: estimated from the clock bridges, locked by correlation
      └── lifter          ring range → WAV in the tape's audio dir → region
```

```
   jack 2 ──────────┐
   USB out 3/4 ─────┴──► CH2 strip ──┐
   aux ─────────────────► AUX ───────┼──► MAIN ──► main out (what you hear)
   USB out 1/2 ─────────► CH1 strip ─┘
        ▲
        │            EP-136 USB in: 1/2 MAIN · 3/4 CH1 tap · 5/6 CH2 tap · 7/8 AUX
        │                                       │
   player (new)                     capture (existing)
        ▲                                       ▼
   renderer ◄── tape.json ◄── lifter ◄──────── Ring
        │                                       │
        └────────────────► aligner ◄────────────┘
                  (what bus A played vs the CH1 tap)
```

Everything on the top four lines happens inside the Sidekick, on one crystal.

**Package boundaries.** `internal/tape` imports `internal/audio` and does
**not** import `internal/midi`. What tape needs from MIDI — note-ons to snap a
free loop to, clock out, strip CC — comes through small interfaces that `main`
wires, the same firewall the saver keeps with `TempoSource` and
`MIDIExporter`. The PortAudio sink lives in `internal/audio`, beside
`deviceSource`, because the lifecycle it must share is unexported there.
`internal/audio` also gains `Ring.Range(from, to, pick)`: an absolute frame
range, one channel pair, copied in bounded chunks with the window re-checked
between them. Today's `SnapshotAt` only takes the most recent N frames, of
every channel, under one lock — which for a long lift would be the whole ring
held while gigabytes are copied.

### The player

An output-only PortAudio stream: 4 channels, 32-bit (the only format the
device takes), 48 kHz, on **the same ALSA card the capture has open**, with no
fallback. `pickDevice` falls back to any device for input; for output that
would play the tape out of HDMI on a second clock, so the player refuses
instead.

It is a separate stream rather than a duplex one, because a duplex stream would
tie the dashcam's health to playback's, and the sample lock a duplex stream
buys is what the aligner provides anyway. The routing doc lists `playmap.py`
(which uses `aplay`) as runnable while Hindsight holds the capture; PortAudio
doing the same is on the [verify list](#still-to-verify-on-hardware).

- **The callback never blocks or allocates.** It copies one pre-rendered block
  of 1024 frames (21 ms) from a pool, or writes silence and counts a late
  render when none is ready. It also reads PortAudio's status flags, so a
  device-level output underflow is known.
- **It runs all the time,** playing silence while the transport is stopped, so
  the alignment survives stop and play.
- **The renderer keeps five blocks ready** (107 ms). Behind that is
  PortAudio's own `OUTPUT_LATENCY_MS`, default 100, for the same busy-poll
  reason as input. A change takes about a quarter of a second to reach the
  speaker; quantized actions hide that as long as they arrive before the
  renderer reaches their boundary, and a later one waits for the next. Stop
  and mute also have an *immediate* form: it flushes the blocks not yet
  delivered and lands within that quarter second.
- **A delivered-output history.** The player keeps the last four seconds of
  what the callback actually delivered, keyed by output frame. That, not what
  was rendered, is what the aligner correlates against, because an immediate
  stop throws rendered blocks away.
- **Its own clock bridge.** Each delivered block records a
  `(monotonic ns, output frame)` pair with the same `TryLock` rule. The
  pipeline latency is *subtracted* here: the existing `FrameAt` adds it, which
  is right for input and backwards for output.

**One PortAudio lifecycle.** `paLifecycle` wraps a process-global library, and
today each `deviceSource` builds its own. It becomes one shared object with a
registry of open streams and one lock held across every open, close and
rescan, plus a generation counter. `Rescan` closes every registered stream
before `Pa_Terminate`, which would otherwise close them underneath their
owners and leave a dangling stream pointer for a later `Close` to free twice.
A stream opened in an older generation is never touched again. Only the capture
supervisor rescans; the player waits for the new generation and reopens.
`Source.Reset`'s comment that nothing is live during a reset stops being true
and is rewritten.

### The renderer

For each block, for each track, every region overlapping the block's span of
the tape (with the loop wrapped) is summed into the track's bus at the track's
gain and pan. Mixing is float32, converted to int32 with saturation at the end.
Eight stereo tracks at 48 kHz is a few million multiply-adds a second, which is
noise on a Pi 5.

**Edges.** A region's true start and end — where nothing of it continues —
get the 3 ms declick fade cuts use. A *seam*, where a region wraps or tiles
into itself, does not: a fade-out and fade-in there would notch every loop and
tick audibly under a held chord. A seam gets a 5 ms equal-power crossfade
instead, from the audio the lifter kept just past the region's end into its
start.

**Reading audio.** Regions in the loop are preloaded into RAM when the tape
loads — an 8-bar loop is 8.8 MB. Longer regions (phase 2's linear tape) are
read ahead with plain reads, well beyond the render-ahead. Nothing is
memory-mapped: if the SSD is bumped mid-session, a mapped file faults and Go
kills the whole process, ring included. A failed read makes that region
silent and says so on the page. Every tape goroutine runs under `recover`, as
the saver's MIDI steps do.

### Transport and actions

A tape has a loop: a start, a length **in frames**, and a number of bars. The
frame length is the truth and the tempo is derived from it, because tempos
don't divide into whole frames — at 84 BPM a bar is 137,142.857 frames. Bar *n*
of the loop begins at `round(n × length ÷ bars)`. The time signature is 4/4.
Once the tape has audio, the length is fixed; nothing is time-stretched.

The transport anchors the tape position to an output frame and advances one
frame per frame delivered, through late renders too, wrapping at the loop end.
It logs the output frame of each of the last 64 loop-cycle starts, together
with the Δ valid at the time; that log is what *pass −k* reads.

Actions are queued with a quantum — `now`, `beat`, `bar` or `loop` — and the
renderer executes each on the exact frame its boundary falls on. A punch that
is armed when the transport stops is cancelled.

**The click.** With a tempo set, the Pi can play a one-bar count-in and a
metronome on bus A. It's on by default only while the tape is empty. It lands
in MAIN, and so in dashcam takes, like anything else on the strips.

### Alignment: the Pi hears itself

**Δ** is where the tape's output shows up in the ring: the content of output
frame *o* appears in the CH tap at ring frame *o* + Δ. That is what a lift
needs. You hear the tape and your instrument through the same Sidekick output,
and they share every stage after the tap, so a part played in time *by ear*
lands in the tap in time with the tape. No converter correction applies.
`TAPE_LATENCY_MS`, default 0, is for the one case that differs: hearing the
instrument directly, from its own speaker, rather than through the Sidekick.

- **Estimated, always available.** Both bridges map frames to monotonic
  nanoseconds, so Δ is approximately the ring frame at *t* minus the output
  frame at *t*. That misses the device's internal delays, which the
  correlation measures, so the estimate is corrected by the last lock's
  residual. Before any lock it is good to a few milliseconds.
- **Locked, exact.** While bus A sounds, correlate the last two seconds of
  what was delivered on it against the CH1 tap in the ring, within ±50 ms of
  the estimate. Use a normalised (PHAT-weighted) cross-correlation computed by
  FFT, and accept a lock only for a single sharp peak with a low fit residual.
  A sustained pad, whose correlation repeats every pitch period, is rejected
  rather than guessed at, and so is a strip whose FX smears the peak, if the
  tap turns out to be after the FX. Whatever is plugged into jack 1 doesn't
  hurt: this is a matched filter. Bus B against the CH2 tap works the same
  way. The fit also gives the strip's gain at the tap, so the page can warn
  before the return clips.
- **One lock per session is enough.** Δ only changes when one side loses
  frames the other didn't:
  - capture drops a block at the hand-off (`XRuns()` moves: the device moved
    on and the ring didn't);
  - ALSA reports an input overflow or output underflow (the status flags,
    newly read);
  - or a stream restarts.

  A late render isn't one of these: the callback still delivered a block, on
  time. Δ is kept as segments over output frames, so a pass from before a shift
  uses the Δ that was valid when it played. While bus A sounds, the lock is
  re-checked continuously. The page shows *locked*, *estimated* or *none*.

A lift of the tape span played at output frames [*o₁*, *o₂*) copies ring frames
[*o₁* + Δ, *o₂* + Δ) of the source pair, plus `TAPE_LATENCY_MS` if set, using
the Δ segment covering each end.

### Lifting

**Sources** are named capture pairs, each tagged with the buses that leak into
it: `main` (1/2, both buses), `ch1` (3/4, bus A), `ch2` (5/6, bus B), `aux`
(7/8, none). A source can also name the MIDI device that plays into it
(`ch2` → `Orchid`), which helps the free loop find attacks.

| Lift | Range |
|---|---|
| **Last N bars** | Ends on the last bar line played, and waits until the ring holds it (150–250 ms behind real time). A tap up to 250 ms *before* a bar line means that bar line: people tap on the downbeat, and Wi-Fi delivers late |
| **Pass −k** | The k-th most recent complete loop cycle, from the cycle log |
| **Punch** | *Rec* arms for the next loop start and ends at the loop end. A punch left running for several cycles keeps the last full one; the others are passes. A bar-quantized partial punch (bars 2–3) also works |
| **Free** (no loop yet) | Two taps, timestamped when they reach the Pi — the phone's clock isn't trusted. Each snaps to the strongest attack in the source between 250 ms before the tap and 50 ms after; note-ons from the source's MIDI device, if it names one, point at the attack, which is then refined on the audio. The span becomes the loop. Its bar count defaults to whatever puts the tempo nearest the last tape's, or 90 BPM, and the page offers the alternatives. Playback starts in phase, as if the loop had been playing since the second tap |

**Placement.** A lift sits at the position in the loop cycle where it was
played, wrapping across the seam if it did, so a punch of bars 2–3 lands on
bars 2–3. In phase 1 a lift can't be longer than the loop; a shorter one can be
set to *tile* (one bar repeated through four). Longer lifts need *multiply*
(phase 2).

**What gets written.** The range, plus 10 ms of overhang either side for seam
crossfades, streamed chunk by chunk from `Ring.Range` into a 32-bit stereo WAV
in the tape's `audio/` directory, with its peaks. Nothing the size of the range
is ever held in memory. Names follow the saver's rule: a second lift in the
same second gets `_2`, so an immutable file is never overwritten.

**Seams.** Every pass after the first starts with the previous pass's ringing
tails — close to what will ring into it when it loops — so a steady-state pass
loops almost seamlessly, and the crossfade covers the rest. The very first pass
has nothing ringing into its start, which is why a later pass often loops
better than the one where you found the part.

**Rules.**

- Lifting `ch2` while bus B sounded in that range is allowed and flagged.
  Sometimes printing the tape and the live part together is the point.
- Lifting `main` is a bounce: it prints the strips' EQ and FX as you heard
  them.
- Onto a track that already has audio, a lift adds a **layer**: summed, with
  its own gain, undoable. *Replace* clears the range first.
- Every region has a ± millisecond nudge, for a part that was early or late on
  purpose, or a lift made without a lock.

### Storage

```
TAPE_DIR (default ~/hindsight/tapes — put it on the SSD)
└── 2026-10-03_bedtime/
    ├── tape.json
    └── audio/
        ├── lift_2026-10-03_201512.wav          immutable: stereo, 32-bit, 48 kHz
        └── lift_2026-10-03_201512.peaks.json
```

`tape.json`, in outline:

```json
{
  "version": 1,
  "name": "bedtime",
  "sample_rate": 48000,
  "loop": {"start": 0, "frames": 548571, "bars": 4},
  "tracks": [
    {"n": 1, "name": "chords", "bus": "A", "gain_db": -6, "pan": 0, "mute": false,
     "regions": [
       {"file": "audio/lift_2026-10-03_201512.wav", "src": 480, "frames": 548571,
        "at": 0, "layer": 0, "gain_db": 0, "tile": false, "nudge_ms": 0,
        "source": "ch2", "clean": true, "aligned": "locked"}
     ]}
  ],
  "history": []
}
```

`src` skips the 10 ms of overhang at the file's start. `tape.json` is rewritten
after every operation: written to a temporary file, synced, renamed, and the
directory synced. Undo keeps the last 100 versions of the track list in
`history`; dragging a gain or pan is one step, not a hundred. Audio that
neither the current state nor the history references is deleted only when you
ask for a clean-up, never automatically. `MIN_FREE_GB` guards lifts as it
guards saves (HTTP 507), checked on `TAPE_DIR`'s volume rather than
`OUTPUT_DIR`'s.

What it costs:

| | Size |
|---|---|
| Stereo, 32-bit, 48 kHz | 384 KB/s · 23 MB/min · **1.38 GB/hour** |
| An 8-bar loop at 84 BPM (22.9 s) | 8.8 MB |
| A 4-minute song, 4 tracks fully recorded, 2 layers each | about 740 MB, worst case. Loop-built songs are far smaller, because copies point at the same files |
| 1 TB SSD | about 720 hours of stereo tape |
| RAM | the loop's regions, preloaded: megabytes. The 1.3 GB ring is unchanged |

Takes share the disk at the same rate; `SAVE_ALL_CHANNELS` takes are four
times it. Archiving finished tapes to FLAC would roughly halve them, and waits
until disk actually matters.

### Buses and strips

A bus is a playback pair. Each track is assigned to A or B; the Pi mixes the
tracks of a bus with their gain, pan and mute, and the strip does EQ,
compression, FX and the fader.

**Phase 3 makes the strips part of the tape.** The Pi writes CC to the
Sidekick's MIDI port to recall each bus's scene: fader (CC 7), gain (20), pan
(10), EQ (22/23/24), compression (12), saturation (13), FX amount (1), FX type
(program change 1–6) and FX parameter (pitch bend). MIDI channel 1 is strip 1
and channel 2 is strip 2. The guide's outgoing table has the Sidekick sending
its own knobs and faders as CC, and Hindsight already captures its port, so
the Pi can learn each strip's state as you touch it and save it with the tape —
if the Sidekick sends those while its mixer is in use (verify).

**Phase 4 loops the moves.** It records the knob moves made during a loop
cycle and plays them back every cycle: FX automation per bus.

### Clock

Today `MIDI_CLOCK_DEVICE` names whose clock the takes follow. With tape, the
question is who leads.

- **Lead — recommended.** The tape's tempo is the master. The Pi sends 24-ppq
  clock, Start at bar 1 and Stop to the devices in `TAPE_CLOCK_OUT`. Pulses
  are computed from output frames through the output bridge and sent early by
  the output latency, so they arrive with the audio they belong to, plus a
  per-device nudge. A free loop's tempo — 83.73 BPM, say — is fine, because the
  followers take whatever arrives. The Orchid can't follow a clock and doesn't
  need to: it's audio on tape. This works with no Bento at all.
- **Follow.** The tape locks to an external clock and Start. The existing
  `Clock` already tracks the pulse index since Start; the capture bridge maps
  those pulses to ring frames, and Δ maps them to output frames. A tape made
  in follow mode takes the clock's tempo and grid, so its first loop is lifted
  by bars rather than free. The loop re-anchors to the external bar line at
  each cycle's start. Crystal drift between two devices (±100 ppm at worst) is
  about 2 ms over a 22-second loop, and the correction happens inside the seam
  crossfade. A tempo change on the Bento means a new tape, since nothing is
  stretched.
- **Free.** No clock out. The tape is the grid.

With the tape leading, the saver's bar snap (today the MIDI exporter's
`BarSnapper`) asks the transport instead, so dashcam takes land on the tape's
bars and their `.mid` carries the tape's tempo.

### The phone page

`web/static/tape.html` plus a `lib/tape/` folder of vanilla modules, no build
step, linked from the main page. It reuses the waveform page's geometry and the
existing `PeakData`. Live state comes over a WebSocket at about 25 frames a
second: position, the armed track, pending lifts, bus and source meters (from
the existing `channel_rms`), lock state and the passes.

```
┌──────────────────────────────────────┐
│ bedtime ▾          84 BPM · 4 bars ● │  ● alignment locked
│ ▕█████▏░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  whole tape, loop bracketed
│ 1 chords ▆▅▇▆▅▇▆▅▇▆▅▇▆▅▇▆▅▇▆▅  A  M  │
│ 2 bass   ▃▂▃▅▃▂▃▅▃▂▃▅▃▂▃▅▃▂▃▅  A  M  │  lanes on the bar grid,
│ 3        ····················  A  M  │  playhead across them
│ 4        ····················  A  M  │
├──────────────────────────────────────┤
│ source   ch2 ●   aux ○   main        │  ● sounding and clean
│ [ ▶ ]  [ ● REC ]  [ LIFT  1 2 4 8 ]  │
│ passes  ▁▃▅ ▁▃▅ ▁▃▅ ▁▃▅ ▁▃▅   −5…−1  │  tap one to keep it
└──────────────────────────────────────┘
```

Tap a lane to select and arm it. Long-press a region for its gain, nudge and
layer. Drag along a lane to select bars, which opens the edit sheet (phase 2).
The transport buttons are thumb-sized, and each source chip shows whether it's
sounding and whether it's clean.

### API

Following the existing style: query parameters, JSON bodies. Everything lives
under `/api/tapes`, kept clear of the existing `/api/take`. One tape is
*loaded* — the one the transport plays — and every action names its tape and
is refused for any other.

| Method | Path | Does |
|---|---|---|
| `GET` | `/api/tapes` | Every tape with its size on disk; with `?id=`, one tape |
| `POST` | `/api/tapes` | New tape: a name, optionally a tempo and bars |
| `PATCH` | `/api/tapes?id=` | Name, loop bars, click, track settings, a region's gain, layer or nudge |
| `DELETE` | `/api/tapes?id=` | Delete a tape and its audio |
| `POST` | `/api/tapes/load?id=` | Make it the loaded tape |
| `POST` | `/api/tapes/transport?id=` | `play`, `stop`, `locate`, with a quantum |
| `POST` | `/api/tapes/tap?id=` | A free-loop tap, stamped on arrival |
| `POST` | `/api/tapes/lift?id=` | Track, source, then `bars` or `pass`; `layer` or `replace`; `tile` |
| `POST` / `DELETE` | `/api/tapes/record?id=` | Arm a punch; cancel or end it |
| `POST` | `/api/tapes/undo?id=`, `/api/tapes/redo?id=` | |
| `POST` | `/api/tapes/cleanup?id=` | Delete audio nothing references |
| `GET` | `/api/tapes/peaks?id=&file=&from=&to=&buckets=` | A region's peaks, as `/api/peaks` does for takes |
| `GET` | `/api/tapes/live` | WebSocket: transport, meters, lock, passes |
| `POST` | `/api/tapes/edit?id=` | Phase 2: copy, cut, paste, duplicate, reverse, clear, multiply over bars and tracks |
| `POST` | `/api/tapes/import?id=` | Phase 2: a region of a take onto a track — *Send to tape* from the waveform page |
| `GET` | `/api/tapes/export?id=` | Phase 2: a zip of per-track stems from bar 1, a mix, and a `.mid` with the tempo |

### Configuration

| Variable | Default | What it does |
|---|---|---|
| `TAPE` | `false` | Turns on the tape engine and the output stream. Off by default, so a rig that only wants the dashcam never opens playback |
| `TAPE_DIR` | `~/hindsight/tapes` | Where tapes live. Put it on the SSD |
| `TAPE_TRACKS` | `4` | Tracks in a new tape |
| `OUTPUT_CHANNELS` | `4` | Playback channels opened |
| `OUTPUT_LATENCY_MS` | `100` | Same reasoning as `INPUT_LATENCY_MS` |
| `TAPE_BUSES` | `A=1,2 B=3,4` | Bus → 1-indexed playback pair |
| `TAPE_SOURCES` | `main=1,2:AB ch1=3,4:A ch2=5,6:B aux=7,8` | Source → capture pair and the buses that leak into it; `@device` names the MIDI device that plays into it (`ch2=5,6:B@Orchid`) |
| `TAPE_LATENCY_MS` | `0` | Added to Δ only if you hear the instrument directly rather than through the Sidekick |
| `TAPE_PEDAL` | *(empty)* | `device:cc` or `device:note` that acts as the tap and Rec button (phase 3) |
| `TAPE_CLOCK` | `free` | `lead`, `follow` or `free` (phase 3) |
| `TAPE_CLOCK_OUT` | *(empty)* | Substrings naming the devices that get clock in lead mode |
| `TAPE_STRIP_CONTROL` | `false` | Send CC to the Sidekick to recall bus scenes (phase 3) |

The defaults are the Sidekick map from this morning, so on this rig only
`TAPE=true` and `TAPE_DIR` need setting.

## Failure behaviour

- **Tape off, or crashed:** Hindsight is exactly today's Hindsight.
- **No output device, or the wrong one:** the player retries with backoff and
  the page says so. Lifting and editing still work; you just can't hear the
  tape.
- **A rescan:** both streams close; the player reopens in the new generation
  and Δ re-locks.
- **A late render:** silence for one block, counted; Δ is unaffected.
- **An underflow or overflow at the device:** Δ starts a new, unlocked segment
  and re-locks at the next stretch of sound.
- **The SSD disappears:** regions that can't be read go silent and the page
  says so. The process, and the ring, carry on.
- **A range the ring no longer holds** (a pass more than 15 minutes old):
  refused, with a message saying so.
- **Low disk:** a lift is refused with 507, like a save.
- **The phone disconnects:** nothing changes. The Pi keeps looping.
- **The Pi restarts:** `tape.json` was synced after every operation; the
  transport comes up stopped.
- **No lock:** lifts go ahead on the estimate, are marked, and can be nudged.

## Testing and the demo

The demo source and demo sink share one frame counter, so their offset is
fixed and known. With tape on, the demo models the Sidekick: bus A appears in
channels 3/4 and MAIN, bus B in 5/6 and MAIN, and AUX is digital zero, in
place of the faint copy of the loop the demo writes to unsaved channels today.
So `--demo` runs the whole tape path in CI with no hardware, and the aligner's
test is to recover that offset exactly. Beyond that:

- the renderer places regions to the sample, wraps the loop, fades true edges
  and crossfades seams;
- bar boundaries round consistently for tempos that aren't whole frames;
- the transport executes queued actions on their frame and advances through
  late renders;
- Δ segments are honoured for a pass recorded before a shift;
- `Ring.Range` copies correctly across chunk boundaries while the ring keeps
  writing;
- every model operation round-trips through undo.

## Phases

**Phase 1 — Loop and layer.** The session above, through step 5.

- The shared lifecycle and stream registry, `Sink`, the player, and the demo
  loopback.
- `Ring.Range` and the lifter.
- `tape.json` with undo.
- The transport with its loop, quantized actions and click.
- The aligner, estimated and locked.
- Lifts — by bars, by pass, free and punched — with placement, tiling, layers
  and nudge.
- Tracks with gain, pan, mute and bus.
- The tape page.

**Phase 2 — Splice.** A linear tape longer than the loop, with the loop as a
bracket on it. Copy, cut, paste, duplicate, reverse and clear over bar ranges
on one track or all of them; multiply; *Send to tape* from the waveform page;
export as stems plus `.mid`.

**Phase 3 — The brain.** The MIDI out writer; clock lead and follow; takes
snapped to tape bars; strip scenes over CC; the pedal.

**Phase 4 — Play with the sound.** Non-destructive software FX per track —
filter, tempo-synced delay, reverb, saturation, reverse, speed — rendered in
the same render-ahead path, so they change while the tape plays. Bouncing a
track or bus, including through the strips via `main`. FX automation looped
from Sidekick knob moves. Listening from elsewhere in the house: a compressed
stream of MAIN to the phone. FLAC archiving.

## Hardware notes

- **An SSD for `TAPE_DIR`.** A USB 3 SSD or an NVMe HAT on the Pi 5. At the
  rates above, 500 GB to 1 TB is years of tape. The SD card is the wrong place
  for a store that is written on every lift.
- **A DI for the guitar.** The Sidekick's channel inputs are line level at
  10 kΩ (the guide's spec). A passive guitar pickup wants something near 1 MΩ
  and sounds dull and quiet straight in. Any buffered pedal, amp modeller or DI
  with a line out in front of jack 2 fixes that.
- **A MIDI footswitch.** A USB MIDI pedal puts Rec and the free-loop taps
  within a few milliseconds and keeps your hands on the instrument.
- **More buses, later.** If two hardware buses and the clean-input rule start
  to pinch, the upgrade is one bigger interface with more returns — one clock —
  rather than a second interface beside the Sidekick. Buses and sources are
  configuration, so the engine moves over without code changes.

## Open decisions for the owner

1. **Who leads the clock.** The 2026-09-14 plan made the Bento the clock
   source. For tape I'd flip it and let the tape lead. The Orchid can't sync
   either way; a leading tape is sample-exact, and it works without the Bento
   in the room. The Bento keeps its sequencer and follows. *Follow* stays
   available for when a Bento song is the arrangement.
2. **The patch:** tape on strip 1, live instruments on jack 2 and aux, every
   track on bus A, bus B spare.
3. **How a tape starts:** free first loop by default, or a click and a tempo.
4. **Overdub default:** layer (summed, undoable) or replace. Layer is
   recommended.
5. **Four tracks or eight.** The OP-1's four keeps the phone page readable;
   eight costs the engine nothing.
6. **Loop length fixed once a tape has audio,** with no stretching.
7. **Phase order.** Splicing comes before clock as written. Swap them if the
   Bento's drums need to sit under the tape soon.

## Still to verify on hardware

1. **Where the returns come out** — main out, cue, or both. Already open in the
   routing doc. This design assumes main out, which the MAIN capture suggests.
2. **Whether the CH taps are before or after each strip's EQ and FX.** That
   decides whether `ch1` and `ch2` lifts are dry, which matters for changing
   the sound later, and whether strip FX can blur the aligner's peak.
3. **Whether the Sidekick obeys incoming CC in its normal mode,** and whether
   it sends its knob CCs then. The forum report says control mode disables the
   mixer and FX; phase 3 needs neither direction to require it.
4. **Whether the Orchid sends the notes you play over USB,** which the free
   loop uses to find attacks. Audio onsets work without it.
5. **Whether the Bento follows clock on its USB device port,** and the MPC
   Sample likewise.
6. **A PortAudio output stream on the EP-136 beside the running capture,** its
   CPU cost, and how often it underflows at `OUTPUT_LATENCY_MS=100`.
7. **A Sidekick button combination that could serve as the pedal** without
   side effects. Holding select while pressing a cue button sends CC 52;
   whether it also toggles cue is unknown.
