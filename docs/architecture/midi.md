# MIDI

Two things happen with MIDI. Each take is stamped with the tempo measured
over its own window, as before; and everything every connected instrument
sent during the window is written beside the take as a Standard MIDI File,
placed on the take's timeline to within a couple of milliseconds, with a
tempo map so the notes sit on the DAW's grid.

## Every port, no cgo

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

## Controllers

A port that `TAPE_CONTROLLER` names is a controller: its notes and CCs
go to Play mode's bus on the Pi (`internal/api/controls.go`), a
`midi.ControlSink`, whatever page is open. Each one is looked up in that
controller's bindings: `controls.json`, keyed by the controller's name, or
a known controller's profile, or the defaults. The bus presses a pad, moves
an amount or runs a verb (CATCH, the transport, GRAB, DROP, KEEP): the
tablet's own verbs, `Verbs` in `internal/api/verbs.go` (`tape.md`, *The
verbs*), pressed bare. MIDI LEARN binds the next message.

A controller can also talk back in SysEx. The parser hands a controller's
complete SysEx messages, up to `midi.MaxSysEx` bytes, to the sink if it
is also a `midi.ControlSysExSink`. They still stay out of the event ring.

The SMK-37 on Hindsight's own firmware, which talks back this way, is in
`keyboard.md`.

## The clock bridge

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

## The tempo map, and why takes start on a downbeat

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
