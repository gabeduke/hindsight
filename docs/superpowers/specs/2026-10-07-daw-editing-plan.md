# Plan: DAW-style editing, clips, and Zoom parity

**Date:** 2026-10-07 · **Status:** approved by Gabe on 2026-10-07, to be built in a fresh session (see [Handoff](#handoff)) · **Repo:** `hindsight` at `ed39ae9` (v2026.10.07.3)

> Copied from the Jamstation project (`claude/2026-10-07-daw-editing-plan.md`)
> on 2026-10-07, with [the clips design](2026-10-07-clips-design.md).
> The Zoom recorder study, the rig roles page and the MPC Sample notes it
> links to stay in that project.

**What this covers.** Gabe wants editing on the tape, takes and clips to feel
more like a DAW. He also wants to match the Zoom features for arranging and
managing audio, and to do that first. This plan orders the work into PRs, each
of which ships alone.

**Where the ideas come from:**
- the Zoom recorder study (Jamstation project);
- [the clips design](2026-10-07-clips-design.md);
- which device does what (the rig roles page, Jamstation project).

It was checked against the code as it stands, not against the older status
page. Several things those docs proposed already exist, and are left out.

## What the code already has

**On the takes page:**
- search, tags, filters and sorting;
- bulk select, with star, export and delete;
- trash with undo, and *Recently deleted*;
- **take families**, which fold cuts under their original take and a tape's
  mixdowns under its newest.

So "the takes list is getting crowded" is already partly handled.

**On the take page:**
- selection, Loop, snap, nudges, flags (add, move, step) and the boundary
  editor;
- *Save as take*, *Copy*, *Send to tape*;
- undo, with a 50-step history;
- delete, which is two taps, under *More*.

**On the tape:**
- lift, copy, drop, merge drop, split, join, slide and ×2;
- reverse, clip level, nudge, *Repeat to the loop's end*;
- Align, and a 100-step whole-tape undo;
- crossfades at every join.

| Missing on the tape | Notes from the code |
|---|---|
| Edge trim | `Clip.Src` and `Frames` can express it. But copied pool files carry only 10 ms beyond the clip (`OverhangSeconds`), so a clip can't grow back out past its original ends |
| Moving a clip to another track | `slide` keeps the track |
| Multi-select | Clip state is single; `lift` and `copy` only work by time range |
| Fades | Only the fixed 3 ms declick and 5 ms crossfade |
| Sections | None; the loop is the only span |
| Clip gestures | `lib/tape/page.js` (2,400 lines) handles them itself, rather than through the shared gesture module, and has no unit tests |

| Missing on takes | Notes |
|---|---|
| Kept clips | Nothing between a take and a tape clip |
| Split here | Missing |
| Play all | Missing |
| A list of a take's flags | Only as chips in the takes page's detail pane |
| Dropout flags | The capture counts xruns, but nothing is stored per take |
| Normalize | Missing |
| Skip back | Missing |
| One-tap trash | Missing |

## A naming decision

The clips design called the collection of kept clips "the shelf". That word
is already the takes page. This plan calls it **the crate**, a box of pieces
you dig through.
- **Crate** isn't used anywhere in the app.
- **Clip** stays, because a kept clip and a tape clip are the same thing: a
  window onto a WAV in the tape's pool.

## The order

Three phases: the tape first, as asked, then clips, then the take page.
Phase C's steps are small and independent, so they can be slotted in between
the others whenever convenient.

| # | PR | Size | Needs |
|---|---|---|---|
| **A0** | Clip gestures in a module of their own | M | — |
| **A1** | Edge trim, with handles | M | A0 |
| **A2** | Slide onto another track | S | A0 |
| **A3** | Drag to repeat | S | A0 |
| **A4** | Select several clips | M | A0, A2 |
| **B1** | The crate: Keep as clip, drop from the crate | M | A1 (handles) |
| **B2** | *Split here* on a take | S | B1 |
| **A5** | Clip fades | S | — |
| **A6** | Sections | M | — |
| **A7** | Insert and delete time | M | A6 |
| **C1** | One-tap trash; *Undo last save* | S | — |
| **C2** | *Play all*; flags step on to the next take | S | — |
| **C3** | A flags list; skip back 5 s | S | — |
| **C4** | Dropout flags | M | — |
| **C5** | Normalize on share | S | — |

**After A0–A4,** the tape covers the R20's region editing. **After B1–B2,**
Gabe's workflow works end to end without filling the takes list: jam, send to
tape, layer, cut up the base, keep the good bits. **A6 and A7** turn
arranging into moving sections around.

Every PR follows the house routine:
- a spec and plan in `docs/superpowers`;
- Go tests beside the code, and node tests for the pure modules;
- a `TIPS` row for each new control, plus the matching row in the guide's §9
  table (`help.test.js` enforces this);
- guide checks marked [demo] or [rig];
- the `sw.js` cache bumped;
- an independent review before it goes up;
- Gabe merges.

## Phase A: the tape page as a DAW

### A0. Clip gestures in a module of their own

**Why first.** A1–A4 all add touch targets to a clip block. Today hit-testing
is by x only, inside `wireLane` in a 2,400-line page. Each new handle there
would be hard to test and could easily break the others.

**What.**
- `lib/tape/clipgestures.js` is pure and tested. It holds hit zones on a
  block: **body, left edge, right edge, top-right corner,** and later fade
  corners. Zone sizes are in CSS pixels, so touch targets stay 24 px or more
  wide at any zoom.
- It also holds the gesture state machine: tap, hold-then-drag and drag-a-
  handle, with the 8 px slop and one pointer by id, which the tape-edit
  review settled.
- `page.js` keeps drawing and calling the API, and delegates to the module.

**Behaviour doesn't change.** Existing taps, hold to slide and the clip sheet
work as before.

**Tests:**
- node tests for zones at several zoom levels, including narrow blocks, which
  get no handles and have a sheet instead;
- node tests for the state machine;
- a Playwright check in `scripts/smoke-tape.mjs`: hold a clip and slide it a
  bar, then ↶. That's the first gesture smoke test.

### A1. Edge trim

**Model.** No new fields: trimming changes `Src`, `Frames` and `At`.
- A new edit op, `trim {clip, edge: "in"|"out", at}`. The server clamps it to
  the pool file's bounds (`ReadWAVInfo`) and to the neighbours on its layer.
- One undo step per drag.

**Handles: the room to grow back.**
- New pool files (copy, catch, send, overdub) carry **handles**: up to
  **2 s** of the source either side, where the source has it.
  `OverhangSeconds` stays as the minimum the crossfade needs. The handle
  length comes from a new `TAPE_HANDLE_S` setting (default 2, 0–10), read
  in `internal/config/config.go` and documented in `docs/configuration.md`.
- That costs about 1.5 MB per clip at 48 kHz stereo float, which is cheap.
- Older clips, and clips at a recording's very end, can only trim inward. The
  grip shows a hard stop at the limit.
- Split halves already share a file, so they can always grow back fully.

**UI.**
- Selecting a clip shows grips on both edges. Drag one to trim it. It snaps
  to the Slide-snap grid, and a held ⌥ or Off moves freely.
- While dragging, the hidden part of the audio shows as a faint waveform past
  the edge, so you can see what you'd get back.
- Trimming the In edge moves `At` with it, so the audio stays where it was
  played, as in a DAW.

**Tests:**
- Go: `edit_test.go` covers trimming in and out; clamping to the file, to
  handles and to neighbours; and undo.
- Render tests: a trimmed edge next to audio crossfades, and one next to
  silence declicks.
- API tests.

### A2. Slide onto another track

- `slide` gains `track`. The drag follows the pointer across lanes, and the
  target lane is highlighted. It lands on the lowest free layer there, as now.
- A drag changes track only once it has moved half a lane up or down, so a
  sideways slide doesn't jump lanes by accident.
- Go tests: a move across tracks, a move onto a muted track, and undo as one
  step.

### A3. Drag to repeat

- A ⟳ handle at the clip's top-right corner. Dragging it right adds whole
  copies end to end, with a ghost of each copy. Dragging back removes them.
- One op, `repeat {clip, count}`, generalising today's `tile`, which stays as
  *Repeat to the loop's end*.
- Copies are new clips pointing at the same file. They aren't linked: editing
  one doesn't change the others, as on the R20.
- Go tests: counts, the room at the tape's end, and undo.

### A4. Select several clips

- **Selecting:** *Select more* in a clip's sheet, or Shift-click on a
  computer, starts a selection. Tap clips to add or remove them. A bar shows
  "3 clips" with Move, Copy, Reverse, Remove and Done.
- **Moving:** dragging any selected clip moves them all by the same time
  offset and track offset, clamped so none falls off the four tracks.
- **One op:** `move {clips:[…], dt, dtrack}`, atomic, one undo. `remove` and
  `reverse` take `clips` too.
- **Copying** selected clips to the clipboard keeps their spacing and tracks,
  using the multi-track clipboard that already exists.
- **Keys:** Delete removes, Cmd/Ctrl+C copies, and Cmd/Ctrl+D duplicates
  after the last selected clip. S splits at the playhead; it's the only
  missing key.
- This lifts the tape-align spec's "no multi-clip moves". That spec's Align
  editor stays single-clip.

### A5. Clip fades

- **Model:** `Clip.FadeIn` and `Clip.FadeOut`, in frames, default 0. The
  automatic declick and crossfade still apply underneath.
- **Render:** an equal-power curve in `Mix.sample`. A fade longer than the
  clip is clamped.
- **UI:** in the clip sheet, *Fade in* and *Fade out* chips (off · 10 ms ·
  ⅛ · ¼ beat · 1 beat · 1 bar), drawn as ramps on the block. Fade handles on
  the block's top corners would compete with the repeat handle on a phone,
  so they're left out.
- Fades survive split (each half keeps its outer fade), trim, reverse (which
  swaps them) and join.

### A6. Sections

- **Model:** `State.Sections []Section{ID, Name, At, End, Color}`, undoable
  with the tape. They're kept on bar lines when the tape has a grid.
- **UI:**
  - A thin row above the ruler. Hold and drag there to make a section, and
    name it from a short list (Intro, Verse, Chorus, Drop, Bridge, Outro) or
    type one.
  - **Tapping a section selects its bars** (sets the loop In and Out), so Lift,
    Copy and ×2 act on it.
  - Drag a section's edges to resize it. Its sheet offers rename, colour and
    remove.
- **Export:** sections are written as MIDI markers in the stems' `.mid`,
  where the loop's In and Out already go, so a DAW sees them.
- **Later:** a section sends a program change to the instruments
  (see the rig roles page in the Jamstation project).

### A7. Insert and delete time

The words, icons, previews and confirm step are set out in
[Making the edits obvious](#making-the-edits-obvious), and are part of this
PR.


The tape's Drop replaces what's underneath, as on the OP-1. Arranging verses
needs the DAW's other mode:
- **Insert** (beside Drop): pushes everything from the playhead onward
  later by the clipboard's length, on all four tracks, then drops. Sections
  after the point move too.
- **Delete time**, on a selection: removes the bars and closes the gap.
- With sections, **Duplicate section** is copy-all, then Insert at the
  section's end. That makes "the chorus again" one action.
- Go tests: the ripple across tracks, clips straddling the point (they're
  split there), the tape's length limit (`TAPE_LENGTH_S`), and undo as one
  step.

## Phase B: clips and the crate

### B1. The crate

**Model** (`internal/tape/crate.go`):
- `crate.json` in `TAPE_DIR`, holding `[]CrateClip{ID, Name, File, Src,
  Frames, BPM, Bars, Source{take|ring|tape, …}, Created, Deleted?}`.
- **Garbage collection:** the crate is a root in `Store.Cleanup`, beside the
  clipboard and every tape's history.
- **Deleting** marks the clip and purges it after 7 days, as the takes trash
  does.
- **Space:** `MIN_FREE_GB` guards *Keep as clip*.

**Keeping a clip:**
- From a take or the ring, *Keep as clip* writes the pool file with handles
  (A1), reusing `CopyTake` and `CopyRing`.
- From a tape clip, or the clipboard, it keeps a reference and copies nothing.

**API:** `GET`, `POST`, `PATCH` and `DELETE /api/crate`, plus
`GET /api/crate/audio?id=`. Dropping goes through the existing drop as
`{from: {crate: id}}`, so undo and crossfades come with it.

**UI:**
- **Keep as clip** on the take page's toolbar, beside *Copy*.
- **Keep** in a tape clip's sheet, and on the clipboard chip.
- A **Crate** drawer on the tape page, beside Rec and Edit. Its rows are
  newest first, with a search box. Tap a row to audition it, use **Drop** and
  **Insert** (once A7 lands), and hold for rename, share as WAV, the take it
  came from, and delete.
- The take page shows a **Crate** chip too, so you can see what you've kept.
- **Families:** a take's detail pane on the takes page shows "◫ 3 clips kept"
  under its cuts, linking to the crate filtered by that take.

**Checks** (from the clips design):
- *Keep* doesn't touch the takes list.
- A clip outlives the take it came from.
- Pruning leaves the crate alone.
- Deleting a clip and undoing restores it.

### B2. *Split here* on a take

- Under *More* on the take page: two crate clips, before and after the
  playhead, named "*take* · A" and "*take* · B". **The take isn't changed.**
- The word matches the tape's Split, a cut at the playhead. On a take it
  makes clips, because a take's audio never changes.
- Later, *Chop at flags* on top of this makes one clip per gap between flags.
  It's held back with the pads idea, until the MPC side is settled.

## Phase C: the take page and the takes list

| PR | What | Where in the code |
|---|---|---|
| **C1** | **Trash** button in the take header, beside ↶. It's one tap and moves to the next take, with an Undo toast (`DELETE /api/delete` already trashes). On Capture, an **Undo last save** toast after each capture, which trashes the new take | `wave.html` header, `lib/wave/page.js`, `app.js` |
| **C2** | **Play all** on the takes page: plays the visible, filtered order from each take's selection, through the bar's take source, moving on at the end. The playing spine is highlighted. On the take page, ◂⚑ and ⚑▸ go on to the previous or next take past the first or last flag | `lib/shelf-page.js`, `lib/bar/take-source.js`, `neighbours()` |
| **C3** | A **flags list** sheet on the take page, reusing the detail pane's `flagChips`: time, label, tap to play from it. An **↺ 5 s** button in the bar's transport, key J | `lib/wave/page.js`, `lib/bar/*` |
| **C4** | **Dropout flags.** The capture records each xrun's ring frame in a small ring of events (`Capture`). A save turns any that fall inside the take into flags with `kind: "dropout"`: shown as ⚠, not editable, and not counted against the 512 cap. The take's detail and cassette show "⚠ 2 dropouts". A [rig] check forces an overrun | `capture.go`, `save.go`, `saverange.go`, `meta.go`, flag rendering |
| **C5** | **Normalize on share.** A toggle in the share sheet. The peak comes from the peaks pyramid, which is already on disk, so it reads no audio. ffmpeg's `volume=` applies the gain. Previews get an optional *Level* toggle that matches it | `lib/wave/share.js`, the share handler |

## Not in this plan

These are on purpose, per the roles page and the earlier discussion:
- pads and the virtual MPC;
- chopping into many clips at once;
- *Fit to tempo* (it belongs with tape speed in step 9);
- a MIDI sequencer on the tape;
- folders, stars or tags for clips. The crate has ids, sources and dates, so
  they can be added once there's a real need.

## Decisions

Settled with Gabe on 2026-10-07.

1. **The crate:** the name stands. It fits the studio vocabulary: tape,
   cassettes, shelf, crate. It's a drawer on the tape page, with a chip on the
   take page.
2. **Handles: 2 s, configurable.** Hindsight's settings are environment
   variables in `internal/config/config.go`; there's no settings page. So this
   is `TAPE_HANDLE_S` (default `2`, 0–10), documented in
   `docs/configuration.md` beside `TAPE_LENGTH_S`. A settings page in the app
   would be a separate piece of work.
3. **Insert and delete time:** in. The words, looks and previews must make
   clear what Drop, Insert and Delete time each do. See
   [Making the edits obvious](#making-the-edits-obvious).
4. **Order:** not important. Gabe will run the whole plan, then fix bugs and
   make improvements. The table's order still stands, because A0 has to come
   before A1–A4 and B1 needs A1's handles.

## Making the edits obvious

Replace, insert and remove-and-close-the-gap are the edits most likely to
surprise. A DAW tells them apart with words, pictures and a preview. The tape
does the same.

**Words.** Each verb says what happens to what's already there:

| Button | Tip | Gets you |
|---|---|---|
| **Drop** | Put the clipboard here, **over** what's there | Replaces. The tape's length doesn't change |
| **Insert** | Put the clipboard here and **push** everything after it later | Everything after the playhead, on all four tracks and sections, moves later by the clipboard's length |
| **Lift** | Cut the selection out, **leaving a gap** | Silence where it was |
| **Delete time** | Cut the selection out and **close the gap** | Everything after it moves earlier |
| **Duplicate section** | Play this section **twice in a row** | The section copied right after itself; the rest moves later |

**Icons pair up.** Drop and Insert sit side by side, and Lift and Delete time
sit side by side, so each pair reads as two ways of doing one thing:
- ⤓ **Drop** beside ⇥ **Insert**, an arrow pushing a bar line right;
- ✂ **Lift** beside ⇤ **Delete time**, an arrow pulling a bar line left.

**A preview while the button is held or hovered.**
- **Insert** shows a ghost of the clipboard at the playhead. Everything after
  it is drawn shifted right, with the gap shaded, and the ruler shows
  "+4 bars".
- **Delete time** shades the selection on all four tracks, draws everything
  after it shifted left, and shows "−4 bars".
- **Drop** outlines what it will cover on the selected track.
- On a phone there's no hover, so a first tap shows the preview with a
  **Confirm** chip, and a second tap carries it out. After the first use, an
  *Ask before inserting* preference lets you turn the confirm off.

**Scope is always visible.** Insert and Delete time act on **all four tracks
and the sections**, because moving one track alone would knock the parts out
of time with each other. The buttons say so: a small "all tracks" label under
them. Drop, Lift and Copy keep today's Track N / All toggle.

**After every edit, a toast and one undo.** For example: "Inserted 4 bars at
bar 9 · Undo", or "Deleted bars 9–12 · Undo".

**The guide** gets a short section, *Replace, insert or close the gap*, with
three before-and-after strips drawn the same way as the previews, and [demo]
checks for each.


## Handoff

This plan is built in a fresh session. Paste this to start it:

> Build the Hindsight DAW-style editing plan. The repo is
> `gabeduke/hindsight`. The plan and its designs are in the Jamstation
> project: `claude/2026-10-07-daw-editing-plan.md` (read it first, including
> *Decisions* and *Making the edits obvious*), with
> `claude/2026-10-07-clips-design.md`,
> `claude/2026-10-07-zoom-recorder-study.md`,
> `claude/2026-10-07-rig-roles.md` and `claude/status.md`.
>
> - Copy the plan and the clips design into `docs/superpowers/specs` in the
>   first PR.
> - Work through A0–A7, B1–B2 and C1–C5. Order is flexible, but A0 comes
>   before A1–A4, and B1 needs A1's handles.
> - Each step is its own PR, following the house routine in the plan:
>   a spec and plan in `docs/superpowers`; Go and node tests; `TIPS` rows with
>   matching guide §9 rows; [demo] checks in the guide; and the `sw.js` cache
>   bumped.
> - Each PR gets an independent review before it's opened. Never push to
>   `master`; Gabe merges.
> - Run `go test -race ./...`, the node tests and `scripts/smoke-tape.mjs`
>   against `--demo` before each PR.
> - Keep `claude/status.md` in the project current as PRs open and merge.
