# State of Hindsight

**As of 2026-10-22.** This is the one handoff: what is built, what Gabe has
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
- **One bar.** `lib/bar/engine.js` owns the bar's audio, the tape source, the
  stream player and the output; `#np` is the same object in every view, and a
  take keeps playing across a room switch.
- **The Studio:** feed ribbon aligned with the lanes, KEEP, GRAB → buffer →
  DROP, CATCH, multi-arm, sections, ranges, parts, fades, BOUNCE, the
  instrument strip (Play mode, per-device switch, off by default), punch-in
  FX, the collapsible bar and lanes (`body.np-fold`, `body.tracks-fold`).
- **The cue lane.** The lane (`#cue-row`, `lib/tape/cuelane.js`) and its
  store in the tape's state (`State.Cue`), with solo, loop, remove and
  drag-to-track. The buffer's **Cue** puts a GRAB on it
  (`POST /api/tapes/cue/add`; a take's span too, by API). A tap launches a
  clip on the next bar line, a second tap stops it there, Shift at once
  (`POST /api/tapes/cue`, `internal/tape/cuelive.go`): rendered on the Pi,
  summed with the tape on bus A, so it reaches the phone's stream too.
  Launches are a performance, outside undo; `live.cue` says what plays.
  Still to do: adding from the shelf and from a track (`backlog.md`).
- **The Listening Room:** the shelf as a room, tap plays, hold selects, the
  Sketchbook (✎) inline, Open → the take page, which shares the edit curves
  (`lib/edit/curves.js`) but not yet the tape's controls.
- **Releases and the hub:** a merge of shipping code is a release; kits update
  from the Update button or `POST /api/update`. The hub runs on the cluster.

## Known bugs

- **Layout, found by the flows' layout checks** (the baseline,
  `scripts/flows/layout-known.json`; each fix shrinks it, see
  `docs/flows.md`, *What a run says*):
  - Tablet: the bar runs off the right side: its fold button by 8 px
    here, its ✎ Note in CI's fonts.
  - Tablet: the Listening Room's sketchbook place starts off the left side.
  - The cue clip's × (12×14 px) and loop toggle (22 px) and the shelf's
    list button (20 px tall) are under 24 px.
  - About 800 px wide (a Pixel Tablet held upright), the bar runs off the
    right side: Catch is cut, and the page scrolls sideways. No flow runs
    at that width.

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
- Flaky Go tests: `TestAMixdownPlaysTheLoopOnceAndSavesItWithItsTail` fails
  about one run in twelve; `TestDeleteGoesToTheTrashAndComesBack`'s TempDir
  cleanup races a preview writer.
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

1. `the-studio-on-one-screen.md`, in its build order: ~~the header's menu~~,
   ~~the feed strip~~ (done), the track heads on touch, a layout budget, the buffer into the
   cue lane (with the lane's other sources: a take from the shelf, a part
   lifted from a track), then Open's pass. Then the rest of
   `shell-roadmap.md` (the output switch, the bookmark drawer).
2. Write the missing flows in `docs/flows.md` as each journey is touched.
3. Fix the layout findings above, and look through the storyboard
   (`--storyboard`, or CI's `flow-storyboard` artifact) with Gabe for what
   no check can see. The coverage map lists the controls no flow touches.
