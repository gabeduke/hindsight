# Architecture

One Go binary. It opens an audio device, keeps the last `RING_SECONDS` in RAM,
and serves a small vanilla-JS UI. No database, no message broker, no build
step for the frontend.

```
cmd/hindsight        wiring and flags
internal/config      environment → Config
internal/audio       device, ring, levels, envelope, saving  (cgo, PortAudio)
internal/midi        rawmidi watcher, parser, event ring, clock, tempo map, SMF export
internal/smf         Standard MIDI File writer and reader
internal/bundle      writes a take's .mid and manifest from audio's window and midi's events
internal/mono        the one monotonic clock audio and MIDI both stamp with
internal/tape        the tape: model and undo, store and pool, renderer, transport, player, catching
internal/api         HTTP and WebSocket handlers
web/static           the UI, served from disk per request
web/static/lib/wave  the take page: view, geometry, draw, tiles, clock, lanes, page
web/static/lib/edit  the gestures every editing surface shares
web/static/lib/help  tips, help mode, and the guide renderer
web/static/lib/phone the phone recorder
web/static/lib/tape  the tape page
docs/embed.go        the guide, compiled into the binary
```

## Data flow

```
USB audio interface (8ch)                 USB MIDI (every rawmidi port)
   │  PortAudio callback: levels,            │  watcher polls /dev/snd; one reader
   │  then hand off. Never blocks.           │  goroutine per port, timestamped reads
   ▼                                         ▼
free/filled block pool                  parser ──► event ring (notes, CC, transport)
   │  (mono ns, frame) pair ──► clock bridge    └──► pulse ring (clock device only) ──► BPM
   ▼                                                        │
ring writer goroutine ──► Ring (RING_SECONDS)               │
   │                          │                             │
   │ Levels (10ms bins)       │ Snapshot(seconds)           │
   ├──► Envelope (whole ring) │                             │
   ▼                          ▼                             ▼
/api/live   (WebSocket)   WAV ─┬──► _preview.mp3      .meta.json (bpm, flags, downbeat)
/api/envelope (ribbon)         ├──► .peaks.json/.bin  .mid + .manifest.json
                                └──► cue points, written into the WAV itself
```

## The callback never blocks

This is the constraint everything else is arranged around. A PortAudio input
callback that takes too long drops audio, and dropped audio in a dashcam is the
one failure that cannot be repaired afterwards.

So the callback does two cheap things: it accumulates 10 ms min/max/RMS level
bins, and it hands the block to a pooled channel. It never touches the ring, it
never allocates, and it never waits on a lock a slow consumer might hold.

A single writer goroutine owns the ring. Because it is the only writer, a
capture can take the ring's mutex and memcpy a snapshot out — 1.3 GB at the
default settings — without the device ever stalling. The block pool is 64
blocks deep, several seconds of slack at 2048 frames per block, which is what
absorbs the pause while that copy happens.

If the callback stops arriving for two seconds, capture is declared unhealthy
and the supervisor restarts it, backing off from 1 s to 15 s between attempts.

### PortAudio only enumerates once

`Pa_Initialize` builds the device list and never rescans it. An interface that
is powered off therefore stays in that list forever, pointing at an ALSA card
index that no longer exists, and every open attempt fails with "Illegal
combination of I/O devices".

Terminating and re-initialising PortAudio is the only way to see hardware that
appeared or disappeared after start-up. That is what `paLifecycle.Rescan` is
for, and it is why unplugging the interface mid-session and plugging it back in
recovers on its own.

### Input latency

`portaudio.LowLatencyParameters` asks a USB device for a deadline it cannot
meet, and PortAudio then busy-polls — 84% of a core on this Pi, continuously.
A ring buffer has no latency requirement, so `INPUT_LATENCY_MS` is set
explicitly and generously and the draw is about 1%. See "Why
`INPUT_LATENCY_MS` is not small" in [configuration.md](configuration.md).

## The `Source` seam

`audio.Source` is the interface between the capture supervisor and whatever is
producing samples:

```go
type Source interface {
	Open(sink func([]int32)) (name string, err error)
	Close()
	Reset() error
	Shutdown() error
}
```

It exists for two reasons. The supervision logic — restart backoff, staleness
watchdog, block pool — is written once and shared. And every PortAudio symbol
sits behind a `//go:build cgo` tag, so `CGO_ENABLED=0` still compiles and still
runs.

There are two implementations. `deviceSource` is the real interface.
`demoSource` generates a 96 BPM loop that is meant to look like music: an 8-bar
arc, hats, real dynamics. A screenshot of a flat sine would tell a reader
nothing about what the meters, the ribbon or a take actually look like.

The demo is derived from a monotonic sample counter rather than the wall clock,
so the waveform is identical run to run and screenshots are reproducible. It is
what makes `--demo` a genuine test of the whole application rather than a stub:
the same ring, the same saver, the same UI.

## The envelope, and why it is server-side

The buffer ribbon draws the amplitude of the entire ring, on a logarithmic time
axis, at one byte per 10 ms bin.

It has to live on the server. A browser-side ring only fills while the page is
open, and this is something you open *after* the moment — the whole point is to
see what happened while nobody was watching.

The axis is logarithmic because the recent end is where decisions are made, and
a linear 15-minute ribbon gives the last 30 seconds three pixels.
`EdgeSeconds = 10` sets how much width the recent end gets; at 1 s the last 30
seconds took half the ribbon, which is far more than that window needs.

Bins store peak, dB-coded, never mean: a peak survives downsampling where a
mean washes out, and linear amplitude would make everything below about
−20 dBFS look like silence.

## The ffmpeg trap

Previews are built with an explicit channel map, and the reason is worth
keeping:

```
ffmpeg -i take.wav -ac 2 out.mp3      # wrong
```

On an 8-channel file, a bare `-ac 2` makes ffmpeg assume a 7.1 layout. It folds
channel 3 into a mono centre and discards channel 4 entirely as LFE. That is
exactly what made previews sound wrong.

`makePreview` in `internal/audio/save.go` builds a `pan` filter naming the
`SAVE_CHANNELS` indices instead, so the preview is the same pair as the take.
The encode runs under `nice -n 10` so it never competes with the audio thread,
and writes to a `.tmp` before renaming, so a half-encoded mp3 is never visible
to the UI.

## MIDI

Two things happen with MIDI. Each take is stamped with the tempo measured
over its own window, as before; and everything every connected instrument
sent during the window is written beside the take as a Standard MIDI File,
placed on the take's timeline to within a couple of milliseconds, with a
tempo map so the notes sit on the DAW's grid. The design is in
`docs/superpowers/specs/2026-09-15-midi-capture-design.md`.

### Every port, no cgo

A watcher polls `/dev/snd` every two seconds for `midiC*D*` nodes and opens
each one it has not seen in its own reader goroutine, named from
`/proc/asound/cards`. That is the no-cgo stand-in for an ALSA sequencer
`System:announce` subscription, and it gives the same result: anything
class-compliant that enumerates gets read, devices come and go mid-session,
and a device that enumerates on USB without ever exposing a MIDI port — the
Orchid, connected before it finished booting — is simply never seen. Device
ids are never reused within a run, so an event recorded under a device that
has since been unplugged can still be named at save time.

Not finding any device is a normal state, not a failure — everything is
frequently unplugged, and a Mac has no `/proc/asound` at all.

`MIDI_DEVICES` and `MIDI_IGNORE` filter the set; `MIDI_CLOCK_DEVICE` picks
whose clock is the tempo source, and only that device's pulses reach the
tempo path. It defaults to `DEVICE_MATCH` so a rig where the EP is the only
clock changes nothing.

Each reader timestamps once per `read(2)` return, with `time.Now()`'s
monotonic reading, and feeds a parser that assembles complete messages —
running status, realtime bytes tested first so a clock pulse inside a note-on
disturbs nothing, SysEx skipped and counted. Channel messages and transport
go to a bounded ring of 16-byte events; clock pulses go to the tempo ring
and are not stored per event, since at 24 a beat from every device they would
be most of the traffic and none of the content.

**`internal/audio` does not import `internal/midi`.** The saver takes a
`TempoSource` and a `MIDIExporter` interface, each called inside a `recover`
after the WAV is on disk, so no MIDI failure — missing device, parse error,
third-party panic — can cost a recording. The worst case is a take with no
BPM and no `.mid`.

### The clock bridge

The plan called for an ALSA `audio_htstamp` anchor taken once at stream
start. PortAudio does not expose one, and a single anchor would be wrong
anyway: the interface's crystal and the Pi's clock disagree by the same
±50–100 ppm the plan warns about for two audio devices, so an anchor at
stream start is 45–90 ms out by the end of a 15-minute ring.

Instead, the delivery path records a `(monotonic ns, ring frame)` pair for
every block it hands to the ring writer — with `TryLock`, so it never waits
on a reader; a dropped block advances neither the frame count nor the history,
so the pairs stay a true account of what the ring holds. A MIDI timestamp
becomes a frame by a local least-squares fit over the pairs that bracket it
(±16, about 0.7 s each side), which removes callback-scheduling jitter and
tracks the drift rather than assuming it away. A gap of more than two seconds
between pairs is a dropout, and a moment inside it maps to the frame the ring
was at when the gap began. PortAudio's reported input latency is applied so a
moment maps to the frame that was *being converted* then, not the one that
had just been handed over.

What remains after that is the instrument's own latency and the cable, a
constant of a few milliseconds that `MIDI_LATENCY_MS` holds and
`scripts/midi-calibrate.py` measures. Against the demo, whose MIDI is derived
from the same frame counter as its audio, the script's median reads within a
couple of milliseconds of zero.

### The tempo map, and why takes start on a downbeat

The clock device's pulses define the beat: 24 pulses a quarter, 40 ticks a
pulse at PPQ 960. Pulses are grouped into segments of constant tempo, each
extended for as long as every pulse in it stays within 2 ms of the straight
line between its ends, so a steady clock yields a handful of tempo events and
a ritardando yields more, and converting any tick back to seconds lands within
2 ms of the real moment either way. Stretches with no clock are written at
120 BPM and the manifest says so.

A DAW's bar 1 is tick 0, and an audio file dropped at the project start
begins there. A take that begins mid-bar therefore cannot sit on the grid: its
first downbeat would have to be reached through a lead-in at an absurd tempo,
which DAWs clamp, shifting everything after. So with `MIDI_SNAP_BARS` on, a
save asks the exporter for the last downbeat the ring still holds — a pulse
whose index since the last MIDI Start is a whole number of bars — and starts
the take there, trimming the snapshot to the exact frame. The take is up to
one bar longer than asked for, and every bar line in the `.mid` is true. The
downbeat is also written into the take's sidecar so the waveform page's grid
agrees with the DAW. Without a Start in living memory the phase is unknown,
nothing moves, and bar 1 is declared to be the take's first frame — the same
place a snapped window puts it — with the first pulse as many pulses into
that bar as its arrival time says. The manifest's `downbeat.source` says
which convention applied.

Two details that were learned the expensive way:

- **The backlog is dropped.** ALSA starts buffering clock the moment the device
  node appears, and hands the whole backlog over in the reader's first read.
  Those pulses share a handful of arrival times, and the near-zero intervals
  between them drag the rolling median far above the real tempo — three seconds
  after a replug, 223.3 BPM against a true 120. The first 150 ms after opening
  is therefore thrown away.
- **The EP's tempo is a guess, not ground truth.** The EP has no sequencer at
  all. It runs an on-device algorithm that *infers* a tempo and transmits that
  as clock, so there is no project tempo on the wire to be right or wrong
  about. One idle window read 129.87 BPM, rock-steady, against a project set
  to 92; another held 100.67 through a completely silent room; a power cycle
  reset it to 120. Stability is not evidence of correctness, which is the
  whole argument for the BPM field being editable in the takes list — and for
  pointing `MIDI_CLOCK_DEVICE` at a real sequencer once one is on the Pi.

In demo mode a synthetic sequencer plays along with the loop — clock, a
Start, the kick, hat and bass as notes — through the same event ring and
exporter, so `--demo` writes a real `.mid` and the whole path runs with no
hardware. Its tempo tile reads the estimator against that clock rather than a
constant, which is why it says 96.0 and not exactly 96.

## Takes on disk

A take is a WAV in `OUTPUT_DIR` and the sidecars beside it, all sharing its
stem:

| File | Written | Holds |
|---|---|---|
| `jam_<ts>.wav` | at save, cut or the end of a phone recording | The audio, 32-bit, plus RIFF `cue ` points mirroring the flags |
| `.meta.json` | at save or cut, then on every edit | Label, star, selection, tempo, downbeat, flags, lane kinds, creation time, a cut's source |
| `.peaks.json` | at save or cut | 1024 min/max buckets for the whole take, drawn before anything finer arrives |
| `.peaks.bin` | at save or cut; backfilled at startup for older takes | The peaks pyramid: min and max per 256 frames |
| `_preview.mp3` | in the background after a save or cut | What the list plays, and what the waveform page scrubs |
| `.mid`, `.manifest.json` | at save, when MIDI was flowing; a cut gets its region of the source's | The take's MIDI and how it lines up |
| `.history.json` | on every edit a person makes | The last 50 changes, for Undo |

### A take appears only when it's complete

Save and cut write the audio to a hidden `.<name>.part` file, write the
sidecars under the final names, and rename the WAV into place last. The list
only shows `.wav` files, so it never offers a take that is still being
written; a 15-minute save takes long enough that it used to. A take's name
is reserved by creating its `.part` exclusively, so a save and a cut in the
same second can't both write to one file. At startup, a `.part` left by a
crash is removed with the sidecars of the take that never made it, along with
sidecar temp files and any `.meta.json`, `.peaks.json`, `.peaks.bin` or
`.history.json` whose take is gone.

### One writer per take at a time

Every read-modify-write of a take's sidecar holds that take's lock
(`audio.LockTake`, or `audio.UpdateMeta` for the whole cycle): the PATCH, the
per-flag endpoints, the saver's tempo and flag stamps, the MIDI exporter's
downbeat, and `RemoveTake`. The lock also covers rewriting the WAV's cue
chunk, so two cue rewrites never interleave. Before it, two edits landing
together meant the second silently threw the first away. The API handlers
check the take still exists once they hold the lock, so an edit queued behind
a delete answers 404 instead of writing a sidecar for a take that's gone.

Flags carry ids, so an edit names the flag it changes rather than replacing
the list. A flag from before ids reads as `f<frame>`.

### Saving any span of the ring

`Saver.SaveRange` (`internal/audio/saverange.go`) saves absolute ring frames
`[from, to)`, the clock flags already use, so a span picked on the ribbon or
starting at a flag is the audio that was there, however long ago. It reads
through `Ring.Range`: the chosen channel pair only, a chunk at a time under
the ring's lock with the window re-checked before each, and writes as it
goes (`wavWriter`), so a minutes-long span never holds up the ring writer.
`SnapshotAt`, which copies the newest N frames of every channel under one
lock, stays for the capture buttons. The take's name, `created` time and
tempo window come from when its frames were played, through the clock
bridge; MIDI is exported for the span like any save.

### Undo

`internal/audio/history.go`. The API records each edit a person makes -- the
PATCH and the per-flag endpoints, not the saver's own stamps -- as a diff of
the sidecar before and after, under the take's lock: one operation per field
(name, selection, tempo, downbeat, lanes) and one per flag, by id, each with
its JSON value before and after and the device that made it (the pages send
a random per-browser id). The newest 50 are kept in `.history.json`. Each
device's Undo walks back through its own operations only.
A change to the same thing within 2 s, carrying on from where the last ended,
extends that step instead of adding one, so a held nudge undoes in one go;
adding and removing never merge, because a removal's toast needs a step of
its own to undo.

Undo puts an operation's "before" back only while the field still holds its
"after"; otherwise the step is dropped and reported as skipped. The log is
rewritten only after the sidecar, so a failed write keeps the step. That is what
keeps an Undo on one device from overwriting a change made since on another,
and it lets a toast undo its own step by id even after later edits to other
things. There is no redo.

### The trash

`internal/audio/trash.go`. Deleting a take and `MAX_SAVES` pruning both move
the take and its sidecars into `OUTPUT_DIR/.trash/<stem>/` with `rename`,
beside a `trashed.json` saying when and why; restoring moves them back and
stars the take. `takeFiles` is the one list of a take's files that deleting,
trashing and restoring share. Every change to the trash holds one lock
(after the take's own, when both are needed), so emptying can never catch a
take half-moved; a crash half-way leaves sidecars beside a WAV that's in the
trash, and the startup sweep puts them back with it. A new take never gets
the name of one in the trash, and a delete never replaces one there. A janitor empties trash older than 7 days, at
startup and every 10 minutes, and `EnsureFree` empties it oldest first while
free space is under `MIN_FREE_GB`; every write that refuses for low disk (a
save, a cut, a phone recording) calls it first, so the trash is never why a
capture fails. Nothing in the trash is hard-linked, so emptying it frees what
it says.

### When a take was made

The list sorts, and the pruner trashes, by the `created` time in the
sidecar. A take older than that field falls back to the time in its name,
then to the file's modification time. Modification time alone was wrong:
rewriting the cue chunk on a flag edit made an old take look new.

### The list is cached

`/api/jams` is polled every five seconds by every open page. It now costs one
directory listing: each take's signature is the size and modification time of
its WAV and sidecar, the sidecar's inode (every sidecar write is a new file,
so two same-size edits within one clock tick still differ), and which other
sidecars exist, all from that one listing. Takes are cached by signature, and the ETag is a hash of the
signatures, so an unchanged list answers 304 without opening a file, and a
changed one re-reads only the takes that changed.

### The peaks pyramid

The waveform page asks `/api/peaks` for ranges as it zooms. Zoomed out on a
long take, a range spans minutes of audio, and answering it from the WAV
meant reading most of the take off the SD card. The pyramid holds min and max
per 256 frames, per channel, as int16 (about 1.3 MB for a 15-minute stereo
take). Any request whose buckets are at least 256 frames wide is answered
from it; deeper zooms read the WAV, which is a short read at that zoom
anyway. It is built in the same loop that writes the WAV, so it costs no
extra read, and it is checked against the take's channels and length before
use. Takes older than the pyramid get one in the background at startup.

### Phone recordings

A phone records into `/api/phone` (`internal/api/phone.go`), and the take is
written as the audio arrives (`internal/audio/phone.go`):

- **Name first.** The take's name is reserved when recording starts, from
  the start time, so the take sorts by when it was played. A marker,
  `.<stem>.phone.json`, holds the phone's rate and the start time.
- **Audio as it arrives.** Chunks are written in order into the `.part` file
  as 32-bit 48 kHz stereo; a chunk that arrives early, after a reconnect,
  waits for those before it. A phone at another rate goes through a
  windowed-sinc resampler (`resample.go`): centred, so the output starts on
  time, and tracked in exact ratios, so a long recording doesn't drift.
- **The pyramid grows** with the audio, so finishing needs no read of the
  take; the whole-take `.peaks.json` is drawn from the pyramid too.
- **Finishing** patches the WAV header's sizes, writes the sidecars, renames
  the WAV into place and removes the marker. A recording whose phone never
  comes back is finished as *Phone (partial)* after ten minutes.
- **Audio on disk is never thrown away.** A write error finishes the take
  from what reached the file; a failure even then leaves the `.part` and its
  marker for the startup sweep.
- **A restart mid-recording** leaves a `.part` with its marker; the startup
  sweep finishes it as a partial take, its length read from the file, rather
  than deleting it as it does an unfinished save, and the preview backfill
  encodes its preview. The phone, still recording, names the oldest chunk it
  holds when it reconnects, and the Pi starts a second partial take there.

The page side is `web/static/lib/phone/`: an AudioWorklet that taps raw float
PCM, an uploader that numbers chunks, keeps them until they're acked and
resends after a reconnect, and the recorder sheet.

### Shares queue

`GET /api/render` runs ffmpeg. Two at once on a Pi compete with the capture
path for CPU, so renders take turns: a second request waits, and gives up
without starting ffmpeg if its client goes away first.

## The tape

`internal/tape`, behind `TAPE=true`. The design is
[the tape spec](superpowers/specs/2026-10-03-tape-design.md); this is how
steps 6a (the engine) and 6b (playing it through the Sidekick) are built.

```
API ─edit─▶ Tape (model, undo) ─save─▶ tapes/<id>/tape.json
              │ new Mix
              ▼
     render goroutine: transport + Mix ─blocks─▶ FIFO ─pull─▶ Sink (device)
                                                                │ plays
                                                                ▼
     Catch ◀── cycle log + position map ── ring (capture) ◀── Sidekick
```

**The model.** A tape is one `tape.json`: tracks of clips, the grid (the
first loop's exact length in frames, and how many bars it is), the loop,
and each track's mix. A clip points into a pool WAV: `src` and `frames` in
the file, `at` on the tape, a `layer`. Undo is a list of earlier versions of
the whole state, 100 deep, saved in the file; an edit of the same kind
within 2 s extends the last step. Every edit goes through `Tape.Change`,
which validates the result (buses, pan, nothing past the end), on a draft of
the tape that becomes the tape only once it's saved: a refused edit or a
failed save changes nothing, in memory or on disk.

**The store.** `TAPE_DIR/tapes/<id>/tape.json` is rewritten after every
edit through a synced temporary file and a rename. `TAPE_DIR/audio/` is the
pool: every catch and drop is written there once, with handles either side
(`TAPE_HANDLE_S`, at least the 10 ms the crossfades read, so a trimmed clip
can grow back out), and its peaks beside it, and never changed. Clones copy only
`tape.json`. Clean-up deletes pool files that no tape's state or history
uses, and spares any less than a minute old, which may belong to a catch
still being placed.

**The renderer.** `Mix` is built from a state whenever it changes and
swapped in atomically; rebuilds take turns, so the newest is always the one
playing. It carries everything the render goroutine needs (the loop, the
grid, the tape's length), so that goroutine never takes the engine's lock,
and an edit waiting on a slow card can't make it late. It reads pool files
fully into memory as float32; nothing is memory-mapped, because a mapped
file on a bumped USB disk faults and would take the ring down with it. The
pool keeps only the files the tape plays and those its next undo or redo
would, so memory doesn't grow with every tape ever loaded. For each block it sums every clip in
the block's span into its track's bus (A or B) at the clip's and track's
gain and the track's pan, honouring mute and solo. Edges follow what's
beside them: where audio meets audio (two clips end to end, or a clip
wrapping into itself at the loop's seam) a 5 ms equal-power crossfade runs
from the outgoing clip's overhang; an edge with silence beside it gets the
3 ms declick cuts use. A catch split at the seam is the same audio carrying
on, so it gets no fade in. While looping, the wrap itself is an edge when
clips run across the loop's ends: for 5 ms after In, what a clip past Out
would have played next fades out as a clip begun before In fades in, equal
power, only when the tape got there by wrapping (not when it plays through
In).

**The transport and the player.** One render goroutine owns the transport.
It applies queued actions (play, stop, locate) on the exact output frame
their quantum falls on, advances one tape frame per output frame, wraps at
the loop's Out, and renders a few blocks (about 100 ms) ahead into a FIFO.
The device's callback takes blocks from the FIFO and never blocks or
allocates; if none is ready it plays silence, counts it as late, and the
tape counts on, so the tape never drifts against the device. Everything the
transport did is kept: a map from output frame to tape position, and a log
of each complete pass of the loop; a pass is logged only if it ran from this
loop's In to its Out unbroken. Loading a tape resets the transport between
two blocks, before the new tape can play: it stops, drops whatever was
queued, and forgets the passes, so one tape's pass is never caught onto
another. Panics in the render goroutine and the device callback are
recovered and reported in the state; the dashcam keeps rolling.

**Catching.** What the tape played at output frame `o` is in the capture
ring at `o + delta`. A catch looks up the output frames it wants -- a pass
from the cycle log, or the last N bars from the position map, back from the
newest frame the ring has heard -- and copies that range of the ring, on the
chosen source's channel pair, into the pool, then places it where it was
played. N bars that cross the loop's end are split into two clips. Catching
needs `delta`:

- The demo knows it exactly. The demo sink is a loopback: what it plays is
  mixed into the demo source's next input block, MAIN and both channel taps
  by bus, as the Sidekick would. `delta` is counted against the frames the
  capture has handed to the ring, so a dropped block or a reopened source
  doesn't throw it off.
- On the Sidekick it's measured (`align.go`, below).

**The output** (`internal/audio/sink_portaudio.go`) is an output-only
PortAudio stream, four channels of 32-bit at 48 kHz, on the capture's own
card: the capture's device if it can play four channels, else the most
direct device matching `DEVICE_MATCH`, and never anything else -- the tape
out of HDMI, on another clock, would be worse than none. It is a separate
stream rather than a duplex one, so the dashcam's health never depends on
playback's. It keeps itself open with its own supervisor, as the capture
does -- backing off while it can't open, or while it fails soon after
opening -- and plays silence while the transport is stopped, so what it has
measured survives stop and play. It's closed with Abort rather than Stop,
since a wedged ALSA stream can keep Stop waiting for tens of seconds with
the lifecycle's lock held. Its callback calls the engine's pull, which
never blocks, notes output underflows, records in a clock bridge of its
own when each buffer's first frame will be heard (the buffer's DAC time from
PortAudio), and recovers its own panics: the binding's recover would exit
the process. The output never rescans by itself, since a rescan closes the
capture's stream too; if the Sidekick's playback wasn't enumerated, it waits
for the capture's next rescan or a restart.

**One PortAudio.** The library is process-global, so the capture and the
output share one lifecycle (`palifecycle.go`), with a registry of open
streams under one lock held across every open, close and rescan. A rescan --
the capture's, when the interface vanishes -- closes every registered stream
before `Pa_Terminate`, which would otherwise close them underneath their
owners and leave a dangling pointer to be freed twice, and moves the
generation on. The output's supervisor sees the generation move and opens
again in the new one.

**Alignment** (`align.go`). Δ is where output frame *o* shows up in the
ring: at *o* + Δ.

- *Estimated:* the capture's clock bridge gives the ring frame being
  converted at a moment, the output's the output frame being heard then;
  their difference, plus the residual of the last lock, is good to a few
  milliseconds.
- *Locked:* every couple of seconds while unlocked (every ten once locked),
  the last second each bus delivered -- kept by the device callback in a
  lock-free history -- is correlated against that bus's channel tap in the
  ring by a phase-transform cross-correlation computed by FFT (`xcorr.go`),
  over ±150 ms around where Δ should be. The signals are differentiated
  twice first, so a loop's bass doesn't drown out the attacks that pin the
  match down. A peak counts only if it's one sharp peak, well above the rest
  of the correlation and any other candidate, so a sustained tone, which
  matches itself every period, is never guessed at; and only within ±50 ms
  of the estimate (±10 ms once a lock has measured how good the estimate
  is), so a rhythm repeating at its true Δ, beyond that, is seen and refused
  rather than an echo of it inside being taken. Two measurements in a row
  must agree to the frame before a lock is taken or moved.
- *Slips:* both sides of the Sidekick run off one crystal, so Δ moves only
  when one side loses frames: the output restarts or underflows, or the
  capture drops a block or the device reports an input overflow. Each starts
  a new segment, estimated until it locks again: from the output frame the
  output says it slipped at, or for the capture's, the step before it was
  noticed. A lock that moves with no slip seen starts a segment where its
  window began, so what played before keeps the old Δ. A catch uses the
  segment its span played in, and a span with a slip inside is refused.

`TAPE_DEMO_ALIGN=true` makes the demo's output keep its Δ to itself, with a
clock bridge like a device's, so the estimate and the lock run in the demo
too; a test checks that a catch then holds exactly what played.

**Sources** (`TAPE_SOURCES`) name capture pairs and the buses heard in each.
A source is clean on a tape when no bus that leaks into it has unmuted audio,
and each caught clip records whether its source was.

**Recording** (`record.go`) adds nothing to the capture: the ring is always
recording. Rec while playing notes the output frame it was asked at; Rec
while stopped arms the track, and the next ▶ becomes a play with a count-in
-- a bar of click rendered with the tape standing at its bar line, then
play. Ending it works out what it covered from the cycle log and the
position map -- the last full pass inside it, or the bars from the first bar
line it played to the last complete one before the tape stopped, moved or
the punch ended -- and catches that span, placing each piece of it where it
played: every wrap in the position map is marked as one, so a span that went
round the loop is split at the loop as it was then, even if it has moved
since. ■ during a punch stops the tape before the catch is written.

**The click** is rendered into bus A by the mix: a 25 ms sine blip on each
beat line, higher on the bar. It's on for a new tape and goes off with the
first audio; the count-in clicks whatever the setting.

**Free loops** (`tap.go`). A tap is timed when it reaches the Pi, and the
capture's clock bridge turns that into a ring frame. The second snaps both
to the strongest attack in the source within 250 ms before and 50 ms after:
the hop of 128 frames whose energy rises most over the few before, then the
first sample there reaching a third of what follows. The span is written to
the pool and becomes the grid, the loop and the first clip; then a "phase"
action starts the transport as if the loop had been going round since the
second tap, using Δ to turn that ring frame into an output frame.

**The crate** (`crate.go`) is `TAPE_DIR/crate.json`: kept clips, each a
window onto a pool file with a name and where it came from. Keeping a span of
a take or the ring writes the pool first (`copyTake`, `ringClip`); keeping a
tape clip or the clipboard keeps a reference. It's a clean-up root, its
deleted clips too for a week, and an unreadable one stops the clean-up. A
drop from it is a drop of a one-clip clipboard (`dropBoard`).

**The clipboard** (`clipboard.go`) is `TAPE_DIR/clipboard.json`: clips in
the pool, laid out from frame 0, one track's worth or more. Copying from a
take or the ring writes the pool first; the clean-up treats the clipboard as
a root. A drop clears the span on each track it lands on and places the
clips, then, stopped, moves the playhead to its end. The audition renders it
through a mix of its own, every track on bus A.

**Drops** copy a span of a take into the pool. On an empty tape the first
drop becomes the grid and the loop; later ones go at the playhead. A merge
drop places every clipboard track on one track instead, each clip on the
lowest layer free.

**Editing** (`edit.go`) never touches audio. A clip is a window onto an
immutable pool file, so lift and copy are windows trimmed to the loop's In
and Out (a lift also clears the span with the same cut a replace uses);
split is two windows; join merges two that carry straight on in one file;
slide re-places a clip at a new start; trim moves one edge of a window
within its file's handles; multiply copies the loop's windows into the span
after it. Reverse is the one edit that writes audio: the clip's window and
its handles, backwards, to a new pool file
(`audio.ReverseWAVSpan`, a block at a time from the end), so every other
edit still reads every clip forwards; turning it back is arithmetic on the
original's frames. Each goes through `Engine.Edit`, so each is one undo
step and is saved before it's heard. A lift's clipboard is written after the
tape; if it can't be, the lift is undone. The crossfades the renderer already
does where clips meet make the joins silent.

**Mixdown** (`mixdown.go`) renders nothing offline. It queues a "once"
action: the transport plays In to Out through a second, loop-off mix built
alongside the playing one (so no seam joins Out to In), with the click
silent and 3 ms fades at the edges, then stops back at In, noting the output
frames the pass began and ended at and whether any of it was a late render.
A goroutine waits for that, waits for the tail and one aligner step to
reach the ring, and, if nothing broke, slipped or played late, maps the
span through the Δ that held into ring frames and hands it to the dashcam's
saver: the take is exactly what MAIN carried, the strips' FX and any live
playing included. A stop, locate or load during the pass, or any of those
or a play during the tail, marks it broken and nothing is saved.

**Export** (`export.go`) is offline: each track with clips gets a mix of its
own (no loop, its mute and solo cleared) from the pool the loaded tape
already holds, rendered block by block straight into a stored zip entry as
32-bit float WAV, with a write deadline moved on each block so a stalled
client can't hold the one export slot. A tempo-map `.mid` rides along.

**The clock** (`clock.go`, `internal/midi/out.go`). With `TAPE_CLOCK=lead`,
a goroutine looks every 5 ms at what the renderer has added to the position
map. For each pulse line -- n × a bar ÷ 96, not a whole number of frames --
that the tape played across -- laid from the bar line before it, so a bar's
first pulse is its bar line -- it finds the output frame, asks the output's
clock bridge when that frame will be heard (the demo's output has none, so
the engine keeps one of when frames were handed over), and hands the pulse
to `midi.Out` to send then. While the tape stands, pulses run on at its
tempo over the output frames. Starting, or a jump, waits for the next
sixteenth and is announced just before it: Start from bar 1, else Song
Position and then Continue; the loop coming round sends Song Position alone,
and any other jump while the followers run (a locate, a new grid) stops
them first. `midi.Out` opens each matching rawmidi node write-only and
non-blocking, outside its lock, gives every device its own goroutine that
sleeps until each message's moment plus the device's nudge, drops a device
whose write fails or whose node vanishes until the next two-second scan,
skips messages more than 250 ms late, and counts each device that appears
or loses messages, so the scheduler tells the followers where the tape is.
On shutdown the engine waits for the scheduler, whose Stop goes out at once,
ahead of anything queued.

The page is `web/static/lib/tape/`. It polls `GET /api/tapes/state` five
times a second, draws the lanes from each pool file's peaks, and sends what
you tap; the Pi holds all the state, so several devices stay in step.

## The UI

Mobile-first, no build step, no npm, no framework, no vendored libraries:
vanilla ES modules.

It is served with `http.FileServer` straight from disk on every request, which
is why `./deploy.sh --static` can push a CSS change in about a second with no
rebuild and no restart. Anything served with an `.html`, `.js`, `.css` or
`.json` extension is sent `Cache-Control: no-cache`, so the browser revalidates
it and a redeploy is picked up on reload. Nothing here is fingerprinted; the
icons carry no explicit directive and fall through to `http.FileServer`'s ETag and `Last-Modified`
handling.

The takes list is polled every five seconds and guarded by the `/api/jams`
ETag, so an unchanged list does not re-render and interrupt a playing preview.

### Waking up

A tablet that sleeps freezes its page, and a request or socket that was in
flight is often neither answered nor failed: it never comes back. Every page
therefore gives its reads a deadline and checks its link on waking
(`lib/link.js`, node-tested):

- **Reads time out.** `timedFetch` aborts a request that isn't answered
  (8 s; the tape page's poll, which runs five times a second, gives up after
  4 s). The tape page's poll used to run only when the last one had finished,
  so one lost poll stopped them all, and the page showed the tape as it was
  when the tablet went to sleep. Now `lib/tape/poll-gate.js` lets a poll
  forced on waking go ahead of one that may be lost, and drops the lost
  one's answer if it ever arrives.
- **A dead socket is noticed.** Nothing tells a page that its socket died
  in its sleep, so `/api/live`'s client (`lib/live.js`) treats 4 s without a
  frame as dead (frames come ~100 times a second) and replaces it, waiting
  0.5 s after a failure and up to 5 s after repeated ones. The server sends
  no heartbeat of its own: its pings are answered by the browser below
  JavaScript, where the page can't see them.
- **Waking is an event.** `onResume` fires when the page is visible again,
  shown again (`pageshow`, bfcache or not), online again, or when a one-second
  tick arrives more than 3.5 s late (the clock jumped; timers were frozen,
  whatever events fired). The page then refetches at once: the tape page its
  tape state and clipboard, the main page its status, takes and meters, the
  takes page its list, the take page the take (merged as after any return to
  the page, so an edit still being saved, or a selection not yet saved, is
  kept).
- **The note.** A source that fails (`link.fail('tape')`) and doesn't recover
  within a second shows *Reconnecting…* (`.link-note`) and clears when every
  source answers; a failure that clears first is never shown.

Service-worker registration and the screen wake lock are both guarded on
`window.isSecureContext`, so they switch themselves on if the Pi is ever given
an HTTPS name and stay quiet otherwise.

### The take page

The take page is the one place a take is edited, and it is laid out as the
tape page will be (the editing-model spec, step 3): a header, the overview, an
editing canvas in three zones, a toolbar, and the MIDI lanes.

`web/static/lib/wave/` holds the page; `lib/edit/` and `lib/help/` hold what
the tape page will share. The pure parts of each are node-tested.

| Module | What it does |
|---|---|
| `edit/gestures` | The pointer machinery any editing surface extends: a drag pans, a hold then a drag selects (with the view scrolling under a finger held at an edge), taps and double-taps, pinch and wheel, and rollback on a cancel or a second finger |
| `edit/editor-bar` | The editor bar's gesture core: the ZOOM and POSITION pads, the ◂ ▸ steps, their arrow keys and the wheel move a point, and a whole gesture (a drag, a held key, a burst of notches) is saved once, so it is one undo step. The page says what the point is, where a move lands and how it is saved |
| `wave/view` | The take's editing canvas, in three zones. The ruler: flag pins on top (tap to open, drag to move), bar numbers below, the playhead handle ▾ (drag to scrub silently) and bar 1 (drag the downbeat). The body: the waveform. The grips: In and Out at the selection's ends and the move handle between them |
| `wave/geometry` | Pixel and frame math, the bar grid and ruler ticks, Snap, In/Out with a pending point, flag stepping |
| `wave/draw` | Waveform drawing: `levelsFor`/`levelsOfColumns`, `takeGain`, `lift`, `smooth` and `drawBars` -- every view of a take (cassette, spine, tape block, take page, overview) draws on the take's own scale (one gain per take). `drawColumns`, on the meters' dB scale, draws a list row only |
| `wave/tape-strip` | Trace on tape: `paintOxide` paints the brown strip, `drawTrace` the glowing line along a take's envelope (one glow pass per call; blur in CSS px, scaled to device pixels) |
| `wave/rowwave` | A list row's waveform and its playback, with the selection's bracket |
| `wave/tiles` | Fetches and caches `/api/peaks` ranges, drawing the coarsest thing it has until the finer tile arrives |
| `wave/overview` | The whole-take strip: drag, tap and double-tap-to-fit navigation |
| `wave/clock` | The one playback position: the preview MP3, or with Loop on, `/api/slice` looped in Web Audio, sample-exact |
| `wave/lanes`, `wave/rising` | The MIDI lanes (with a menu per lane) and the rising-notes view |
| `wave/share` | Getting a rendered MP3 or bundle off the phone |
| `wave/page` | Owns the take's editable state and wires the rest together |
| `help/tips`, `help/help` | Every control's tip; titles on a computer, help mode on a phone, first-run hints |
| `help/markdown` | Renders the guide for `/guide.html`, from `/guide.md`, which the binary serves compiled in (`docs/embed.go`) |
| `link`, `live`, `tape/poll-gate` | Reads that time out, the wake-up refetch, the *Reconnecting…* note, and the live meters' socket that replaces itself (see *Waking up*) |
| `toast` | Both pages' toasts, with an optional action ("Flag deleted · Undo"), and one carried to the next page |
| `takes`, `trash` (main page) | The list, with select mode for several takes at once; *Recently deleted* |

A few rules hold the page together:

- **One finger moves along the take, always.** Nothing in the waveform's
  body is draggable; what can be dragged lives in the ruler or the grip
  strip, so gestures never compete.
- **Loop is a toggle,** off on every open. Off, the preview plays from the
  playhead straight through; on, the selection is fetched as a slice and
  looped sample-exact. Practice speed applies only to the preview.
- **In and Out** set the selection's ends at the playhead. The first of a
  pair waits as a pending point until the other completes it.
- **The page is the state's owner.** It loads its take with
  `GET /api/take?file=` and fetches it again when it comes back into view,
  merging what another device changed (flags, name, star, tempo, grid, and
  the selection unless it has an unsaved one). Flags go one at a time through
  `/api/take/flags`; the header's rename, star and tempo through the PATCH.
- **Undo is the Pi's.** ↶ and every toast's *Undo* call `POST /api/take/undo`
  and put back the take it answers with; edits still on their way are sent
  first, so Undo acts on what's on screen.
- **Back is the browser's back** when the list is where you came from, so the
  list keeps its scroll; the list also restores it when the browser reloads
  it instead. ◂ ▸ step through the takes in the order the list last showed.
- **Tips live in one file,** `lib/help/tips.js`, and the guide's §9 table is
  the same list; a node test fails if they differ or if any `data-tip` in the
  UI has no tip.
