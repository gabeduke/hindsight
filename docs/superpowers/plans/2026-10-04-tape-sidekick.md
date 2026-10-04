# The tape on the Sidekick — step 6b of the editing-model roadmap

**Spec:** [tape](../specs/2026-10-03-tape-design.md): "The player", "One
PortAudio lifecycle", "Alignment: the Pi hears itself". **Checks:**
[guide](../../guide.md) §8.1–8.4, the [rig] ones. **Branch:**
`tape-sidekick`, stacked on `tape-engine`.

## Decisions taken while building

- **One PortAudio lifecycle with a stream registry.** Every stream opens
  through it, under its lock, with the device picked inside the lock too; a
  terminate closes every registered stream first and moves a generation on.
  With `TAPE` off, the capture's behaviour is unchanged: its stream is
  always closed before it rescans, so the registry is empty then.
- **The output keeps itself open,** as the capture does: retries with
  backoff while the Sidekick is away, reopens after a rescan (the generation
  moved) or a stall. An output that isn't there at boot isn't an error; ▶
  reads *no output* until it is.
- **Only the capture's card.** The capture's own device if it has four
  output channels, else the most direct `DEVICE_MATCH` device; never HDMI or
  `default`.
- **Δ from two clock bridges, then a lock.** The output's bridge records
  each buffer's DAC time, so no latency has to be guessed. The lock is a
  PHAT cross-correlation by FFT of the last second each bus delivered
  against its channel tap, ±50 ms around the estimate, after a double
  difference so a loop's bass doesn't hide the attacks. One sharp peak or
  nothing.
- **Δ as segments.** Output restarts and underflows, and capture drops,
  start a new segment; a catch uses the segment its span played in.
- **The demo can align too** (`TAPE_DEMO_ALIGN=true`), which is how the
  whole path is tested without hardware: a test locks on the demo and checks
  a catch holds exactly what played.

## Not here

- Immediate stop and mute (flushing what's rendered): quantized actions
  cover phase 1.
- Strip gain from the fit, and the clipping warning.
- The aligner's correlation is the CH taps'; MAIN isn't used, since it
  carries both buses and the live instruments.

## Still to verify on the rig

The [rig] checks in guide §8.1–8.4, and the spec's verify list item 6: a
PortAudio output on the EP-136 beside the running capture, its CPU, and how
often it underflows at `OUTPUT_LATENCY_MS=100`.

## Tasks

1. `palifecycle.go`: the stream registry and generations; the capture opens
   through it. Tests.
2. `outpick.go`, `sink_portaudio.go`, `sink_nocgo.go`. Tests for the pick.
3. `xcorr.go`: FFT and the PHAT correlation. Tests, including a loop with
   bass, a pure tone, and as much again of something else.
4. `align.go`: history, estimate, lock, segments; the engine's catch uses
   the segment's Δ and `TAPE_LATENCY_MS`. The demo's aligning sink. The
   end-to-end test.
5. Config: `OUTPUT_LATENCY_MS`, `TAPE_LATENCY_MS`, `TAPE_DEMO_ALIGN`.
6. Docs: guide §8 (the dot, the [rig] checks), api.md, architecture.md,
   configuration.md.
