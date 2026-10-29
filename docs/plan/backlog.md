# Backlog

Wanted, not built. One line each, with where the design was (in git history
under `docs/superpowers/` unless it says otherwise). Promote an item to a
short spec in this folder when it is next.

## The rooms and the bar

- **Cue lane: the shelf and the tracks as sources.** Throw a take from the
  shelf (`POST /api/tapes/cue/add` with `take` does the Pi's half) or lift a
  part from a track onto the lane.
- **The flows' gestures in the harness.** J1.3 and J1.11 each carry a
  hold-then-drag helper; one `t.holdDrag` beside `t.hold` would do.
- **Output switch: Live feed / Playback,** with a real live stream of the
  ring. Today's Feed source plays no audio. Playback is the tape's tracks
  plus the cue lane, summed (with Cue on, the cue lane alone); a shelf take
  is a one-off Playback source; "output" is what this browser plays.
  (Agreed 2026-10-16, before the bar's display took the source key.)
- **Tracks collapse to one strip while the cue lane is open,** and the
  reverse, as the buffer folds the lanes (`body.buffer-fold`).
- **U1: the take page gets the tape's edit controls** (fade in/out curves,
  gain, normalize, reverse); #148 shared only the curve math and the
  navigation.
- **The Rig as a shell view** (leaving for it stops the tape on this device).
- **Open (`wave.html`) as a Listening Room sub-view** (large: its own clock).
- Exported **songs** as a finished object, separate from takes: a source
  for the bar with no tracks and no cue lane.
- Notes on tapes; several tags per take.

## Sound

- An **immediate stop**: re-render the blocks not yet delivered, cutting about
  100 ms from the lead (the tape design's "immediate" stop).
- **Mix memos.**
- More filters and FX (the Sidekick has several of the same tricks).
- MIDI controller keys into the trick queue on the Pi.
- Crate pads on keys 5–0 (parked).
- **Bug: tape on this phone, Both mode:** a reconnect of the phone's stream
  replays the tape. Not yet fixed.
- **VU calibration:** 0 VU at about −20 dBFS, in place of `REF_DBFS`'s −18
  (`lib/scene/vu.js`). Offered to Gabe; not decided.

## Rendering (the scene contract, `docs/architecture.md`)

- **R3** the room in 2.5D: layered planes, at most 12 px pointer parallax;
  the doorway-to-chair move as a cross-document View Transition.
- **R5** device models: `.glb`, Y up, metres, under 300 KB, every port an
  empty node `port:<id>`, no makers' logos.
- **R6** the rig in 3D: vendored three.js, lazy, behind a flag, import map.
- A Zoom R20 theme for the tape (an unbuilt brief, deleted 2026-10-18).

## Kits and the hub

- **Device-profile sharing between kits** via the hub (`docs/hardware/README.md`).
- **Auto-install trigger** for releases ("the hub does it" was the pick).
- Remote per-kit feature switches: its own spec, same hub token.

## Cleanup decisions

- **The crate's HTTP API**: removed 2026-10-18 (Gabe). Follow-up: the
  engine's crate methods (`KeepTake`, `SplitTake`, `KeepRing`,
  `KeepTapeClip`, `KeepClipboard`, `RenameCrateClip`, `DeleteCrateClip`,
  `RestoreCrateClip`, `CrateList`, `DropCrate`, `CrateWAV`) now have no
  production caller (tests only), and the store is write-only from the UI's
  side. Decide whether to retire `internal/tape/crate.go` with them.
- **Remote branches awaiting a decision** (the merged ones were deleted
  2026-10-18):
  `rooms/r2-shelf-to-deck` (R2, the cassette flies to the
  deck; ~8k lines, never landed), `claude/hindsight-enclosure-build-9f51ed`
  (kit enclosure CAD; PR #47), `rooms-screenshots` (an orphan of PNGs).
- The release tarball ships the `*.test.js` files (~1.5 MB).

## Reuse in the flows

- **The continuity sampler** (`continuity-sampler.md`): reads the bar, the
  take's clock and the stream through CDP without a user gesture, and judges
  a room switch, Back/Forward or reload for gaps. Fold it into
  `scripts/flows/` for a stricter J2.2 and a back-forward-cache flow.
