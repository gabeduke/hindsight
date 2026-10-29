# The keyboard surface: the SMK-37

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
  - The encoders send absolute values, from where the Pi says each stands
    (KNOB, *The SMK-37's screen*, below), so a turn never jumps.
  - **The keyboard's own Start and Stop move nothing.** On Hindsight's
    firmware PLAY is a button to the Pi, so realtime Start, Continue and
    Stop from a keyboard that answered HELLO are dropped
    (`API.keyboardFirmware`, in `ControlMIDI`); another controller's still
    run the transport. A screen take used to make the keyboard send
    several Stops, which stopped the tape (*Learnt on the unit*).
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
- **Each ack's round trip** is kept (`Status.RTT`), for step 1's latency,
  and so is a pad press's answer (`Status.Confirm`, below). Both are on
  `/api/status` as `keyboard` (`present`, `screen`, `homed`, `version`,
  `features`, `rtt_ms`, `confirm_ms`; null with no client), which the rig
  and the K flows read.
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
  `02 60` on version 2, and then the firmware's features (`Status.Features`,
  `07` from the fork's PR #10 on: `EchoPads`, `EchoKnobs`, `QuietClock`;
  none from an older build). HELLO goes as version 1, which every version
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
- **Where the knobs stand** (`surface.Stands`, layout.go): a KNOB for
  each encoder whose cell has an amount, sent in the screen's BATCH frames
  after the lights when it differs from what the keyboard acked
  (`Keyboard.stood`), and again with every screen taken. On a keyboard
  with `EchoKnobs`, a knob whose value shows as its number also says where
  it is drawn (its value's TEXT and its BAR, `knobCell`), so a turn writes
  the value there on the keyboard at once. `Keyboard.Turned` (from
  `keyboardTurned`, every encoder CC from the keyboard) then changes the
  Pi's copy of the list as the keyboard changed it (`echoKnob`). For
  `TurnHold` (2 s: the second a turn is previewed and the second before
  it is saved) the cell shows the keyboard's value whatever the State
  says, and no KNOB goes for that knob, so a turn is never put back and
  never jumps to a value the State had before it heard it; after that the
  State wins, cell and KNOB. A CLEAR forgets the places on the keyboard,
  so every KNOB goes again after one (`stood` emptied with the list).
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
- **A press answered.** A keyboard with `EchoPads` lights a pad at its
  half the moment it is pressed. `Keyboard.Pressed` (from `keyboardPad`,
  every pad note from the keyboard, taken or refused) forgets that pad's
  light in `lit`, so the next frame sets it, whatever it is: its half
  once the press is taken (`PadDown`, which sends), or the pad as it was
  if refused (the next Tick). That ends the echo on the keyboard, and the
  time from the press to that frame's ack is `Status.Confirm`. A light
  sent before the press and acked after it isn't the answer, so it isn't
  kept as the keyboard's.
- **Sent again every `Reassert`** (2 s) while the screen is Hindsight's:
  `lit` is emptied, so every light goes with the next frame. A light that
  went wrong on the panel is never news to the acks; the firmware also
  sends its pads' chain again every 500 ms (PR #10).
- **Sent as they change**, in the screen's BATCH sender: the lights that
  differ from what the keyboard has (`lit`, kept from the acks, by
  target) go after the screen's changes. A CLEAR keeps the lights, as the
  firmware does, so a screen drawn again whole sends none of them. HOME,
  a RELEASE or a keyboard forgotten empties `lit` and starts the pads
  again (`lostScreen`): the screen taken again asks Play mode afresh,
  reading the trick log from then on (what landed while the screen was
  the keyboard's is not replayed), lights a pad the tape still holds
  full, and only then sends every light.
- **The link, modelled** (`internal/surface/link_test.go`): a Go model of
  the firmware (the list by kind and place, at most 96, BATCH's stops, the
  lights, KNOB and its echo) on a link that loses any frame of 700 bytes
  or more, as the unit did from the Pi, and drops 5% of acks. The real
  `Keyboard` drives it for 30 s of a screen changing at random, with
  turns on the panel; then, the link quiet, the model's screen must be the
  last State's Layout (the same items, and the ones that overlap in its
  order), its lights `Lamps` and its knobs `Stands`. With `MaxFrame` at
  1,024, as before #202, it fails as the rig did: frames lost, the
  keyboard forgotten, its screen never drawn. Where in the path the
  frames go is still the rig's to find (the checklist in
  `the-instrument.md`, step 7).
- **Checked in the fork's simulator**: `go test ./internal/surface -run
  TestWriteLightsScript -lights=<file>` writes the frames for rest, a
  press, its landing and release, GRAB's flash, recording with SHIFT
  held, and HOME, each with the simulator's `light` checks of what the
  firmware set; `tools/screen/run.sh <file>` there runs them. The panel's
  own LEDs are the board's code, which the simulator doesn't run.

## On the unit

As of 2026-10-29. The firmware is `gabeduke/smk37-hindsight`, whose
`HINDSIGHT.md` covers its builds, the protocol and the flash tools. Gabe's
rules for writing to the unit are decision 0053
(`docs/decisions/0053-smk37-flashing-rules.md`).

- **Built, not flashed:** the fork's PR #10 (local echo, the quiet clock,
  the pads' chain sent again), 452,964 bytes, 957 free (the change cost
  736), built by its CI on Windows and under Wine to the same bytes.
- **The keyboard** runs the fork's `main` at 97159f3a: protocol version 2
  (BOX, BAR, TEXT's background, LED, BATCH, 16 colours, 96 items) and
  partial repaint. Flashed from the Pi on 2026-10-29 with M-Flasher built
  for aarch64 (`~/smk-flash` on the Pi, with a backup from before the
  write); only 0x04000–0x72FFF changed, the bootloader, calibration and
  0xFF000 checked unchanged. 1,693 bytes of the image are free.
- **The Pi** lays out the screen (`internal/surface`, `Layout`) and sends
  only what changed, in BATCH frames; the firmware keeps the item list and
  repaints the bands that changed.

## Learnt on the unit

None of it showed in the simulator:

- Over the Pi's USB MIDI the keyboard takes a BATCH of 624 bytes (acked
  in 2 ms) and silently loses one of 764 or more; from a Mac 953 got
  through, paced by macOS at about 250 ms. `MaxFrame` is 512 (#202;
  decision 0052, `docs/decisions/0052-smk37-frames-of-512-bytes.md`).
- A lost frame looks like a dead keyboard: after three tries the Pi
  forgets it and takes the screen again, blank, every few seconds. While
  the Pi is away, the keyboard's PLAY runs its own sequencer.
- Taking the screen makes the keyboard send several MIDI Stops, and
  Hindsight's transport obeyed realtime start/stop from a controller: a
  re-take mid-play stopped the tape. The source, in the fork's sources:
  Open's clock is on by default (CLOCK_OUT), and `midi_router.c`'s
  `recover()`, run on any send a busy port refuses (a take fills the
  link), queues a Stop for every port with it. Fixed both ways: the Pi
  drops a firmware keyboard's realtime transport, and PR #10's quiet
  clock sends the Pi's port none while the Pi has the screen.
- The pads drop the Pi's colours at times. The Pi's colours already win
  in the firmware (`panel.c` asks `hindsight_pad` before Open's own for
  every pad the Pi set), but the pads' chain shares SPI1 with the LCD,
  and a pad is sent only when its colour changes, so a chain sent wrong
  stays wrong; nor does the Pi, sending only changes, put it back. Fixed
  both ways too: the firmware sends the chain again every 500 ms while
  the Pi has the pads, and the Pi every light every 2 s. Whether it was
  the chain is for the rig to confirm.

What these lead to is the list under *Next* in `docs/plan/the-instrument.md`,
step 7.

## Probing it by hand

The fork's `tools/probe/` sends the protocol to the unit by hand, a frame
at a time: `piprobe.py` on the Pi with Hindsight stopped
(`systemctl --user stop hindsight.service`), `hsprobe.swift` on a Mac.
