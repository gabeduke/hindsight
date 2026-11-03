# The capture path

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
`INPUT_LATENCY_MS` is not small" in [configuration.md](../configuration.md).

## Extra inputs

`EXTRA_INPUTS` names cards that only record, beside the main interface: the
Zoom AMS-24 beside the EP-136, for a guitar. The EP-136 stays the main
interface: the tape plays out of it, it is the monitor, and its clock is the
ring's. Nothing ever plays out of an extra input; its playback side is never
opened. (`docs/plan/extra-inputs.md` has the decisions until it lands.)

**The bus.** Each extra input adds `config.ExtraInputChannels` (2) channels
after the main interface's, so the AMS-24's IN 1 and IN 2 are channels 9 and
10. `Config.BusChannels` is the ring's width, the meters', a take's under
`SAVE_ALL_CHANNELS`, and what `SAVE_CHANNELS` and `TAPE_SOURCES` are checked
against. The ring is sized for the extra channels while the card is unplugged,
so the numbering never moves with what is plugged in; they are silence until
it is.

**Its stream** (`ExtraSource`, `extra_alsa.go`) opens the card through ALSA
directly, `hw:CARD=<id>,0`, found in `/proc/asound` by name, id or USB id:
outside PortAudio, so a replugged AMS-24 is just an open that starts working
again. A PortAudio rescan closes every stream, the EP-136's too, and that hole
in the dashcam is the one failure that can't be repaired. Its own supervisor
(`extraInput.supervise`) reopens it after 2 s without a block, with backoff,
and never rescans. `DEVICE_MATCH=auto` and the capture's fallback never pick
an extra input's card (`withoutExtras`), and `LoadFrom` refuses one card as
both.

**The joiner** (`extra.go`). The two interfaces run on two crystals, up to
±100 ppm apart: left alone, the guitar would slide 90 ms against the synths
over a 15-minute ring. So the ring writer, still the one writer, writes each
EP-136 block at the head (`Ring.WriteNarrow`, zeros in the extra channels),
then the extra input's frames for the same moments into channels 9-10 a
fixed lag behind it (`Ring.WriteChannels`), resampled onto the EP-136's
frames by `steeredResampler` (`resample.go`). Where each frame goes comes
from the two clock bridges: ring frame *f* was converted at the main
bridge's `NSAt(f)`, which the extra stream's own bridge maps to the input
frame being converted then, less `EXTRA_INPUT_OFFSET_MS`. The ratio is
steered so the resampler reads there: proportional and integral on that
error, critically damped at 10 s, within ±200 ppm (0.35 cents: no audible
wobble). In the tests it lands within a frame and a half of the main
interface's pulses at 8 kHz, and within a frame at 48 kHz with 3 ms of USB
jitter. *Locked* is the error, smoothed over a second, within 1 ms for 2 s.

The lag (`Capture.ExtraLag`) is one main block, the extra stream's latency,
50 ms of slack and any negative `EXTRA_INPUT_OFFSET_MS`, about 200 ms: the newest that long of an extra channel is
not written yet. Its meters don't wait: they are fed from the extra stream's
own blocks (`Levels.AccumulateAt`), counting their own samples per bin.

**When one side fails.** A block lost on the way, an overflow the device
reports, a reopen, a stretch with nothing for over a second, or an error past
20 ms (a clock that jumped) all re-seed: the resampler is emptied and placed
again from the bridges, and the span from where it was writing to where it
is placed again is an extra-input gap (`Capture.ExtraGaps`), silence. Its
meters hold their last level across one burst of bins at most, then read
silent. Each open, and each
overflow, starts a fresh bridge, so a stretch of the extra stream's frames
never has a hole in it. The EP-136 stalling stops the ring, so nothing is
written to 9-10 either; the joiner re-places itself when it moves again.
With the EP-136 absent nothing records, since it is the clock.

`/api/status` reports each extra input (`extra_inputs`): what it opened, its
channels, live, locked, and how far its clock runs from the main one's.

In the demo, `EXTRA_INPUTS` set to anything opens a synthetic guitar
(`NewDemoExtraSource`) whose clock runs 80 ppm fast, so the steering is
exercised without hardware.

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
