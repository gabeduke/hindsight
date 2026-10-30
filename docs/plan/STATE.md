# State of Hindsight

**As of 2026-10-30.** What is open, one or two lines each, with a pointer to
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
- Open still titles a take by its date stamp, not `takeTitle`, until Open's
  pass.
- The cue lane takes GRABs only; adding from the shelf and from a track is
  in `backlog.md`.

## Known bugs

- **The first turn to the Listening Room freezes the Studio** about
  0.6–0.9 s at 4× CPU in headless Chromium (later turns 0.25–0.5 s),
  measured before the shelf wall replaced the stage. Re-measure, on the
  tablet.
- **Flow flakes not yet explained** (both 2026-10-19, neither seen
  locally): J1.9 on the tablet once tapped ↶ right after dragging a
  section's edge and the Pi kept the new edge (look at
  `scripts/flows/j1.9-song-layout.flow.mjs` and the section strip's pointer
  handlers in `lib/tape/page.js` before blaming the flow); J1.3's second
  hold-drag on the feed ribbon once didn't open the selection at
  `FLOWS_CPU=4`.

## Open, needs Gabe at the rig

- The instrument's DRIVE make-up by ear with the SMK-37 (about 10 dB
  quieter on a loud loop at full drive). At the rig on 2026-10-29 the
  encoders reached the tape (DRIVE 0 to 1 as K3 turned) but Gabe heard no
  difference in the jam room: find why the tape's FX aren't heard there
  first.
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
  - **Dialled in at the rig, 2026-10-29** (*At the rig* under *Next* in
    `the-instrument.md`, step 7): the fork's #10 and #11 on the unit
    (local echo, the quiet clock, the pads' chain), the Stops fixed, the
    frames written in chunks (#211), the pads on `now` (decision 0060).
  - **Next:** `MaxFrame` up from 512 once the chunks have run a while (a
    whole screen in one frame); the map's spec agreed (`the-map.md`);
    then the build order's rest (K11's pad strip, K6 after the map, K7,
    K8, K3), whose flows are written and `todo`.
- The rig page with the real Sidekick (the eight steps in PR #107).
- The device spike (iPad standalone audio when backgrounded; Android
  discarding the PWA mid-jam) needs the tablet and the iPad.

## Next

- **The component migration, paced** (`components.md`, agreed
  2026-10-30). One component per session, one PR each, tried by Gabe on
  the tablet before the next starts. Gabe, 2026-10-30: "merge anything, we
  roll forward", so a reviewed, green PR merges without waiting for him.
  Start each session fresh from this file and `components.md`. The queue:
  0. **Left from 2026-10-30**, if not merged yet (`gh pr list`):
     - setting the tempo at any time (#223);
     - the component harness and fixture models;
     - phone checks, which run every flow on the phone and dock the cue
       drawer above the mini player;
     - Export offering Download from the tape's track export;
     - ▶ in the Studio playing the tape when the bar held a take, with
       the counter fixed for a take (it read "BAR -1.4");
     - **push over HTTPS**: on a real kit's HTTPS address the socket to
       `/api/tapes/changes` fails, so pages fall back to polling. The
       demo and the flows run on plain HTTP and never see it.
  1. **Transport** (the bar): `components.md` §6, row 1. It amends
     AGENTS.md and decision 0047 (call 1).
  2. **Library: the List.**
  3. **Library: the wall.** The search becomes the library's state
     (call 2), and AGENTS.md's `#shelf-q` line changes with it.
  4. **The notes drawer**, on the take model.
  5. **Pads** (the cue lane). They need `lib/ui/drag.js` first.

  In between, the models still to build (step 4): `feed`, `take`, `rig`,
  `tape`, and the rest of `transport`. #231 built only the tape's
  transport: no source, output or tempo verbs, and getters rather than
  `snapshot()`. Then the one push socket at `/api/changes` (call 3).
- **The walkthrough's specs** wait on Gabe's questions:
  - `reach-back.md` (Catch and Keep as one move);
  - `song-sections.md` (templates you fill in);
  - `the-pocket-kit.md` (a phone that records on its own and syncs the
    tape; 19 questions).

  Their builds sit on the Transport and the List, so they come after
  those. `walkthrough.md` holds the stories and what is still to talk
  through. Play mode's flag is retired (#232: its strip deleted;
  `architecture/tape.md`, *When a pad lands*).
- **Calls taken for Gabe on 2026-10-30, his to overrule:**
  - `tempo.md`'s recommendations: move the bar lines now, varispeed later;
  - the phone's cue drawer docks above the mini player;
  - ▶ in the Studio, with nothing playing, plays the tape;
  - Export always offers Download;
  - Open's selection bar as #220 recommends.
- **`the-ecosystem.md` is the map.** Landed so far:
  - step 2, one verb set (#224);
  - step 4's first models: takes (#225), the tape's transport (#231).

  Step 5 is the migration above, and step 7 is the play look.
- **`the-studio-space.md` is the build order**: steps 1–9 and 11 have
  landed (9, the notes drawer: `docs/architecture/rooms.md`, *The notes
  drawer*; 11, GRAB onto the cue lane, a clip's drawer above the bar;
  decision 0061); 10 (Open, which docks the drawer beside its waveform)
  and 12 (polish) are open.
  The phone's player as a sheet and its ● want a look on a real phone:
  the mini player's display is narrow on a 360 px phone (`bar.md`). They
  take in the open steps of `listening-back.md`, which holds their details.
  Decision 0061's three choices were built as recommended; Gabe to try
  them on the tablet and overrule any.
- **The Pi's buffer routes are dead code** since step 11: `/api/clipboard`'s
  GRAB (bars, seconds, again, a take's grab), its PATCH, keep, toss, toss's
  restore and audio, `/api/tapes/cue/add`, and `Engine.Grab`,
  `GrabTake(Opt)`, `TrimClipboard`, `ShapeClipboard`, `KeepClipboardTake`,
  `TossClipboard`, `RestoreClipboard(Opt)`, `ClipboardAudio`,
  `CueFromClipboard`, `CueFromTake`. Nothing in the UI or on a controller
  calls them. Retire them, moving the tests that use them to the cue lane
  (`grab_test.go`, `replaced*_test.go`, `internal/api/buffer_test.go`);
  a range's Cut, Copy, Paste and their Undo (`RestoreReplaced`) stay.
- **`the-play-look.md`** (not agreed yet): the look made simpler and more
  fun, after Gabe's OP-1 field note. An audit, and three directions on the
  canvas `DHqPaBAGJyqDz4PErR4Qir` (A tidied, B Signal recommended, C
  Toybox), shipped as a theme beside today's Reel and applied per
  component. It is `the-ecosystem.md`'s step 7, after the walkthrough.
  **Gabe picks a direction** before any code.
- **`the-instrument.md`** (agreed 2026-10-26), in tracks of its own:
  Hindsight as something you play. Its step 1 is built: latency
  measured in use, every control timed to the ear, kept on the Pi
  ([decision 0016](../decisions/0016-measure-latency-in-use.md);
  `GET /api/latency`, the rig's line). Next, Gabe at the rig reads the
  numbers on the Pi 5, which choose step 2's buffers. Its step 7, the
  SMK-37, is above. Since Play mode's strip went (2026-10-30) no page plays
  the pads, so a touch is no longer timed (`page→room`, `page→phone`; a
  controller's `midi→room` is), and no page shows the tape mods: both wait
  for the instrument's shape (`tape.md`, *When a pad lands*).
- **An auto-install trigger** for releases ([decision 0012](../decisions/0012-agents-install-releases.md); `backlog.md`).

Leftovers, to fold in as each is touched:

1. **What is still on its own path** is listed, with why, by the
   ratchets: `OWN_HISTORY` and `OWN_MENUS` in `lib/architecture.test.js`,
   `TYPED` in `lib/ui/icons.test.js`. Also off the stack: the Listening
   Room's select mode (`lib/takes.js`), the buffer's lift (it claims its
   Escape), and a previewed Insert, Delete time or Paste.
2. **The presses still their own machines**, with only their numbers in
   `GESTURE` (`lib/ui/press.js`; most hold, then drag, which
   `pressMachine` doesn't do yet): the Takes list's two holds, the tape's
   part, range, ruler and section holds, the ribbon, the buffer grip,
   `lib/edit/gestures.js`, both overviews' double taps, Open's nudge keys.
3. Fix the layout findings above, and look through the storyboard
   (`--storyboard`, or CI's `flow-storyboard` artifact) with Gabe for what
   no check can see. The coverage map lists the controls no flow touches.
4. Write the missing flows in `docs/flows.md` as each journey is touched.
