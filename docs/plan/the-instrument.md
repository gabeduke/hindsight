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
| The render goroutine, ahead of the device (`aheadFor`: as far as `OUTPUT_LATENCY_MS`, 5 × `BlockFrames` 1024 at its default) | ~107 ms | ~107 ms |
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

   Changed for the first install (Gabe, 2026-10-27: *"I'm really not
   worried about one person's failed update. I also failed an update and
   was able to recover it using the dongle. Let's just proceed with
   flashing over top of the baud girl firmware."*): our firmware goes on
   over SMK-37+VA through M-VAVE's own update, with no backup before it
   and with M-VAVE's loader, whose risk to 0xC0000–0xC1FFF he accepts.
   The dongle is the way back. The backups and m-bootloader come right
   after it (step 3), and the rules above hold for every write after that.

   How:
   - *Every write after the first by M-Flasher*, from the Mac. It writes
     only the sectors that change, verifies them and keeps m-bootloader.
     The first is the workbench's (step 3); after it, never the workbench
     or M-UPGRADE, which would put M-VAVE's bootloader back.
   - *A guard before any feature.* New sample transfers stop at 0xC0000.
     Every area the app writes asserts at compile time that it keeps clear
     of `[0xC0000, 0xC2000)` and `[0xFF000, …)`, and a test fails on a
     Flash write anywhere else. A runtime guard like Skiff's `FL_GUARD`
     didn't fit (*Room for code*, under *To settle*). The guard can't
     cover the SDK's own update path, which is one more reason to keep
     the workbench away from the unit after the first install.
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
       transpose and level. Unplugged from the Pi, the keyboard plays its
       voices and nothing more: no step sequencer and no projects on the
       unit.

       Changed by Gabe on 2026-10-28, after playing it: *sound design on
       the keyboard, playable.* He has better sequencers (the Bento, the
       MPC Sample), so Open's sequencer grid goes, as above. What he wants
       on the SMK instead is to shape a sound while playing it: *"playable
       edits to sounds like filter, osc etc."* So the synth page's knobs
       are for sound design you can play, on the encoders, not deep
       editing on the phone. Which edits, mapped how onto an FM voice
       (an FM engine has no filter of its own: brightness is the
       modulators' levels, or the effects'), is the next decision, with
       Gabe. He also found the patch select has only 16 patches in the
       library on the unit, not the 128 voices this plan assumed: fine as
       it is, with the edits made on them.
   - *What the Pi does with them*, as Gabe answered a quiz on how he
     plays (2026-10-28). He plays with his hands on the keyboard and an
     eye on the tablet, into the keyboard's synth, other gear through the
     interface, and the tape itself, in short noodles and hour-long
     builds alike. When something good went by, he keeps playing and
     sorts it out later on the tablet: the ring has it.
     - transport: PLAY plays and stops. REC records onto the tape: with
       the tape playing it punches in on the armed track and, pressed
       again, out; from a stop it starts the tape and records. KEEP is
       not on the keyboard any more, only on the tablet. Loop in and
       out, back to the start and tap tempo stay on the tablet too;
     - scrub: the master knob, while the Pi has the screen, with the
       counter on the screen. SHIFT and the master knob set the synth's
       volume, which the master knob alone sets on the keyboard's own
       screen;
     - the pads and the encoders have two pages. The FX page is theirs
       normally: Play mode's effects on the pads, played only while held
       and never in undo, and the tape's FX on the encoders (DRIVE, AGE,
       FILTER, CRUSH, ECHO, wow and flutter), their values on the screen.
       The Mixer page is theirs while SHIFT is held. Its pads, for the
       tape's four tracks, track *n* in column *n* on both rows:

       | Pads | 1–4 | 5–8 |
       |---|---|---|
       | top row | mute | select |
       | bottom row (9–16) | solo | arm |

       Each pad is lit in its track's colour, so a pad's track can be
       seen at a glance;
     - mixing: the four faders are the levels of tracks 1–4, always, with
       no bank. FADER BANK stays the keyboard's;
     - HOME is for picking one of the synth's voices;
     - clip arranging is not on the keyboard for now (the earlier plan
       had the pads as the tape's clips).

     The keyboard's screen, while the Pi has it, shows the counter and
     the transport (playing, recording, the armed track), what the knobs
     are and their values, which pad page is up and what its pads do,
     and the levels.

     The tablet follows the keyboard: the armed track, the mutes and
     the pad page show there as the keyboard changes them, with a strip
     of what the 16 pads do now. It follows on its poll (200 ms) and
     the Wi-Fi hop, so it lags the keyboard; the sound never waits on
     it, since the keyboard's controls act on the Pi. Gabe has a Pi touch
     display, which would take the Wi-Fi hop out: parked, to weigh with
     a push from the Pi in place of the poll (`pushing-tape-state.md`,
     agreed 2026-10-28).

     *Every press answers, at once, where the player is looking* (Gabe,
     2026-10-28, after a REC at the rig kept a take with nothing to say
     so: *"often when playing an instrument you develop an intuitive feel
     by watching something and feeling out the notes … it could be simple
     to start with"*). To start, one line of text per press:
     - on the keyboard's screen, a short flash of what it did (PLAY,
       STOP, KEPT 30 S, PUNCH IN), beside the counter;
     - on the tablet, the same words as a brief note, with what it
       changed lit: ▶, the armed track, a new take on the shelf.

     A press that is refused says why, the same way. The pad lights and
     the widgets come later and do this richer; the line of text comes
     first, before K3 changes what REC does.
   - *The surface, designed* with Gabe on 2026-10-29, from a quiz and a
     canvas he played and agreed (*"this looks good to me"*): the
     prototype is <https://claude.ai/artifact/WrryAkACiz1AgNHGBMYAWV>,
     built in `~/programming/hindsight-design/smk/`. It draws the screen
     pixel for pixel in the firmware's 5×7 font from the commands the Pi
     would send.
     - *The screen, always there*, top to bottom at 240×240: the tape's
       name and tempo; the counter in bars and beats (`012.3`, scale 4)
       with the transport beside it (PLAY green, STOP, REC red) and the
       armed track under it, with any solos and mutes; the pad page (FX,
       or MIXER while SHIFT is held) and what its 16 pads do, as a 2×8
       map lit as the pads are; the levels of tracks 1–4, a meter each in
       its colour with its fader's place as a tick; and the knobs in the
       panel's own two rows (K1–K4, then SELECT, PAGE, PRESET, MASTER),
       each its name and value.
     - *The flash*: a banner over the top line for about a second after
       each press, in the press's colour (PLAY green, STOP white, PUNCH IN
       and REC red, a Mixer press in its track's colour), then the screen
       as it was. Refused is amber, with the reason (NO TRACK ARMED). A
       knob turn or a fader move flashes nothing: its name and value are
       lit in place for a second. A held FX pad lights its cell in the map.
     - *The Mixer page's encoders*: K1–K4 pan tracks 1–4; SELECT, PAGE
       and PRESET are the selected track's input gain, monitor and echo
       send. A track has only a level and a pan today, so those three
       show a dash until the tape has them. A knob or fader move is one
       undo step, not one per value.
     - *The pad lights*, set by the Pi. On the FX page, by family: T1–T4
       in their tracks' colours, BREAK, REVERSE, CHOP and STOP orange,
       HALF and DOUBLE violet, ROLL, FILTER, ECHO and CRUSH cyan, CATCH
       and GRAB white (pads 15 and 16 stay those). On the Mixer page,
       every pad in its track's colour, dim when off and full when on
       (muted, selected, soloed, armed). A pad is dim at rest, half
       bright the moment it is pressed, and full when what it does is
       heard, after the snap; a command pad flashes full once, when done.
     - *The button lights*: PLAY while the tape plays; REC while
       recording, and blinking while the tape plays with a track armed;
       SHIFT while held. The rest stay the keyboard's.
     - *The tablet*: the banner's words over the bar's display for the
       same second, marked as the keyboard's, and what changed lit (▶,
       ●, a track's head). A strip just above the bar shows the 16 pads
       as the keyboard lights them, switching page with SHIFT, hidden by
       a per-device switch. It rides the push (`pushing-tape-state.md`),
       as an event carrying the words and what changed, not a diff.
     - *The firmware*: the Pi lays out every pixel and times every flash;
       the firmware draws. Protocol version 2 adds BOX (x y w h colour),
       BAR (x y w h value colour back), a background colour on TEXT, LED
       (a pad's RGB, a button on, off or blinking) and BATCH (several
       commands, one ack: a whole screen is about 70 commands), and grows
       the palette to 16 colours (the four tracks, red, orange, violet,
       white) and the items to 96. An item's change repaints only its
       16-row bands, not the whole screen. Estimated at about 900 bytes
       of the 2,877 free; the help page and the voice picker need the
       room *Our firmware* frees.
     - *Where it is built*: on the screen simulator and the virtual
       keyboard first, then on the unit with Gabe at the keyboard.
     - *Still to find*: an overlap Gabe saw on a couple of screens and
       doesn't recall where. Looked for while building the first step's
       banner (2026-10-29): the Pi's screen today has none (its four lines
       are far apart, and the banner takes the top line's place, so the
       two never draw together). The prototype's layout, which step 4
       ports, has three, found by measuring every text item's box:
       - a tape name longer than 15 characters runs into the tempo at
         x 186;
       - from bar 1000 the counter (`1000.1`, scale 4) runs into the
         sixteenths beside it at x 124;
       - NO TRACK ARMED runs into the solos and mutes when all four are
         both (`SOLO 1 2 3 4  MUTE 1 2 3 4` starts at x 78).

       Step 4 cuts the name to fit before the tempo, gives the counter
       its four digits' room, and tests that no two text items overlap.
       Done there (`internal/surface/layout.go`; `docs/architecture.md`,
       *The SMK-37's screen on protocol version 2*): past bar 999 the
       sixteenth drops to scale 1 after the bars, and the solos and mutes
       close up to `SOLO 1234  MUTE 1234`. The busiest screen is a little
       over one frame's 1,024 bytes, so a whole screen goes in two
       BATCHes, not the one the firmware's notes expect.
       Open's own pages, in the simulator, are tight (the step count
       against FOLLOW, a track's name against MUTE) but don't overlap.

     The build order, each its own PR:
     1. the banner as TEXT on today's protocol (PLAY, STOP, KEPT 30 S,
        refusals) and the note on the tablet's bar: the Pi alone
        (the banner #195; the note on the changes socket, J1.15: *The
        keyboard's press* in `architecture.md`);
     2. partial repaint, in the fork;
     3. protocol version 2 (BOX, BAR, TEXT's background, the palette,
        the items, BATCH), with simulator scripts in CI;
     4. the layout in Go (`internal/surface`), the screen as a function
        of the tape's state, tested by golden command lists and drawn in
        the simulator;
     5. LED: the pads by family with the two-stage light, and the
        buttons. It needs Play mode's `at` for each pad;
     6. the tablet's pad strip and the lit change, on the push;
     7. then the Mixer page (K6, after the map's spec), scrub (K7), the
        faders (K8) and REC punching in (K3).
   - *The map.* What each control does, on each page, is written once,
     per device, beside its profile: the control, what it sends, what it
     does on each page, the track colour of a Mixer pad, and the K flow
     that checks it. Three things read it, so none of them can drift
     from the bindings:
     - a section of the guide (`docs/guide.md`), with the panel drawn;
     - a help page on the keyboard's own screen;
     - the overlay: labels over the virtual keyboard's panel, and the
       pad strip on the tablet. It can be hidden once the map is learned
       (Gabe: *"we should be able to hide the map/overlay as well once we
       have learned it"*).

     The SMK-37 is the first device with a map, not the only one: *"the
     midi functions should be mapable to other types of midi devices as
     well so the overlay could be an object that is swapped out for
     other supported devices"*. So the overlay is an object the
     connected controller's profile picks, and another controller with a
     map gets its own. The map is an interface (who writes it, who reads
     it), so it gets a short spec of its own before it is built.
   - *The pads' timing* is open. The lag Gabe feels most is the pads',
     and they are quantised to a 16th by default (`controls.json`'s
     quantum): 0–114 ms at 132 BPM. PLAY and REC are not quantised. He
     chose to A/B a 16th against `now` by ear at the rig, then decide.
   - *Settled* on 2026-10-29 (*The surface, designed*, above): what the
     encoders do on the Mixer page, and pads 15 and 16 stay CATCH and
     GRAB.
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
   3. ⌨ *Ours over SMK-37+VA, by the workbench:* done 2026-10-27, with
      Gabe at the keyboard. SMK-37+VA answers neither the soft key nor
      OCT− and OCT+ held, but it keeps M-VAVE's own update.
      - It calls itself `SMK-37+VA_102` (the update protocol's identity
        query, `F0 00 32 45 00 00 00 40 7F F7`, which only reads). The
        workbench takes only `SMK-37 Elite_<n>`, so a local copy of it
        took `SMK-37+VA_<n>` as the Elite too. That was one line, never
        committed.
      - The workbench came from `tools/container/build.sh elite package`,
        and its package was byte for byte CI's for the same commit. Force
        mode staged M-VAVE's loader, which wrote the package. The unit
        came back as `SMK-37 Elite_8000001`, USB `3654:7756`, named
        `SMK37 Open`, running our build.
      - M-VAVE's loader (`4D4A:4155`, "USB Composite Device") keeps the
        name it was first staged under, `ota-SMK-37+VA_102`. Every
        workbench page needs the same one line to find it, or it times
        out waiting for the unit to reconnect.
      - A workbench page that has installed ours then hangs on *Checking
        the sample bank*. That check speaks Open's transfer protocol,
        which ours replaced, so it writes nothing: cancel it.
   4. ⌨ *Back up:* done 2026-10-27.
      - Ours didn't answer the soft key: the SDK hands
        `F0 22 24 35 7D F7` to the app, and the app's SysEx filter dropped
        it. Fork #6 answers it as stock and m-bootloader do: it writes the
        ROM's marker `usb_update_mode` at `0x01C7FD80`, then resets
        (`0x10000`, bit 4). That build went on by the workbench in the same
        way (its CI builds the installer now), and
        `m-flasher download-mode` works.
      - Two backups, taken across a power-cycle and each checked against
        the chip's CRC32, match (`a4e761ff…`). They are outside every
        repo, in `~/smk37-backups`, and still to be copied to a second
        disk.
      - The factory calibration is there (`trimdat` at 0xC1224), and so is
        the wheel calibration at 0xC2000. The Bluetooth pairing page at
        0xC0000 is blank, and so is the whole 0xFF000 page. Nothing says
        whether either was blank before today. M-Flasher still reads the
        chip key, `0x980F`. Bluetooth MIDI is still to check.
   5. ⌨ *m-bootloader:* done 2026-10-27. M-Flasher installed 1.2-22e2559
      in the boot area and verified it. A plain start runs ours, SEQ PLAY
      opens the menu, and SEQ REC gives download mode (Gabe checked all
      three). Its first start copied the calibration into
      0xFF000–0xFF23B (`TRIMCOPY`). Diffed against the first backup,
      `tools/flash-diff.py` finds changes only there and in the boot area.
      0xC0000–0xC1FFF is unchanged. From here, every write is M-Flasher's.
   6. ⌨ *The first proof: text over SysEx.* The firmware is built and
      tested off the unit, in
      [gabeduke/smk37-hindsight#2](https://github.com/gabeduke/smk37-hindsight/pull/2).
      It speaks protocol version 1 (`app/hindsight.h`): HELLO, CLEAR,
      TEXT and RELEASE, each acked with its seq. Only CLEAR takes the
      screen, and HOME gives it back and tells the Pi. Replacing the
      workbench's transfer protocol made the room: the image is 450,596
      bytes. On the unit: first from the Mac (`tools/midi.swift hs SMK
      hello`), then from the Pi (`amidi -S`), then from Hindsight. From
      the Mac: done 2026-10-27. HELLO, CLEAR and TEXT each acked in about
      1.3 ms, and the text was on the screen. From Hindsight: done the
      same day, skipping `amidi`. With
      [gabeduke/hindsight#183](https://github.com/gabeduke/hindsight/pull/183)
      deployed unreleased, the Pi took the screen and drew its panel. That
      is Hindsight's side: `internal/midi` reads a controller's SysEx,
      `internal/surface` is the protocol's client, and it writes to the
      keyboard's own port, found by the profile's name. The keyboard stays
      class-compliant, so the Pi needs no driver.
   7. *The surface* is built and tested off the unit, in
      [gabeduke/smk37-hindsight#3](https://github.com/gabeduke/smk37-hindsight/pull/3),
      and on the unit from the Mac (2026-10-27). Every row below came out
      as written, and HOME sent RELEASE. PLAY and REC to the Pi are
      still to try. The unit now calls itself `SMK37 Open`. #183's SMK-37
      profile matches it; main's, without #183, matches only `SMK-37`.
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

   *The virtual keyboard, and the keyboard's flows.* Gabe, 2026-10-27: a
   virtual keyboard *"would give us a chance to dial in the interface and
   play around with how we want to interact with hindsight"*, and *"a
   validation frame like we used for the mobile app with user flows"*. It
   runs beside the unit, not instead of it. The interface is designed on
   it, and every change is checked on it before it goes on the keyboard.
   - *What it is.* Open's workbench draws the whole SMK-37 panel (the
     screen, pads, encoders, faders, buttons and keys) and plays the
     synth. It runs the firmware's own `app/`, compiled to WebAssembly,
     on Open's simulator (`web/engine`, M-VAVE's C stand-in for the
     binary SDK).
     - The fork builds it from our `app/` with
       `tools/container/build.sh elite web`, in about 40 s (done
       2026-10-27).
     - It is the code that goes on the unit, less the board layer. So the
       screen it draws is the unit's, and the bytes it sends are the ones
       Hindsight will get.
     - The simulator already takes SysEx in (`sim_midi`) and captures
       what the keyboard sends (`sim_midi_output`). The page uses neither
       yet.
   - *What it can't tell us.* Each of these stays a check at the
     keyboard:
     - the timing: USB at full speed, the one-message mailbox, Pi to
       screen;
     - how the encoders, pads and keys feel;
     - what the binary SDK itself does;
     - the image's size, which only the real build reports (2,877 bytes
       left).
   - *The link to Hindsight.* Hindsight reads MIDI only from Linux rawmidi
     nodes, so a keyboard in a browser can't reach it.
     - Hindsight: a WebSocket, `/api/controllers/virtual`. `internal/midi`'s
       Watcher opens it as a port like any rawmidi node, under the name
       the page gives it: `SMK-37 Elite (virtual)`, which the SMK-37
       profile matches.
     - Its bytes go through the same reader. So `ControlSink`,
       `ControlSysExSink`, `internal/surface` and Play mode's bus run the
       same code as for the real keyboard, and `KeyboardSend`'s
       `midi.Out` writes back to it. Since #183's review, that `Out` is
       aimed at the controller's node rather than its name, so the virtual
       port needs a node of its own that `Out` can match and write to. One
       MIDI message goes in each binary frame, both ways.
     - This changes interfaces: `internal/midi` gets a port that isn't a
       rawmidi node, and `midi.Out` a target that isn't one. It is a PR of
       its own, written up in `docs/architecture.md`.
     - It is on with `--demo` and off on every kit. It is never one of the
       Pi's settings, since nothing a kit does needs it.
     - The page, in the fork: `?link=<ws url>` opens the socket, sends
       what the simulator captures, and hands what comes back to
       `sim_midi`.
     - Hindsight puts the keyboard's status on `/api/status` (connected,
       has the screen, homed), so a flow can check it as the Pi sees it.
   - *The flows* are a K series in `docs/flows.md`, run by
     `scripts/flows.mjs` against the demo, like the J series.
     - The harness gains `t.keyboard`: the virtual keyboard's page, opened
       beside the app in the same browser and linked to the run's demo. Its
       gestures are real pointer events on the panel: `press`, `hold`,
       `pad`, `turn`, `fader` and `key`. `shot()` adds a picture to the
       storyboard.
     - It is checked as the Pi sees it. The tape and the takes come
       through the API, and the keyboard's status through `/api/status`.
       What the keyboard drew is what Hindsight sent and the keyboard
       acked.
     - The page is the fork's build. `SMK37_VIRTUAL` names a directory
       that holds it. CI fetches the fork's own build, pinned to a commit
       like a dependency; the fork's CI gains the `web` build as an
       artifact for it.

     The stories, agreed with Gabe on 2026-10-28 from his answers above.
     K2, K4 and K5 run on what is built and wait only for the link; the
     rest are `todo` until their feature lands. Each row of the map
     names the story that checks it:

     | Id | As Gabe I want to… | Status |
     |---|---|---|
     | K1 | plug the keyboard in and see Hindsight take its screen: the counter, the transport, the knobs, the pad page and its map, and the levels | core for taking the screen, once the link lands; the widgets `todo` |
     | K2 | press PLAY on the keyboard to play and stop the tape, and see the tablet follow | core, once the link lands |
     | K3 | press REC to punch in on the armed track and again to punch out (from a stop, REC starts the tape), then find what I played on the tape | todo: REC KEEPs today |
     | K4 | press HOME to pick one of the synth's voices, then hold HOME a second and let go to hand the screen back | core, once the link lands |
     | K5 | on the FX page, hold pads for Play mode's effects, with nothing in undo, and turn the tape's FX on the encoders, with their values on the screen | core for the pads and the four mod knobs (the SMK-37 profile's today), once the link lands; the rest `todo` |
     | K6 | hold SHIFT for the Mixer page: mute, select, solo and arm tracks 1–4 on the pads, each in its track's colour, and see the tablet follow | todo |
     | K7 | scrub the tape on the master knob, with the counter on the keyboard's screen; SHIFT and the master knob for the synth's volume | todo |
     | K8 | set the levels of tracks 1–4 on the faders | todo |
     | K9 | play the keyboard's synth over the tape and record it as an input | rig |
     | K10 | read what every control does, on the keyboard's help page and in the guide, and hide the overlay once I know it | todo |
     | P1 | A/B the pads' quantum by ear, a 16th against `now`, and pick their timing | rig |
     | R2 | install ours over SMK-37+VA, back up, then m-bootloader (steps 3 to 5) | rig |

   - *Build order*, each step its own PR:
     1. the fork's CI builds and uploads the virtual keyboard;
     2. Hindsight's virtual port and the keyboard on `/api/status`, with
        tests;
     3. the page's link;
     4. the harness's `t.keyboard`, and K1 to K10 in `docs/flows.md`:
        core where the table says so, `todo` for the rest;
     5. each `todo` turns core as its feature lands: on the virtual
        keyboard first, then at the keyboard. The map's spec comes before
        K6, since the Mixer page is the first thing it describes.

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
   - *Getting off SMK-37+VA*: decided (Gabe, 2026-10-27). Ours goes on
     over it by the workbench (step 3), not by Felucca or the dongle
     first. The dongle stays the way back: Gabe has recovered a failed
     update with one.
   - *A developer switch on a Pi* for the virtual keyboard's link, to
     play it against the real rig. Leave it out until a flow needs the
     rig: the demo is where the flows run.
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
