# State of Hindsight

**As of 2026-10-29.** This is the one handoff: what Gabe has decided, what
is open, what is next. Keep it current and short; when a section goes
stale, fix it or delete it. How things work is in `docs/architecture.md`;
what happened is in `git log`, and deleted specs are in git history.

No home network details here (no LAN or tailnet addresses or names): the Pi
is `<pi-host>`.

## What is built

All of it is in `docs/architecture.md`: the shell and its two rooms (*The
UI*, *The shell*, *Moving between rooms*), the frame (*The frame*), the bar
(*The bar*), the Listening Room as a library (*The library*), the cue lane
and the tape's changes socket (*The tape*, *The revision*), and the SMK-37
on Hindsight's firmware (*Controllers*). What is not built yet, and still
looks it:

- Open (`wave.html`), the rig (`rig.html`) and the guide are still pages of
  their own, outside the shell.
- Notes on a take are still the Sketchbook's dialog (✎ on the bar), until
  the notes drawer (`listening-back.md`).
- Open still titles a take by its date stamp, not `takeTitle`, until Open's
  pass.
- The cue lane takes GRABs only; adding from the shelf and from a track is
  in `backlog.md`.

## Known bugs

- **Layout, found by the flows' layout checks** (the baseline,
  `scripts/flows/layout-known.json`; see `docs/flows.md`, *What a run
  says*): the cue clip's × (12×14 px) and loop toggle (22 px) are under
  24 px.
- **The first turn to the Listening Room freezes the Studio** for a moment
  while the room is laid out and drawn the first time: about 0.6–0.9 s at
  4× CPU in headless Chromium, measured before the shelf wall replaced the
  stage. Later turns freeze 0.25–0.5 s at 4×. Re-measure, on the tablet.
- On a phone, the Studio's track level sliders are 18 px tall (axe's
  target-size), met only by a partial run on the demo's own tape (J5.1,
  J2.10 on a phone).

(Not a bug: a take tapped while its preview encodes says "Still encoding"
and loads when ready, which is why `t.api.keep` waits.)

## Gabe's decisions (they explain today's code)

- **Devices:** the main device is an Android tablet, tap and stylus; iPad
  second; the laptop for desk work; a phone for recording and the tape
  upstairs.
- **Two nouns, takes and tapes.** A tap plays, anywhere, in the bar; one page
  (Open) to dig in; the bar is the only transport. Words: see *Vocabulary* in
  `docs/architecture.md`.
- **Rooms are the only UI. Shell, not hand-off.** Rooms stay mounted after
  their first visit and are hidden, not rebuilt, when you leave.
- **Wake lock** while the tape plays or a recording runs, in either room.
  Leaving the Studio during a recording shows a **REC chip** with Stop in the
  header, never a refusal.
- **The cue lane** is stored with the tape (`/api/tapes/state`), not per
  browser. A clip launches on the **next bar line** and loops until tapped;
  Shift starts it at once. Dragging to a track copies.
- **Tape mods go through undo; tricks and punch-in FX are held-only** and
  never touch undo or the tape. Momentary gestures must bypass undo.
- **Multi-arm by cables;** ● arms one track, holding ● adds one.
- **Studio keys:** C catch, G grab, ↵ drop, K keep. Crate pads are parked.
- **The crate leaves the screen, not the Pi.** Records aren't written any
  more (`Meta.Record` is ignored, not migrated). The ring stays in code and
  `RING_SECONDS`, never on screen (it is *the feed*).
- **Flat first:** DOM, SVG and canvas; three.js only for the Rig, lazy,
  behind a flag.
- **Open is its own page** (`wave.html`), for now. The Rig should become a
  shell view next (leaving for it stops this device's tape about 6 s
  later).
- **Releases:** Gabe doesn't pull releases by hand; an agent installs them
  with `POST /api/update` (see AGENTS.md). An auto-install trigger is open.
- **The tape's state is pushed as a nudge, not the state** (2026-10-28;
  *The revision* in `docs/architecture.md`): send the state itself only if
  the nudge still feels slow. A Pi touch display, which would take out the
  Wi-Fi hop, is parked.

## Open, needs Gabe at the rig

- The instrument's DRIVE make-up by ear with the SMK-37 (about 10 dB quieter
  on a loud loop at full drive).
- `BenchmarkRenderABlock` on the Pi 4B.
- **The push, timed** (the last step of pushing the tape's state): the
  SMK-37's PLAY, from its log line to the tablet's paint. Expected 30–50 ms
  (the push ~10 ms on Wi-Fi, one poll ~20 ms, up to a frame), against up
  to 235 ms on the poll alone; the tablet's Wi-Fi power saving can add
  100 ms or more. Then **Gabe decides the fallback poll**: the
  recommendation is the Studio's 200 ms slowed to 1 s, for when the socket
  is down.
- **The SMK-37 on Hindsight's own firmware** (`the-instrument.md` step 7
  holds the plan and *The surface, designed*; this is where it stands,
  2026-10-29). The firmware is `gabeduke/smk37-hindsight`, whose
  `HINDSIGHT.md` covers its builds, the protocol and the flash tools.
  - **The keyboard** runs the fork's `main` at 97159f3a: protocol version 2
    (BOX, BAR, TEXT's background, LED, BATCH, 16 colours, 96 items) and
    partial repaint. Flashed from the Pi on 2026-10-29 with M-Flasher built
    for aarch64 (`~/smk-flash` on the Pi, with a backup from before the
    write); only 0x04000–0x72FFF changed, the bootloader, calibration and
    0xFF000 checked unchanged. 1,693 bytes of the image are free.
  - **The Pi** lays out the screen (`internal/surface`, `Layout`) and sends
    only what changed, in BATCH frames; the firmware keeps the item list and
    repaints the bands that changed. On the rig (unreleased, #202 deployed):
    the designed screen, the press banner, the pads lit by family with the
    half/full stage, PLAY/REC/SHIFT lights; the tablet's note over the bar
    for every press (#198); the push socket (#196). Gabe, seeing it: *"it
    works!"*
  - **Learnt on the unit** (none of it showed in the simulator):
    - Over the Pi's USB MIDI the keyboard takes a BATCH of 624 bytes (acked
      in 2 ms) and silently loses one of 764 or more; from a Mac 953 got
      through, paced by macOS at about 250 ms. `MaxFrame` is 512 (#202).
    - A lost frame looks like a dead keyboard: after three tries the Pi
      forgets it and takes the screen again, blank, every few seconds. While
      the Pi is away, the keyboard's PLAY runs its own sequencer.
    - Taking the screen makes the keyboard send several MIDI Stops (its own
      sequencer), and Hindsight's transport obeys realtime start/stop from
      a controller: a re-take mid-play stops the tape.
    - The pads drop the Pi's colours at times: the stock firmware still
      paints pads itself (on a press, and `fm1_led_set` in `screen.c`), and
      the Pi, sending only changes, never puts them back.
  - **Next** (Gabe, 2026-10-29: a session of its own to dial in the link
    and the signal flow):
    1. The pads: while the Pi holds the panel its LED colours win in the
       firmware; and/or the Pi re-asserts lights on a timer.
    2. The Stops: the SMK-37's realtime start/stop shouldn't move the tape
       when its PLAY is a button to the Pi; and the firmware shouldn't send
       them on a screen take.
    3. Local echo in the firmware: a pad half-lit and a knob's value shown
       the instant they're touched, the Pi confirming after.
    4. The link itself: measure where frames are lost (the SDK's USB MIDI
       assembly, Linux's `snd-usb-midi` packing), ack and retry behaviour,
       latency from press to light and press to sound, and a probe in CI or
       the harness that would have caught the 764-byte loss.
    5. Then the build order's rest: the tablet's pad strip (step 6), the
       Mixer page on SHIFT (K6), scrub (K7), the faders (K8), REC punching
       in (K3).
  - **Tools:** the fork's `tools/probe/` sends the protocol to the unit by
    hand, a frame at a time: `piprobe.py` on the Pi with Hindsight stopped
    (`systemctl --user stop hindsight.service`), `hsprobe.swift` on a Mac.
- The rig page with the real Sidekick (the eight steps in PR #107).
- The device spike (iPad standalone audio when backgrounded; Android
  discarding the PWA mid-jam) needs the tablet and the iPad.

## Gotchas

- `gh pr edit` fails on this repo (the retired projects API). Use
  `gh api -X PATCH repos/gabeduke/hindsight/pulls/<n> -F body=@file`.
- On the Pi, the service's log is
  `journalctl _SYSTEMD_USER_UNIT=hindsight.service`;
  `journalctl --user -u` finds nothing.
- A demo without `TAPE_DIR` and `SETTINGS_FILE` writes `~/hindsight`. The
  flows runner sets both to a temp dir.
- A red Go test is not a flake until its log says so (the known ones were
  fixed on 2026-10-22). Not seen since mid-October, and never fixed:
  `TestAMixdownPlaysTheLoopOnceAndSavesItWithItsTail` and the MIDI clock's
  tempo tests.
- The end-to-end sound check without ears: output `both`
  (`PUT /api/tapes/output`), record `/api/tapes/stream` while a script holds
  pads on `/api/tapes/play`, and read the level every 50 ms: BREAK reads 0,
  STOP falls to 0 over a beat.
- Node 22 for the JS tests (as CI).
- **Flow flakes not yet explained** (both 2026-10-19, neither seen
  locally): J1.9 on the tablet once tapped ↶ right after dragging a
  section's edge and the Pi kept the new edge (look at
  `scripts/flows/j1.9-song-layout.flow.mjs` and the section strip's pointer
  handlers in `lib/tape/page.js` before blaming the flow); J1.3's second
  hold-drag on the feed ribbon once didn't open the selection at
  `FLOWS_CPU=4`.
- The layout checks settle each screen and look twice, which makes a whole
  run about 9 minutes locally.

## Design canvases (claude.ai artifacts, private to Gabe)

- Room, Studio & Rig: `Ls32s93iBGoT7jUcHQb54Y`
- One player, two rooms (the shell): `9oJSxmvQhTnrBvVr2Uiz5o`
- Interaction model: `KwreNYVjPb8Kt3RMgrAbPr`
- The wireframes (every view at tablet, phone and desktop size):
  `9VDEexPH2bUo1vVzxZBSQx`
- The SMK-37's surface: `WrryAkACiz1AgNHGBMYAWV`

## Next

`the-studio-space.md` is the build order: steps 1–6 have landed; 7 (the
phone), 8 (the Studio's heads and ruler), 9 (the notes drawer), 10 (Open),
11 (the buffer into the cue lane) and 12 (polish) are open. They take in
the open steps of `listening-back.md` and `the-studio-on-one-screen.md`,
which hold their details.

Beside it, in tracks of their own: `the-instrument.md` (agreed
2026-10-26), Hindsight as something you play. Its step 1 comes first:
latency measured in use, every control timed to the ear, kept on the Pi.
Its step 7, the SMK-37, is above.

Leftovers, to fold in as each is touched:

1. **What is still on its own path** is listed, with why, by the
   ratchets: `OWN_HISTORY` and `OWN_MENUS` in `lib/architecture.test.js`,
   `TYPED` in `lib/ui/icons.test.js`. Also off the stack: the Listening
   Room's select mode (`lib/takes.js`), the buffer's lift and Play's learn
   mode (they claim their Escape), and a previewed Insert, Delete time or
   Paste.
2. **The presses still their own machines**, with only their numbers in
   `GESTURE` (`lib/ui/press.js`; most hold, then drag, which
   `pressMachine` doesn't do yet): the Takes list's two holds, the tape's
   part, range, ruler and section holds, the ribbon, the buffer grip,
   `lib/edit/gestures.js`, both overviews' double taps, Open's nudge keys.
3. Fix the layout findings above, and look through the storyboard
   (`--storyboard`, or CI's `flow-storyboard` artifact) with Gabe for what
   no check can see. The coverage map lists the controls no flow touches.
4. Write the missing flows in `docs/flows.md` as each journey is touched.
