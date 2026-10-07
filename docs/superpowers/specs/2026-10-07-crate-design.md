# The crate (B1)

**Date:** 2026-10-07 · **Status:** step B1 of the
[DAW-style editing plan](2026-10-07-daw-editing-plan.md), from
[the clips design](2026-10-07-clips-design.md), approved by Gabe on 2026-10-07
· **Repo:** `hindsight` · Builds on [edge trim](2026-10-07-edge-trim-design.md)
(A1: a kept clip's handles)

## Why

Keeping a verse or a drop today means *Save as take*. The takes list then
fills with pieces beside the raw jams, and they get pruned along with them.
The clips design puts what you make from a take in a place of its own: the
**crate**.

## What

### The model (`internal/tape/crate.go`)

- **`crate.json`** in `TAPE_DIR` is a list of `CrateClip`:
  - `ID`, `Name`;
  - the window `File`, `Src`, `Frames` and `Reversed`, as a tape clip has;
  - `BPM`;
  - `Source{Kind: take | ring | tape | clipboard, Take, From, To, Tape, What}`;
  - `Created`, and `Deleted` (when it was deleted, if it was).

  It's written as the clipboard is (`writeSynced`). One change at a time
  goes through `Engine.crateMu`.
- **Bars aren't stored.** The page reads them from `BPM` and the length.
- **Keeping:**

  | From | Function | Audio |
  |---|---|---|
  | A take's span | `KeepTake` | A new `keep_` pool file via `copyTake`, with A1's handles |
  | A span of the ring | `KeepRing` | A new `keep_` pool file via `ringClip`, the clipboard copy's ring path, with handles |
  | A tape clip | `KeepTapeClip` | A reference: nothing is copied |
  | The clipboard | `KeepClipboard` | A reference, when it holds one clip; otherwise it's refused |

  `MIN_FREE_GB` guards the two that copy, as it guards Copy.
- **Names:**
  - from a take, *take · m:ss* (where the span starts), the take being its
    label or when it was made;
  - from a tape clip, *tape · track N*;
  - from the clipboard, its *from* and length;
  - from the ribbon, *The ribbon (main) · hh:mm*.

  `Source.What` says where it came from in words.
- **Delete and restore:**
  - **Deleting** sets `Deleted`. The clip leaves the list, and **restore**
    clears it.
  - **After 7 days** (`CrateTrashDays`), the list lets go of it, the way the
    takes trash does.
- **Clean-up:** the crate is a root in `Store.Cleanup`, deleted clips
  included until they're let go of. A `crate.json` that can't be read stops
  the clean-up, as a tape that can't be read does.
- **Dropping** builds a one-clip `Clipboard` and drops it through
  `dropBoard`, factored out of `DropClipboard`. So the playhead, an empty
  tape's first loop, replacing what's there, the crossfades and one undo all
  work as they do for a clipboard drop.

### The API

- `GET /api/crate?q=&take=`;
- `POST /api/crate` with `{take, from, to}`, `{ring_from, ring_to, source}`,
  `{tape, clip}` or `{clipboard: true}`;
- `PATCH /api/crate?id=` with `{name}` or `{restore: true}`;
- `DELETE /api/crate?id=`;
- `GET /api/crate/audio?id=`: a 16-bit WAV, the share path's `clipWAV`
  factored out of `ShareClip`;
- `POST /api/tapes/drop` with `{crate, track}`.

The plan's route names are used. The clips design's `/api/clips` and
`clips.json` were renamed with *the crate*.

### The pages

- **Tape page:**
  - **Crate ▴**, a third drawer key beside Record and Edit, holds:
    - a search box over the names;
    - rows, newest first, each with a small waveform from its file's peaks,
      its name, its length (and bars, with a tempo) and where it came from.
  - **On a row:** tap it to play it here (and again to stop); **Drop** drops
    it on the selected track; **⋯** opens its sheet: rename, *Share as WAV*,
    *Open its take*, and *Delete*, with an Undo toast.
  - **Keep** is in a tape clip's sheet, and beside the clipboard when it
    holds one clip.
  - `tape.html?crate=<take>` opens the drawer on that take's clips, with a
    *from … ×* chip to see them all.
  - The plan says a hold opens a row's sheet. It's a ⋯ key instead, because
    it can be found and reached by keyboard. A hold on a list that scrolls
    also fights the scroll.
- **Take page:**
  - **Keep as clip** beside *Send to tape*: the selection, or the whole take.
    The plan put it beside *Copy*, but Copy lives under *More*.
  - A **◫ N** chip in the header, once something has been kept from the take.
    It links to the crate on those clips.
- **Main page:** the ribbon's selection gets **Keep as clip** beside Copy.
- **Takes page:** a take's detail shows *◫ N clips kept*, linking to them.

*Insert* on a crate row comes with A7.

With a third drawer key, the keys sit beside Catch only from 1200 px. Below
that, the 1024 px bench included, they sit in the bar's second row beside
OUT, because Catch was pushed off the bar. On a phone every drawer is on the
page, so the crate is read as the page opens, and after every Keep.

A clip kept from the tape keeps its audio, not its level or nudge: those
are the tape's. A kept clip can't be played or dropped while it's deleted,
and deleting it again doesn't restart its week. Keeping more than a track
holds is refused, as Copy refuses it, because it could never be dropped.

## Checks

These come from the clips design.
- *Keep* doesn't touch the takes list.
- A clip outlives the take it came from.
- Pruning leaves the crate alone: the crate is the tape's, and pruning
  only removes takes.
- Deleting a clip and undoing restores it.

## Tests

- **Go:**
  - keeping a take's span: its pool file, handles, name and source, the
    takes' folder unchanged, and it's still there after a restart;
  - a kept clip still plays and drops after its take is deleted;
  - three drops end to end, and three undos;
  - a tape clip and the clipboard kept by reference, with no new pool file;
    another tape's clip refused, and a two-clip clipboard refused;
  - delete and restore, newest first;
  - clean-up keeps the crate, and a deleted clip within the week;
  - the week runs out: the list lets go, and clean-up frees the audio;
  - an unreadable crate stops clean-up;
  - the list by name and by take; rename, with a blank name refused;
  - keeping from the ring;
  - over the API: keep, list by take, drop, keep a tape clip, rename,
    audio, delete, restore, and the refusals.
- **Smoke** (`smoke-tape.mjs`):
  1. Keep a clip from its sheet;
  2. Crate ▴ lists it;
  3. Drop puts it on track 3;
  4. ↶;
  5. `?crate=` shows only that take's clips.
- **Guide:** a new §8.11, *The crate*, with seven [demo] checks, and Keep as
  clip in §4. `TIPS` and §9 gain sixteen rows.
