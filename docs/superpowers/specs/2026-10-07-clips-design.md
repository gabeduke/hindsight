# Clips: pieces of takes, without more takes

**Date:** 2026-10-07 · **Status:** proposed, for Gabe's review. "The shelf" is renamed **the crate**, because *shelf* is already the takes page. The build order is in the [plan](2026-10-07-daw-editing-plan.md) · **Repo:** `hindsight`

> Copied from the Jamstation project (`claude/2026-10-07-clips-design.md`) on
> 2026-10-07. Where it differs from [the plan](2026-10-07-daw-editing-plan.md)
> (the store is `crate.json` and the API `/api/crate`), the plan wins. The
> Zoom recorder study and the MPC Sample notes stay in that project.

Companions:
- the Zoom recorder study (Jamstation project)
- the MPC Sample notes (Jamstation project)
- [the editing model](2026-10-03-editing-model-design.md)
- [the tape design](2026-10-03-tape-design.md)

This replaces the earlier *chop and pads* draft. The pads and the MPC-style
workflow are set aside until the MPC Sample's part is worked out (see the
notes).

## The problem

Pulling a section out of a take today means *Save as take*. Every verse or
drop you keep then sits in the takes list beside the raw jams, and gets pruned
with them. Gabe's concern is that takes multiply until they're hard to keep
track of without proper library tools, and building those tools first is more
than getting started needs.

## The idea

A take is **what was played**: the dashcam's raw record. What you make from a
take is a different thing, so it gets its own type: a **clip**.

| | Take | Clip |
|---|---|---|
| Is | A recording from the ring, or a phone | A piece kept from a take, the ring or a tape |
| Lives in | The takes list (`OUTPUT_DIR`) | **The crate** (`TAPE_DIR/clips.json`, with audio in the tape pool) |
| Made by | Capturing, *Save as take*, mixdown | **Keep as clip** |
| Pruned by `MAX_SAVES` | Yes, unless starred | No. Clips are kept until you delete them |
| Audio | A WAV with sidecars | An unchanging WAV in the pool, as tape clips use. Placing one on a tape is a reference, not a copy |

So the takes list stays a record of what was played, and only grows when you
capture. Everything you cut out of it goes to the crate.

A tape's clips and the crate's clips are the same kind of thing: a window onto
a WAV in the pool. Dropping a crate clip onto a tape places a reference.
Keeping a tape clip on the crate saves a reference. Nothing is copied twice.

## Making clips

| Where | Do | Gets you |
|---|---|---|
| A take, with a selection | **Keep as clip** (toolbar, beside *Copy*) | The selection, copied into the pool, on the crate. It's named "*take name* · 0:42" until renamed. It carries the take's BPM and the selection's length in bars |
| A take, at the playhead | **Split here** (under *More*) | Two clips, before and after the playhead. **The take is untouched.** This is the Zoom divide, without new takes |
| The ribbon, with a selection | **Keep as clip** | The span of the ring, on the crate |
| A tape clip's sheet | **Keep** | That clip, by reference |
| The clipboard chip | **Keep** | Whatever is on the clipboard |

*Save as take* stays where it is, for the times you do want a new take: to
share or bundle it, or to work on it on the take page.

## The crate

Open it from a **Clips** chip in the header of the main page, the take page
and the tape page, beside the clipboard chip. It's a sheet on a phone and part
of the side panel from 1000 px wide.

**Each row shows:**
- the name;
- a small waveform;
- the length, and the bars at its BPM;
- where it came from ("from *Tuesday jam* · 0:42–1:10").

| Do | Gets you |
|---|---|
| **Tap** | Plays it on this device |
| **Drop** (on the tape page) | Places it on the selected track at the playhead, replacing what's there, and moves the playhead to its end. Drop, drop, drop works as it does from the clipboard |
| **Hold** | Its sheet: rename, *Share as WAV*, open the take it came from, *Delete* |
| **Delete** | Goes to the trash, with an Undo toast, as takes do |

**Kept deliberately small.** Newest first, with a search box over names. No
folders, tags, stars or sorting yet. Those are the "advanced library
features", and they can come once we see how many clips build up and how
they're used. The data has room for them: each clip has an id, a name, its
source, its BPM, and when it was made.

**Storage.**
- `clips.json` in `TAPE_DIR`.
- Garbage collection treats it as a root, as it does tapes, the clipboard and
  undo histories.
- Deleting a take never breaks a clip, because a clip has its own copy of the
  audio in the pool.
- `MIN_FREE_GB` guards *Keep*, as it guards *Copy*.
- The trash empties deleted clips after 7 days, as it does takes.

## Gabe's workflow, step by step

How the session he described maps onto Hindsight: what exists, and what's new.

| Step | How | State |
|---|---|---|
| Build a base track on the Bento and jam over it | The dashcam catches it, and a capture makes the take | Built |
| Put it on the four-track tape | *Send to tape* from the take, or *Catch* from the ribbon | Built |
| Layer instruments on top | ● Rec on another track; each time round is a pass | Built |
| Duplicate the base layer to cut it up | *Clone* the tape as a safety copy, then *Copy* the base track and *Drop* it on a spare track | Built |
| Cut out regions and rearrange them: a verse repeated, a drop | Split, lift, drop, slide | Built |
| | Trim a clip's edges by dragging, drag a clip onto another track, named sections that select their bars | **New, step 7e** (from the R20) |
| Keep a good section for another day or another song | **Keep as clip**, then drop it from the crate | **New, step 7d** |
| A drop on one track while pads play on another | Lift or split the base track's bars; the pad track plays on underneath | Built |
| Play MPC one-shots over the tape | The MPC plays into the Sidekick, so the dashcam records it, and ● Rec takes it as a pass. Over USB MIDI, the tape could lead the MPC's clock as it leads the Bento's | Audio: built. Clock to the MPC: MPC notes |
| Move regions onto MPC pads for another project | Clips on the crate, sent to the MPC Sample as WAVs | Later: MPC notes |

The crate is also where the MPC hand-off would start: anything you'd put on a
pad is a clip first. So the crate can ship now without deciding anything about
the MPC.

## API

| Call | Does |
|---|---|
| `GET /api/clips` | The crate, newest first; `?q=` searches names |
| `GET /api/clips/audio?id=` | One clip's audio, for playing |
| `POST /api/clips` `{take, from, to}` \| `{ring_from, ring_to, source}` \| `{tape, clip}` \| `{clipboard: true}` | Keeps a clip, behind the `MIN_FREE_GB` guard |
| `POST /api/take/split?file=&frame=` | *Split here*: two clips, take untouched |
| `PATCH /api/clips?id=` | Rename |
| `DELETE /api/clips?id=` | To the trash |
| `POST /api/tapes/edit` `{op: "drop", from: {clip: id}, track}` | Drop from the crate, using the existing drop, with its undo and crossfades |

## Checks, for the guide

- [demo] Select 4 bars of a take, then **Keep as clip** → it's on the crate as
  "*take* · 0:..", 4 bars long. The takes list is unchanged.
- [demo] **Split here** on a take → two clips on the crate; the take is still
  whole, with the same length.
- [demo] On a tape, drop a crate clip three times → three copies end to end,
  without clicks; ↶ three times → as it was.
- [demo] Delete the take a clip came from → the clip still plays and still
  drops.
- [demo] Delete a clip, then Undo → it's back.
- [demo] Capture until `MAX_SAVES` prunes → the crate is untouched.

## Where it fits

- **7d, clips and the crate.** It needs the take page (step 3) and the
  clipboard and drop (steps 6–7), which are built.
- **7e, the R20's gestures on the tape:** edge trim, drag to repeat, drag to
  another track, select several, named sections. It's independent of 7d.
- **Later, once the MPC is understood:**
  - chopping a take into several clips at once, at flags or every few bars;
  - **virtual pads:** a 16-slot view of the crate laid out like the MPC's pads,
    which goes to the MPC as a kit (MPC notes, *Virtual pads*).
