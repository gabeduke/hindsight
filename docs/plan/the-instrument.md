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

7. **The SMK-37 Elite's firmware.** Checked against the sources
   themselves on 2026-10-26, and read off Gabe's unit the same day.
   - *Gabe's unit*, read on the Mac without writing anything:
     - it runs Baud Girl's SMK-37+VA, after the stock firmware and
       Felucca. Baud Girl's installer puts M-VAVE's bootloader back, so
       that is probably the bootloader on it; the backup will say;
     - its USB ids are `4C4A:C755`, the FM-1's, which SMK-37+VA keeps. It
       runs at full speed (12 Mb/s);
     - one MIDI port, `SMK-37+VA`. It is silent when idle and doesn't
       answer a Universal Device Inquiry. Under the stock firmware its
       ports were `SMK-37 Elite -Private`, `-Master` and `-MCP`, from the
       Mac's MIDI cache;
     - USB audio, two channels each way at 44.1 kHz. A note sent over MIDI
       came back on its input, so the Elite's synth reaches a computer
       over USB, at least under SMK-37+VA.
   - *The hardware:*
     - a JieLi AC791N (WL82) with 1 MiB of SPI flash and about 511 KiB of
       internal RAM, no external RAM;
     - a 240×240 ST7789V display on SPI1, a bus the pad LEDs share;
     - 8 encoders, 16 pressure pads with RGB LEDs, 4 faders and 18 lit
       buttons;
     - class-compliant USB MIDI at full speed, BLE MIDI, and TRS MIDI out
       only.

     The Pro, the Elite and two rebadges are one hardware family; the
     Elite is the least tested of them. The stock firmware is a DX7-style
     FM synth with a sequencer and an arpeggiator.
   - *Open firmware:* M-VAVE released SMK37 OPEN V01 on 2026-10-24
     (`m-vave/smk37_open`). It is a whole instrument: eight tracks (DX7,
     303, 808, PSG, pluck, sampler), a sequencer, and a browser workbench
     that installs it over Web MIDI. Its app layer, the board layer
     included, is GPLv3 with an SDK exception; the SDK (`libfm1_engine.a`)
     is binary-only. Its SDK settles what the research left open:
     - *SysEx in:* `fm1_app_sysex()` is handed whole frames, F0 to F7, of
       at most 1024 bytes, on the routing task. It copies the frame and
       calls `fm1_control_request()`; drawing happens on the control
       task. Open's own transfers already use `F0 7D 'F' 'M' 2`.
     - *The display:* the app's board layer drives SPI1
       (`app/board/lcd.inc`), behind the SDK's `fm1_screen_fill`, `_blit`
       and `_submit` (DMA in bands of 240×16 pixels). Its font has digits
       and capitals only.
     - *What the FM engine leaves of the RAM:* `Build.ps1`'s image report
       gives it at the first build.

     The GPL ports (genkigenki's board layer, Skiff) build with JieLi's
     Linux toolchain. Baud Girl's SMK-37+VA is closed source, so we can't
     build on it.
   - *Recovery:*
     - the ROM's download mode (`4C4A:8057`, a mass-storage disk) reads and
       writes the whole flash. The stock firmware restarts into it on
       `F0 22 24 35 7D F7`;
     - M-Flasher (MIT, native on the Mac) replaces `jl-uboot-tool`. It
       backs up, restores, and installs packages and m-bootloader. It
       checks every read against the chip's CRC32 and refuses the factory
       ranges;
     - `m-bootloader` (MIT) adds a recovery menu (SEQ PLAY at power-on)
       and download mode (SEQ REC);
     - with no working bootloader, the USB_KEY dongle (a Raspberry Pi
       Pico) still forces download mode;
     - three regions are the unit's own and are never written: Bluetooth
       pairing at 0xC0000, factory calibration at 0xC1000, and the chip
       key and MAC at 0xFF000. The wheel calibration (around 0xC2060) and
       the stock sounds (`[0xF4000, 0xFE000)`) are the unit's too: only a
       backup brings them back.
   - *Where that last rule is at risk:*
     - SMK37 OPEN's user partition is `[0x7C000, 0xFF000)`
       (`sdk/Package.cs`). Projects run to 0x8D000; after them, a sample
       bank lies over 0xC0000, 0xC1000, the wheel calibration and the
       stock sounds. Booting writes nothing there, but a sample transfer,
       *Check / initialize samples* or a library save does. Open ignores
       the factory calibration and keeps its own in VM.
     - On its first start, m-bootloader's calibration guard copies 0xC1000
       into `[0xFF000, 0xFF23C)`. It writes blank bytes only and never
       erases. If 0xC1000's marker is ever invalid, the guard erases that
       sector and restores its copy at every start: under Open's sample
       bank, that would cut into samples. While 0xC1000 stays intact, the
       guard never trips.
     - M-VAVE's update loader, which Open's packages and the workbench
       use, erased 0xC0000–0xC1FFF on a Skiff unit. And every official or
       workbench install puts M-VAVE's bootloader back over m-bootloader.

   Gabe's rules for it (2026-10-26):
   - never write the three regions above;
   - back up the whole flash twice, and check the dumps match, before
     anything is flashed;
   - keep the dumps out of every repo;
   - install m-bootloader before any build of ours, so there is a way
     back;
   - flash nothing without Gabe at the keyboard, confirming each step;
   - the firmware lives in its own repo, a fork of `m-vave/smk37_open`
     (GPLv3, with its linking exception and `THIRD_PARTY.md`), not here.

   How:
   - *Every write by M-Flasher*, from the Mac. It writes only the sectors
     that change, verifies them and keeps m-bootloader. Never the
     workbench, never M-UPGRADE.
   - *A guard before any feature.* New sample transfers stop at 0xC0000.
     Every area the app writes asserts at compile time that it keeps clear
     of `[0xC0000, 0xC2000)` and `[0xFF000, …)`, and a test fails on a
     Flash write anywhere else. A runtime guard like Skiff's `FL_GUARD`
     didn't fit (*Room for code*, under *To settle*). The guard can't
     cover the SDK's own update path, which is one more reason never to
     point the workbench at the unit.
   - *A proof after every write:* back up again and diff against the
     first dump. Nothing may differ outside what that write meant to
     change, and 0xC0000–0xC1FFF never may. A script in the fork does the
     diff.
   - *The protocol:* `F0 7D 'H' 'S' <version> <command> … F7`, at most
     1024 bytes. 0x7D is MIDI's non-commercial ID: fine for our own kit,
     not for a product, where a manufacturer ID is step 8's. The keyboard
     acks each command with its sequence number, so step 1 can time Pi →
     screen. Send text, primitives and changed rectangles: a whole frame
     (115 KB) is too much for SysEx.
   - *The toolchain on a Mac* (Apple silicon, with Docker):
     - M-VAVE's Windows 2.5.3 toolchain (PI32v2 clang 4.0.1, `r3`) runs
       under Wine in a linux/amd64 container (`tools/container/build.sh`
       in the fork). It is unpacked from its installer, never run, and all
       22 of its files match the SDK's manifest. Off Windows, `Build.ps1`
       runs it through Wine.
     - The toolchain is 32-bit. Rosetta for Linux can't run 32-bit code,
       so on the Mac QEMU does: each tool takes about 45 s to start, and a
       build takes 26 minutes. CI's Linux build takes about a minute.
     - Proved: the fork's CI builds the Elite firmware on `windows-latest`
       with Windows PowerShell, as `build.bat` does, and under Wine on
       Linux. The two packages are the same bytes, for V01 and for the
       fork, and the Mac's own build matched CI's too.
     - Fallback: JieLi's Linux toolchain, a different compiler build not
       proved against the binary SDK. Last resort: a Windows VM.

   Our firmware (the direction agreed with Gabe on 2026-10-26; the details
   are to settle):
   - *The keyboard is the hands and a screen to glance at; the Pi is the
     brain.* The firmware never knows what a tape is. It shows what the Pi
     says, sends what is touched, and plays its own synth.
     - Controls go out as plain MIDI. Buttons send press and release, so
       Hindsight's `GESTURE` decides tap, hold and double tap. Faders send
       values, and pads send pressure. Encoders send absolute values,
       because Hindsight's knob bindings take absolute values; the Pi sets
       where each knob stands, so a value never jumps. (The plan first
       said relative turns.)
     - The screen: the Pi sends state, not pixels. The firmware draws a
       few widgets from it at 60 fps: the tape's counter, the transport,
       the FX as knobs, meters, track names, and text for menus.
     - Lights: the pads' colours and the buttons' LEDs, set by the Pi.
     - The synth: the keys play the onboard FM engine with no added delay.
       Its audio reaches the Pi over USB as an input, and its tempo
       follows the tape's clock.
     - The synth has one small page of its own: a surface, not a second
       instrument (Gabe, 2026-10-26). It is built from Open's DX7 QUICK
       EDIT page, which picks one of the 128 voices (PRESETS, and PAGE
       for the bank) and has four knobs for quick edits, plus Open's
       effects page for the synth's own reverb and delay. Which four
       knobs is a detail for the build; Open's are algorithm, feedback,
       transpose and level. Deep editing (operators, envelopes, LFOs)
       moves to the phone, if it is built. Unplugged from the Pi, the
       keyboard plays its voices and nothing more: no step sequencer and
       no projects on the unit.
   - *What the Pi does with them*, in Gabe's order:
     - transport: play, stop, record, scrub on an encoder, loop in and
       out, back to the start, tap tempo. And a button only Hindsight
       has: keep the last N seconds or bars of the ring as a take;
     - FX: DRIVE, AGE, FILTER, CRUSH and ECHO on five encoders, with
       their values on the screen. Pads play effects only while held,
       and never go in undo;
     - mixing: the four faders set track or input levels (the mixer
       Gabe wants in the Rig), banked to 5–8. SHIFT and a pad mutes,
       solos or arms, as Open does;
     - clip arranging: the 16 pads are the tape's clips, to pick, cue,
       launch and move. They are Play mode's pads too.
   - *Where the room comes from.* The image's symbol table says what
     Open's app spends (about 80 of its 83 KB placed):

     | Open's app | Bytes | In ours |
     |---|---|---|
     | Drivers: keys, pads, screen, audio; MIDI routing; controls | 14.1 K | kept |
     | Sound-editing pages: FM, tone, envelope, LFO, FX, names | 13.5 K | gone, except the quick-edit and effects pages |
     | Projects, presets, sessions, and their storage | 11.9 K | gone, except the device's settings |
     | The factory DX7 voices | 10.2 K | kept, all or some |
     | Control dispatch (`apply_controls` and its helpers) | 10.1 K | replaced by MIDI out |
     | Drawing: text, font, lines, knobs, header, messages | 7.2 K | kept, for our widgets |
     | Sample storage and the DX7 library | 3.2 K | gone |
     | The workbench's transfer protocol | 2.8 K | replaced by ours |
     | Sequencer and step pages | 1.9 K | gone: the tape is the arrangement |
     | Overview and mixer pages | 1.9 K | drawn from the Pi's state |
     | Bluetooth page | 1.9 K | kept |
     | Project and preset pages | 1.4 K | gone, except picking a voice |

     About 40 KB comes out, and our protocol, widgets and MIDI mapping
     go back in. These figures are estimates: inlining moves bytes
     between functions, and the true figure is the image size a build
     reports. The SDK's 366 KB stays as it is: it is linked whole, with
     the instrument's own engine (the sequencer, the arpeggiator, about
     20 KB), the synth engines and FX (about 21 KB), and Bluetooth (about
     100 KB).

   The steps, each a checkpoint. ⌨ marks one Gabe confirms at the
   keyboard:
   1. *Off the unit:* done 2026-10-26, in
      [gabeduke/smk37-hindsight#1](https://github.com/gabeduke/smk37-hindsight/pull/1):
      - the fork, `gabeduke/smk37-hindsight`;
      - the Elite firmware built on Windows and under Wine, the same bytes;
      - the write areas asserted, with a test, and `tools/flash-diff.py`;
      - M-Flasher 0.6.1, built on the Mac from its tag;
      - a MIDI monitor: `tools/midi.swift` in the fork on the Mac, and
        `aseqdump` on the Pi.
   2. ⌨ *Identify the unit, read-only:*
      - on the Mac: done, above;
      - on the Pi, by *Capturing an unknown device* in
        `docs/hardware/README.md`: the CC map of the firmware on the
        unit, into `smk-37-elite.json`, in a PR of its own.
   3. ⌨ *Back up:*
      - into download mode. Tried on 2026-10-26: SMK-37+VA answers
        neither the soft key (`m-flasher download-mode`) nor OCT− and
        OCT+ held, and the stock bootloader its installer puts back has
        no key for it. So it takes one of two routes, chosen at the
        keyboard (*To settle*): reinstall Felucca, whose app answers the
        soft key, or force it with the Pico dongle;
      - `info`: the chip, the flash's JEDEC id, the model, the firmware
        and the bootloader;
      - `backup` to a directory outside every repo. Power-cycle, back up
        again, and check the two SHA-256s match;
      - check `trimdat` at 0xC1224, and what 0xFF000–0xFF23C hold;
      - keep two copies, on two disks.
   4. ⌨ *m-bootloader:* the boot area only (16 KiB), from a pinned
      release. SEQ PLAY opens the menu, SEQ REC gives download mode, and
      stock still starts. Back up and diff with
      `--accept-unit 0xFF000-0xFF23C`, for its calibration copy (Gabe
      accepted it, 2026-10-26).
   5. ⌨ *The fork as step 1 leaves it,* by M-Flasher, with neither
      `--with-bootloader` nor `--wipe-settings`. Check that it boots and
      that the keys and pads respond. Back up and diff.
   6. ⌨ *The first proof: text over SysEx.* The firmware is built and
      tested off the unit, in
      [gabeduke/smk37-hindsight#2](https://github.com/gabeduke/smk37-hindsight/pull/2).
      It speaks protocol version 1 (`app/hindsight.h`): HELLO, CLEAR,
      TEXT and RELEASE, each acked with its seq. Only CLEAR takes the
      screen, and HOME gives it back and tells the Pi. Replacing the
      workbench's transfer protocol made the room: the image is 450,596
      bytes. On the unit: first from the Mac (`tools/midi.swift hs SMK
      hello`), then from the Pi (`amidi -S`), then from Hindsight. Today
      `internal/midi` only skips SysEx when it reads. It gains a SysEx
      writer and a client for the protocol, with tests, and finds the
      port by the profile's name. The keyboard stays class-compliant, so
      the Pi needs no driver.
   7. *The surface* is built and tested off the unit, in
      [gabeduke/smk37-hindsight#3](https://github.com/gabeduke/smk37-hindsight/pull/3).
      While the Pi has the screen, the panel speaks to it:
      - pads as notes 36–51 on channel 10, with poly aftertouch. That is
        the SMK-37 profile's Play mode, CATCH and GRAB;
      - encoders as CC 21–27 on channel 16, absolute, which the Pi sets
        with KNOB;
      - faders as CC 28–35;
      - buttons as notes on channel 16, pressed and let go.

      Then the lights from the Pi, and the room the screen's widgets need.
      That room comes from what *Our firmware* drops, one build at a time,
      keeping the keys and pads working.
   8. The screen's widgets, then the features in Gabe's order:
      transport, FX, clip arranging. Then the keyboard's synth over the
      tape, recorded as an input. That is the Elite's USB audio, shown
      under SMK-37+VA but not yet under our firmware or on Linux.

   Decided: *m-bootloader's write into 0xFF000* is accepted (Gabe,
   2026-10-26, "use the recommended patterns regarding writes"). It fills
   blank bytes with a copy of the calibration and never erases, and it is
   the build M-Flasher and m-bootloader were tested with.

   To settle, my recommendation first:
   - *Room for code.* V01's Elite image is 453,892 bytes, and
     `Package.cs` allows 453,921: 29 bytes to spare. *Our firmware* says
     where the room comes from. The first proof reused `screen.c`'s own
     text drawing and took out the workbench's transfer protocol, which
     left 3,325 bytes with the surface in. The screen's widgets need
     more, from the pages *Our firmware* drops. A smaller user partition
     would be one more source, but only a unit can say whether the SDK
     accepts one.
   - *The factory DX7 voices* (10.2 K): keep all 128 while there is room,
     since the synth over the tape is a goal. Cut to a bank of 32 if
     space runs short.
   - *The sampler:* capped before 0xC0000 in the fork, which leaves about
     9 s instead of 19.5; that was the recommendation. Dropping it would
     also free code space. The DX7 library and tuning sectors
     (`[0xFA000, 0xFF000)`) sit over the stock sounds, which the backup
     holds.
   - *Builds on the Mac:* let CI build (about a minute) and fetch its
     package with `gh run download`; the container stays for working
     offline. Wine for macOS would be fast, since its Rosetta does run
     32-bit code, but it is unsigned software installed on the Mac.
   - *Rehearse on the FM-1 first.* Gabe has one. It has the same chip,
     and M-VAVE's `fm1_open` is the same SDK. M-Flasher and m-bootloader
     were tested on its hardware, and it has no factory calibration to
     lose. Run steps 3 to 6 on it, then on the Elite. (Not with Gabe on
     2026-10-26, so the Elite goes first.)
   - *Download mode from SMK-37+VA*, which ignores the soft key (step 3).
     Gabe will choose at the keyboard, sitting down for it (2026-10-26).
     - *Reinstall Felucca* through its own installer. It ran on this
       unit before, and its app answers the soft key. Its loader writes
       the app area and its own settings, and refuses 0xC0000–0xC1FFF
       (genkigenki's docs, verified on a Pro). But it is one write before
       any backup, against the backup-first rule. Export SMK-37+VA's
       presets first.
     - *The Pico dongle* keeps the rule. A Raspberry Pi Pico and two
       2.2 kΩ resistors on the USB data lines force download mode with
       no firmware. It works on an SMK-37 Pro (m-bootloader's spec), and
       it is the recovery path worth having anyway.
   - *Giving the screen back to Hindsight after HOME*: decided (Gabe,
     2026-10-26). HOME held for a second, on the keyboard's own screen,
     offers it back. The keyboard sends OFFER, and Hindsight takes the
     screen.
   - *The CC map in the profile* follows the firmware on the unit until
     ours lands; SMK-37+VA's is in its manual. The alternative is to put
     stock back to capture its map.

   Sources:
   - <https://github.com/m-vave/smk37_open> (V01, `b2d6bcb`): `sdk/include/fm1.h`, `sdk/Package.cs`,
     `sdk/Build.ps1`, `app/instrument.h`, `app/board/`
   - <https://github.com/jvitkauskas/m-bootloader> (`64b74d0`): `docs/SPEC.md` §4.2, §5.5 and §9.3, and
     `core_guard` in `src/core.c`
   - <https://github.com/jvitkauskas/m-flasher> (0.6.1): `docs/usage.md`, `docs/safety.md`,
     `src/boards.rs`
   - <https://genkigenki.github.io/smk37/> and
     <https://github.com/genkigenki/fm1-to-smk37>: hardware, pin and flash
     maps and the calibration record, in `docs/01-hardware.md`
   - <https://github.com/illuminus5/skiff/blob/main/SMK37.md>: Skiff, its
     backup done twice, and the loader that erased 0xC0000–0xC1FFF
   - <https://github.com/AL-255/FM-1-RE>: the FM-1, the same chip, reverse
     engineered
   - <https://github.com/m-vave/fm1_open>: the same SDK, for the FM-1
   - <https://altstrument.org/devices/m-vave-smk-37>: an overview, and
     Baud Girl's SMK-37+VA (<https://baudgirl.com/work/SMK-37+VA/manual>:
     its install, and its CCs in 11.10)
   - <https://heise.de/-10503740>: the hardware and the synth

### The product

8. **A box of our own**: CM5, a board, the enclosure, once steps 1–5 hold
   on a Pi 5.
