# Lift and drop: one holding place, the cue lane

**Status: proposed 2026-11-16, the calls taken as recommended (Gabe's to
overrule, each marked *rec.*). Not built.** It is the calm Studio's decision
10 (`the-calm-studio.md`) made concrete, and the first item on issue #306.
It amends decision 0061, whose third choice (a range's Cut, Copy and Paste
keep a clipboard of their own, unseen) it reverses.

## Why

Gabe's second journey is a light DAW on the tablet: *cut, copy and arrange
clips from different takes* (E2). The feel he named for the Studio is the
OP-1's tape, where recordings are arranged "very fluidly almost like its own
instrument", and the OP-1's tape is played with two verbs: **lift** takes a
piece off the tape and holds it, **drop** puts it down.

Today Hindsight has two holding places and two ways to put down:

- GRAB (from the feed, a note, Open) lands on the **cue lane**, where a clip
  can be seen, launched, trimmed, kept, tossed and DROPped.
- A range's or a part's Cut and Copy go to a **clipboard nobody sees**, put
  down with Paste or Insert on the range's bar, and undone through a slot of
  their own on the Pi (`replaced.go`), not the tape's Undo.

So a cut part can't be heard before it is put down, can't be launched over
the loop, and is gone from sight the moment it is cut. Two holding places is
one more thing to know, and the range's bar carries keys (Paste, Insert)
that only make sense if you remember what is on the clipboard.

## Decisions

1. **Everything lifted goes on the cue lane.** A range's or a selected
   part's **Lift** (today's Cut) and **Copy** put a clip on the cue lane,
   with a lane per track the range spans, as a GRAB has a lane per input.
   The cue lane is the one holding place; nothing is held out of sight.
2. **Lift is the word for Cut** on the range's bar and a part's row; Copy
   stays Copy. *rec.* (OP-1's word, and *Cut* reads as "destroy" on a
   touch screen; the alternative is to keep Cut.)
3. **DROP is the one way to put down**: the cue clip's DROP (at the
   playhead on the armed track, as now), or a drag onto a track
   (`cue-to-track`, as now). **With a range set, DROP lands at the range's
   start on its first track**, which is what Paste did. The range's bar
   loses **Paste** and **Insert**. *rec.*
4. **Insert moves into Trim** as "Insert at the playhead": it pushes every
   track along by the clip's window instead of laying over it, as the
   range's Insert does today. It is rare,
   and Trim is where the clip's less used acts already are. *rec.* (The
   alternative, a ▾ on DROP, is one more control at rest.)
5. **A lift or copy is never replaced.** A GRAB takes the place of the
   lane's newest clip while it is an untouched GRAB (0061); a lifted or
   copied clip is its own (`Source` "lift" or "copy"), never replaced by a
   GRAB, a lift or a copy, and always added. What you take off the tape is
   never lost by the next press.
6. **One Undo, the tape's.** A Lift is one edit of the tape: the span
   cleared and the clip added together, so ↶ puts the audio back and takes
   the clip off the lane. A Copy is one edit that adds the clip. The
   clipboard's Undo slot (`RestoreReplaced`) is not needed and goes.
7. **A lifted clip has handles where the audio has them.** A part is a
   window onto a pool file, so the lane's clip is that window, with up to a
   bar of handle either side wherever the file runs on; IN and OUT in Trim
   reach into them, as a GRAB's do. A range's lift over silence makes a
   lane with no clips, which is dropped as silence (it clears what it lands
   on, as Paste did).
8. **Its name says where it came from**: *Bars 5–8* for a range or a part,
   with the tracks when it spans more than one (*Bars 5–8 · 2–3*). *rec.*
9. **The keys stay**: ⌘X lifts, ⌘C copies, ⌘V drops the lane's newest clip
   (on the range if one is set, else at the playhead on the armed track).
10. **The clipboard goes**, once nothing reads it: `/api/clipboard`,
    `clipboard.json`, `replaced.go`, and the crate (`crate.go`), whose last
    reader is Insert taking a kept clip. The pool's clean-up roots become
    the tapes (their tracks and cue lanes) and the takes.

### Out of scope

- **The shelf as a source.** A take already reaches the cue lane from its
  notes drawer's GRAB and from Open (`POST /api/tapes/cue/grab` with
  `take`). Throwing a whole take from a spine on the wall is its own small
  step, after this, if Gabe wants it.
- **Move here and Duplicate** on a part's row stay as they are: they move
  or repeat a part in one press, without the lane. Whether lift and drop
  makes Move here redundant is for the walk after step 2, by E2's presses.
- Snapping a GRAB from the feed's mark to the bar (#308).

## What it changes, for whoever builds it

- **Pi** (`internal/tape`): a verb `CueLift(id, EditRequest, cut bool)`
  beside `GrabToCue`, built from `edit.go`'s lift and copy windows and
  `cuegrab.go`'s `placeGrab` (added, never replacing), in one `Edit`. The
  API: `POST /api/tapes/cue/lift` with the range's or the clips' body and
  `cut`. `CueDrop` learns nothing new: a range's start and first track are
  its `at` and `track`. Insert at the playhead is a `CueDrop` with
  `insert: true`, through `edit.go`'s insert.
- **Web**: the range's bar is Lift, Copy, Delete time, ×2 and Done; a part's row
  is Lift, Copy, Split, Duplicate, Move here, Remove, Done. `lib/tape/page.js`
  loses `fetchClipboard`, `renderClipboard`, the clipboard's Undo toast and
  `boardOf`'s clipboard; the drawer's DROP reads the range. The budget:
  the range's bar goes from 7 keys to 5, Trim gains 1 (decision 8 of the
  calm Studio: the spec names what it removes).
- **Flows**: J1.9 copies a bar and reads the cue lane, not `/api/clipboard`;
  E2 lifts a part instead of cutting it and ↶ takes it back off the lane;
  the harness and J1.4 stop clearing the clipboard. A new core flow, **E3**
  (or an extension of E2): lift a range, launch it over the loop, DROP it
  on another track, ↶ twice.

## Build order

Each step is one PR, looked at on the tablet before the next.

1. **The Pi's lift** (Go; built and tested with a working toolchain,
   decision 0026): `CueLift`, `POST /api/tapes/cue/lift`, the insert
   drop, their tests, and `docs/architecture/tape.md`'s *The cue lane*.
   Nothing in the web calls it yet, so nothing changes on screen.
2. **The Studio lifts onto the lane**: the range's bar and a part's row,
   DROP on a range, Insert in Trim, the keys, the flows above, and
   `STUDIO_BUDGET` lowered to what it measures. Gabe tries E2 on the tablet.
3. **The clipboard goes** (Go and web): the routes, `clipboard.go`'s
   store, `replaced.go`, the crate, and the clean-up's roots. A Pi
   carrying a `clipboard.json` from before stops reading it; the
   clean-up then frees what only it held.
4. **When it lands**: decision 0068 (*Lift and drop*), amending 0061;
   `docs/flows.md` with E2's new story; this spec deleted.
