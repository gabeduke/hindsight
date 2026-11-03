# State of Hindsight

**As of 2026-11-01.** What is open, one or two lines each, with a pointer to
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
(`tape.md`, *The cue lane*; `push.md`), the SMK-37 on Hindsight's
firmware (`keyboard.md`), and the components' foundations (`components.md`:
the contract and Guardrail 15, the protocol client and fixtures, the
harness, `node scripts/components.mjs`, and `display`, mounted by the
harness only until the Transport's extraction). What is not built yet,
and still looks it:

- Open (`wave.html`), the rig (`rig.html`) and the guide are still pages of
  their own, outside the shell ([decision 0011](../decisions/0011-open-is-its-own-page.md)).
- The cue lane takes GRABs only; adding from the shelf and from a track is
  in `backlog.md`.

## Known bugs

- **A full flows run fails one timing flow in about half of runs**
  (2026-11-02, the Transport's PRs): a different one each time, each
  passing 3/3 alone on the branch and on main. J1.14 [tablet] (▶ shows
  within 100 ms: 107), J1.20 [phone] (the taps set no tempo), J2.5
  [tablet] (the drawer read once before it docks), J2.7 [tablet] (the
  wall scrolled 551 of 608), and J2.11 [phone] in CI on #251 (the meters
  read the same twice). Worst while two runs share the Mac. Each wants
  its own look: J2.5 reads the layout once without polling; the others
  may be load.
- **A press waits while nothing plays the tape.** With the interface off,
  only a listening phone pulls the tape along (`Output.paceStep`). Once
  the last phone leaves, a stop, a locate or the 6 s drop-pause's own
  stop is queued for an output frame that never comes (`renderLoop` →
  `drain`); it lands only when the next phone joins, and that phone first
  hears what was rendered ahead. Seen on the rig on 2026-10-23. Gabe
  asked for it to be listed, not fixed yet.
- **J5.1 on the phone throws in its setup on a Mac** (seen 2026-11-01,
  also without the `checkLayout` change): `api.copies` in
  `scripts/flows/harness.mjs` hits `EEXIST` linking the kept take to a
  copy's name (`jam_<date>_<time>.mid`), with a dozen takes dated whole
  hours back. The kept take is named by one clock and the copies by
  another; look at the zone before blaming the flow's dates. Cause (found
  2026-11-01, US fall-back day): local hours repeat, so two copies get one
  name; `TZ=UTC node scripts/flows.mjs` works around it, and CI is UTC.
- **J5.1's "tip clears the last take" check on the phone depends on how
  many takes the run has kept** (2026-11-01, #223): J1.20 keeping a take
  per profile took the List to 79 rows and the last take ended 3 px under
  the tip ({rows:79, last:555, tip:552}, deterministic, in CI and with
  `TZ=UTC` locally); J1.20 now reuses a take on the shelf, and the run
  is 97/97. The List's foot is off by a few px at some lengths: look at
  it when the List is rebuilt (queue 2), not by adding to the flow.
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
- **Two copies of the display's keys** until the Transport's extraction:
  the bar's (`shell.html`, `css/bar.css` `.np-lcd-*`) and the `display`
  component's (`lib/components/display`, `css/display.css`), which only
  the harness mounts. The extraction keeps one and deletes the other.

## Open, needs Gabe at the rig

- **Extra inputs** (`extra-inputs.md`, spec 2026-11-02): the AMS-24's two
  inputs recorded beside the EP-136's as channels 9–10, resampled onto its
  clock, never played out of. Decided, not built (2026-11-02): the build
  order's eight steps wait for their place in the queue. How Gabe hears
  the guitar (decision 2) is his wiring, recommended but his to change.
- **Decided for Gabe while he was away, his to overrule** (2026-10-30): in
  the Studio a take or the feed that isn't playing gives the bar back to
  the tape, so ▶ there plays the tape (`docs/architecture/bar.md`, *In the
  Studio, the tape*; J1.17).
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
  0. **Left from 2026-10-30**: nothing open (#223, setting the tempo at
     any time, merged 2026-11-01 with J1.20's phone path).
  1. **Transport** (the bar): `components.md` §6, row 1, in four PRs.
     a. **Its model**: done, #244 (2026-11-01). The transport is on the
        protocol client with its output, tempo and tap verbs and
        `snapshot()` (`architecture/bar.md`, *The transport*); Guardrail
        16; J1.13 runs on the phone (J1.10 and J1.16 say why they don't).
        Gabe tries it on the tablet and the phone before b.
     b. **The tape model**: done, #245 (2026-11-01).
        `lib/models/tape.js` is the page's one poller of the tape (the
        Studio 200 ms while shown, the bar 500 ms), with `change(send)`
        and the verbs for ●, Catch and the click (`record`, `punchOut`,
        `cancelRecord`, `catch`, `setClick`); the transport reads the
        tape from it and `delegate` keeps only `around`; Guardrail 17
        (`architecture/tape.md`, *The tape model*). Left for d: the
        Studio still looks up and draws the bar's `$('rec')`,
        `$('catch-pass')` and `$('click')` and binds them to these
        verbs; the extraction moves that into the component.
     c. **The engine split**: done, #247 (2026-11-02). `lib/models/engine.js`
        `createEngine` holds the sources (`lib/models/tape-source.js`,
        `take-source.js`, `feed-source.js`), which is in the bar and the
        take's Audio, with `setSource`, `loadTake`, `eject`, `snapshot()`
        and `onChange` (per change and per frame while it plays) on
        `engine.bar`; `NowPlaying` (`new NowPlaying({engine, onToast})`,
        made by `boot.js`) draws it and wires the source menu, ● on the
        mini player and the output sheet; Guardrail 18
        (`architecture/bar.md`, *The engine*). Left for d: the engine
        still imports `carry.js` and `handoff.js` from
        `lib/bar/`; Guardrail 18 matches the source makers by name (an
        aliased import gets past it).
     d. **The extraction** into `lib/components/transport/`: a spec
        first, `transport-extraction.md` (2026-11-02), because the move
        breaks Guardrail 15 in six places that each need an interface
        (the ids, the bar's state on `<body>`, the fold event and the
        `tape-page` observer, the Studio's keys in the bar, the window,
        Open sharing the files), each agreed in `components.md` or
        recommended within it; then its five PRs in order. It amends
        AGENTS.md and decision 0047 (call 1). Built: step 1 (#249: the
        stack's `covered()`, which J asks; `cx.media`; the recorder's
        `snapshot()`) and step 2a (#250: `lib/bar/layout.js`
        `barLayout`, the one writer of `body.np-fold` and
        `body.player-open`, shared as `ctx.barLayout`; `NowPlaying`'s
        `room()`; no `hindsight:np-fold`, no body `MutationObserver`).
        Step 2b (the stylesheet half of decision 2: the page around the
        bar is `styles.css`'s, and `.np[data-room]`) and step 3's keys
        (#254: `lib/bar/tape-keys.js`, ●, Catch and the click on the
        tape's verbs, the Studio's hands lent through `ctx.tapeKeys`;
        Guardrail 19) are built, and step 3's slot for the overview
        (#256: the Studio's markup, in the bar's strip through
        `ctx.barSlot`'s `{ place: 'strip' }`, held by the page;
        Guardrail 21). Step 4, the ids, is built ahead of it (#255:
        every id inside the shell's `#np` is `np-<name>`; Guardrail 20).
        **Next**: step 5, the move, audited on 2026-11-02 and split
        into eight PRs (5a–5h), built in order. Gabe's calls are taken
        as recommended: D1, the `@media` stay (container queries can't
        say height or orientation); D2, `display` in the bar is out of
        the move, its own PR (5h), which Gabe looks at before it merges;
        D3, no copies for Open; D4, a mediator for the Studio's keys;
        D5, the surface owns the phone's sheet; D6, menus in the top
        layer. The clock-out lamp and the output strip are the bar's,
        drawn from the models in every room (5b), not the Studio's slot.
        Gabe tries the bar on the tablet after 5h. 5a, the interfaces,
        is built and adopted by nothing yet: menu rows with no
        document and `dialogKey` (`lib/ui/menu.js`), `sizeCanvas`
        (`lib/ui/canvas.js`), `onSchemeChange`'s off, `shellScope`
        (`lib/shell/view.js`) and `cx.visible()`, and fixture makers for
        `bar`, `recorder` and `layout` (#260). 5b is built (#261):
        `engine.bar`'s verbs (`playPause`, `toStart`, `back5`,
        `setLoop`, `seekFraction`, `toEnd`, `step`), a frozen
        `snapshot(here)` with a `v` and `paintStrip`; `noteHere` in the
        engine; `NowPlaying` draws from them and holds no source; the
        lamp and the output strip are the bar's, from the tape's
        snapshot and `engine.stream` (`lib/bar/tape-status.js`), the
        Studio's ghost lent through its hands. 5c-1 is built (#262):
        the surface's pieces (`--np-h` measured by the boot; the fold's
        storage in `barLayout`; `data-fold`, `data-open` and
        `data-docked` on the bar's root, the fold synced by the router's
        `chrome.classesGiven`, docked said by `ctx.dockSlot.show`; the
        phone's player sheet the surface's, `playerSheet`, dragged from
        the bar's handles by `sheet.grab`; the Output sheet and the
        recorder made at boot). 5c-2 is built (#263): the Studio's and
        the rooms' reaches into the bar are verbs and callbacks (SYNC
        the bar's; ▶ and L the engine's; `ctx.tapeKeys.focusPlay()` and
        `tempo(fn)`; `ctx.openOutput()`; the grease through
        `ctx.barSlot`), Guardrail 22. **Next**: 5d, `css/bar.css` onto
        the root's attributes.
  2. **Library: the List.**
  3. **Library: the wall.** The search becomes the library's state
     (call 2), and AGENTS.md's `#shelf-q` line changes with it.
  4. **The notes drawer**, on the take model.
  5. **Pads** (the cue lane). They need `lib/ui/drag.js` first.

  In between, the models still to build (step 4): `feed`, `take`, `rig`,
  and the tape's other edits (`edit`,
  `PATCH /api/tapes`'s other fields, undo, load, the cue lane's), still
  the Studio's through `tape.change`. Then the one push
  socket at `/api/changes` (call 3).
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
  - the phone's cue drawer docks above the mini player (0063);
  - ▶ in the Studio, with nothing playing, plays the tape (0064);
  - Export always offers Download (0065);
  - Open's selection bar as #220 recommends (0066).
- **Calls taken for Gabe on 2026-11-02, his to overrule**: the
  Transport's extraction (`transport-extraction.md`), built on its
  recommendations overnight. Decision 1, the ids, was already agreed
  (`components.md` 1.3). The rest:
  - 2: the bar's fold and player-up go on `#np`; the shell, not the bar,
    sets `body.np-fold` and `body.player-open` for the page's own rules;
  - 3: the Transport is told the room by the surface, and the Studio hears
    the fold through `ctx.barLayout`, not `hindsight:np-fold`;
  - 4: ●, Catch and the click become the Transport's keys on the tape's
    verbs; the overview stays the Studio's, in the bar's slot; the
    clock-out lamp and the output strip are the bar's, from the models
    (taken as (b) on 2026-11-02, after Gabe handed the call over);
  - 5: `cx.media` and the stack's `covered()` (built, #249);
  - 6: one display: the bar mounts `display` (`#np-lcd-…`), which learns
    a take's and the feed's words;
  - 7: Open keeps its markup and modules until its pass, sharing
    `css/bar.css`;
  - 8: the shell makes the phone's recorder at boot and hands it to the
    Transport.
- **`the-ecosystem.md` is the map.** Landed so far:
  - step 2, one verb set (#224);
  - step 4's first models: takes (#225), the tape's transport (#231).

  Step 5 is the migration above, and step 7 is the play look.
- **`the-studio-space.md` is the build order**: steps 1–11 have landed
  (10, Open and the dolly into a take: `docs/architecture/take-page.md`,
  *Open*); 12 (polish) is open, and so is Open's one unbuilt part, the
  selection's action bar, settled by recommendation (Gabe may overrule):
  its ends, length and Clear dock above the bar as the Studio's action bar
  does, and GRAB and KEEP stay under the waveform, already saying what
  they do to the selection. Open wants a look on the tablet: the docked
  notes drawer, GRAB first, the folds, the numbered pins and double-tap
  zoom.
  The phone's player as a sheet and its ● want a look on a real phone:
  the mini player's display is narrow on a 360 px phone (`bar.md`).
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
