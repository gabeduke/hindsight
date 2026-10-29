# State of Hindsight

**As of 2026-10-29.** What is open, one or two lines each, with a pointer to
where its detail lives. Keep it current and short; when an item closes,
delete it. How things work is in `docs/architecture.md` (an index of
`docs/architecture/`); why, and what Gabe has decided, in
`docs/decisions/`; what happened, in `git log`. Gotchas and the design
canvases are in `docs/development.md`.

No home network details here (no LAN or tailnet addresses or names): the Pi
is `<pi-host>`.

## What is built

All of it is in `docs/architecture/`: the shell and its two rooms
(`shell.md`, *The shell*, *Moving between rooms*), the frame (`shell.md`,
*The frame*), the bar (`bar.md`), the Listening Room as a library
(`rooms.md`, *The library*), the cue lane and the tape's changes socket
(`tape.md`, *The cue lane*; `push.md`), and the SMK-37 on Hindsight's
firmware (`keyboard.md`). What is not built yet, and still looks it:

- Open (`wave.html`), the rig (`rig.html`) and the guide are still pages of
  their own, outside the shell ([decision 0011](../decisions/0011-open-is-its-own-page.md)).
- Notes on a take are still the Sketchbook's dialog (✎ on the bar), until
  the notes drawer (`listening-back.md`).
- Open still titles a take by its date stamp, not `takeTitle`, until Open's
  pass.
- The cue lane takes GRABs only; adding from the shelf and from a track is
  in `backlog.md`.

## Known bugs

- **Layout** (the flows' baseline, `scripts/flows/layout-known.json`;
  `docs/flows.md`, *What a run says*): the cue clip's × (12×14 px) and loop
  toggle (22 px) are under 24 px.
- **The first turn to the Listening Room freezes the Studio** about
  0.6–0.9 s at 4× CPU in headless Chromium (later turns 0.25–0.5 s),
  measured before the shelf wall replaced the stage. Re-measure, on the
  tablet.
- On a phone, the Studio's track level sliders are 18 px tall (axe's
  target-size), met only by a partial run on the demo's own tape (J5.1,
  J2.10 on a phone).
- Red Go tests not seen since mid-October, and never fixed:
  `TestAMixdownPlaysTheLoopOnceAndSavesItWithItsTail` and the MIDI clock's
  tempo tests.
- **Flow flakes not yet explained** (both 2026-10-19, neither seen
  locally): J1.9 on the tablet once tapped ↶ right after dragging a
  section's edge and the Pi kept the new edge (look at
  `scripts/flows/j1.9-song-layout.flow.mjs` and the section strip's pointer
  handlers in `lib/tape/page.js` before blaming the flow); J1.3's second
  hold-drag on the feed ribbon once didn't open the selection at
  `FLOWS_CPU=4`.

## Open, needs Gabe at the rig

- The instrument's DRIVE make-up by ear with the SMK-37 (about 10 dB
  quieter on a loud loop at full drive).
- `BenchmarkRenderABlock` on the Pi 4B.
- **The push, timed** (the last step of pushing the tape's state): the
  SMK-37's PLAY, from its log line to the tablet's paint. Expected 30–50 ms
  (the push ~10 ms on Wi-Fi, one poll ~20 ms, up to a frame), against up
  to 235 ms on the poll alone; the tablet's Wi-Fi power saving can add
  100 ms or more. Then **Gabe decides the fallback poll**: the
  recommendation is the Studio's 200 ms slowed to 1 s, for when the socket
  is down (`docs/architecture/push.md`; [decision 0013](../decisions/0013-push-a-nudge-not-the-state.md)).
- **The SMK-37 on Hindsight's own firmware.** Released (#202's 512-byte
  frames first in v2026.10.29.6): the designed screen, the press banner,
  the pads lit by family with the half/full stage, PLAY/REC/SHIFT lights;
  the tablet's note over the bar for every press (#198); the push socket
  (#196). Gabe, seeing it: *"it works!"*
  - The unit as it is, its firmware and how to probe it, and what was
    **learnt on the unit** (the 764-byte frame loss, the dead-keyboard
    retake, the Stops, the pads' colours): `docs/architecture/keyboard.md`,
    *On the unit* and *Learnt on the unit*.
  - **Next** (Gabe, 2026-10-29: to dial in the link and the signal
    flow): the pads, the Stops, local echo and the link's model are built
    without the unit (the fork's PR #10, not flashed; the Pi's side in
    hindsight). What needs Gabe at the keyboard is the checklist *At the
    rig* under *Next* in `the-instrument.md`, step 7: install, flash,
    look, listen, measure, about 1 h 45 min. Then the build order's rest
    (K11's pad strip, K6 after the map's spec `the-map.md`, K7, K8, K3),
    whose flows are written and `todo`.
- The rig page with the real Sidekick (the eight steps in PR #107).
- The device spike (iPad standalone audio when backgrounded; Android
  discarding the PWA mid-jam) needs the tablet and the iPad.

## Next

- **`the-studio-space.md` is the build order**: steps 1–6 have landed; 7
  (the phone), 8 (the Studio's heads and ruler), 9 (the notes drawer), 10
  (Open), 11 (the buffer into the cue lane) and 12 (polish) are open. They
  take in the open steps of `listening-back.md` and
  `the-studio-on-one-screen.md`, which hold their details.
- **`the-instrument.md`** (agreed 2026-10-26), in tracks of its own:
  Hindsight as something you play. Its step 1 is built: latency
  measured in use, every control timed to the ear, kept on the Pi
  ([decision 0016](../decisions/0016-measure-latency-in-use.md);
  `GET /api/latency`, the rig's line). Next, Gabe at the rig reads the
  numbers on the Pi 5, which choose step 2's buffers. Its step 7, the
  SMK-37, is above.
- **An auto-install trigger** for releases ([decision 0012](../decisions/0012-agents-install-releases.md); `backlog.md`).

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
