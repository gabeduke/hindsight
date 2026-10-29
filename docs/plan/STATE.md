# State of Hindsight

**As of 2026-10-25.** This is the one handoff: what is built, what Gabe has
decided, what is open. Keep it current and short; when a section goes stale,
fix it or delete it. What happened before is in `git log`, and the deleted
specs and handoffs are in history under `docs/superpowers/`.

No home network details here (no LAN or tailnet addresses or names): the Pi
is `<pi-host>`.

## What is built

- **One document, two rooms.** `shell.html` is served at `/`, `/index.html`,
  `/tape.html` and `/takes.html`. The Studio, the Listening Room and Capture
  are views inside it, switched by `lib/shell/router.js` (pushState). The
  legacy UI and the rooms flag are gone. `wave.html` (Open), `rig.html` and
  `guide.html` are still separate pages. See `docs/architecture.md`, *The UI*.
- **One frame on every page.** `css/chrome.css` lays out the header on the
  Studio, the Listening Room, Capture, Open, the rig and the guide: what
  you're working on at the left (the tape's name, the search, the feed, ‹
  and the take's name), Studio | Listening Room centred at one rect on
  every page of a width (J5.1), ↶ ↷ and then ☰ at the right; the brand
  from 1280 px; on a phone the context, ↶ and ☰, the rooms as tabs. Each
  tab has its own picture; ☰ is only the app's menu. A thing's name is its
  menu (the tape's, the take's): ⋯ is gone, its options in ⌗'s View menu
  beside the ruler. The header's tempo pill, output button and alignment
  dot went to the bar's display (SYNC). See `docs/architecture.md`, *The
  frame*.
- **One bar, one shape.** `lib/bar/engine.js` owns the bar's audio, the tape
  source, the stream player and the output; `#np` is the same object in every
  view, and a take keeps playing across a room switch. `css/bar.css` draws it
  as five zones (the deck, |◀ ▶ ●, Catch ▾, ⟲ and the metronome, ⏏ Open ›
  ✎) and the strip, ▶ at one x for every source in both rooms and on Open
  (`docs/architecture.md`, *The bar*). Its display says what plays, its
  tempo and where it plays, each a key; it folds by its grabber. On a phone
  it is a mini player with |◀ and ▶ (and Catch in the Studio, Open › and ✎
  with a take).
- **The Studio:** feed ribbon aligned with the lanes, KEEP, GRAB → buffer →
  DROP, CATCH, multi-arm, sections, ranges, parts, fades, BOUNCE, the
  instrument strip (Play mode, per-device switch, off by default), punch-in
  FX, the collapsible bar and lanes (`body.np-fold`, `body.tracks-fold`).
  **Share the mix** (in the tape's name's menu) sends the whole tape as an
  MP3 rendered on the Pi
  (`listen?all=1&format=mp3`), dry, with the interface off or on.
- **The cue lane.** The lane (`#cue-row`, `lib/tape/cuelane.js`) and its
  store in the tape's state (`State.Cue`), with solo, loop, remove and
  drag-to-track. The buffer's **Cue** puts a GRAB on it
  (`POST /api/tapes/cue/add`; a take's span too, by API). A tap launches a
  clip on the next bar line, a second tap stops it there, Shift at once
  (`POST /api/tapes/cue`, `internal/tape/cuelive.go`): rendered on the Pi,
  summed with the tape on bus A, so it reaches the phone's stream too.
  Launches are a performance, outside undo; `live.cue` says what plays.
  Still to do: adding from the shelf and from a track (`backlog.md`).
- **Moving between rooms** (`the-studio-space.md` step 5): a switch turns a
  camera from one wall of the room to the other (`css/rooms-motion.css`),
  the header and the bar held still, a crossfade with less motion; the
  Listening Room and Capture are mounted out of sight once the first room
  is up, so the first turn lands on a drawn room; a tap during a turn ends
  it, and lands if it was on the header or the bar (on the room, it does
  nothing else). Rooms make their entrance on `html[data-arriving]`. See
  `docs/architecture.md`, *Moving between rooms*.
- **The Listening Room is a library** (step 6 of `the-studio-space.md`,
  2026-10-24): the shelf wall on a tablet and wider (a shelf per month,
  ★, a shelf per tag; All › opens a shelf as the List), the List by month
  and day on a phone, Shelf | List remembered per device, Sort ▾, the
  chips, and a search that opens the List pinned and matches what a spine
  says. The drawn room is the backdrop, in full only while
  `html[data-arriving="room"]` is set (the camera's step sets it). Tap
  plays, hold selects; ✎ on the bar opens the Sketchbook's notes; Open →
  the take page, which shares the edit curves (`lib/edit/curves.js`) but
  not yet the tape's controls. A take is named one way in the rooms, the
  bar and the toasts (`takeTitle`); Open's page still titles it by its
  date stamp, for Open's pass (a shorter title there moved ★ over the
  tempo's line, under 24 px apart: its header is the bar track's now).
- **The reels and the cassette's hubs are rendered** in Blender
  (`scripts/blender/spools.py` → `web/static/sprites/`, drawn by
  `lib/objects/spin.js`): the bar's reels turn as sheets of lit frames,
  blurred as they wind to a jump; the hubs turn by the cassette's model,
  the emptier spool faster, where a CSS spin turned them at one speed. The
  cassette face is on the bench only while the take-detail pane is off.
- **Releases and the hub:** a merge of shipping code is a release; kits update
  from the Update button or `POST /api/update`. The hub runs on the cluster.

## Known bugs

- **Layout, found by the flows' layout checks** (the baseline,
  `scripts/flows/layout-known.json`; each fix shrinks it, see
  `docs/flows.md`, *What a run says*):
  - The cue clip's × (12×14 px) and loop toggle (22 px) are under 24 px.
- **The first turn to the Listening Room still freezes the Studio** for a
  moment while the room is laid out and drawn for the first time (its
  ResizeObserver draws the stage in that frame): about 0.6–0.9 s at 4× CPU
  in headless Chromium, against 0.15 s before into an empty page the room
  popped into later. Later turns freeze 0.25–0.5 s at 4×, as before: the
  body classes' restyle and the transition's capture. Measured from a
  trace's screenshots; re-measure on the tablet. The shelf wall (step 6)
  has replaced the stage since: re-measure.
- On a phone, the Studio's track level sliders are 18 px tall (axe's
  target-size). A run of only some flows meets them on the demo's own tape
  (J5.1, J2.10 on a phone); the whole run, whose tapes are the flows'
  own, doesn't.

(A take tapped while its preview encodes isn't one:
`lib/room/tap.js` says "Still encoding", retries, and loads it when ready.
A flow that taps that soon hears nothing, which is why `t.api.keep` waits.)

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
  shell view next: leaving for it while the tape plays on this device stops
  the tape about 6 s later.
- **Releases:** Gabe doesn't pull releases by hand; an agent installs them
  with `POST /api/update` (see AGENTS.md). An auto-install trigger is open.
- **The header's one menu** (☰, top right on every page) holds Settings, the
  rig, help mode, the guide and Releases (2026-10-22). That reversed the
  `.appbar-end` cluster, which had reversed "one route, the about line"; the
  Settings sheet keeps its line too. On a tablet the rooms' header is one
  row. It is step 1 of `the-studio-on-one-screen.md`, whose other picks are
  the feed as a strip, the track heads on touch as name, ● and input, and
  the buffer merged into the cue lane.

## Open, needs Gabe at the rig

- The instrument's DRIVE make-up by ear with the SMK-37 (about 10 dB quieter
  on a loud loop at full drive).
- `BenchmarkRenderABlock` on the Pi 4B.
- The SMK-37 profile's MIDI channel (a guess: channel 10).
- The rig page with the real Sidekick (the eight steps in PR #107).
- The device spike (iPad standalone audio when backgrounded; Android
  discarding the PWA mid-jam) needs the tablet and the iPad.

## Gotchas

- `gh pr edit` fails on this repo (the retired projects API). Use
  `gh api -X PATCH repos/gabeduke/hindsight/pulls/<n> -F body=@file`.
- A demo without `TAPE_DIR` and `SETTINGS_FILE` writes `~/hindsight`. The
  flows runner sets both to a temp dir.
- Flaky Go tests: fixed on 2026-10-22, from every red `test` job in the
  last 100 CI runs. `TestSaveRangeSavesASpanThatEndedInThePast` (four of
  them) measured from the end of the test instead of the save;
  `TestDeleteGoesToTheTrashAndComesBack` lost a race to a restore's preview
  encode, which ran outside the API's `WaitBackground`; and the MIDI
  watcher had a real data race on a reader's id, which `-race` caught in
  `TestWatcherOnlyOnePortIsTheClock`. Not seen since 15 October, and not
  touched: `TestAMixdownPlaysTheLoopOnceAndSavesItWithItsTail` (once said to
  fail one run in twelve) and the MIDI clock's tempo tests (4–5 October).
  If one comes back, the job's annotation names it; read its log before
  calling it a flake.
- The end-to-end sound check without ears: output `both`
  (`PUT /api/tapes/output`), record `/api/tapes/stream` while a script holds
  pads on `/api/tapes/play`, and read the level every 50 ms: BREAK reads 0,
  STOP falls to 0 over a beat.
- Node 22 for the JS tests (as CI).
- **A flow flake not yet explained:** once in six CI runs (2026-10-19),
  J1.9 on the tablet tapped ↶ right after dragging a section's edge and the
  Pi kept the new edge, with nothing to redo: as if the tap never landed. It
  hasn't happened locally, even at `FLOWS_CPU=6`. If it comes back, look at
  `scripts/flows/j1.9-song-layout.flow.mjs` and the section strip's
  pointer handlers in `lib/tape/page.js` before calling it the flow's fault.
- Once at `FLOWS_CPU=4` (2026-10-19), J1.3's second hold-drag on the
  feed ribbon didn't open the selection (six reruns passed).
- The layout checks settle each screen and look twice, which makes a whole
  run about 9 minutes locally.

## Design canvases (claude.ai artifacts, private to Gabe)

- Room, Studio & Rig: `Ls32s93iBGoT7jUcHQb54Y`
- One player, two rooms (the shell): `9oJSxmvQhTnrBvVr2Uiz5o`
- Interaction model: `KwreNYVjPb8Kt3RMgrAbPr`

## Next

`the-studio-space.md` (agreed 2026-10-24) is the build order now: it takes
in the open steps of the two specs below, in one sequence of checkpoints,
and changes four of their decisions (⋯ goes into the tape's name; the
output, tempo and source move onto the bar's display; the Listening Room
becomes a shelf wall with the drawn room as the way in; ● on a phone
records from the phone). Its step 3, **the frame**, has landed (the
header's three zones on every page, the tape's and the take's names as
their menus, ⋯ gone into them and into ⌗'s View menu, the tempo, output
and alignment out of the header). Its step 4, **the bar**, has landed with
`listening-back.md`'s step 1 (the way in): `css/bar.css`, the first of the
per-place stylesheets; the zones, ▶ at one x for every source in both
rooms (J1.13), ● beside ▶, the display's tempo, source and output keys
(the Feed | Tape | Shelf switch is gone), the grabber, Open › and ✎ at the
bar's end, and a double tap on a spine. Its step 6, **the library**, has
landed too (above). Its step 1
(foundations, nothing visible) is under way, and step 2 has begun: `lib/ui/layers.js`, the one stack of open
things, with ☰, the Studio's menus, inspector, clip editor and selection,
and the phone's player on it; and `lib/ui/menu.js`, the one menu, with ☰
and every menu in the Studio on it (KEEP ▾, GRAB ▾, Catch ▾ as a key of its
own, the tape's name, the tempo, ⌗ and the input chips'), and Open's take
menu. Still on their own path, each to move as it is touched: Open's notes
pane (its own history entry, until it is the notes drawer), Open's More,
Send to and lane menus (into `menu.js`), the Listening Room's select mode (`takes.js`), the buffer's
lift and Play's learn mode (they claim their Escape with `preventDefault`),
and a previewed Insert, Delete time or Paste in the Studio (no layer: a
pointer over the key shows one). The icon sprite (`lib/ui/icons.js`,
`icons/ui.svg`) has the header's, the bar's (Catch's ▾ among them) and the
ruler's keys. The glyphs still typed (the feed strip's ▾s, KEEP's among
them, the buffer's, GRAB's ▾ among them, the cue lane's and the editors'
keys, Open's own, the menus' ✓) go as their regions are rebuilt.

1. `listening-back.md` (agreed 2026-10-23, from Gabe trying the Listening
   Room on the rig): ~~Open › on the bar and a double tap on a spine~~
   (landed with the bar), one notes drawer in place of the Sketchbook, then
   Open on one screen.
2. `the-studio-on-one-screen.md`, in its build order: ~~the header's menu~~,
   ~~the feed strip~~ (done), the track heads on touch, a layout budget, the buffer into the
   cue lane (with the lane's other sources: a take from the shelf, a part
   lifted from a track). Open's pass moved into `listening-back.md`. Then
   the rest of `shell-roadmap.md` (the output switch).
3. Write the missing flows in `docs/flows.md` as each journey is touched.

Beside it, in tracks of their own: `the-instrument.md` (agreed
2026-10-26), Hindsight as something you play. Its step 1 comes first:
latency measured in use, every control timed to the ear, kept on the Pi.
And `pushing-tape-state.md` (agreed 2026-10-28): the Pi nudges the page
when the tape changes, so the tablet follows a controller's press in about
30–50 ms instead of up to 235.
4. Fix the layout findings above, and look through the storyboard
   (`--storyboard`, or CI's `flow-storyboard` artifact) with Gabe for what
   no check can see. The coverage map lists the controls no flow touches.
5. Fold the presses that are still their own into `lib/ui/press.js` as each
   is touched (most hold, then drag, which `pressMachine` doesn't do yet):
   the Takes list's two holds, the tape's part, range, ruler and section
   holds, the ribbon, the buffer grip, `lib/edit/gestures.js`, both
   overviews' double taps, Open's nudge keys.
