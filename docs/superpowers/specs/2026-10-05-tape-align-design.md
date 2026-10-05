# Aligning clips on the tape to the sample

**Date:** 2026-10-05 · **Status:** design approved by the owner 2026-10-05 ·
**Repo:** `hindsight`

## Why

The take page's boundary editor (#24) places a loop's In, Out and bar 1 to the
sample. The tape needs the same precision for its clips, for two jobs:

- **A recording at the tape's tempo** — a catch from the ring, or a take sent
  to tape — should sit with its first hit exactly on the grid.
- **An overdub** — a part played over the loop on the Pi or a phone — should
  sit exactly against what it was played to, even where both are a few ms off
  the grid, with micro-adjustments by ear.

Today neither is possible:

- The tape lanes zoom no closer than a quarter of a second across the screen.
- Clips are drawn from each pool file's whole-file peaks (1024 buckets), so a
  10 s clip has a column every 10 ms: a hit's start can't be seen.
- A clip moves by sliding (snapping to bar, beat or ⅛, or keeping an off-grid
  offset) or by its sheet's ±5 ms nudge.

Bringing a same-tempo recording from the ring onto the tape already works
(catch; Send to tape carries the take's tempo since #22). This is not a step
towards a general DAW: no stretching, no multi-clip moves, no automatic
alignment.

## What changes

### 1. The tape at sample level

- **Zoom:** the tape view's floor drops from a quarter of a second across to
  the take page's 8 px per sample (pinch, ⌘/Ctrl-scroll, and the editor's
  ZOOM pad).
- **Detail:** clips draw from range peaks of their pool file for the stretch
  on screen, cached as tiles the way the take page's are, falling back to the
  whole-file peaks while a tile loads. Every lane at once, so hits on
  different tracks can be compared by eye.
- **New endpoint:** `GET /api/tapes/peaks?file=&from=&to=&buckets=` — range
  peaks of a pool file (the same JSON and limits as `/api/peaks`' range
  form; immutable cache). Without `from`/`to`/`buckets` it answers the
  whole-file peaks as now.

### 2. The clip editor

- **Way in:** a clip's sheet gains **Align**. It closes the sheet and opens
  the editor bar for that clip.
- **The bar** is the take page's: the readout, **ZOOM** and **POSITION**
  pads, ◂ ▸ steps, ▶, **Done** — shared code, not a copy (see 4). On the tape
  page it takes the place of the tape toolbar's rows while open.
- **The point** the view centres on and follows is the clip's **first hit**:
  found with Attack from the clip's start (within 60 ms), else the clip's
  start. It moves with the clip.
- **POSITION** and the steps move the **whole clip**. A pad drag previews the
  move and saves it on release as one `slide` edit (`/api/tapes/edit`, op
  `slide`, `at` in whole frames) — one undo step, like a slide today. A step
  saves at once.
- **Where a clip sounds** is its `at` plus its nudge. Alignment works in
  sounding frames and writes `at`; the nudge is left as it is.
- **The readout:** the point's tape time to the sample, its offset from the
  nearest beat (*+2.5 ms from 5.1*), and, with a reference track picked, its
  offset from that track's nearest hit (*−1.3 ms from track 1*).

### 3. Two snaps

- **Hit → Grid:** moves the clip so its point (its first hit) lands exactly
  on the nearest line of the Snap setting, or the nearest beat with Snap off.
  Hidden without a tempo.
- **Hit → Track:** a track picker on the bar (the other tracks, numbered, in
  their colours). With one picked, it finds the hit nearest the point on the
  reference track (Attack, within 60 ms of the point, in that track's audio
  at that tape frame) and moves the clip by the difference, so the two hits
  coincide. Declines with a toast if either side has no hit.
- Both use `findAttack`, so both decline rather than guess.

### 4. Shared, not copied

- The encoder pads, steps, readout and the editor bar's wiring move from
  `lib/wave/page.js` into a shared module (`lib/edit/editor-bar.js`), which
  both pages use. The take page's behaviour doesn't change; its tests and a
  demo check confirm it.
- `lib/wave/onset.js` and `lib/wave/boundary.js` are used as they are.
- `NearAudio` learns a URL builder, so the tape asks
  `GET /api/tapes/slice?file=&from=&to=` — a 16-bit WAV of a pool file's span
  (both channels, as `/api/slice`; immutable cache; at most 60 s).
- The take page's tile cache learns a URL builder too, so the tape's lanes
  use it for pool files.

### Fits the reel-to-reel restyle

As on the take page: no new hex in JS; window inks on the lanes; hover only
inside `@media (hover: hover)`; focus rings; reduced motion; nothing orange
in the editor; the track picker uses the track colours and their numbers.

## Not in this

- Stretching a clip, moving several clips at once, aligning a whole track.
- Automatic alignment of every catch.
- The grid on the beat for takes (the take page's phase 2).

## Checks

- [unit, Go] `/api/tapes/peaks` range form and `/api/tapes/slice`: the right
  frames, bad names refused (only pool files), out-of-range refused, 60 s cap.
- [node] The tile cache and `NearAudio` with a URL builder; the alignment
  maths: a hit-to-grid move, a hit-to-track move, sounding frames with a
  nudge, clamping at the tape's start.
- [demo] Zoom the tape lanes to single samples: every lane draws sample
  detail. Catch a pass onto track 2; Align → the view centres on its first
  hit; Hit → Grid → the readout says *on* a beat. Nudge a clip 7 ms late;
  Align → pick track 1 → Hit → Track → *0.0 ms from track 1* (or *on*), and
  one ↶ puts it back.
- [demo] The take page's editor still behaves as before (its checks from #24).
- [rig] Overdub a part on the phone over a loop; Align it to the loop's track
  by ear and by Hit → Track; no flam.
