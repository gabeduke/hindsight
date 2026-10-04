# The editing model, and refining the base app

**Date:** 2026-10-03 · **Status:** approved by the owner 2026-10-03; steps 1 (solid ground), 2 (phone recording) and 3 (one take page) built · **Repo:** `hindsight`

Companions: [the tape design](2026-10-03-tape-design.md),
[the OP-1 Field tape study](2026-10-03-op1-tape-study.md),
[phone recording](2026-10-03-phone-recording-design.md).

## Goal

Two things, which turn out to be one.

1. **Make what exists solid.** An audit of the app as it stands on `main`
   found:
   - a few ways to lose data quietly;
   - some endpoints doing far more work than a Pi needs;
   - features that live on one page but not the other;
   - gestures that fight on a phone;
   - docs that have drifted from the code.
2. **Give editing one model** that works the same on the ribbon, on a take and
   on a tape, borrowing the OP-1's loop keys and clipboard. The tape is
   coming. If takes and tapes are edited with different words and gestures,
   the app becomes two apps.

The model is what makes the fixes coherent rather than a list. Most of the
gesture and parity problems go away once the take page is treated as a
one-track tape.

## What's wrong today

From a read-only audit of `main` at `62cb34d`, checked in the code. The
`file:line` references are where to start.

### Data safety

- **Concurrent edits overwrite each other.** `PATCH /api/take` reads the
  sidecar, modifies it and writes it back with no lock
  (`internal/api/api.go:798–1019`). The save path also writes sidecars, in
  `stampFlags` and `stampTempo` (`save.go:276–279`) and the MIDI exporter's
  downbeat (`bundle/exporter.go:233–240`), while the take is already listed:
  `WriteWAV` creates it under its final name (`wav.go:217`). Flags are sent
  as a whole array from both pages, and the take page never refreshes after
  it loads, so an open page can silently undo flags added from another
  device.
- **Editing a flag rewrites the take's cue chunk and RIFF size in place**
  (`cue.go:312–318`, opened read-write at `cue.go:359`). That moves the WAV's
  modification time, and the takes list sorts and prunes by modification time
  (`save.go:513`). So editing a flag on an old take very likely jumps it to
  the top of the list and shields it from `MAX_SAVES`.
- **Nothing can be undone.** Deleting a take, or pruning one, is permanent.
  These all save immediately:
  - clearing or moving a region;
  - deleting a flag from the ribbon, which is one tap with no confirm;
  - flipping a lane kind.
- **Smaller gaps:**
  - The trim PATCH isn't bounds-checked, unlike flags and the downbeat.
  - Cuts drop `lane_kinds`, and a downbeat the owner placed (`cut.go:68–96`).
  - Pruning doesn't run after a cut, so `MAX_SAVES` can be exceeded until
    the next capture.

### Work the Pi shouldn't be doing

- **The takes list rescans everything on every poll.** `/api/jams` reads
  every WAV header and every sidecar on each 5-second poll from the main page,
  and computes its ETag only after that scan (`api.go:181–209`). The take page
  loads the whole list to find one take.
- **Zooming into a long take reads most of it.** On a 15-minute take, the
  first zoom in from the overview fetches peak tiles spanning hundreds of
  seconds each, computed from the WAV on demand (`geometry.js:13–33`,
  `rangepeaks.go`). That reads most of the file from the SD card. There's no
  server-side cache.
- **The audition can differ from the share.** `/api/slice` sends every
  channel (`slice.go:44`), so under `SAVE_ALL_CHANNELS` the audition can play a
  different pair than the one previews and shares use.
- **Shares aren't queued.** Each runs its own ffmpeg (niced), with no queue.

### One page or the other

- **The list and the take page split the editing between them.**
  - Only the list can star, rename, set BPM, delete or download.
  - Only the take page can select, loop, cut, share or bundle.
  - The downbeat needs a BPM, and the BPM can only be set from the list.
- **The same take looks different on each page.** The list draws dB; the
  take page draws linear amplitude with fit gain.
- **Adding a flag works differently on each.**
  - The list uses a double-click (a mouse event) and a 2 px tick to tap.
  - The take page uses a double-tap and a bottom sheet.
- **Smaller splits:**
  - Speed control exists only inside the notes pane.
  - The wake lock is main-page only.
  - Back is a full reload that loses your place in the list.

### Gestures that fight on a phone

- **One-finger drags inside a region move it** instead of panning. When a
  region fills the screen, panning needs two fingers or the overview strip,
  and an accidental move is saved at once.
- **A region always loops.** Play restarts at its start, and tapping outside
  drops and re-arms the loop. There's no way to hear the bars before it.
- **Unlabelled flags inside a region can't be tapped,** because the region
  body wins the hit test (`view.js:213–229`).
- **Flags can't be moved.**
- **The top strip is overloaded.** Grip tabs, the downbeat and flag chips
  share 16–24 px.
- **Some actions are keyboard-only.** Set start, set end and flag-at-cursor
  are `[`, `]` and `F`.
- **Nudge loses its fine step.** With a BPM set it steps a whole beat.
- **Holds and double-taps disagree.**
  - Select is a 350 ms hold, and flipping a lane is a 500 ms hold that only
    a tooltip mentions.
  - A double-tap flags on the wave but fits the view on the overview.

### What you can't do

- **Pick an exact span of the ring.** A capture always ends *now*, so older
  audio needs a capture long enough to reach back to it, then a cut.
- **Edit finely.** No split, join, grid snap, gain change, moving a flag, or
  stepping between flags.
- **Work on several takes at once.** You can't select several, or export
  them.

### Words

- **Two names for one thing:**
  - trim (API) and region (UI);
  - cut and *Export as take*;
  - render and *Share MP3*;
  - *Mark* on the main page, flag elsewhere, and cue in the file.
- **Misleading or awkward labels:**
  - *Delete region* is styled as dangerous but only clears the selection.
  - A cut of a cut is labelled "X cut cut".

### Docs

- **Counts are out of date.** The README says fourteen endpoints; there are
  sixteen.
- **`architecture.md` describes a waveform page that no longer exists:**
  seven modules, four endpoints, drag-to-select.
- **`api.md`:** its index row omits `downbeat_frame` and `lane_kinds`, and
  its delete section omits the `.mid` and `.manifest.json` sidecars.
- **The service worker's cache list** misses `rising.js`.
- **Elsewhere:** several spec statuses are stale, and some comments describe
  behaviour that has changed.

## The editing model

### Three places audio lives

| Place | What it is | Audio changes? |
|---|---|---|
| **The ring** | The last 15 minutes of every input, in RAM | Rolling |
| **A take** | A WAV with sidecars, in `OUTPUT_DIR` | Only its cue chunk, when flags change |
| **A tape** | Four tracks of clips in `tape.json`, pointing into a shared pool of WAVs in `TAPE_DIR` that never change | Never; edits change `tape.json` |

### One selection, one loop toggle

A selection is always **In** and **Out**, the OP-1's loop points:

- on the ribbon, a span of the ring;
- on a take, a span of the take;
- on a tape, a span of bars.

**Loop** is a separate toggle, so a selection no longer forces a loop. With
Loop off, Play runs from the playhead through the selection and on. With Loop
on, it wraps between In and Out. That alone fixes "a region traps playback".

On a take, the selection is what the API saves as `trim`. The field keeps its
name; the UI and docs call it the selection.

### One set of verbs

| Verb | Ribbon | Take | Tape |
|---|---|---|---|
| **Select** | Hold and drag | Hold and drag, or In · Out | Hold and drag on the ruler, or In · Out |
| **Play · Loop** | — | ✓ | ✓ |
| **Flag** | ✓ (today's *Mark*) | ✓ | — |
| **Save as take** | ✓ any span of the ring | ✓ (today's cut) | *Mixdown* |
| **Share** | — | ✓ (today's *Share MP3*) | via a mixdown take |
| **Copy** | ✓ (tape on) | ✓ (tape on) | ✓ |
| **Catch onto a track** | ✓ (lands at the tape's playhead, on the selected track) | — | ✓ |
| **Send to tape** | — | ✓ copy, then drop at the tape's playhead | — |
| **Lift · Drop · Merge drop · Split · Join · Slide · Multiply** | — | — (a take's audio never changes) | ✓ |

### The clipboard

There is one clipboard, belonging to the tape engine. It exists when `TAPE` is
on, and *Copy* appears on the ribbon and on takes only then, because a tape is
the only place to drop it.

- **What it is.** `clipboard.json` in `TAPE_DIR`: references to clips in the
  tape audio pool, one track's worth or four after *lift all*.
- **Copying from the ring or a take writes the pool first.** It writes just
  the selection, with 10 ms of overhang either side, as a stereo WAV. A take's
  audio is never linked or referenced, because flag edits rewrite take WAVs in
  place. The pair taken is the take's configured pair: the `SAVE_CHANNELS`
  pair of an 8-channel take, or both sides of a mono take.
- **Lifting and copying from a tape** only writes references; nothing is
  copied.
- **It persists across restarts,** as the OP-1 Field's does. Garbage
  collection treats it as a root, so audio it points to is never cleaned up.
- **A chip in every header** shows its contents, such as "4 bars · 2 tracks".
  Tapping the chip auditions it on the phone, with tracks summed.
- **The API** is `GET /api/clipboard` for its contents and
  `GET /api/clipboard/audio` for a summed preview. `POST /api/clipboard`
  copies `{take, from, to}` or `{ring_from, ring_to, source}`, behind the
  `MIN_FREE_GB` guard. `DELETE /api/clipboard` clears it. Lifting and copying
  from a tape go through `/api/tapes/edit`.

### One set of gestures

The take page and the tape page share one gesture module
(`lib/edit/gestures.js`), split out of today's `view.js`. Each kind of
gesture has its own zone on screen, so they don't compete.

```
┌──────────────────────────────────────────┐
│ ⚑     ⚑            ⚑                     │  ruler, top half: flag pins (take)
│ 1    2    3    4 ▾  5    6    7    8     │  ruler, bottom half: bars; ▾ = playhead handle
├──────────────────────────────────────────┤
│        ┃▁▃▅▇▅▃▁▁▃▅▇▅▃▁▁▃▅▇┃              │  body: the audio (take) or lanes (tape)
│        ┃▁▃▅▇▅▃▁▁▃▅▇▅▃▁▁▃▅▇┃              │
├────────╂━━━━━━━━[ ═══ ]━━━╂──────────────┤  bottom: In/Out grips at the edges,
│        ◀ In              Out ▶           │  move handle in the middle
└──────────────────────────────────────────┘
```

| Where | Gesture | Does |
|---|---|---|
| Anywhere | One-finger drag | **Pans.** Always, including inside the selection |
| Anywhere | Pinch, wheel | Zooms |
| Body or ruler | Tap | Moves the playhead; snaps when snapping is on |
| Ruler | Drag the playhead handle ▾ | Scrubs, silently: the OP-1's lifted tape head |
| Ruler, top half | Tap a pin | Opens that flag |
| Ruler, top half | Drag a pin | Moves the flag. Pins outrank the downbeat where they meet |
| Ruler, bottom half | Drag the bar 1 label | Moves the downbeat (takes with a BPM) |
| Ruler, bottom half (tape) | Hold, then drag | Selects bars (In and Out) |
| Body (take) | Hold, then drag | Selects a span (In and Out) |
| Body (tape) | Hold on a clip | Selects the clip. Then drag slides it, and its sheet offers split, gain, nudge, reverse and *share as WAV* |
| Body (tape) | Hold on an empty part of a lane | Selects that lane's bars from there; drag to extend |
| Bottom edge | Drag an In or Out grip | Adjusts that end |
| Bottom edge | Drag the move handle | Moves the whole selection. It's the only way to, so it can't happen by accident. The handle hides on a selection too narrow for three grips; nudge it instead |

**The toolbar** sits at the bottom of the screen, below the grips, in two rows
on a phone.

- **Transport row:** ▶ · ⟲ Loop · In · Out · ⚑ Flag · ◂⚑ ⚑▸ (step between
  flags) · *practice speed* (½× 1× 2×, pitch kept).
  - Practice speed works for every take, not just ones with MIDI. It plays
    the preview at a slower or faster rate, so it's disabled while Loop is on;
    the sample-exact loop runs at 1×.
  - It's a different thing from tape speed, which changes pitch.
- **Verb row:** Copy · Save as take · Share · Send to tape ▸ · *More*. *More*
  holds the DAW bundle, the WAV and MIDI downloads, and delete.
- **In, Out and Flag** are the touch versions of `[`, `]` and `F`, which stay
  as keyboard shortcuts.

**Snap and nudge.** With a BPM set, a *Snap* chip picks the grid — bar, beat,
8th, or off — the OP-1's tape grid. In and Out each have ◂ ▸ nudges that step
by the snap, or by 10 ms with snap off. Holding a nudge repeats it.

### The take page is a one-track tape

Seen this way, the take page gets the tape's header, ruler, toolbar and
gestures, with one lane. What you learn on one page works on the other. The
tape page is the same view with four lanes, plus clip gestures and the
tape-only verbs.

### Undo, and nothing permanent by accident

**Every take has an operation log.**

- **What it records.** Each change to a take's sidecar is logged as an
  operation with a before and after — flag added, flag moved, selection set,
  BPM changed, downbeat moved, lane kind flipped. The last 50 live in
  `<take>.history.json`.
- **How Undo works.** *Undo* reverses the newest operation, and only if its
  field still holds the "after" value. So undoing on one device can't
  clobber a change made since on another. A clash is skipped, with a toast
  saying so.
- **The toast.** Anything that removes something gets one with an Undo
  button, such as "Flag deleted · Undo".

**Deleted takes go to a trash** (`OUTPUT_DIR/.trash/`), together with all
their sidecars, the history included.

- **Pruning uses the trash too.** `MAX_SAVES` pruning moves takes there
  rather than deleting them, so nothing is permanent by accident.
- **Restoring.** *Recently deleted*, at the bottom of the list, restores a
  take. A restored take comes back starred, so the next prune doesn't take it
  straight back.
- **Emptying.** The trash empties after 7 days. It also empties oldest first
  whenever free space on `OUTPUT_DIR` falls below `MIN_FREE_GB`, before a save
  would be refused, so the dashcam never fails because of it. Nothing in the
  trash is hard-linked, so emptying it always frees what it says.

**Tapes** keep their own 100-step undo (tape design).

### Help, tooltips and the guide

The OP-1's workflow is new to most people, the owner included, so the app
explains itself.

- **Tooltips.** Every control has a tip: a `title` on a computer, and on a
  phone a **?** button in the header that turns on help mode. In help mode,
  tapping any control shows its tip instead of acting. A long press can't do
  this job, because the nudges already repeat on hold.
- **First-run hints.** The first time a device opens the take page or the
  tape page, three short hints point at the gestures that matter: hold to
  select, drag pans, Loop is a toggle (and on the tape: drop, drop, drop).
  They're dismissed for good per device, in `localStorage`.
- **The guide.** [`docs/guide.md`](../../guide.md) explains everything in
  plain words, from the main page to tape tricks. The release copies it next
  to the UI, and `/guide.html` renders it with a small vanilla renderer. Each
  page's **?** sheet links to its section.
- **One source of truth.** Tip text lives in `web/static/lib/help/tips.js`
  and in the guide's tip table. A node test fails if a `data-tip` in the HTML
  has no entry, or if `tips.js` and the guide's table disagree.
- **The guide is the acceptance test.** Every section ends with checks marked
  [demo] or [rig]. A roadmap step is done when its checks pass. The [demo]
  ones are the CI's end-to-end smoke test against `--demo`.

Tips and the guide page arrive with step 3 for takes, and with step 6 for the
tape.

## Fixes to the base app

These land first. Most are invisible.

### Data safety

1. **One lock per take, in `internal/audio`.** It goes around every sidecar
   read-modify-write, through `ReadMeta` and `WriteMeta`. That covers the API,
   the saver's stamps, cue writes and the MIDI exporter. A save writes the WAV
   and its sidecars under temporary names and renames the WAV last, so a take
   appears in the list only when it's complete.
2. **PATCH changes only the fields it's sent.** With the lock making each
   change atomic, two devices editing *different* fields never collide, and
   the same field is last-writer-wins. That's fine for a label or a BPM. The
   take page also refetches its take when it comes back into view. No
   `If-Match` scheme is needed.
3. **Flags get stable ids and their own operations,** replacing the
   whole-array PATCH that lets one device undo another:
   - add: `POST /api/take/flags?file=`;
   - edit or move: `PATCH /api/take/flags?file=&id=`;
   - delete: `DELETE /api/take/flags?file=&id=`.

   These are separate from `/api/flag`, which stays the live-mark endpoint.
   Flags dedupe by id, not by frame, so moving one flag onto another keeps
   both.
4. **Creation time is stored, not read from the filesystem.**
   - Every take gets `created` in its sidecar: stamped at save, cut or phone
     upload, as RFC 3339 with its zone.
   - A take that predates the field takes its time from its `jam_<ts>` name,
     and only failing that from its modification time. That way a list request
     never writes anything.
   - Cue rewrites then can't reorder a take or protect it from pruning.
5. **Smaller fixes:**
   - The trim PATCH is bounds-checked.
   - Cuts carry `lane_kinds` and an owner-placed downbeat, shifted to the
     cut.
   - Pruning runs after cuts and phone takes too.
6. **Cut labels** become "*source label* · 0:42–1:10", replacing "X cut cut".

### Pi load

1. **`/api/jams` keeps a per-take cache,** keyed by the size and modification
   time of the WAV *and* each sidecar. Its ETag is computed from one directory
   listing with an lstat per entry, before any file is opened. An unchanged
   poll then costs a listing, not a scan.
2. **`GET /api/take?file=` returns one take,** so the take page stops loading
   the list.
3. **Every take gets a peaks pyramid:** a small multi-level peaks file,
   written at save time and built lazily for old takes. Zoomed-out tiles then
   never read audio, and only deep zooms touch the WAV. A 15-minute take's
   pyramid is a few megabytes.
4. **`/api/slice` sends the configured pair,** like previews and shares.
5. **Shares are queued,** one ffmpeg at a time.

### Parity and consistency

1. **One take header** on both pages:
   - name, editable;
   - star;
   - BPM, editable on the take page too;
   - source lineage for cuts;
   - *Undo*;
   - the overflow menu.
2. **One waveform renderer** for list rows, the overview and the take page,
   with the same scale. A list row shows the selection as a bracket, and the
   length as "1:12 of 7:00" when a take has one.
3. **The take page:**
   - holds the wake lock while playing;
   - *Back* returns to the list where you left it;
   - ◂ ▸ in the header step to the previous and next take.
4. **The main page:**
   - shows the running version;
   - says *waiting for the interface* distinctly from a real error.
5. **MIDI lanes:**
   - Tapping a lane header opens a small menu (collapse, drums or notes,
     hide), replacing the hidden 500 ms hold.
   - The notes pane's "mute" chips become *hide*, since they never touched
     the audio.
   - On a phone, the notes fullscreen keeps a thin waveform strip at the top.

### Words

| Today | Becomes |
|---|---|
| Mark (main page), flag, cue | **Flag**; the main-page button is *Flag now* |
| region (UI), trim (API) | **selection** (In–Out); the API keeps `trim` |
| cut, *Export as take* | **Save as take** |
| render, *Share MP3* | **Share** |
| *Delete region* | **Clear**, not styled as dangerous |
| take speed chip | **Practice speed** (pitch kept), distinct from tape speed |
| (tape) recording from the ring | **Catch** |
| (tape) cut and paste | **Lift** and **Drop** |

### Docs

Bring `README.md`, `architecture.md`, `api.md` and `configuration.md` back in
line with the code. Add `rising.js` to the service worker and bump its cache.
Update the stale spec statuses and comments. Add a glossary to the README.

## New capabilities on the base app

1. **Select on the ribbon.** Hold and drag across the buffer ribbon to select
   any span of the last 15 minutes, then *Save as take*. With a tape loaded,
   *Copy* and *Catch onto a track* are offered too.
   - The ribbon's time axis is logarithmic, so old spans are coarse: save
     generously and refine on the take page.
   - It needs two things the saver doesn't have yet:
     - `Ring.Range(from, to, pick)`, the chunked range read the tape design
       specifies, built here first;
     - a save window that can end in the past. Its BPM is measured over the
       window's own times through the clock bridge, not ending at
       `time.Now()`, and `created` is the window's end.
2. **Save from a flag.** A flag's sheet offers *Save from here to now* — the
   flags spec's "capture since first flag", finally.
3. **Several takes at once.** A long-press on a row starts select mode, with
   bulk star, delete (to the trash) and export. `GET /api/export` returns a
   zip of WAVs, sidecars and `.mid`s.
4. **Move flags, and step between them,** from the ruler and the toolbar.

**Not proposed:** multiple selections per take, gain and normalise, and
transient or key detection, all deferred before. The tape covers what multiple
selections were for: collecting bits of a take is copy, drop, copy, drop.

## Roadmap

Each step ships alone.

| # | Step | Needs |
|---|---|---|
| 1 | **Solid ground:** data safety, Pi load, docs | — |
| 2 | **Phone recording** | 1 (atomic saves, the lock, `created`) |
| 3 | **One take page:** header, ruler, toolbar, gestures, Loop toggle, snap, renderer, words, tips and the guide page | 1 |
| 4 | **Undo and trash; several takes at once** | 1, 3 (the header's *Undo*) |
| 5 | **The ribbon:** select, save any span, save from a flag; `Ring.Range`; the past-ending save window | 1 |
| 6 | **Tape phase 1:** loop and layer, the clipboard, *Drop*, *Send to tape*, *Copy* on takes and the ribbon | 3, 5 |
| 7 | **Tape phase 2:** lift, merge drop, split, join, slide, multiply, mixdown, export | 6 |
| 8 | **Tape phase 3:** clock, strips, pedal | 6 |
| 9 | **Tape phase 4:** tricks, tape speed, tape style, FX, bounce, listen | 7, 8 |

Steps 1–5 make today's Hindsight better whether or not the tape ever ships.
Step 3 is the biggest UI change, and its gesture module is reused by the tape
page in step 6.

## Decisions

All settled with the owner on 2026-10-03.

1. **Loop is off by default,** now that a selection no longer forces a loop.
2. **Layout:** grips and the move handle at the bottom, the ruler at the top.
3. **The trash:** 7 days, plus emptying under disk pressure. Pruning goes to
   the trash too.
4. **The word changes,** including *Flag now* replacing *Mark*.
5. **Phone recording is second** on the roadmap.
6. **In-app help and the guide** ([above](#help-tooltips-and-the-guide)), because the
   OP-1's workflow is new to the owner as well as to anyone else.
