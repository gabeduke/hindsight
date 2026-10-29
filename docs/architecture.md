# Architecture

One Go binary. It opens an audio device, keeps the last `RING_SECONDS` in RAM,
and serves a small vanilla-JS UI. No database, no message broker, no build
step for the frontend.

```
cmd/hindsight          wiring and flags
cmd/hindsight-hub      the hub: certificates and heartbeats for every kit (docs/hub.md)
internal/config        environment → Config
internal/audio         device, ring, levels, envelope, saving  (cgo, PortAudio)
internal/midi          rawmidi watcher, parser, event ring, clock, tempo map, SMF export
internal/surface       the SMK-37 on Hindsight's firmware: its screen and its panel
internal/smf           Standard MIDI File writer and reader
internal/bundle        writes a take's .mid and manifest from audio's window and midi's events
internal/mono          the one monotonic clock audio and MIDI both stamp with
internal/tempo         the tempo a take was played at, measured from its audio
internal/tape          the tape: model and undo, store and pool, renderer, transport, player, catching, cue lane
internal/rig           the kit drawn as hardware: device profiles, sockets, cables
internal/hub           the Pi's side of the hub
internal/hubserver     the hub itself
internal/api           HTTP and WebSocket handlers
web/static             the UI, served from disk per request
web/static/shell.html  the one document: the Studio, the Listening Room and Capture
web/static/lib/shell   the router, the view contract and the three views
web/static/lib/bar     the bar (#np) and the engine that owns its audio
web/static/lib/tape    the Studio's tape: lanes, parts, ranges, the cue lane
web/static/lib/rooms   the Studio around the tape: feed, KEEP, bounce, words
web/static/lib/buffer  the buffer: GRAB, trim, DROP
web/static/lib/room    the Listening Room: the shelf, the deck, the Sketchbook
web/static/lib/play    the instrument strip (Play mode)
web/static/lib/rig     the rig page
web/static/lib/objects the physical things: reels, cassettes, VU meters, the shared ticker
web/static/lib/scene   the scene contract the renderers follow
web/static/lib/wave    the take page (wave.html): view, geometry, draw, tiles, clock, lanes
web/static/lib/edit    the gestures and curves every editing surface shares
web/static/lib/ui      the shared parts: one press (GESTURE), a key's tap, double tap and hold, and its down pose;
                       one stack of open things, one menu;
                       one icon set: icons.js, drawing from web/static/icons/ui.svg
web/static/lib/help    tips, help mode, and the guide renderer
web/static/lib/phone   the phone recorder
docs/embed.go          the guide, compiled into the binary
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
tempo map so the notes sit on the DAW's grid.

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
disturbs nothing, SysEx skipped and counted (a controller's is passed on:
*Controllers*, below). Channel messages and transport
go to a bounded ring of 16-byte events; clock pulses go to the tempo ring
and are not stored per event, since at 24 a beat from every device they would
be most of the traffic and none of the content.

**`internal/audio` does not import `internal/midi`.** The saver takes a
`TempoSource` and a `MIDIExporter` interface, each called inside a `recover`
after the WAV is on disk, so no MIDI failure — missing device, parse error,
third-party panic — can cost a recording. The worst case is a take with no
BPM and no `.mid`.

### Controllers

A port that `TAPE_CONTROLLER` names is a controller: its notes and CCs
go to Play mode's bus on the Pi (`internal/api/controls.go`), a
`midi.ControlSink`, whatever page is open. Each one is looked up in that
controller's bindings: `controls.json`, keyed by the controller's name, or
a known controller's profile, or the defaults. The bus presses a pad, moves
an amount or runs a verb (CATCH, the transport, GRAB, DROP, KEEP). MIDI
LEARN binds the next message.

A controller can also talk back in SysEx. The parser hands a controller's
complete SysEx messages, up to `midi.MaxSysEx` bytes, to the sink if it
is also a `midi.ControlSysExSink`. They still stay out of the event ring.

**The SMK-37 on Hindsight's own firmware** (`internal/surface`;
`docs/plan/the-instrument.md`, step 7; the protocol is `app/hindsight.h` in
`gabeduke/smk37-hindsight`):

- **The client** (`surface.Keyboard`) writes through `API.KeyboardSend`.
  That reaches a `midi.Out` aimed at the keyboard's own node, made only
  while an SMK-37 is open as a controller. So a keyboard that
  `MIDI_IGNORE` keeps out, or that `TAPE_CONTROLLER` doesn't name, is
  never opened or asked anything, even beside one of the same name.
- **One SMK-37 at a time**: the first open as a controller. There is one
  client, so a second keyboard's HOME, OFFER or unplugging counts as the
  first one's.
- **HELLO** asks whether the keyboard runs Hindsight's firmware: three
  tries a quarter of a second apart, every two seconds, until it answers.
  When it answers, the API takes its screen.
- **Taking the screen takes the panel.** While Hindsight has the screen,
  the pads, encoders, faders and buttons send plain MIDI.
  - The SMK-37's profile binds the pads (notes 36–51 on channel 10, as
    any controller's), PLAY (the transport) and REC (KEEP).
  - Encoders 1–4 send CC 21–24, the tape mods' defaults.
  - The faders, encoders 5–7 and the other buttons are free for MIDI
    LEARN.
  - The encoders send absolute values. `Keyboard.Knob` can say where each
    stands, but nothing calls it yet, so a turn starts from where the
    knob last was.
- **HOME on the keyboard** gives both back, and the keyboard says RELEASE.
  Hindsight leaves them with the keyboard (`Status.Homed`), even when it
  answers HELLO again.
- **HOME held for a second** on the keyboard's own screen, and let go with
  nothing else pressed or turned meanwhile, hands them back: the keyboard
  says OFFER, and Hindsight forgets the HOME and takes the screen as when
  the keyboard first answered (`Keyboard.Feed`). Unplugging the keyboard
  or restarting Hindsight forgets the HOME too.
- **As Hindsight stops**, it gives back a screen it has (`Farewell`), so
  the panel doesn't go on talking to nobody.
- **One message is in flight at a time**, because the keyboard's mailbox
  holds one frame. Frames are written under the client's lock, in the
  order the keyboard must see them.
  - The next message goes when its ack comes.
  - A message without an ack goes again.
  - Three unanswered tries forget the keyboard until it answers HELLO
    again.
  - A TEXT waiting for the place a newer TEXT draws to is replaced, unless
    a CLEAR waits between them.
- **Each ack's round trip** is kept (`Status.RTT`), for step 1's latency.
- **Every press on the keyboard answers on its screen** (`Keyboard.Banner`;
  `internal/api/banner.go`): its words over the top line for
  `surface.BannerFor` (a second), then the line that was there.
  - The banner is a TEXT at the top line's place (`surface.TopX`,
    `TopY`) at `BannerScale` 2, so 19 characters; a layout puts its top
    line at that place, since TEXT works by place. A TEXT for the top line
    while the banner shows is kept and drawn when it goes.
  - Its time is the client's own clock (`Keyboard.Clock`, `Now`) and loop:
    the 20 ms `Tick` that resends puts the top line back (a test with its
    own clock calls `Tick` in place of `Start`). Each banner, TEXT and
    CLEAR is checked and queued under one lock, so a HOME can't fall
    between the two. A new press
    replaces the banner showing; a CLEAR, HOME or a forgotten keyboard
    ends it with nothing put back, and none is drawn without the screen.
  - The API stamps a press with `Keyboard.Now` (`verbJob.pressed`), and
    only the keyboard's own presses say anything there. The transport is
    timed from the press; KEEP, CATCH, GRAB and DROP from when they are
    done, as the design's command pads flash when done.
  - The words are the verb's (`verbDone.says`), in the design's colours,
    version 2's palette: PLAY green, STOP the text's white, KEPT 30 S red,
    CATCH, GRAB and DROP white. Version 1 has seven colours, so there the
    client draws red as the accent and white as the text (`v1Colour`). A
    refused press, a verb's or a pad's, is amber with its reason
    (`refusals`: NO TRACK ARMED, NO TAPE LOADED, NOTHING TO KEEP, …), or
    its name and REFUSED.

**The SMK-37's screen on protocol version 2** (`internal/surface`'s
`items.go`, `layout.go`, `diff.go`; `internal/api/keyboard_screen.go`):

- **The version** is HELLO's ack's: `<version> <items>` after the status,
  `02 60` on version 2. HELLO goes as version 1, which every version
  reads; once the keyboard says 2, every frame is version 2's (TEXT with
  its back), and `Feed` takes acks of either version, the keyboard's own
  RELEASE and OFFER always saying 1. On version 1 nothing below happens:
  the screen is the legend `keyboardPresent` draws with `Text`, and the
  banner the TEXT above.
- **The screen is a function of the tape's state**: `surface.Layout`
  takes a `surface.State` (the name and tempo, where the tape is in beats,
  the transport, the armed track, solos and mutes, the pad page and the
  pads held, the meters and faders 0–127, the eight knobs' names, values
  and amounts, which knob or fader is lit, the banner) and gives the
  items, `TEXT`, `BOX` and `BAR`, in drawing order. It is the prototype's
  layout (`~/programming/hindsight-design/smk`), pixel for pixel: its six
  screens are the golden command lists in `internal/surface/testdata`,
  written as the firmware simulator's script lines. Three overlaps the
  prototype had are fixed there: a name is cut before the tempo (15
  characters), the counter's sixteenth follows its bars and drops to
  scale 1 past bar 999 (and the counter to scale 3 past 9999), and the
  solos and mutes close up (`SOLO 1234  MUTE 1234`) when they'd run into
  NO TRACK ARMED. `TestNoTwoTextsOverlap` holds that for long names, big
  bars, everything soloed and muted, both pages and lit knobs.
- **A change sends only what changed** (`plan`): the items the keyboard
  has are kept as its acks say (`apply`), keyed by kind and place as the
  firmware keys them. Removals go first, so the 96-item list has room,
  then replacements, which keep their place in the order, then new items,
  last. An item that would end up drawn under one it should cover (the
  banner's box under a top line that came back) is taken away and sent
  again after it.
- **BATCH frames**, at most 512 bytes (`MaxFrame`), one in flight as
  every message is. The next is planned only when nothing waits, from the
  screen wanted then, so a screen changing faster than the keyboard
  acks sends only what it is now. The firmware's mailbox holds 1,024
  bytes, but over the Pi's USB MIDI the unit loses a frame of about 700
  or more (764 lost, 624 acked in 2 ms, 2026-10-29), so half the mailbox
  it is. A whole screen is about 960 bytes of commands: two or three
  frames. A BATCH the keyboard refuses keeps what it did
  (its ack's done count) and stops the drawing; the client then draws the
  screen again whole from a CLEAR, at most every `Heal` (2 s), and logs
  it, so one refusal doesn't freeze the screen and a screen the keyboard
  can't take isn't sent over and over. A BATCH whose ack is lost is sent
  again as it was, as every message is: each command can be repeated.
- **The banner** is the layout's on version 2: a box over the top line in
  the press's colour, its words black on it (white on red), for
  `BannerFor`; `Keyboard.Banner` puts it in the state and the 20 ms tick
  takes it out.
- **Refresh and traffic.** `Keyboard.Follow(a.keyboardState)` is asked
  every `Refresh`, 40 ms, while the screen is Hindsight's: the counter's
  sixteenths change every 114 ms at 132 BPM, so it is never more than a
  frame behind. The meters are taken from it every `MeterEvery`, 100 ms,
  and held between, in sixteen steps over 48 dB (`meterOf`), so their
  flicker can't fill the link. Playing at 132 BPM with all four meters
  moving, that measured 14 BATCH frames a second of about 41 bytes: about
  600 bytes a second to the keyboard, and an 11-byte ack back for each.
  Standing, nothing changes and nothing is sent.
- **The feed** (`keyboardState`) reads the tape (`Engine.Loaded`, a copy)
  only when `Engine.Changes` moves on, and the encoders' bindings then or
  when the controls change (`controlBus.rev`): its name, the grid's tempo, the
  armed track, the tracks' mutes, solos and levels (a fader's place,
  `surface.FaderOf`), the mods. Every ask it reads `Engine.Heard`, the
  recording (REC only once a punch is on, not while it is armed for the
  next bar), the pads held (`HeldPads`) and the meters
  (`Engine.TrackLevels`, each track's peak after its fader with a 26 dB/s
  release, measured as it renders, and silent with no output). An encoder's cell is what its CC (21–
  27 on channel 16) is bound to on the keyboard, its value the tape's,
  or the one it just sent while lit, for `BannerFor` after a turn; one
  bound to nothing is its panel name and a dash.
- **Not built yet, so not shown**: the Mixer page under SHIFT (K6:
  `State.Page`, the layout and the lights have it, the feed always says
  FX), the faders (K8: a tick is the track's level as the tape has it),
  and scrub (K7: the master knob's cell is the synth's volume, a dash,
  since only the keyboard knows it).

**The SMK-37's lights** on protocol version 2 (`internal/surface`'s
`lights.go`; `keyboardLandings`, Play mode asked on its loop, in `internal/api/
keyboard_screen.go`). Version 1 answers LED unknown, so there nothing is
sent.

- **What is lit** is `surface.Lamps(State, stages)`: LED (command 08) for
  the sixteen pads, then SHIFT, PLAY and REC. The rest of the buttons are
  never sent, so they stay the keyboard's.
  - The FX page by family, in the screen's palette (`Colour.RGB`, the
    firmware's RGB565 table): T1–T4 the tracks', BREAK, REVERSE, CHOP and
    STOP orange, HALF and DOUBLE violet, ROLL, FILTER, ECHO and CRUSH the
    accent's cyan, CATCH and GRAB white (`FXPads`, as the map draws them).
  - The Mixer page (`State.Page`, K6's to set): each pad its track's
    colour, full when on (mute, select, solo, arm) and dim when off.
  - A pad's colour at its stage, as the prototype draws it: 0.18 at rest,
    0.55 half, full. A level is 0–127 of the colour; the firmware scales
    127 to the pads' own brightest it allows (48).
  - PLAY on while `State.Playing`; REC on while `Recording`, blinking
    while playing with a track armed; SHIFT on while held
    (`Keyboard.ShiftHeld`, from SHIFT's note, 0 on channel 16, whatever
    it's bound to: `keyboardButton`). The Keyboard lets SHIFT go with the
    screen (HOME, RELEASE) and with the keyboard (`Gone`, as
    `ControllerGone` says, or forgotten), so a release lost then can't
    leave it lit.
- **A pad's stage over time** is `surface.PadLights`, which the
  `Keyboard` keeps under its lock:
  - half from the keyboard's press (`PadDown`, from `controllerPress`
    once the press is taken; a refused one stays dim) until what it does
    is heard, even when let go first (`PadUp`): a quantised press waits
    for its line, and stays half for it, at most `AwaitFor` (4 s, a bar
    at 60 BPM) if nothing of it is ever heard;
  - full from its press's landing until its release's, from any holder: a
    phone's BREAK lights the keyboard's too, since it is what is heard;
  - a command pad (CATCH, GRAB) is half from its press (`queueVerb`) until
    its verb is done, then flashes full once for `FlashFor` (150 ms) if
    it went through (`PadDone`, from `runVerb`), or goes dim if refused.
    Presses are counted, so a second CATCH queued is half again after the
    first one's flash.
- **The landing time** is Play mode's, as a page's `at` gets it. The
  Keyboard's loop asks for it every `Tick`, as its own step before the
  screen (`Keyboard.Landings(a.keyboardLandings)`; the screen's getter
  has no side effects): the pads the tape holds (`HeldPads`, read
  first), and each press's and release's output frame from the trick log
  (`TrickEventsSince`), mapped to the keyboard's clock through the lead
  (`HeardIn`: the blocks rendered ahead and the device's latency). What
  it says is kept for that Tick's send, so the lights go in one frame
  with the screen's change. With no output, a pad is lit as it lands. A
  pad heard that the tape no longer holds, with no release landed, goes
  dim (a tape loaded under it), so a light can't stick.
- **On time.** The loop Ticks at least every 20 ms (`tickEvery`), and
  sooner, at the next time a pad's stage changes (`Keyboard.Wait`,
  `PadLights.Next`); a pad's change from another goroutine wakes it. An
  event is logged as it renders, so with any lead over 20 ms (the Pi's
  is about 100–200 ms; 40 ms is the least the tests rely on) it is read
  before it is heard, and the light is sent at its landing, to the
  timer's precision, when nothing is in flight. When a frame is in
  flight it goes with that frame's ack, which works the stages out again
  at that moment (`queueScreen`): late by at most the rest of one round
  trip.
- **Sent as they change**, in the screen's BATCH sender: the lights that
  differ from what the keyboard has (`lit`, kept from the acks, by
  target) go after the screen's changes. A CLEAR keeps the lights, as the
  firmware does, so a screen drawn again whole sends none of them. HOME,
  a RELEASE or a keyboard forgotten empties `lit` and starts the pads
  again (`lostScreen`): the screen taken again asks Play mode afresh,
  reading the trick log from then on (what landed while the screen was
  the keyboard's is not replayed), lights a pad the tape still holds
  full, and only then sends every light.
- **Checked in the fork's simulator**: `go test ./internal/surface -run
  TestWriteLightsScript -lights=<file>` writes the frames for rest, a
  press, its landing and release, GRAB's flash, recording with SHIFT
  held, and HOME, each with the simulator's `light` checks of what the
  firmware set; `tools/screen/run.sh <file>` there runs them. The panel's
  own LEDs are the board's code, which the simulator doesn't run.

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

`internal/tape`: the engine, and playing it through the Sidekick.

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
the loop's Out, and renders ahead into a FIFO as far as the device is asked
to buffer (`OUTPUT_LATENCY_MS`, `aheadFor`): never less than the sink's
biggest pull (`audio.PullSize`: the device's 1024 frames, the demo's
`FRAMES_PER_BUFFER`), nor more than a second. At 48 kHz that is five blocks
(107 ms) at the default 100 ms, one (21 ms) at 20 ms; it is counted in
time, so a 96 kHz kit keeps ten. Each block ahead is that much more lead
between a press and its sound; a deeper FIFO rides out a device that, after
a stall, asks for several pulls back to back. The phone's pacer, which
pulls for a phone while the device is away, isn't counted: at a low
setting a phone with no device can hear a gap.
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

**When a pad lands** (`trick.go`, `landing`). Play mode's pads, from a
page or a controller, are quantised to the line the player was playing
to: the line nearest what they heard at the moment the press reached the
Pi, worked out from the lead (`heardAt`, the blocks rendered ahead and the
device's latency). A hit up to half a unit after a line, and never more
than 100 ms, goes back to it; anything later goes on to the next. A line
still to come lands on its frame. One already rendered lands at once, and
a trick pad's head starts as if it had left the tape on that line
(`anchor` the line, `start` that many frames back), so a STOP is that far
into its wind-down and a ROLL in its phase. Snapping instead to the next
line after the render head, as it once did, put every hit on the beat a
whole unit late to the ear. Releases snap the same way, with nothing to
anchor, and a tap still sounds a whole unit from where its press is first
heard, however late on its line it lands. A late start is crossfaded in
like any other; what it means is each trick's own: STOP is already part
way down, REV jumps back twice the lateness, DOUBLE forward by it. With no output, the tape on a phone's stream (whose delay the Pi
doesn't hear), or no straight play from the line to the render head, a
press lands on the transport's own target, the next line after the
render head.

**The revision** (`changes.go`, `Engine.Changes()`) moves whenever what
`/api/tapes/state` shows moves, apart from the playhead and the device's
counts, which move all the time: the loaded tape once it is the new one
(an edit, an undo, a load); in the render goroutine, a transport action,
trick or cue launch queued or carried out, a count-in ending, the tape
running off its end, the cue lane's clips starting, ending or leaving,
and each pass of the loop logged; ● Rec arming, turning on and ending; a
mixdown's state; the output mode; and the clipboard and the crate once
written (the store's `changed` hook). A page is told of a new revision so
that it polls at once: a nudge, not the state, so the page has one way in
for its state, at about 30–50 ms from a change to the tablet's paint where
the 200 ms poll alone took up to 235. `Bump` runs on
the render goroutine, so it takes no lock and never blocks: each
subscriber's channel holds one tap, and a subscriber reads `Rev` when it
wakes. The render goroutine bumps once a block, after it has published
the block's view of the transport and the cue lane, so a page polling at
the tap finds what it was told of. A carried-out action bumps when it is
rendered, up to the FIFO's 100 ms before it is heard; the page's playhead
goes by `heard`, so it doesn't jump ahead. Not bumped yet, so a page sees
them on its next poll: the alignment locking (Δ), a render panic, the
output device going or coming back, the stream's listeners, tap tempo's
pending tap, the clock's status and a failed pool file.
`TestEveryChangeThePageSeesMovesTheRevision` drives the tape, ● Rec, the
clipboard, ▶ and ■ (and that the view already shows them at the tap), a
pass and a count-in, and fails on one that doesn't move the revision.

**`/api/tapes/changes`** (`internal/api/changes.go`) is a WebSocket of its
own that tells a page of the revision: `{"rev":N,"at_ms":…}` when it opens,
on each tap of `Changes().Subscribe()`, and once a second (`changesBeat`)
whether anything changed or not, with `at_ms` the Pi's clock so a page can
time the push. It sends a nudge, not the state: the page polls
`/api/tapes/state` at once, through the poll it already has. The beat is
what keeps a quiet socket from being taken for a dead one (`lib/socket.js`
replaces one silent for 4 s), and a beat whose rev differs from the last
one heard catches a nudge that was lost. The page never writes to it; with
the tape off it is a 404, as the rest of `/api/tapes` is. Not on
`/api/live`, which is the capture's levels.

In the page, `lib/tape/changes.js` (`watchChanges(onNudge)`, and
`revisions()`, which says whether a message's rev is one not yet heard) is
the client, kept open by `lib/socket.js`'s `connectSocket`, the reconnect
and dead-socket rules `lib/live.js` had, moved so both use them. A watch
takes its socket's first rev as seen, not news: whoever opens one polls as
they do, and counting it would ask the Pi twice; after a reconnect, a rev
that moved while it was down is news. The Studio (`lib/tape/page.js`) holds
it through `ctx.socket` (*The shell*), so it is open only while the Studio
is shown, and with it the bar's hand-over: opening it delegates the bar's
tape to the Studio, closing it hands it back (`delegate(null)`). A nudge
asks `poll-gate.js`'s `nudge()`, which polls at once with no poll out, or
has the poll that is out poll once more when it ends (`end()` says so),
never two at once. The bar's tape source (`lib/bar/tape-source.js`) is not
a view: its socket's life is tied to `del` instead. It watches while the
tape is not handed to the Studio (`!del`), and closes on `delegate(d)` and
on `destroy()`. With a take in the bar (`setActive(false)`) it stays open
for the keyboard's presses (*The keyboard's press*), but its nudges poll
nothing until the tape is back. Its polls go through a gate of their
own on the same rules (a tick skipped while one is out, a wake-up forced,
a nudge, a press or the hand-back asked for once), with a 4 s timeout so a
poll lost in a sleep frees the gate. The 200 ms and 500 ms polls stay, as
the fallback for a socket that is down. J1.14 times ▶, ■ and a rename made
at the Pi to the page's paint, in the Studio and in the Listening Room's
bar: within 100 ms on the demo.

**The keyboard's press** (`internal/api/press.go`; `the-instrument.md`,
step 7, *The tablet*) rides the same socket, as an event carrying the words
and what changed, not a diff. Each press on the SMK-37 that says something
on its own screen (`keyboardSays`, `banner.go`: the verbs, their refusals,
a Play pad refused) is published on the API's `presses` feed, which never
blocks the verb (a socket four presses behind misses one), and every open
changes socket sends it at once, with the revision as it is then:

    {"rev":N,"at_ms":…,"press":{"words":"DROPPED ON T2","role":"verb","lit":["track"],"track":2,"at_ms":…}}

- `words` are the banner's, in capitals, at most 19 characters;
- `role` is its colour, as on the keyboard: `play` (green), `stop` and
  `verb` (CATCH, GRAB, DROP: the display's own ink), `rec` (KEEP, which
  is the keyboard's REC: red), `refused` (amber), and `mixer`, a Mixer
  page press in its `track`'s colour (K6: nothing says it yet);
- `lit` is what it changed: `play` (▶, for PLAY and STOP), `rec` (●, for
  KEEP), `track` (that track's head, for CATCH and DROP). A refusal lights
  nothing;
- `track` is the track lit, 1 up, and left out for none;
- `at_ms` is when the banner's second began, by the Pi's clock: the press,
  or for a verb timed from when it was done, then. The message's own
  `at_ms` is when it left, so a page takes what is left of the second
  from the two, whatever its own clock says.

Only the keyboard's presses are sent (another controller's say nothing),
whether or not Hindsight has its screen. In the page, `watchChanges({onNudge,
onPress})` reads it with `pressOf` (`lib/tape/changes.js`), and a message
whose rev moved is a nudge as well. The bar's tape source hands each press
to `onPress` listeners, from its own socket or, while the Studio is shown,
from the Studio's (`heardPress`); the engine's listener is the bar's note
(`lib/bar/press-note.js`, `#np-press`), which puts the words over the
display, after the keyboard's icon, for what is left of the second, and
lights ▶ or ● (`.kb-lit`, `data-kb` the role). The Studio lights the
track's head itself (`lightTrackHead`). The note is out of the layout,
over the display alone (in the phone's mini player, over the whole window,
reels and all, since the display there is too narrow), and lets taps
through, so nothing on the bar moves. `#np-press` is a live region
(`role="status"`, `aria-atomic`) that is always in the page: a press shows
by its `data-kb` and its words, and goes by emptying them, never by
`hidden`, which would take it out of the accessibility tree.

**Every press answers, whatever the bar holds.** The keyboard plays the
tape, not the bar's source, so the note shows over the display in every
room with the shell's bar: over the tape, the live feed or a take alike,
in the Studio (through its socket) and anywhere else (through the bar's,
which stays open for presses while a take is in the bar). Open's page
(`wave.html`) has no tape source and no note.

J1.15 presses PLAY, STOP, a refused CATCH, GRAB and DROP on a keyboard in
the demo (`api.keyboard()`, a FIFO for its rawmidi node), in the Studio
and in the Listening Room, with a take in the bar there too, and checks
each note comes and goes, what it lit (▶, the dropped-on track's head)
and that ▶ never moved.

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

The **cue lane** stages clips beside the tape: they're in the tape's state
(`State.Cue`, so undoable and seen by every device), each a pool file of its
own (a GRAB's lanes summed, or a copied span of a take). Launching one is a
performance, like Play mode's pads, so it stays out of the state and out of
undo (`cuelive.go`): a launch or stop rides the transport's action queue
with quantum `bar` (`now` for Shift), and the render goroutine keeps the
voices, rendering each from the output frame it started at, looped, into bus
A after the tape, the click and the FX. A voice stops with a 3 ms fade; the
transport's Stop and a mixdown's pass stop them all, and the lane's Solo
leaves the tracks out of the output. What plays is `live.cue`. The lane is
not in the mix or its exports: a clip reaches them only once it is dragged
onto a track.

**The feed strip** in the Studio is the ribbon with GRAB, KEEP and Flag in
one row. A tap on GRAB or KEEP takes the last length and its ▾ picks
another (1, 2, 4 or 8 bars for GRAB; 30 s, 2 m or the whole feed for KEEP);
the input follows the armed track's, with an override in GRAB's ▾. The
readouts (free disk, dropped buffers, the MIDI tempo, *Input channels*)
are in a sheet behind the strip's lamp, which lights when something is
wrong, with a link to the Rig. ● Phone shows on the strip only while it
records.

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

### The shell

One document, `web/static/shell.html`, is served at `/`, `/index.html`,
`/tape.html` and `/takes.html` (`cmd/hindsight/main.go`; `main_test.go`
checks it). It holds the header, `<main id="views">` with one
`<section class="view">` per view, `#np-dock` (the dock slot, then the one
`#np`), `#toasts`, the shared sheets (Settings, Releases, output, phone) and
one script, `lib/shell/boot.js`. `wave.html` (Open), `rig.html` and
`guide.html` are separate pages; leaving for one unloads the shell, and the
carry (`lib/bar/carry.js`, `handoff.js`) resumes a take on the way back.

**Views** (`lib/shell/views/`: `studio.js`, `room.js`, `capture.js`; Capture
is what `/` shows when the tape is off) export
`{ id, title, bodyClass, help, prewarm, mount }`. `mount(ctx)` runs **once**,
on the first visit (or before it, out of sight: *Moving between rooms*,
below), and answers `{ ready, show({first}), hide(), destroy() }`. A view stays
mounted after that and is hidden, never rebuilt: the tape page is a module
singleton, and a listener registered twice makes Space press ▶ twice. `ctx`
(`lib/shell/view.js`) carries:

- `engine`, `go(url)`, `tapes`, `toast`, `link`: shared. A view never creates
  the bar's audio and never assigns `location` to a room path.
- `on(target, type, fn)`, `every(fn, ms)`, `loop(fn)`: a listener, interval or
  ticker step that does nothing while the view is hidden. Every global
  listener, poll and frame loop goes through these, so a hidden view costs no
  CPU and no network.
- `socket(open)`: a connection held only while the view is shown.
  `open()` runs on each wake (after `show()`, with the polls) and answers
  something with a `close()`, called when the view is hidden or destroyed.
  A room's socket to the Pi (`lib/socket.js`'s `connectSocket` or what is
  built on it) goes through it, so a room not shown holds none open.
- `active()`: shown and the document visible.
- `layers`: the view's scope of the shell's one stack of open things
  (below). A menu, sheet, drawer or selection the view opens goes on it with
  its `onClose`, and whatever is still open when the view is hidden is
  closed then, as its slots are taken out.
- `headerSlot`, `dockSlot`, `barSlot`: **Slots**. What a view adds to the
  header, the dock or the bar is in the page only while it is shown: `hide()`
  takes the nodes **out of the document** and `show()` puts them back. So
  `getElementById` on a docked node (`#multi-bar`, `#clip-editor`) answers
  null while the Studio is hidden; code that can run then (a timer) must hold
  the node, not look it up.

All views share one id namespace, since hidden ones stay in the DOM
(`pages.test.js` checks the union). The CSS is global and keyed on the body
class the router sets (`tape-page`, `shelf-page`, `main-page`).

**The router** (`lib/shell/router.js`) routes a same-origin click on a link
whose path is a view, unless a modifier, `target` or `download` says
otherwise; `go()` pushes `{shell, view, scroll}`; a switch hides the old view,
swaps body classes and slots, sets the title, `aria-current` and the help
page, and shows the new one, inside a View Transition when there is one
(*Moving between rooms*, below).
`popstate` switches only when the path names another view, so an entry of
the same room (the stack's own, in Safari) is left to its owner. Before a
switch the router calls `chrome.beforeSwitch` (the stack's `leave()`), which
closes everything open but the phone's player; on a tap it then waits for
the stack's own Back, or writes the room's entry over the stack's, so no
dead entry is left for Back to land on. Each view keeps its own scroll. If `mount` or `show`
throws, the router falls back to a full navigation.

**Moving between rooms** (`lib/shell/router.js`, `css/rooms-motion.css`).
The Studio's desk and the Listening Room's shelves are two walls of one
space, the Studio on the left, as the tabs are (`WALLS`; Capture is on the
Studio's wall). A switch from one wall to the other **turns a camera**: in
a View Transition the old room swings away to one side about a point in
front of the screen, its far edge turning from you, as the new one swings
in from the other, the two meeting at their corner halfway (28° between the
walls, 20° on a phone, the eye at the pivot so they never cross), dimming a
little over the room's own dark; on the lid spring
(`--spring-lid`/`--t-spring-lid`), transform and opacity only, on the
transition's snapshots. Along one wall (Studio and Capture), and every
switch with less motion (read at each switch, so turning it on takes at
once), it is a crossfade over `--t-touch` instead, and what would move on
the desk (the lit tab, a bar of another shape) changes in place.

- **The desk holds still.** While a switch is drawn, `.appbar` and `#np`
  have view-transition names (`appbar`, `np`), so only the room behind them
  turns; what changes on them (the header's left zone, the bar's keys)
  crossfades in place. The names are the only thing this file gives them:
  their layout is their own stylesheets'. (Until the bar has one shape, the
  Listening Room at 1000 px and wider draws it as a dock of its own, so
  there it morphs into the dock rather than holding still: J2.10, a todo
  flow, says when it stops.)
- **The router says how to draw it** before `startViewTransition`, on the
  html element, so it works in Safari 18.0 (no transition `types`):
  `data-turn` is `right` or `left` (the way the camera turns, `turnOf`) or
  `fade`. It comes off when the transition has finished. A switch asked for
  while one is drawn (a second tap on a tab, Back) skips that one's turn
  (`skipTransition`).
- **The update only flips.** Inside the transition's update the router
  hides the room left, swaps the body classes and *reveals* the room
  arrived in (`view.js` `reveal`: its root shown and its slots back, as it
  was left; a canvas keeps its picture while hidden). Its own `show()`, its
  title, its loops and its polls (`wake`) run only once the turn is over:
  work on the page while it turns holds up the turn's first frames on a
  tablet.
- **Rooms are mounted before their first switch.** Once the first room is
  up (its mount's `ready`: the Studio's first poll), the router mounts, in
  idle time and out of sight, each room a tab leads to whose view says
  `prewarm: true` (the Listening Room, Capture; not the Studio, whose mount
  takes the bar's transport and output). A prewarmed mount runs with its
  root hidden; what it adds to a slot waits inside that root (in the
  document, so a lookup by id finds it); its listeners, polls and loops are
  as quiet as a hidden view's; then its polls run once, so its data is in,
  and its own `hide()` runs. So such a mount must not touch the room shown:
  no class on `<body>` (a class it adds anyway comes off at once and is
  reported; the view's classes are its `bodyClass`, the doorway's
  `room-on` is `lib/room/mount.js`'s `BODY`), nothing in the header, the
  dock or the bar but through its slots, and nothing to the room shown (a
  saved scroll is restored only by a room that mounts shown, never by one
  warming while the Studio is up). Its first visit is a reveal, still
  `first: true`, but its `hide()` has run before it: so its `show()` puts
  back on every visit what `hide()` put away (Capture's live socket), and
  what it runs outside `ctx` (Capture's ribbon, on its own timer) stops in
  `hide()` and starts in `show()`.
- **A tap lands where it looks, or nowhere.** While a switch is drawn,
  what is on the screen is the turn, and the page under it is the room
  arrived in laid out at rest (before the update has run, still the room
  left). Chromium hit-tests a press, and `elementFromPoint`, to `<html>`
  while a View Transition runs; a mouse's click goes to `<html>` too, and a
  finger's click goes through the overlay (`:root[data-turn]
  ::view-transition` has `pointer-events: none`) to what is laid out under
  it, not to the picture. So a press during a turn ends it at once
  (`skipTransition`), and its click lands only on the desk that holds
  still (`.appbar`, `#np`), on the control the press was on (hit-tested
  once the turn is over), and only once the swap is done; a click on the
  room, or on a key the swap took away, goes nowhere. A tap on ▶ or a tab
  as the camera turns does what it says; a tap on the room only ends the
  turn.
- **The entrance contract.** While a turn into a room plays,
  `html[data-arriving]` names that room (`room`, `studio`, `capture`): set
  before the transition starts, so the room's own entrance (the shelves
  settling, the room showing in full and then falling back to ambient
  light) plays inside the turn, and taken off when it has finished. With
  less motion, along one wall, or without View Transitions it is never
  set. A room's entrance is CSS keyed on it (`html[data-arriving="room"]
  .shelf …`), transform and opacity only, done within `--t-room`.
  `router.test.js` holds the contract.

The flows check it: J2.2 that the camera turns both ways, the header's box
is the same before, on every frame of the turn and after, the bar is never
turned with the room, a tap on ▶ mid-turn stops the take, and a tap on a
take's spine mid-turn plays nothing; J2.10 (todo until the bar has one
shape) that the bar keeps its box too.

**One way to close things** (`lib/ui/layers.js`). Menus, popovers, sheets,
drawers, a selection and the phone's player sit on one stack per document
(`layersOf(document)`: the shell's, handed to each view as a scope; Open,
the rig and the guide have their own). Back and Escape close the top one
first: a menu, then a sheet or a drawer, then the selection, then the
player (`RANK`), the newest first among the same, and nothing under a modal
layer (the player pulled up) before it. Only once nothing is open does Back
leave the room; a press
outside closes a menu; a switch of rooms closes the menus and the room's
own sheets and selection (the player stays up), as a view's hide would. An owner opens with `layers.open({el, kind,
owner, onClose})` and closes with `layer.close()`, so its `onClose` is the
one way out, whoever asked. Where the browser has `CloseWatcher` (Chromium:
Escape, and Android's Back) each layer has one, made in the press that
opened it; elsewhere (Safari) an Escape keydown closes the top layer, and the
stack holds one history entry while anything is open (`historyStep`), so the
iPad's edge swipe closes it too. A modal sheet that is not on the stack
(Rename, Settings, a confirm: a `<dialog>` shown with `showModal`) is over
all of it: with `CloseWatcher` its own is the newest, and in Safari the
stack leaves Escape to the browser and closes the sheet on Back, so neither
lets go of what is under it. Never both for one layer, or Back would
take two presses. A handler that keeps Escape for itself (a field's own, a
drag let go) calls `preventDefault()`, and the stack leaves that press be.
In Chromium the browser's own Back button is a move in the history, not a
close request: it switches rooms, with the menus closed on the way.

**Menus** (`lib/ui/menu.js`). A menu, or a ▾'s panel beside its key, is
`menu(button, panel, {layers, role, side, align, floor, render, focus})`
on that stack: the button says what it opens (`aria-haspopup`,
`aria-expanded`, `aria-controls`), ↑ ↓ Home End move along it, Tab closes it
and goes on from the button, and it closes only through its layer. `place`
is where it goes (pure: below its key or above it, its right or left edge
on the key's, moved in from the screen's sides and kept off the bar at the
foot by `floor`), fixed, so no panel's overflow clips it. It grows from its
key: `data-state` (`open`, `closed`) and `@starting-style` scale it from .96
as it fades in over `--t-touch`, and fade it out over `--t-exit` (eased
in, as anything leaving is), taking no press while it goes. `splitKey(verb, more, panel)` is a key with a ▾ of
its own (KEEP ▾, GRAB ▾). Its rows are `menuItem`s, the one style (☰'s, 48
px, a line under the word), with `menuRows` putting a divider between
groups and anything that destroys last. Several buttons may share one
panel (the Studio's four input chips, one input menu): it shows for one at
a time. ☰ and every menu in the Studio are on it: KEEP ▾, GRAB ▾, Catch ▾
(a key of its own beside Catch), the tape's name, the tempo on the bar's
display, the ruler's ⌗ (the View menu) and a track's input chip; on Open,
the take's name. Open's More, Send to and lane menus are still their own,
to move in Open's pass.

**The engine** (`lib/bar/engine.js`), made once by the shell:

| Part | What it is |
|---|---|
| `engine.bar` | The bar's API: `loadTake`, `loadTakeByName(name)` (for the Studio and a reload with no shelf), `backToTape`, `setSource`, `playing()`, `snapshot()`, `onChange` |
| `engine.audio` | `adopt`, `owns`, `release`, `audioFor`: the take in the bar belongs to the engine, so a shelf row torn down never stops it, and two shelves never hold two elements for one take. Engine media is never in a view's subtree (a removed media element pauses) |
| `engine.tape` | The tape source. `ingest({tape, live})` (the Studio's poll feeds the LCD), `delegate({play, stop, locate, setLoop, poll})` (▶ in the Studio goes through the tape page's transport; the Studio delegates while it is shown and hands it back, `delegate(null)`, on hide, so the bar polls the tape itself in the other rooms), `setLevels`. While it polls the tape itself it watches `/api/tapes/changes` (`lib/tape/changes.js`) and polls on each new revision. `onPress(fn)` hears each press on the keyboard (see *The keyboard's press*), and `heardPress(p)` is the Studio's socket handing one on |
| `engine.stream`, `engine.output` | The one `StreamPlayer` and output wiring; `output-ui.js` renders them |
| `engine.feed` | The feed source |
| `engine.np` | The one `NowPlaying`; it sets `#np[data-source]` (`take`, `tape`, `feed`), and `.playing` on ▶ (`#np-play`) while it is heard playing: what ▶ draws (▶, ❚❚ for a take, ■ for the tape) is an icon, so a check reads the class. `lib/bar/player.js` sets `#np[data-size]` (`mini`, `full`) |

**Audio rules the design relies on.** Pushing history or hiding DOM never
touches media or an AudioContext. Autoplay gates are per document with sticky
activation, so after the first tap a later `play()` needs no new gesture. The
AudioContext is made once, on a tap, with `audioSession.type = 'playback'`,
and resumes on `visibilitychange`. Media Session has one owner, the engine.
`connectSocket` (`lib/socket.js`, under `connectLive` and `watchChanges`)
closes its socket on `pagehide` and reopens on `pageshow`, since
an open socket keeps the shell out of the back-forward cache, and a restored
shell applies a carry record rather than dropping it.

The checks that a journey through all this still works are the user flows
(`docs/flows.md`).

### The frame

The header (`css/chrome.css`, the second per-place stylesheet) is one rule
set for every page: the Studio, the Listening Room and Capture
(`shell.html`), Open (`wave.html`), the rig and the guide. It was four
blocks of per-page overrides once, which put Studio | Listening Room top
left in the rooms and top centre on Open and Capture, so a tap where it
usually was landed on the brand.

- **Three zones**, a grid of `minmax(0, 1fr) auto minmax(0, 1fr)`:
  `.appbar-start` (what you're working on: the tape's name in the Studio,
  the search field `#shelf-q` in the Listening Room, ‹ Takes and the take's
  name on Open, the feed's health on Capture), `.appnav` (the switch,
  centred, so it stands at one place on every page of a width; J5.1 checks
  it on the Studio, the Listening Room, Capture and Open) and `.appbar-end`
  (the page's ↶ ↷, then ☰, last). The brand shows only from 1280 px, first
  in the start zone.
- **A room puts its part into a zone as it is shown**: its context through
  the header slot (`lib/shell/boot.js`: the start zone), and the Studio's
  ↶ ↷ (`#header-studio-end`) into the tools before ☰
  (`ctx.headerSlot.add(el, { before: menu })`). Open, the rig and the
  guide have theirs in their markup. `lib/nav.js` `mountHeaderTools` adds ☰
  to the end of the tools zone the page has (and makes one only for a page
  without).
- **Each tab has its own picture**: the Studio's faders (`studio`) with the
  feed's lamp on them, the Listening Room's spines (`shelf`). **☰ means the
  header's menu and nothing else**: the shelf's List key has the `list`
  icon.
- **On a phone** (under 700 px) the header is the context (one pill a
  finger tall), ↶ and ☰ (↷ only while there is something to redo), and the
  switch is the tabs along the bottom, each its picture over its word.
- **What the header no longer holds**: the tempo (the bar's display), where
  the tape plays (the bar's display; `np-output` opens the output sheet,
  as the jam-only sheet's Switch does), and the alignment dot (SYNC on the
  bar's display, `lib/bar/display.js` `syncState`: green to the sample,
  amber by the clocks, red not lined up yet, out while the tape is stopped
  or plays on a phone).
- **A name that is a menu, and no ⋯.** What acts on a thing is in its
  name's menu, on `lib/ui/menu.js`, Delete last and red after a line of its
  own; never in a ⋯ beside it, which once split the tape's actions from its
  list of tapes, a third menu beside ☰.
  - In the Studio the tape's name (`#tape-name`) opens the tape's menu
    (`lib/tape/page.js` `renderTapeMenu`; its words, `lib/tape/tape-menu.js`):
    *The tapes*, each with its tempo and parts and the loaded one ticked,
    and New tape; Rename…, Duplicate; Share the mix, Bounce the loop,
    Bounce the whole tape, Export stems and Play the last bounce
    (`lib/rooms/bounce.js`); Record from this phone…; and Delete this
    tape…. Delete asks in `#confirm` (never the browser's prompt) by the
    tape's name and what is on it, then, the Pi keeping the tape it has
    loaded, loads the most recently changed other tape (or a new empty one)
    and deletes this one by its id. The menu reaches over the bar, as tall
    as its rows: a tablet's height above the bar can't hold them.
  - ⋯'s options went to ⌗ beside the ruler, the View menu on every screen:
    the snap, Lock the loop, Fit, Fold the tracks (`#tracks-fold-btn`, the
    one fold for the lanes) and, on a touch screen, Ask before Insert and
    Delete time. The key says the snap and shows the lock; Fit stands
    beside it too while the view is moved (in the menu alone on a phone).
  - On Open the take's name (`#take-name`, a pill with ▾) opens the take's
    menu: Rename… (the name becomes its field), Previous take and Next
    take, each with the take it opens by its spine's name, the downloads,
    Reset the downbeat, under 860 px its MIDI and under 1000 px its tag (no
    room beside the star), and Delete this take last. Its tempo, length and
    source are the line under the header (`.take-sub`), not in it.

### The bar

The bar (`#np`, `css/bar.css`, `lib/bar/`) is the one transport, the same
object in both rooms and the same shape on Open (`wave.html`), so **▶ never
moves**: not between rooms, nor between the tape, a take and the feed
(J1.13 measures it at 800, 1024 and 1280 and fails past 2 px, or on a
sideways scroll).

- **Five zones in a row, and the strip under them**, each a named slot in
  the markup (`data-slot`; `lib/bar/slots.js` `SLOTS`): the **deck** (the
  reels and the display), the **transport** (|◀ ▶ ●, with ↺ 5 s in ●'s
  place for a take, the feed, or the tape away from the Studio), the
  **verb** (Catch and its ▾ for the tape in the Studio; GRAB for the feed),
  the **modes** (⟲ Loop or Repeat, the metronome) and the **end** (⏏,
  Open ›, ✎ for a take), laid out first so nothing pushes it off. Every key
  is in the markup, in its slot; a script that adds to the bar puts it in
  a slot by name (`putIn`), never after whatever was appended last.
- **What shows is said positively.** Each key lists in `data-for` the
  sources it is for (`tape`, `studio` = the tape in the Studio, `away` = the
  tape anywhere else, `take`, `feed`) and in `data-mini` those it stays for
  in the phone's mini player; one rule in `css/bar.css` shows each source's
  keys, and a key's `display` is set nowhere else. No `:not()` lists and no
  `!important` (`shape.test.js`). A key a script hides by `hidden` (⏏ with
  no tape) stays hidden.
- **Its widths are its own**: a container query on its first row
  (`.np-row-1`, never `.np` or the dock, whose fixed descendants a container
  would hold). The deck's width hangs on the row's width alone
  (`--deck-w`, from `100cqi`), so ▶ stands at one x whatever the bar
  holds: from 600 px the zones are one row (the reels go under 960), from
  960 the deck is 352 at 1024 and grows to 768, and from 1180 the display
  says everything in full. Under 600 (the phone's player pulled up) the
  zones stack. The phone's mini player is `data-size="mini"`: its window,
  |◀ ▶, and a tail one width for every source.
- **Its height is measured** (`measureBar`: one `ResizeObserver` writing
  `--np-h` on the root), never written into the CSS; every reader has its
  `0px` fallback.
- **The display says what plays** (`lib/bar/display.js`): where it is, then
  three keys on the LCD, each a value over its legend: the tempo (in the
  Studio, with the tape, the tempo menu; elsewhere a readout), the source
  (TAPE, FEED or the take's name; `source-menu.js`: the tape, the live
  feed, the last few takes, Go to the shelf) and where it plays (JAM ROOM,
  PHONE, BOTH for the tape; THIS TABLET, THIS PHONE or THIS COMPUTER for a
  take or the feed; the output sheet). Each value has a short form and a
  long one, for the widest bar.
- **It folds by its grabber** (`lib/bar/fold.js`), a pill on a lip above its
  top edge: a tap toggles, a drag down folds, a drag up unfolds, and it
  slides by a FLIP on the lid spring (a transform, never a height a frame).
  Folded it is one row of 44 px keys, `body.np-fold`, kept for the visit. On
  a phone the grabber is the player's, and puts it away. ▾ only ever opens
  a menu.

### Vocabulary

Gabe, 2026-10-15: *"we have takes, clips, tapes, and records which is
confusing … we should just be able to listen to a file and if need then we
can dive in to make notes."* So: **two nouns, takes and tapes.** A take is
anything you kept; a tape is what you build on. Everything else on screen is
a place (the Studio, the Listening Room, the Rig), a part of a screen (the
feed, the buffer, the tracks, the bar, the instrument), or something inside a
take or a tape (a note, a tag, a star; a part, a section, the loop).

| Verb | Does | From |
|---|---|---|
| **KEEP** | makes a take, always, and nothing else | the feed (its last N, or a selection), the buffer, a take's selection |
| **BOUNCE** | makes a take from a tape, by playing it through the mixer | the tape's name's menu |
| **Share the mix** | sends a tape as an MP3, rendered on the Pi without the mixer (no Sidekick, no take, the interface may be off): `listen?all=1&format=mp3` | the tape's name's menu; Bounce's refusal |
| **GRAB** | fills the buffer | the feed (last N bars, or a selection); a take (bars before the playhead, a note, a selection) |
| **DROP** | empties the buffer onto a track | the buffer, ↵, a range's bar |
| **CATCH** | puts the last pass on the armed track | the Studio |
| **Cut · Copy** | a range of the tape into the buffer | a range's bar |
| **●** (Record) | records onto the armed track | the bar, in the Studio, beside ▶ |

Every key names its object: *KEEP 2m*, *GRAB 4 BARS*, *Drop on track 2 ·
bars 1–4*, *CATCH LAST PASS*. Words that mean these things are retired:
audio on a track is a **part** (not a clip); the clipboard is the
**buffer**; the ring is the **feed** (*Feed length* in Settings); a flag is a
**note**; a bounced *record* is just a take; Capture, Save as take and Cut
are **KEEP**; Copy from the feed is **GRAB**; Paste is **DROP**; Mix down and
Cut a record are **BOUNCE**; the bar's ⟲ is **Repeat**; the crate is not on
screen. `lib/rooms/words.test.js` enforces the retired list.

A tap on a take plays it in the bar, wherever you are; holding selects; the
bar is the only transport; **Open** (`wave.html`) is the one page to dig in,
and the bar's **Open ›** is its way in. The bar's display says what plays:
its **source** (the tape, the live feed or a take), and where it plays.

**A take is called one way** wherever a person reads it: its own name, or
the time it was caught, which is what its spine prints (`takeTitle`,
`lib/rooms/takename.js`). The bar, a search, Recently deleted, a toast and
a screen reader all say that; where nothing around it says the day (a
toast, Recently deleted) the day goes before the time (`{ day: true }`).
Never the file (`jam_….wav`) or its date stamp. The buffer names a take's
grab the same way (`grabTitle`, `lib/buffer/model.js`), from the grab's
`take` and `take_label` (the take's name when it was grabbed), not from its
`sources`, which the Pi writes for its own lines. Open's own page still
titles a take by its date stamp (`lib/wave/page.js` `stampOf`), until
Open's pass.

### The library

The Listening Room is a library (`lib/shell/views/room.js`, with the wall
in `lib/room/doorway.js`):

- **The shelf wall**, on a tablet and wider, fills the room from under the
  header to the bar: a shelf per month, newest first, then ★, then a shelf
  per tag (`lib/room/shelves.js` `wallShelves`); a take stands on each
  shelf it belongs to. Short shelves share a row and a long one scrolls
  sideways, its spines spaced so that it ends on half a spine at the case's
  upright, which says it goes on (`fitRows`, measured all at once). The
  perspective is drawn -- the shadow under each board, each cubby's sides,
  the lamp's light from the upper left -- and nothing that scrolls is
  turned in 3D: a tilted case (`rotateX` under the wall's `perspective`)
  was one big layer to scroll, and on a tablet a drag that started on a
  spine moved nothing (`styles.test.js`, J2.7). Nothing on it animates by
  its scroll; the playing spine's green ring breathes by its opacity, on a
  layer of its own (`.room-cassette-glow`). A shelf's **All ›** opens the
  List to it (`shelfNames`).
- **The List** is `#takes` (`lib/takes.js`, the rack): by month and then by
  day (`lib/shelf.js` `shelve`), each row a case with its **›** to Open,
  NEW for a day, the playing row ringed; *Recently deleted (n) ›* is its
  last row. A phone's library is the List.
- **Shelf | List** is how this device sees the room, remembered in this
  browser (`lib/room/library.js`, a line in `lib/device-prefs.js`); a
  phone starts on the List, wider on the wall. **Sort ▾** (`menu.js`):
  newest, oldest, longest, name, for both. The chips: ★, the tags, *This
  week*, MIDI.
- **The search** is `#shelf-q`, found by its id wherever the page puts it.
  Used, it opens the List with the field pinned and the results right under
  it; *Cancel*, or Back, empties it. It matches what a person sees
  (`searchText`): the spine's title, the day in words, the tag, the tempo,
  the notes' words, every word typed.
- On a tablet and wider the room (and its toolbar) is pinned to the
  window where the page's own box for it is (`--room-top`, `--room-h`,
  measured from `main` by a ResizeObserver), so a page pushed sideways by a
  bar too wide for the screen moves the header and the bar, never the
  shelves.
- A shelf opened by All ›, and the search, are each on the page's stack
  (`ctx.layers`, kind `drawer`), so Back and Escape put them away.
- **The drawn room is the backdrop** (`lib/room/stage.js` `backdropRoom`:
  the room without the bookcase and the deck, whose faces were page
  markup): at `--room-ambient` behind the wall, in full only while
  `html[data-arriving="room"]` is set — the router's, while a switch into
  the room plays — then fading back over four of the room's moves. The deck
  and the Sketchbook's place are gone from the room; ✎ on the bar opens the
  Sketchbook's notes until the notes drawer replaces it.

### Icons

A key's picture is a symbol in one sprite, `web/static/icons/ui.svg`: line
art on a 24 grid, in the key's own ink (`currentColor`), its stroke's width
`styles.css`'s (`svg.i`, 1.75; under 16 px 2.25, and a small ▾ 2.75, as the
kit draws them). The unicode
glyphs the keys had (↶ ⋯ ▾ ✎ ⏏ ⌗ …) were drawn by each platform in a fallback
font of its own, so a key fitted on a laptop ran off a tablet in CI's fonts.

- **In the markup, so it is there at the first paint**: `<svg class="i
  i-undo" width="22" height="22" aria-hidden="true"><use
  href="/icons/ui.svg?v=…#undo"/></svg>`. A script writes the same with
  `icon(name)`, and changes what a key shows with `setIcon(key, name)`, which
  writes only when it changes (`lib/ui/icons.js`). The key says what it
  does (`aria-label`, its words); the icon is hidden from a screen reader,
  and a tap on it is a tap on the key (`pointer-events: none`), so help
  mode's tips and the keys' own handlers see the key.
- **State is the key's, not its picture's**: ▶ is `.playing` while it is
  heard playing, whatever it draws (▶, ❚❚ for a take, ■ for the tape); a
  fold's ▾ turns over by `body.np-fold` or `aria-expanded`, in CSS.
- **A key keeps the width its glyph gave it**: an icon's box is wider than
  its line, and where a ▾ or ⌗ follows a word its blank sides come off the
  key's gap or padding (the rules say so where they do it).
- **The sprite's address moves with it**: `SPRITE` (`lib/ui/icons.js`) is
  `/icons/ui.svg?v=` and the first 8 hex of the file's sha-256, and the
  pages, `sw.js`'s `SHELL` and every script ask for exactly that. A browser
  keeps the SVG a `<use>` names by its URL — across a reload, which is what
  the Update button does, and in its HTTP cache when the app is opened again
  — so a sprite changed at the same address goes on drawing the old copy,
  and a symbol new to it as a blank key. Bumping `CACHE` does not reach it.
  Change the sprite and `icons.test.js` names the new address.
- The loop's lock is two symbols, its body and its shackle, so the page can
  slide the shackle open.
- `lib/ui/icons.test.js` fails on a name a page or a script uses that the
  sprite hasn't got, on a symbol that isn't in `ICONS`, on markup that
  doesn't name the icon it shows, on the sprite missing from `sw.js`'s
  `SHELL`, on an address that isn't the sprite's hash, on an icon written
  under 16 px that isn't drawn heavier, on a key of the header, the bar or
  the ruler that goes back to a glyph or has no tip, and on a script that
  types a glyph into a key: `TYPED` counts, by file, the writes still left
  in the regions not drawn yet, and a count only goes down. The objects bench (`objects.html`) shows every icon.

### The scene contract

`lib/scene/` (the object library is `lib/objects/`). Three parts, three
owners: **the page writes state** (plain data, targets: *loaded take 41*,
*cable from ch1 to track 2*; objects never fetch); **the model steps** each
object on the shared ticker (`lib/objects/motion.js`) and derives its view;
**a renderer draws views** and never writes state or computes motion
(`SceneObject`, `Scene`, and the duck-typed renderer documented in
`lib/scene/renderer.js`: `mount`, `frame`, `hit`, `twin`, `destroy`). Rules
every renderer keeps:

1. Motion comes from the models, so flat and 3D move identically and tests
   drive them with a fake `dt`.
2. Every interactive object has a DOM twin, a real `<button>` over it, for
   focus, keys and screen readers; WebGL draws over accessible markup, never
   replaces it.
3. Drop frames, never input: picks go through `hit()` and the twins.
4. Reduced motion is the ticker's job (`dt = Infinity` settles everything);
   a renderer never checks the media query.
5. Park when still: a settled model returns `false`.
6. Big assets (models, textures, three.js) stay out of the service worker's
   `SHELL`, in a versioned `hindsight-assets` cache.
7. No bundler, no CDN: three.js, when the Rig needs it, is one pinned ES
   module under `web/static/vendor/three/`, lazy, behind a flag.

### A frame's budget

The device this has to be smooth on is a mid-range Android tablet, and its
main thread also feeds a phone's stream. Measured at a 4x CPU throttle,
the Studio fell to 6-18 fps while the tape played, because each frame
redrew every lane and wrote each lane's head before measuring its canvas.
What a frame may do, in the Studio and anything else on the ticker:

- **Put back, don't paint.** The lanes are painted only when what they show
  changes (`laneKey`), or the view moves; while the tape plays each is
  painted twice, as layers, as if none of it had played and as if all of it
  had, its parts lit (`lib/tape/playhead.js` `compositeLane`). A frame cuts
  the two at the playhead and draws the playhead over them; the ruler and
  the overview put back a base the same way. And it puts back only the
  columns the playhead moved over since the last frame (`headBand`), a few
  device pixels, not the canvas: everything else on it is already right.
  A page turn repaints, once.
- **Never measure or read style.** Canvas sizes come from a
  `ResizeObserver`; colours from `tokenCache` (`lib/theme.js`), forgotten
  when the scheme flips. A measure after a DOM write is a forced layout.
- **Write the page only when it changes**, and text that changes often in
  place (`lib/text.js` `setText`): a text node put in or taken out makes
  Chromium check every `:has()` rule above it, and `styles.css`'s
  `body:has(…)` rules make that a style recalculation of most of the page,
  for each digit of a counter. Text written in place is spared that only
  while no `:has()` tests `:empty`: one that does, anywhere, has Chromium
  look again at every `:has()` above any text that changes, so none may
  (`lib/text.test.js`). Likewise an inherited custom property set on
  a container restyles all of it: the bar's `--np-progress` is written only
  where the phone's mini player draws it. And an SVG attribute set to the
  value it has is still a restyle and a layout of its picture: the reels'
  packs are set only when they change.

`lib/tape/playhead.test.js` walks what the playhead's step calls and fails on
a measure, a style read, a write to the page or a lane painted.

### Motion

One set of times, eases and springs for the whole app, in
`lib/objects/motion.js`: `T` (press 0, release 120, touch 120, move 200,
exit 120, sheet 280, room 300, flight 420 ms), `EASES`, and `SPRINGS` as a
damping ratio and a natural frequency (snap, lid, carry, and the VU
needle's). `spring()` is the exact step of any of them, critically damped
and overdamped included, for anything a finger drives or that may turn
round halfway; `springEasing()` is one as a CSS `linear()` and its own
duration, for a move that runs to its end; `project()` is where a flick
comes to rest.

- **The CSS has them as tokens** (`--t-*`, `--ease-*`, `--spring-*` with
  `--t-spring-*`, at the top of `styles.css`), written by
  `node scripts/motion-tokens.mjs --write` from `lib/objects/motion-css.js`;
  `lib/objects/motion-tokens.test.js` fails while the two disagree. A
  spring's curve goes with its own time: over another, it is another
  spring. A browser without `linear()` takes the nearest cubic-bézier.
- **Less motion, in one place:** one `@media (prefers-reduced-motion)`
  block zeroes every time a thing travels in (the fades stay), and the
  ticker follows the setting as it changes. The room switch reads it at
  each switch and crossfades instead of turning (*Moving between rooms*).
- **Nothing turns by `@keyframes`.** A reel or a hub turns by its model on
  the ticker, drawn from frames rendered in Blender (`lib/objects/spin.js`,
  `scripts/blender/spools.py`): the reels at the tape's speed, each by its
  pack, blurred as they wind to a jump; the cassette's hubs each by how much
  tape is on it. Reduced motion holds them still.
  `lib/architecture.test.js` fails on a stylesheet that spins something.
- **The room switch is a camera turn** between two walls of one space, the
  header and the bar held still: `css/rooms-motion.css`, drawn by the
  router (*Moving between rooms*, under *The shell*).
- **A key goes down at once** and comes back on the snap spring: its
  `:active` rule draws `.down` too and zeroes the time into it
  (`--t-press`), and `lib/ui/keys.js`, wired once at each page's boot after
  help mode, adds `.down` on the pointer's first touch and keeps it 80 ms,
  so a touch (whose `:active` Chrome holds back) and a quick tap both show
  it. A key's hover rules step aside while it is down, so under a mouse it
  goes down too. The big transport keys travel 2 px; spines and cue clips
  (`.sinks`) sink 2 px by their `translate`. Lamps light at once and fade
  over `--t-move`. `lib/ui/keys.test.js` fails on a key's `:active`
  without its `.down`, and on a hover rule that would hold a pressed key
  up.

### Waking up

A tablet that sleeps freezes its page, and a request or socket that was in
flight is often neither answered nor failed: it never comes back. Every page
therefore gives its reads a deadline and checks its link on waking
(`lib/link.js`, node-tested):

- **Reads time out.** `timedFetch` aborts a request that isn't answered
  (8 s; the Studio's tape poll, which runs five times a second, gives up after
  4 s). The Studio's poll used to run only when the last one had finished,
  so one lost poll stopped them all, and the page showed the tape as it was
  when the tablet went to sleep. Now `lib/tape/poll-gate.js` lets a poll
  forced on waking go ahead of one that may be lost, and drops the lost
  one's answer if it ever arrives.
- **A dead socket is noticed.** Nothing tells a page that its socket died
  in its sleep, so `lib/socket.js` (`connectSocket`, which `/api/live`'s
  client, `lib/live.js`, and `/api/tapes/changes`'s, `lib/tape/changes.js`,
  both use) treats 4 s without a message as dead and replaces it, waiting
  0.5 s after a failure and up to 5 s after repeated ones. `/api/live`'s
  frames come ~100 times a second; `/api/tapes/changes` beats once a second
  for this, since its pings are answered by the browser below JavaScript,
  where the page can't see them.
- **Waking is an event.** `onResume` fires when the page is visible again,
  shown again (`pageshow`, bfcache or not), online again, or when a one-second
  tick arrives more than 3.5 s late (the clock jumped; timers were frozen,
  whatever events fired). The page then refetches at once: the Studio its
  tape state and clipboard, Capture its status, takes and meters, the
  Listening Room its list, the take page the take (merged as after any return to
  the page, so an edit still being saved, or a selection not yet saved, is
  kept).
- **The note.** A source that fails (`link.fail('tape')`) and doesn't recover
  within a second shows *Reconnecting…* (`.link-note`) and clears when every
  source answers; a failure that clears first is never shown.

Service-worker registration and the screen wake lock are both guarded on
`window.isSecureContext`, so they switch themselves on if the Pi is ever given
an HTTPS name and stay quiet otherwise.

### The take page

The take page (`wave.html`, *Open*) is the one place a take is edited: a
header, the overview, an editing canvas in three zones, a toolbar, and the
MIDI lanes.

`web/static/lib/wave/` holds the page; `lib/edit/` and `lib/help/` hold what
it shares with the Studio. The pure parts of each are node-tested.

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
| `link`, `socket`, `live`, `tape/poll-gate`, `tape/changes` | Reads that time out, the wake-up refetch, the *Reconnecting…* note; a socket that replaces itself (`socket.js`'s `connectSocket`), for the live meters (`live.js`) and the tape's changes (`tape/changes.js`, see *The revision*); one poll at a time, and a nudge's poll after it (see *Waking up*) |
| `toast` | Both pages' toasts, with an optional action ("Flag deleted · Undo"), and one carried to the next page |
| `takes`, `trash` | The Listening Room's list, with select mode for several takes at once; *Recently deleted* |

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
