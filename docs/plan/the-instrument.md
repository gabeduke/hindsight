# The instrument

Agreed with Gabe on 2026-10-26, after he played the effects from his phone
while listening on the phone: *"there is quite a bit of latency which makes
it more of a novelty than an actual instrument."* What he asked for:

- Hindsight as something you play, not only something you edit: an
  OP-1 Field-like box, *"a great opportunity to make our own product once
  the software is dialed in"*, in an enclosure of its own.
- The phone stays the place for *"arranging & doing more DAW type
  actions"*; it doesn't need to effect the jam room live. Effects played on
  the phone can be played *locally* and recorded *"to a new audio stream
  that could be added to a buffer or tape track"*.
- The M-VAVE SMK-37 Elite, on firmware of our own, as the box's real-time
  control surface: *"transport, effects, clip arranging, and it even has
  its own audio engine to play on top of our tape."*
- Measurements first, and from use: *"instrumenting the app so we get
  these measurements through usage."*

This is a plan of tracks, not one sequence: the engine, the phone's
effects, the box's screen, the controller and the product each move on
their own, and each step below is its own PR and checkpoint.

## Where the time goes today

From the code's constants, not yet measured (step 1 measures them):

| On the way to the ear | Jam room (the Pi's output) | The phone, listening on the phone |
|---|---|---|
| A touch, over Wi-Fi to the Pi (WebSocket `/api/tapes/play`) | 10–60 ms | 10–60 ms |
| A MIDI controller over USB (`internal/midi`) | ~1 ms | – |
| The render goroutine, ahead of the device (`aheadBlocks` 5 × `BlockFrames` 1024) | ~107 ms | ~107 ms |
| The device's buffer (`OUTPUT_LATENCY_MS` 100, 1024 frames, `HighLatencyParameters`) | ~100 ms | – |
| The stream's packets, then the phone's jitter buffer (0.8 s, `stream-buffer.js`) | – | ~820 ms |
| The phone's audio output (more on Bluetooth: 150–300 ms) | – | 40–100 ms |
| **About** | **250 ms** | **1.1–1.4 s** |

Neither is the language or the hardware: they are buffers chosen for a
recorder and a robust listen-along stream. Something you play needs about
10 ms from a control to the ear, so the engine needs a second way to run.

## Decisions

| | |
|---|---|
| Measure in use | The first step is instrumentation, not a bench: every control carries its times through the engine to the moment it is heard, and the app keeps the numbers (step 1). Every later step is judged by them. |
| The Pi 5 first | The instrument's target is the Pi 5. The Pi 4B stays supported: the same build, with larger buffers if its numbers say so, never a fork. |
| A performance mode in the engine | The tape keeps reading ahead; live controls (FX, pads, the transport from a controller) apply at the device's edge, on a small buffer, at real-time priority. The recorder's path doesn't change: the ring never depends on it. Momentary gestures never touch undo (AGENTS.md). |
| One DSP, in Rust | The FX are ported to Rust and built for the browser (WebAssembly) first. If the port holds, the Pi uses it too (through cgo) and `internal/tape/fx.go` goes: one implementation, not two. Until then Go and Rust run side by side, kept identical by a parity test. |
| The phone plays its effects itself | An FX pass on the phone downloads the region and loops it from memory, with the FX in an AudioWorklet: no stream, so no jitter buffer, and the phone knows the exact frame it plays, so what it records lands sample-accurately. The pass uploads through the phone-recording path (`/api/phone`) and lands as a clip, or in the buffer. |
| The web app on the box's screen | The box's screen (the Pi Touch Display, on DSI) runs the web app in a full-screen browser on the Pi, with an instrument view. Its controls reach the engine on the same machine, never over Wi-Fi. A native UI only if the numbers say the browser is too slow; that is a second UI to keep. |
| Our own controller firmware | The SMK-37 Elite gets firmware of our own, in a track of its own: display, transport, FX, arranging, and its sound engine over the tape. Until it lands, the stock firmware and the controller profile (`internal/rig/profiles/smk-37-elite.json`) keep working. |
| The product last | A compute module (CM5), a board and an enclosure once the software is dialed in on a Pi 5. The kit enclosure (draft PR #47) is the starting point. |

### To settle while building

My recommendation first in each.

- **What an FX pass saves**: undecided (Gabe, 2026-10-26). The audio as
  heard, first: simplest, and what was played. The knob moves with their
  frames, re-rendered on the Pi, later: full quality and editable, but it
  needs the one DSP above.
- **The WebAssembly build**: the `.wasm` committed beside its source, with
  a CI check that a rebuild gives the same bytes (as
  `scripts/motion-tokens.mjs` keeps its tokens), so a kit still installs
  from a tarball and `web/static` needs no build step. A Rust toolchain in
  CI either way.
- **Where the Rust lives**: a `dsp/` crate at the root. When the Pi links
  it, `dsp/**` goes on `release.yml`'s `paths` (AGENTS.md, *A new file
  that ships goes on the list*).
- **The performance mode's numbers** (buffer frames, blocks ahead, real-time
  priority, the CPU governor, whether the Pi needs a PREEMPT_RT kernel):
  chosen from step 1's numbers on both Pis, not in advance.

## Build order

### The engine

1. **Instrument latency, in use.** Nothing a person sees changes:
   - *The Pi:* a control (a WebSocket message, a MIDI message) is stamped
     when it arrives, with the output frame the render applies it at;
     the output's clock bridge says when that frame is heard. That gives
     control → ear on the jam room per event.
   - *The client:* the page stamps the touch (`event.timeStamp`) and the
     send, and keeps a clock offset to the Pi from the socket's round trips;
     a phone listening also knows its jitter buffer's fill (already
     reported) and `AudioContext.outputLatency`. That gives touch → ear on
     each path.
   - *Ground truth now and then:* the alignment's Δ (`align.go`) is a
     loopback measurement of the output already.
   - Rolling percentiles per path (p50, p95, max) with the buffer settings
     and underflows beside them, kept on the Pi, never sent anywhere else:
     `GET /api/latency`, a line in the Rig, and a dev overlay.
2. **The performance mode**, on the Pi 5, then checked on the Pi 4B: live
   controls at the device's edge, a small output buffer with
   `LowLatencyParameters`, real-time priority for the render thread. A test
   fails if the render path allocates (`testing.AllocsPerRun`), so the
   garbage collector has nothing to stop it for. Target: under 10 ms from
   a controller to the ear, by step 1's numbers.

### The phone's effects

3. **The FX in Rust.** `dsp/`: DRIVE, AGE, FILTER, CRUSH, ECHO as
   `internal/tape/fx.go` has them (the smoothing, the 5 ms gate), built to
   WebAssembly. A parity test renders the same input through Go and Rust
   and fails on a difference beyond a stated tolerance.
4. **The FX pass on the phone.** From a loop, a section or a track: the
   region downloads, loops locally with the FX in an AudioWorklet, ●
   records a pass, and it lands as a clip on a new track or in the buffer,
   one undo step. Target: under 50 ms from a touch to the ear. A flow for
   it in `docs/flows.md`.
5. **One DSP.** If step 3's parity held, the Pi renders the FX through the
   Rust crate and `fx.go` goes.

### The box

6. **The instrument view** (later, Gabe: *"we can do that later"*): the web
   app full-screen on the Pi Touch Display, a view for playing rather than
   editing, judged by step 1's touch → ear on the Pi itself.

### The controller (its own track)

7. **The SMK-37 Elite's firmware.** What the research found
   (2026-10-26, from published sources, each to confirm on Gabe's unit):
   - *The hardware:*
     - a JieLi AC791N (WL82) with 1 MiB of SPI flash;
     - a 240×240 ST7789V display over SPI;
     - a DX7-style FM synth with a sequencer and an arpeggiator;
     - 8 encoders, 16 pressure pads with RGB LEDs, 4 faders and 18 lit
       buttons;
     - class-compliant USB MIDI, BLE MIDI, and TRS MIDI out only.

     The Pro, the Elite and two rebadges are one hardware family; the
     Elite is the least tested of them.
   - *Open firmware exists:* M-VAVE's own `m-vave/smk37_open`. Its app
     layer is GPLv3 with an SDK exception; the SDK is binary-only, and the
     toolchain runs on Windows only. There are GPL ports and a board layer
     (genkigenki; Skiff), and several full replacement firmwares already
     draw on the display at about 60 fps. Baud Girl's SMK-37+VA is closed
     source, so we can't build on it.
   - *Recovery:*
     - the chip's mask-ROM download mode dumps the whole flash
       (`jl-uboot-tool`);
     - `m-bootloader` (MIT) adds a recovery menu on a key combination;
     - three regions are the unit's own and are never written: Bluetooth
       pairing at 0xC0000, factory calibration at 0xC1000, and the chip key
       at 0xFF000.

   The steps, each a checkpoint:
   1. Back up first: dump the flash twice, check the dumps agree, and keep
      them off the repo.
   2. Install `m-bootloader`, so a bad build is a key combination away
      from recovery.
   3. The first proof: a SysEx handler in `smk37_open` that draws text the
      Pi sends. The Pi talks to the firmware over USB MIDI with SysEx: the
      keyboard stays class-compliant, so Hindsight's MIDI path
      (`internal/midi`) needs no driver. Send text, primitives and changed
      rectangles: a whole frame (115 KB) is too much for SysEx.
   4. Pad colours from the Pi, and encoders as relative CCs.
   5. The features in Gabe's order: transport, FX, clip arranging. Then
      the keyboard's synth over the tape, recorded as an input. That is the
      Pro's USB audio, not yet shown on the Elite or on Linux.

   Still open: how much RAM the FM engine leaves; whether the binary SDK or
   the app owns the display's SPI bus; the stock CC map (capture it with a
   MIDI monitor first); whether the keyboard is full-speed or high-speed
   USB.

   Sources, as the research found them:
   - <https://github.com/m-vave/smk37_open>: M-VAVE's open firmware
   - <https://genkigenki.github.io/smk37/> and
     <https://github.com/genkigenki/fm1-to-smk37> (hardware, pin and flash
     maps in `docs/01-hardware.md`)
   - <https://github.com/illuminus5/skiff/blob/main/SMK37.md>: Skiff, with
     flash dumping by `jl-uboot-tool`
   - <https://github.com/jvitkauskas/m-bootloader>: the recovery bootloader
   - <https://github.com/AL-255/FM-1-RE>: the FM-1, the same chip, reverse
     engineered
   - <https://altstrument.org/devices/m-vave-smk-37>: an overview, and
     Baud Girl's SMK-37+VA (<https://baudgirl.com>)
   - <https://heise.de/-10503740>: the hardware and the synth

### The product

8. **A box of our own**: CM5, a board, the enclosure, once steps 1–5 hold
   on a Pi 5.
