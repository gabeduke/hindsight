# MIDI capture — aligned multitrack MIDI beside every take

**Date:** 2026-09-15 · **Status:** built overnight from the owner's plan, awaiting owner review · **Repo:** `hindsight`

## Goal

One tap saves the last N minutes of a jam as the take it already saves, plus a
Standard MIDI File of everything every connected instrument sent over that same
window, placed on the take's timeline to within a few milliseconds, with a
tempo map so the notes land on the DAW grid. A manifest ties the two together.

This is the owner's *Hindsight MIDI Capture — Build Plan* (2026-09-14) as it
lands in this codebase. The plan was written against an imagined Python daemon
on the ALSA sequencer; Hindsight is a Go binary on PortAudio and rawmidi. The
goals carry over unchanged. Several mechanisms do not, and this document is
where each substitution is argued.

## What the plan asked for, and what this codebase is

| Plan | Reality here | What was built |
|---|---|---|
| Subscribe to the ALSA sequencer's `System:announce` for hotplug | No sequencer client without cgo/libasound; the existing reader is rawmidi (`/dev/snd/midiC*D*`) with no cgo, and that was a deliberate, hardware-verified choice (see the 2026-09-08 spec) | A **watcher** that polls `/dev/snd` for rawmidi nodes every 2 s, opens each new one in its own reader goroutine, and forgets it when its read fails. Same outcome — anything that enumerates gets captured, add/remove mid-session survives — different mechanism |
| Kernel-space timestamps from the sequencer, "do not timestamp in Python userspace" | The concern is GC pauses and scheduler jitter smearing note timing by tens of ms. Go is not Python: a goroutine parked in `read(2)` on a character device wakes on the interrupt path, GC pauses are sub-millisecond, and `time.Now()` carries `CLOCK_MONOTONIC` | **Userspace timestamps at read wake-up, one per read.** Measured cost is wake-up latency, which on a Pi 5 is tens of microseconds idle and low single-digit ms under load. The sequencer route stays open as an upgrade — it is the one substitution that gives up real precision, and it is called out under open decisions |
| `snd_pcm_status_get_audio_htstamp()` anchor, captured once | PortAudio hides the ALSA handle; there is no htstamp to read. And a single anchor is wrong anyway: the interface's crystal and the Pi's clock drift apart by the same ±50–100 ppm the plan warns about for two audio devices, so one anchor taken at stream start is 45–90 ms out by the end of a 15-minute ring | A **clock bridge**: every audio block that reaches the ring records (`monotonic ns`, `ring frame`) into a lock-free history covering the whole ring. A MIDI timestamp becomes a frame by interpolating between the bracketing pairs, so drift is tracked rather than assumed away. Callback-arrival jitter is smoothed by fitting over a local window of pairs |
| Bundle directory per save: `manifest.json`, `session.mid`, per-stem WAVs | Every endpoint, the takes list, the waveform page and the sidecar model address a take by its `.wav` name in one flat directory | **Two more sidecars** next to the take: `jam_<ts>.mid` and `jam_<ts>.manifest.json`. Same lifecycle as `.meta.json` and `.peaks.json`: written after the WAV, deleted with it, pruned with it. Per-stem WAV splitting is not built; see open decisions |
| The Bento is the clock source | Today's tempo estimate comes from the EP-136's inferred clock, and the Bento's MIDI has never been on the Pi | Every device's clock is captured. `MIDI_CLOCK_DEVICE` picks which device's clock drives the tempo map and the BPM stamp; it defaults to `DEVICE_MATCH` so today's behaviour is unchanged until the owner points it at the Bento |

## Architecture

```
Hindsight
├── audio ring          (existing — PortAudio → block pool → ring writer)
├── clock bridge        (new — (monotonic ns, ring frame) history, fed by the delivery path)
├── midi watcher        (new — polls /dev/snd, one reader goroutine per rawmidi node)
│     └── reader ×N     (existing shape: open, drain backlog, read, timestamp, recover)
├── midi event ring     (new — bounded ring of parsed, timestamped, device-tagged events)
├── clock (tempo)       (existing — pulse ring for BPM; now fed by the clock-source device only)
└── saver               (extend — WAV, peaks, meta, then .mid + .manifest.json)
```

Everything MIDI stays behind the same firewall the 2026-09-08 spec built:
**`internal/audio` does not import `internal/midi`.** The saver takes a
`MIDIExporter` interface and calls it inside a `recover`, after the WAV is on
disk. No MIDI failure — missing device, parse error, a panic in the SMF writer
— can cost a recording. The worst case is a take with no `.mid`.

### The reader, per device

`midi.Reader` already does the hard part for one device: find, open, discard
the ALSA backlog, read in a tight loop, timestamp once per read, recover on
unplug. It is generalised in two ways:

- It is given a node path rather than finding one by `DEVICE_MATCH`.
- It feeds a `Parser` that assembles complete messages — with running status,
  with realtime bytes tested first so a clock pulse arriving inside a note-on
  neither corrupts the note nor gets lost — and hands each message to the
  event ring tagged with the device's id and the read's timestamp.

The clock pulses of the clock-source device also go to the existing tempo
`Clock`, exactly as before.

### The watcher

Polls `/dev/snd` for `midiC<card>D<dev>` nodes on a 2-second tick. A node it has
not seen gets a device record — an id that is never reused within a run, the
node path, and a name taken from the card's product string in
`/proc/asound/cards` (`USB-Audio - EP-136` names the device `EP-136`), falling
back to the node's basename for a card the table does not list — and a reader
goroutine. A reader whose read returns an error marks its device gone; the
watcher drops it and will re-add the node if it reappears. A card exposing two
rawmidi devices gets both suffixed (`#1`, `#2`) so their tracks can be told
apart.

**Policy** is two substring lists: `MIDI_DEVICES` (allowlist; empty means
everything) and `MIDI_IGNORE` (denylist). Matching is case-insensitive against
the device name and the node path. The Sidekick's own MIDI port is captured by
default — its knob and FX-pad automation is useful as a track — and
`MIDI_IGNORE=EP-136` turns it off.

**Orchid quirk.** A device that enumerates on USB but never exposes a rawmidi
node is invisible to the watcher, which is the correct behaviour: nothing to
open, nothing to log about, nothing to fail. When it reboots properly a node
appears and is picked up on the next tick.

**Nothing here can touch the audio stream.** The watcher and readers share no
lock with the capture path; the event ring is written only by readers and read
only by a save.

### The event ring

A bounded ring of `Event{NS int64; Device uint16; Status, D1, D2 byte}`, 16
bytes each. Capacity is `MIDI_RING_EVENTS`, default 1,000,000 (16 MB): a
15-minute jam on four devices with one of them spraying 14-bit CC is well under
that; when it overflows, the oldest events go, which is the same policy as the
audio ring.

SysEx is dropped. Nothing on this rig sends a SysEx anyone wants in a DAW, and a
variable-length message would break the fixed-size ring. It is counted, so the
manifest can say how many were discarded.

Clock (`F8`) is *not* stored per event — at 24 per beat from every device it is
most of the traffic and none of the content. Pulses go to the tempo path
instead. Start/Continue/Stop are stored: they carry the downbeat.

### The clock bridge

`audio.ClockBridge` holds a ring of (`ns`, `frame`) pairs, one per delivered
block, sized to cover `RING_SECONDS` at `FRAMES_PER_BUFFER`. The delivery path
(`processAudio`) records a pair only when a block is actually handed to the
ring writer — a dropped block advances neither the frame counter nor the
history, so the pairs stay a true account of what the ring holds.

The recording call uses `TryLock`: if a save is reading the history at that
instant, the pair is skipped rather than the callback waiting. Pairs arrive
forty times a second; one missing is nothing.

`FrameAt(ns)` maps a monotonic timestamp to an absolute ring frame: find the
bracketing pairs by binary search, fit a line through a local window of them
(±16 pairs, about 0.7 s each side), and evaluate. The fit is what removes
callback-scheduling jitter; the local window is what tracks crystal drift over
a long ring.

The bridge also answers `NSAt(frame)`, the inverse, which is what places the
window's start on the timeline.

### Timestamps

Every MIDI timestamp is `time.Now()` at the moment a read returns, taken once
per read and shared by every byte in it. `time.Now()` in Go carries a monotonic
reading; the bridge stores the same. Wall clock is never used for alignment.
The 2026-09-08 spec's wall-clock BPM path is untouched, and unaffected by this.

The pipeline latency — PortAudio's `INPUT_LATENCY_MS`, one block of
`FRAMES_PER_BUFFER`, the hand-off — means a block's pair is recorded later than
the audio it holds was heard. That is a constant, and it is what
`MIDI_LATENCY_MS` exists to absorb (see calibration). It is written into the
manifest as `latency_correction_ms` so a bundle records what was applied.

### Tempo map

The clock-source device's pulses define the beat: 24 pulses is one quarter
note, 40 ticks at PPQ 960 is one pulse. Every stored event's tick is its
position among those pulses — pulse index times 40, plus a linear
interpolation inside the pulse. Between two pulses the DAW's tempo is whatever
makes those 40 ticks take exactly the measured time.

Written literally, that is one tempo event per pulse, tens of thousands in a
long take, and a jagged tempo lane nobody wants. So pulses are grouped into
**segments**: a segment is extended while a single straight line through its
pulses keeps every pulse within 2 ms of where the line says it is. A steady
clock yields a handful of tempo events; a ritardando yields more. Either way,
converting any tick back to seconds lands within 2 ms of the real moment,
which is the only property that matters for the audio to line up.

**Downbeat.** MIDI Start (`FA`) means the next pulse is beat 1 of bar 1. The
tempo path tracks pulses since the last Start; the manifest records where the
first downbeat inside the window falls, in frames and in ticks, and the take's
`.meta.json` gets `downbeat_frame` set to it if the sidecar has none — so the
waveform page's grid and the DAW agree. Without a Start in living memory, the
phase is unknown and nothing pretends otherwise: bar 1 is declared to be the
take's first frame, the first pulse sits as many pulses into it as its arrival
time says at the run's tempo, and `downbeat.source` says `window-start` rather
than `midi-start`. The EP never sends Start — it has no transport — so with it
as the clock device that is the normal case until the Bento takes over.

**Fallback.** No pulses in the window, or a gap longer than 250 ms between two
pulses (below 10 BPM — a stopped clock, not a slow one): that stretch is written
at a fixed 120 BPM, so ticks are effectively absolute time at 1.92 ticks per
millisecond. The manifest's `tempo_source` is `"midi-clock"` when the whole
window was clocked, `"fallback"` when none of it was, `"mixed"` otherwise.

**Bar-snapped windows.** Found while building: a DAW's bar 1 is tick 0, and
audio dropped at the project start begins there, so a take that begins
mid-bar cannot be laid on the grid — its first downbeat would need a lead-in
at an absurd tempo (a first pulse 20 ms into the window, 95 pulses into its
bar, needs 3800 ticks in 20 ms: 7000 BPM), and DAWs clamp imported tempos,
shifting everything after the clamp. That is the common case, not an edge:
every full-ring save starts wherever the ring happens to start. So the save
itself asks the exporter for the last downbeat the ring still holds and
starts the take there. The take is up to one bar longer than asked; tick 0
is bar 1; the downbeat goes into the sidecar for the waveform page. A
whole-ring save, which cannot go back, moves forward to the first downbeat
instead. Without a Start in living memory the phase is unknown and nothing
moves. `MIDI_SNAP_BARS=false` turns it off; then the lead-in is bent only as
far as 480 BPM, after which bar alignment is given up for beat alignment, and
then for none, and the manifest's `downbeat.aligned` says which.

### SMF

Format 1, PPQ 960. Track 0 is the conductor: a time signature of 4/4 (nothing
on the wire says otherwise), the tempo map, a marker at every Start seen. Tracks
1..n are one per (device, channel) pair that has at least one event, in device
order then channel order, each opening with an `FF 03` name like `Orchid ch1`
or `EP-136 K.O. Sidekick ch1`. Channel demux happens here, at write time,
so Reaper, Logic and Ableton all show the same layout with no import dialog.

Note-ons left hanging at the end of the window get a note-off at the last
tick, so a DAW does not render a note that lasts forever. Note-offs whose
note-on fell before the window are dropped.

### Manifest

`jam_<ts>.manifest.json`:

```json
{
  "version": 1,
  "take": "jam_2026-09-14_201342.wav",
  "midi": "jam_2026-09-14_201342.mid",
  "window_seconds": 900,
  "sample_rate": 48000,
  "ppq": 960,
  "window_start_monotonic_ns": 0,
  "latency_correction_ms": 0.0,
  "tempo_source": "midi-clock",
  "clock_device": "EP-136 K.O. Sidekick",
  "downbeat": {"frame": 0, "tick": 0},
  "devices": [
    {"id": 1, "name": "Orchid", "node": "/dev/snd/midiC3D0", "events": 1204, "channels": [1]}
  ],
  "tracks": [
    {"track": 1, "device": "Orchid", "channel": 1, "events": 1204, "notes": 602}
  ],
  "dropped": {"sysex": 0, "overflow": 0}
}
```

The take is the WAV that already exists; stems are that file's channels. The
plan's per-stem layout is deferred (open decisions).

### Configuration

| Variable | Default | What it does |
|---|---|---|
| `MIDI_CAPTURE` | `true` | Capture MIDI events at all. `false` keeps only the existing tempo path |
| `MIDI_DEVICES` | *(empty)* | Comma-separated substrings; if set, only matching devices are opened |
| `MIDI_IGNORE` | *(empty)* | Comma-separated substrings; matching devices are never opened |
| `MIDI_CLOCK_DEVICE` | `DEVICE_MATCH` | Substring picking whose clock is the tempo source |
| `MIDI_RING_EVENTS` | `1000000` | Event ring capacity |
| `MIDI_LATENCY_MS` | `0` | Constant added to every MIDI timestamp before it is placed on the audio timeline; positive moves notes later |
| `MIDI_SNAP_BARS` | `true` | Start a take on the last downbeat before the requested window (see below) |

### API and UI

`Take` gains `has_midi`; `/api/download?file=<take>.mid` serves the file
(`.mid` and `.manifest.json` join `.wav` and `.mp3` as addressable sidecar
types); the takes list shows a **MIDI** download beside **WAV** when the file
exists. `/api/status` gains `midi_devices`, the list the watcher currently
holds, so a phone can confirm the Orchid actually came up as a MIDI device
rather than a power sink.

## Failure behaviour

- A save never fails because of MIDI. The exporter runs after the WAV, peaks
  and meta are on disk, inside a `recover`.
- No devices, no events, or no bridge history in the window: no `.mid`, no
  manifest, one log line, a normal take.
- A device unplugged mid-window: its events up to that point are in the ring
  and in the file. The reader's goroutine exits on the read error and the
  watcher drops the device.
- A device that never exposes a node: never seen, never logged.
- The event ring overflowing: oldest events lost, counted in the manifest.
- Demo mode: a synthetic MIDI source plays the 96 BPM loop's kick and hat as
  notes with clock, so `--demo` produces a real `.mid` and the export path is
  exercised in CI with no hardware.

## Calibration

`scripts/midi-calibrate.py <take>.wav` reads the take and its `.mid`, finds
each note-on (filtered by channel, note or track if asked), looks for the
earliest significant transient within a window of it in the loudest audio
channel, and prints the median offset and its spread. Play something
percussive from one instrument with nothing else running, save, run the
script, put the number in `MIDI_LATENCY_MS`. Positive means the audio landed
after the MIDI, which is the normal case; the manifest records what was
applied, so the script prints the new total rather than a delta. Against the
demo, whose MIDI is derived from the same frame counter as its audio, its
median reads within a couple of milliseconds of zero; the spread is wide
because the demo never plays an isolated hit.

## Open decisions for the owner

1. **ALSA sequencer timestamps.** The one place this build gives up precision
   against the plan. Wake-up jitter under load is low single-digit ms; if the
   calibration script shows a spread wider than that, the fix is a cgo
   `libasound` sequencer client behind the same `//go:build cgo` seam
   PortAudio uses. Not built; the readers are structured so it slots in.
2. **Which device is the clock.** Defaults to the EP so nothing changes
   tonight. The plan says the Bento; set `MIDI_CLOCK_DEVICE=Bento` once its
   device port is confirmed to send clock to a host.
3. **Per-stem WAVs and a bundle directory.** Not built. It changes the take
   model that every endpoint and the waveform page depend on. The `.mid`
   aligns to the existing WAV, which already holds every channel under
   `SAVE_ALL_CHANNELS`. A `/api/bundle` zip of WAV + MID + manifest would be
   cheap if one download is what matters.
4. **SysEx.** Dropped and counted. Say so if something on the rig sends SysEx
   worth keeping.
5. **Time signature.** Hardcoded 4/4 in the conductor track; there is nothing
   on the wire to read it from.
6. **Bar-snapped windows.** On by default because the alternative is a `.mid`
   whose bars are wrong in the common case. It changes what "last 30 s" means
   by up to one bar. Say so if the exact length matters more than the grid.
7. **Cuts.** Built after all: a cut takes the region of its source's `.mid`
   with it, re-based, with the source's tempo lane. Its bars are wherever
   the region's start put them — the manifest reports the first true bar
   line rather than pretending — because a region is chosen by ear. Snapping
   a cut's start to the grid would be the waveform page's call, not this
   one's.

## Still to verify on hardware

Unchanged from the plan's section 9: Bento device-port MIDI-out on current
firmware; whether it echoes KeyStep notes or only its own sequencer; Orchid
boot-then-connect ordering; the MPC's channel layout; the hub's power budget.
Plus one this build adds: the calibration number, and whether its spread says
the sequencer upgrade is needed.
