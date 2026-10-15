# Two rooms and a rig

**Date:** 2026-10-15 · **Status:** direction agreed with Gabe on 2026-10-15
(the canvas's recommended picks) · **Repo:** `hindsight` · **Canvas:**
[Hindsight — Room, Studio & Rig](https://claude.ai/artifact/Ls32s93iBGoT7jUcHQb54Y)

This is the umbrella note. It records the direction, the decisions that
change earlier specs, and the build order. Each piece has its own spec:

| | Spec | What |
|---|---|---|
| P1 | this note, *Step 1* below | The two rooms, as pages and navigation |
| P2 | [The Studio's buffer](2026-10-15-studio-buffer-design.md) | GRAB, trim, DROP, KEEP |
| P3 | [The instrument strip](2026-10-15-instrument-strip-design.md) | Play mode in the Studio; one control bus for touch, keys and MIDI |
| P4 | [Punch-in FX and tape mods](2026-10-15-punch-in-fx-design.md) | ROLL, FILTER, ECHO, CRUSH; wow, flutter, drive, age |
| P5 | [The Listening Room](2026-10-15-listening-room-design.md) | Shelves, the deck, the sketchbook, records |
| P6 | [The rig](2026-10-15-rig-design.md) | Devices as profiles, cables as settings, multi-arm |
| R1–R7 | [The scene contract](2026-10-15-scene-contract-design.md) | What every drawn thing is, and the render briefs |

## Why

Gabe, 2026-10-14:

- the play features (OP-1 Field and K.O. style punch-in FX and tape mods)
  will mostly be played from a MIDI controller or a keyboard;
- Capture and Tape should be one place, and Capture and Takes partly so:
  *"a listening room… like walking into John Cusack's apartment from High
  Fidelity"* for reviewing, and *"a recording studio approach"* for making;
- *"take an audio sample from the live feed into a buffer or workspace and
  then commit it to tape"*, instead of *save a clip in Capture → edit it down
  → load it onto tape*;
- input routing is hard to reason about and MIDI will make it harder, so a
  device you can see, with ports and cables, should replace the channel menus.

The handoff of 2026-10-15 asked the same thing from the other side: the
catch → layer → perform → keep loop needs a path through it that takes no
thought. Today that path crosses three pages.

## What

### Two rooms, and the rig

| Room | For | Made of |
|---|---|---|
| **Studio** | Making things while the music runs | The feed (the ring, live), the buffer, the tape (lanes, deck, CATCH), the instrument strip, KEEP |
| **Listening Room** | Sitting with what was kept | Shelves (tapes, takes, an archive by month, records), a deck and a turntable, the sketchbook |
| **Rig** | Wiring, not playing | Devices from profiles, cables that are settings, an inspector |

The Rig isn't a tab. It opens from the device chip in the header, because it
is visited when something changes, not while playing.

### Three verbs, three places

| Verb | Puts the last N bars, or a span of the feed… | Today |
|---|---|---|
| **CATCH** | onto the armed track, in one touch | The tape's Catch |
| **GRAB** | into the buffer, to trim before it lands | New. Replaces Capture → take page → Send to tape |
| **KEEP** | onto the shelf, as a take | Capture's CAPTURE key, renamed |

### Where today's parts go

| Today | Becomes |
|---|---|
| Capture's ribbon, VU meters and lamp | Studio · the feed |
| CAPTURE (`POST /api/trigger`) | Studio · KEEP; the take lands on the Room's shelf |
| A take's IN/OUT trim, Send to tape, the clipboard | Studio · the buffer (P2) |
| The Tape page: lanes, deck, drawers, Catch | Studio · the tape |
| The Play mode overlay | Studio · the instrument strip (P3) |
| The Takes rack and a take's page | Listening Room · shelves, deck, chair view (P5) |
| Flags with labels, tags, take names | Listening Room · the sketchbook (P5) |
| Mixdown and *Send to* | Listening Room · *Cut a record* (P5) |
| Settings › interface, track input chips, clock and source settings | Rig (P6) |
| Settings itself | Unchanged, one route: the about line at the Studio's foot |

## Decisions

Agreed on 2026-10-15. Two of them reverse earlier decisions, so the earlier
specs are named.

1. **Two rooms replace three tabs.** The Rig opens from the device chip in
   the header. Settings keeps exactly one route: the about line at the
   Studio's foot, as on Capture today.
2. **The instrument is a strip in the Studio, not an overlay.** This reverses
   decision 2 of [Play mode](2026-10-14-play-mode-design.md). On a phone, an
   EDIT | PLAY toggle in the bottom panel replaces the floating PLAY button,
   which sat over the Tape tab where Gabe didn't see it.
3. **Multi-arm by cables.** Patching two taps into two tracks and arming both
   records both at once. This reverses decision 4 of
   [the interaction model](2026-10-08-interaction-model-design.md), *one
   armed track at a time*. Details are in the rig spec.
4. **The studio verbs get mnemonic keys:** C catch, G grab, ↵ drop, K keep.
   Phase 2's crate pads, specified on A–L and not built, move to 5–0.
5. **Tape mods belong to the tape and go through undo.** Tricks and punch-in
   FX stay held-only, and never touch undo or the tape.
6. **Flat first.** Every view is DOM, SVG and canvas until it works. three.js
   would be vendored, lazy-loaded, behind a flag, and only for the Rig.

## Step 1 (P1): the two rooms as pages

The smallest change that makes the rooms real, before any new feature.

### Behind a flag

`hindsight.rooms`, a per-device switch:

- a flag module like `lib/play/flag.js`;
- one entry in `DEVICE_PREFS` (`lib/device-prefs.js`).

It is off by default, for the reason Play mode's was: the brother's and the
brother-in-law's kits update from the same releases.

### Pages

No new page for either room. The Studio grows out of the Tape page, and the
Listening Room out of the Takes page, because those already host the heavier
half of each room:

| Room | Page | Gains |
|---|---|---|
| Studio, tape on | `tape.html` | The feed above the lanes (`Ribbon`, `lib/objects/ribbon.js`), the L/R VU meters, KEEP, and the about line with Settings |
| Studio, tape off | `index.html` | Nothing: it already is the feed and KEEP. It loses only its Takes tab label |
| Listening Room | `takes.html`, and `wave.html` for one take | P1: only the tab's name. The room itself is P5 |

- **Two tabs.** Each page's nav markup is hard-coded: `<nav class="appnav">`
  with three `a[data-tab]` links. With the flag on, `initNav()` rewrites it to
  two:
  - **STUDIO** links to `/tape.html` when the tape is on, `/` when it's off,
    using the `tapeOn` it already reads;
  - **LISTENING ROOM** links to `/takes.html`.

  `TABS` gains the two room entries; `wave.html` counts as the Listening Room.
- **`/` with the flag on and the tape on** replaces itself with
  `/tape.html`, read from the cached `hindsight.tapeOn` before anything
  draws, so the PWA's start URL opens the Studio.
- **Settings.** The about line (`.about`: version, Releases, `#settings-btn`,
  the guide, `#update-btn`) moves with the feed to the Studio's foot.
  `styles.test.js`'s about-line rule then names the Studio. Its comment says
  the button lives on Capture *and nowhere else*; that becomes the Studio.
  With the flag off, nothing moves.
- **The bar.** `tape.html` already drives its own bar. Capture's `pageBar`
  role, holding a take that was pressed on a spine, moves to the Listening
  Room, where spines are.

### Tests that pin the structure

These change with step 1:

- `nav.test.js`: the tabs per path, with the flag on and off;
- `pages.test.js`: no id used twice. The ribbon's ids join the Tape page;
- `styles.test.js`: the about line, as above;
- `objects/materials.test.js`: its list of six pages;
- `paths.test.js`: everything the Tape page now imports;
- `sw.js`: a `CACHE` bump.

A new test: with the flag off, the Tape page draws no feed and the nav has
three tabs. Play mode's spec had the same check.

### Look before merge

At phone and desktop size, in both schemes, with the flag on and off, against
the demo (`AGENTS.md`). The phone check that matters most: is Settings
reachable from the Studio, and is the feed above the fold?

## Build order

Each step is its own PR, or a short stack, with a spec first where its spec
says so.

| Order | Step | Depends on |
|---|---|---|
| 1 | **P1** two rooms, flagged | — |
| 2 | **P2** the buffer | P1 |
| 3 | **P3** the instrument strip and the control bus | P1 |
| 4 | **R1** the scene contract, with no visible change | — |
| 5 | **P5** the Listening Room, flat | P1; R1 for the deck |
| 6 | **P6** the rig, flat | P1 |
| — | **P4** punch-in FX and tape mods | Engine only; alongside the rest. Its pads arrive with P3 |
| later | **R2–R7** render work | R1; see the scene contract |

P2 and P3 together are the OP-1 loop on one screen. They come first after P1
because they are what Gabe plays.

## Not in this

- **3D**, physics or the vinyl lathe in any product step. These are render
  briefs R2–R7, after the flat versions work.
- **A Sonos output.** The rig draws OUT generically, as a listener on the
  network, so Sonos can join later.
- **Removing the old pages.** With the flag off, everything stays as it is.
  Turning the flag on by default is its own decision, after Gabe has lived in
  the rooms.
