# Rising notes, and the tablet bench

**Date:** 2026-09-16 · **Status:** approved by the owner in chat · **Repo:** `hindsight`

## Goal

Show a take's MIDI as it plays, the way a musician watches their own hands:
a keyboard and a row of pads at the bottom of the screen, and every note
that sounds comes *out of* its key and rises away. On the tablet, which is
the owner's primary interface, the take page becomes a bench: the existing
wave, lanes and actions in a narrow left column, the rising notes filling
the rest. On a phone the same view opens fullscreen from the take header.

This is the third sub-project implementing the owner's Claude Design canvas
(`Hindsight Mobile.dc.html`, turn 5 artboard 5b and turn 4 artboard 4b;
`HANDOFF.md` steps 5 and 6). It builds on `GET /api/midi` from the lanes spec
(`2026-09-15-midi-lanes-design.md`). No backend changes.

## What the owner decided

| Question | Decision |
|---|---|
| Direction of motion | **Rising.** Notes emanate upward out of the keyboard. The canvas's "falling" artboard is superseded on this one point; everything else about it stands |
| Bench left column | Keeps the **zoomable wave** above the lanes, so every existing gesture (region drag, flags, downbeat, tap-to-seek) keeps working. The overview-only variant in the artboard was rejected |
| Phone | A fullscreen mode **on the take page** (header button opens, Back closes), sharing the page's one Clock. No second page, no second audio load |
| Speed | 0.5 / 1 / 2× through the preview `<audio>`'s `playbackRate`. Slice loops ignore it |
| Keyboard | Four octaves, octave-aligned around the take's melodic range |
| Pads | One per distinct drum pitch, at most eight |
| Mute chips | Per track, hide that track's notes; per-viewer local state like lane collapse |
| Cleanup chips | Out of scope (own sub-project, needs backend design) |

## Why rising

Hindsight records what just happened. A view where notes drop *onto* the
keys shows the future, which is a practice tool for reading a piece. A view
where notes leave the keys shows the past a bar or two deep, which is what
someone reviewing their own take wants: what did I just play, and did the
chord land on the beat. It also degrades better: nothing is hidden above the
fold waiting to arrive, so a paused frame is complete.

## The picture

The pane is one `<canvas>`. From the bottom up:

- **Keyboard**, full width minus the pad column, height `KEY_H = 88` px
  (72 on a phone under 700 px tall). White keys are even columns; black keys
  are drawn over them at 60 % height and 62 % width, offset, as on a real
  keyboard. Every C is labelled in the mono font (`C2`, `C3`, …) at its
  foot. A key whose note is sounding is filled with the track's colour at
  the note's velocity alpha; after note-off the fill decays to nothing over
  one beat.
- **Pad column**, `PAD_W = 126` px at the left edge, the pads stacked from
  the bottom, each `KEY_H / npads` tall with a 2 px gap, labelled with the
  GM drum name when the pitch has one (36 kick, 38 snare, 42 closed hat,
  46 open hat, 41/43/45/47/48/50 toms, 49 crash, 51 ride) and `#<pitch>`
  otherwise. A hit flashes the pad at velocity alpha for 0.3 beat.
- **Rise area**, everything above the keyboard, up to the chip row. Time
  runs upward: y for a frame `f` is
  `keyTop - (now - f) / framesPerBeat * PX_PER_BEAT`, with `PX_PER_BEAT = 44`.
  A note whose start is `s` and end `e`:
  - while sounding (`s <= now < e`): a bar from `keyTop` up to `y(s)`, in
    the key's column, track colour at velocity alpha, with a 1 px lighter
    top edge so the growing end reads as an edge;
  - after note-off (`now >= e`): the same bar between `y(e)` and `y(s)`,
    alpha multiplied by `1 - (keyTop - y(e)) / riseH` so it fades to nothing
    as it reaches the top;
  - not yet started (`now < s`): not drawn. The view shows the past only.
  Drum hits are bars in the pad's row-column: `PAD_W` wide, rising from the
  pad, `max(6, y(s) - y(e))` px tall.
- **Beat lines** across the rise area at every beat from the downbeat
  (`state.grid.downbeat`), bar lines brighter, the same `--line` and
  `rgba(255,255,255,0.06)` the lanes use. They scroll up with the notes.
- **Chip row** across the top, 40 px: one chip per track (swatch + name),
  tap toggles mute (dimmed chip, notes hidden); then the speed chip cycling
  `0.5× · 1× · 2×`; then, on the phone only, a bar.beat readout and the
  Play/Pause button, since the page's action row is covered.

Colours are `laneColors(tracks)` from `lanes.js`, so a track is the same
colour here as in its lane. Velocity alpha is `alphaFor(v)` from the same
module.

### Time base

`framesPerBeat` comes from the `tempo` array in the MIDI response: the entry
whose `frame` is the last one `<= now` sets the current bpm. A take with no
tempo (empty array, or `bpm` null) uses 120 bpm, so the scale is 2 beats per
second and the beat lines are drawn faintly with no bar emphasis.

Speed is `clock.audio.playbackRate`; the Clock gains a `setRate(r)` that
applies it to the preview engine and stores it so a slice engine, which
ignores it, can restore it on the way back. Position still comes from
`clock.position()`, so the visual rate follows the audible one for free.

### Keyboard range

From every non-drum track's notes: `lo`, `hi`. `KEY_LO` is the largest C at
or below `lo - 2`; if `hi` does not fit in `KEY_LO + 47`, shift the window so
its centre is the range's centre, rounded to a C. Empty melodic set: C2 to
B5 (36 to 83), the artboard's default. A pitch outside the window draws on
the edge key (36 or `KEY_LO + 47`) with a small `▾`/`▴` marker on the bar,
rather than vanishing.

### Pads

Distinct pitches over every drum track, sorted ascending, lowest at the
bottom, capped at the eight most-played (by note count); the rest map to
the nearest kept pitch. A take with no drum tracks draws no pad column and
the keyboard takes the full width.

## Layout

### Tablet bench (`min-width: 860px`)

`.wave-main` becomes a two-column grid: `372px minmax(0, 1fr)`, gap 10 px,
height `calc(100dvh - var(--topbar-h))`, no page scroll. The left column
holds, in order, the overview, the wave canvas (height capped at 34 % of the
column instead of 55vh), the lanes (they already scroll inside at 40vh), the
action row and the Fine tune details; it scrolls on its own when the lanes
run long. The right column is the notes pane at full height. The existing
`min-width: 900px` wave-height rule and the `min-width: 860px` action-row
rule fold into this block.

On a 1024 × 600 tablet that leaves a 640 × 552 pane: 88 px keyboard, 40 px
chips, 424 px of rise, about 9.6 beats or two and a half bars at 96 bpm.

### Phone

The header gains a `Notes` button (right end, `.icon-btn`). It shows only
once `/api/midi` has returned tracks, so a take without MIDI never offers a
view of nothing. Tapping it adds `notes-open` to `<body>`: the pane becomes
`position: fixed; inset: var(--topbar-h) 0 0 0; z-index: 40`, the wave page
scroll locks, and the header's back link becomes a close (it reads `‹`
still; a `popstate` from `history.pushState({notes:1})` closes the pane
too, so the hardware/gesture back works). Landscape on a phone (the
`max-height: 560px` tier) is the same fullscreen pane; the keyboard drops to
72 px.

The pane runs (draws each rAF while playing) only when it is visible:
always on the bench, only while open on the phone. Hidden, it neither
paints nor observes.

## Module shape

`web/static/lib/wave/rising.js`, after `lanes.js`'s pattern: pure geometry
at the top, a class owning the canvas at the bottom.

Pure, tested:

- `keyWindow(tracks) -> { lo, hi }` — the four-octave window above.
- `keyLayout(lo, width) -> { whites: [{p, x, w}], blacks: [{p, x, w}], xFor(p) -> {x, w} }`.
- `padLayout(tracks, cap = 8) -> { pads: [{p, label, row}], rowFor(p) }`.
- `bpmAt(tempo, frame, fallback = 120)`.
- `noteBars(tracks, now, geometry) -> [{x, w, y0, y1, alpha, color, clampMark}]`
  — every visible bar for one frame, sounding and risen, drums and melodic,
  muted tracks skipped. Nothing before `now - riseH` worth of frames is
  visited: tracks are scanned from a per-track cursor kept by the caller, so
  a 10-minute take costs the same per frame as a 10-second one.
- `keyGlow(tracks, now, fpb) -> Map<pitch, alpha>` — the decay after note-off.

The class `RisingNotes({ canvas, chipRow, tracks, tempo, getState, getClock, storageKey })`:
`start()` / `stop()` the rAF loop, `draw()` for a single paused frame,
`setMuted(name, bool)`, `destroy()`. It reads `clock.position()` itself on
each frame and `getState().grid.downbeat` for the beat lines; it does not
subscribe to page events. The page calls `draw()` from its `onTick` when the
pane is visible and the clock is paused (a seek), and `start()`/`stop()`
when play state or visibility changes.

Page wiring in `page.js`: after `loadLanes()` resolves with tracks, build
the pane, reveal the phone button, and hook the Play button's state changes.
`pagehide` destroys it with the rest.

CSS: the bench grid block; `.notes-pane`, `.notes-canvas`, `.notes-chips`,
`.chip[aria-pressed]`; the `body.notes-open` phone rules.

## Errors

Nothing new can fail on the network: the pane uses the response the lanes
already fetched. A track list that is all drums draws a keyboard with no
keys lit and works. A tempo map with a 0 or absurd bpm (over 400) falls back
to 120 for that stretch. `playbackRate` unsupported (it is not, anywhere
current, but) leaves the chip at 1× with a toast.

## Testing

`node --test web/static/lib/wave/rising.test.js`, alongside the others in
CI:

- `keyWindow`: empty → 36..83; a bass range 40..52 → 36..83; a high range
  84..96 → 72..119; a span wider than four octaves centres.
- `keyLayout`: 28 whites across four octaves; a black key sits between its
  neighbours; `xFor` of an out-of-window pitch clamps to the edge key.
- `padLayout`: nine distinct pitches cap to the eight most-played; the ninth
  maps to its nearest kept pitch; labels for GM pitches.
- `bpmAt`: before the first entry, between entries, after the last, empty.
- `noteBars`: a sounding note is anchored at `keyTop`; a finished note has
  `y1 < keyTop` and alpha below its velocity alpha; a note that has not
  started is absent; a muted track is absent; a drum bar is at least 6 px.
- `keyGlow`: full at note-off, zero one beat later, the larger of two
  overlapping notes wins.

Hardware: on the tablet, open a take with four bento tracks; play, watch a
chord rise together and the drums flash their pads; scrub the wave and see
the pane follow; loop a region and confirm the rise wraps with it; 0.5× and
the rise slows with the audio. On the phone, open Notes, use the hardware
back to close it, rotate to landscape.

## Out of scope

Cleanup chips; the home screen and bottom tabs; settings; colouring notes by
velocity instead of track; dragging lanes to reorder; a keyboard-on-the-left
landscape variant (the artboard's "try next" list).
