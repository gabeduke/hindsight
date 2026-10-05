# The boundary editor: two encoders and a seam view

**Date:** 2026-10-05 · **Status:** design approved by the owner 2026-10-05
(phase 1 of 2: this document; phase 2, the grid on the beat, gets its own) ·
**Repo:** `hindsight`

## Why

The owner starts a beat on a sequencer and plays on top of it, then loops and
lays the result onto the tape. Since 2026-10-04 a take's tempo is measured from
its audio, so the grid's *spacing* is right. What's still missing is control
of *where* a loop starts and ends, and where bar 1 is, down to the hit and
down to the sample:

- The take page zooms to single samples, but getting there means pinching in
  and panning, and the point being placed drifts off screen.
- In and Out move with their grips or by 10 ms nudges; bar 1 only by dragging
  it on the ruler. On a phone, at a useful zoom, a finger is far coarser than
  the precision wanted.
- Nothing finds the hit or the zero crossing for you, so a loop can start a
  few ms before the beat or click at its seam.
- Nothing shows the seam: the end of the loop running into its start, which is
  where a stutter or a click lives.

The model is the MPC Sample's sample edit, which the owner named: two
encoders, **position** and **zoom**, always about the point being placed.
Zoom out, get the point near; zoom in; get it nearer; zoom in again.

## What changes

All of it is in the take page (`web/static/wave.html`, `lib/wave/`). No Go
changes: the page already draws single samples at deep zoom (1-frame peak
tiles), and `/api/slice` already hands it raw audio for any span up to 60 s,
cached as immutable.

### 1. Editing a boundary

A **boundary** is In, Out, or the downbeat (bar 1). One can be *selected for
editing* at a time.

- **To select one:** tap its time readout in the selection panel (`#sel-in`,
  `#sel-out`), or tap the bar-1 marker on the ruler without dragging it. A
  take with no BPM has no downbeat to edit. Tapping the selected readout again,
  or **Done**, ends editing; so does Escape.
- **While one is selected:**
  - the waveform centres on it and **follows it**: every change keeps it in the
    middle of the view, so it never drifts off screen;
  - it is drawn as a bright full-height line with a small label (*In*, *Out*,
    *1*), and its readout shows its time to the sample — *0:02.500 +31* is
    2.500 s and 31 samples — and, with a BPM, its offset from the nearest
    beat line as bar.beat (*+3.1 ms from 3.1*);
  - the **editor bar** takes the place of the toolbar rows below the
    waveform (see Layout), holding the two encoders, the snaps and the steps.

### 2. The two encoders

Two **encoder pads**, wide horizontal strips, labelled **ZOOM** and
**POSITION**. Each is turned by dragging sideways anywhere on it, so no aim
is needed; a drag is relative, like a knob, and the pad itself doesn't move.

- **ZOOM:** dragging right zooms in, left zooms out, about the selected point,
  which stays centred. A full pad width is about a factor of 64. The range is
  the page's own: the whole take out to 8 px per sample in.
- **POSITION:** dragging moves the point. The step scales with the zoom: a
  pad's width of drag moves the point by **half of what's on screen**, so far
  out it travels bars, and fully in it moves a sample at a time (at 8 px per
  sample, half a 390 px screen is about 24 samples per pad width). Moving it
  rounds to whole frames, and it stops at the take's ends (and In stays before
  Out, as the grips enforce now).
- **Feel:** both pads respond to the drag's distance, not its speed. A short
  tick of haptic feedback (`navigator.vibrate(5)`) marks each crossing of a
  grid line by the point, where the browser supports it.
- **Keyboard and mouse, for a computer:** while a boundary is selected,
  ← / → move it one *step* (see below) and Shift+← / → ten; the wheel
  moves it, ⌘ or Ctrl with the wheel zooms about it; Escape ends editing.

### 3. Snaps and steps

On the editor bar, as buttons that act once (not modes):

- **Attack** — moves the point to the start of the strongest hit within
  ±60 ms of it (or within half the visible span if that's smaller). The hit's
  start is the first sample where a short energy envelope rises above a
  quarter of the way from the quiet before it to the hit's peak; a window
  with no rise (silence, a held note) leaves the point where it is and says
  *no hit near here*.
- **Zero** — moves the point to the nearest zero crossing (left channel, or
  the mix for stereo), within ±5 ms, so a cut there doesn't click.
- **Grid** — moves it to the nearest line of the current Snap setting (bar,
  beat or ⅛), or the nearest beat when Snap is off. Hidden without a BPM.
- **◂ ▸** — one *step*: 1 sample when zoomed past 1 px per sample, else 1 ms.
  The step size is shown between the arrows.

Attack and Zero read the audio around the point from `/api/slice` (±250 ms,
which the browser caches) and do their analysis in the page; the analysis is
pure functions, node-tested. While a slice loads, the button shows it's
waiting; a failed load says so in a toast and moves nothing.

### 4. Hearing it

- **▶ from here** plays from the selected point (In: the loop's start; Out:
  a second before it, so you hear the edge arrive; bar 1: from it).
- With the **loop** on, playback loops the selection as it does today (the
  slice engine, sample-exact), so moving In or Out while it plays is heard on
  the next pass. Edits made while playing take effect at the next wrap.

### 5. The seam view

For a selection with the loop on, the editor bar has a **Seam** toggle.
On, the waveform splits down the middle:

- the **left half** shows the last stretch before **Out**, ending at the
  centre line; the **right half** shows the first stretch from **In**,
  starting at it. The two halves meet at the centre as playback will join
  them, at the same zoom. A faint label over each half says *…end* and
  *start…*.
- the ZOOM encoder zooms both halves together about the centre line.
- the POSITION encoder, and the snaps and steps, move **whichever side is
  selected**: tap a half to select it (In or Out); the selected half's edge is
  the bright line.
- a jump at the centre line is the seam's click or stutter; a waveform that
  runs straight through is a clean loop.
- Seam turns off on its own if the loop is turned off or the selection is
  cleared.

### 6. Undo, saving and the downbeat

- A drag on an encoder is one change: the selection (or downbeat) is saved
  as now (the page's existing `final: false` / `final: true` events), with
  `final: true` on the drag's end, so one drag is one undo step, as a grip
  drag is today. A snap or a step is one change each; held keys coalesce as
  held nudges do now.
- Moving bar 1 moves the whole grid, as dragging it does now; In and Out
  don't move with it.

### Layout

The editor bar must fit a 390 px-wide phone in portrait without hiding the
waveform:

```
┌──────────────────────────────────────────┐
│ ZOOM     ◀─────────── drag ───────────▶   │  encoder pad, ~40 px tall
│ POSITION ◀─────────── drag ───────────▶   │  encoder pad, ~40 px tall
│ [Attack] [Zero] [Grid]  ◂ 1 ms ▸  ▶  Seam  Done │
└──────────────────────────────────────────┘
```

It takes the place of the toolbar rows below the waveform while a boundary is
being edited, and gives them back on Done. It uses the page's existing
tokens and button classes only, in one self-contained block
(`#boundary-editor`), so the reel-to-reel restyle can dress it (below).

### Fits the reel-to-reel restyle

The take page is being restyled as a reel-to-reel deck
(`docs/superpowers/plans/2026-10-04-reel-to-reel.md`, on branch
`claude/reel-1-tokens`; its PR 6 redraws the take page with "trace on tape",
grease-pencil IN/OUT and an amber-LCD edit strip). The editor is built to that
plan's rules from the start, so PR 6 restyles it rather than rebuilds it:

- **Windows:** the waveform, both seam halves included, is a black window in
  both themes; anything drawn on it uses `--well-ink`, `--well-dim` and
  `--well-rule`, never `--ink`. The selected boundary's line and label use the
  existing selection colour (`--sel`); bar 1 keeps its downbeat colour.
- **Keys:** Attack, Zero, Grid, the steps, ▶ and Seam are keys: raised, sitting
  low when pressed, and Seam latches with a yellow LED (yellow is loop, flags,
  snap). Orange stays the page's one main action; nothing in the editor is
  orange.
- **The readout** is a single element (`#boundary-readout`) that PR 6 can
  dress as the amber LCD.
- **Encoder pads** are recessed controls (wells), not keys.
- **Rules carried over:** no new hex literals in JS (token fallbacks only);
  hover styles only inside `@media (hover: hover)`; every control shows the
  `:focus-visible` ring; `prefers-reduced-motion` turns off any slide-in of the
  editor bar; fonts are the vendored ones.
- **Order:** this work starts after reel PR 1 (tokens, depth, window inks)
  merges, because both touch `lib/wave/view.js`, and builds on its tokens.

## Not in this

- **The grid on the beat** (beats found from the audio, bar 1 guessed from
  the accent, *Bar 1 here*) — phase 2, its own spec. It needs the Pi.
- **Hardware encoders** — mapping two MIDI knobs (the Bento, the Sidekick's
  strips) to ZOOM and POSITION. The page's design leaves room for it: the
  encoders take relative deltas, which a CC encoder sends too.
- **Editing boundaries on the tape page.** The tape's clips align by bar and
  by nudge; this editor is for takes, where loops are made.

## Checks

- [node] The pure parts: zooming about a point keeps it centred and clamps to
  the page's range; position steps scale with the zoom (half the visible span
  per pad width) and round to frames; the step is 1 sample past 1 px per
  sample, else 1 ms; Attack finds a hit's start in synthetic audio (a click
  after silence, a kick over a held bass) within 1 ms and finds nothing in
  silence or a sine; Zero finds the nearest crossing and nothing in a DC
  window; Grid finds the nearest line of each snap; In can't pass Out.
- [demo] Open a take, tap In's readout → the view centres on In, the editor
  bar shows. Zoom out with ZOOM, POSITION the line near a kick, zoom in, then
  Attack → In sits on the kick's start; the readout says *+0.0 ms from* a
  beat (the demo is on its grid). Zero → In moves by under 5 ms. Done → the
  toolbar returns.
- [demo] With an 8-bar selection and the loop on, Seam → the end and start
  meet at the centre; select the Out half and step it → only Out moves.
- [demo] At 390 × 844, nothing in the editor bar is cut off, and the waveform
  keeps at least half the screen.
- [demo] One encoder drag is one undo step.
- [rig] On a stylophone take with a part played over it, the owner sets a
  loop's In on the first beat's hit and its Out on the last bar line, checks
  the seam, sends it to tape, and hears no stutter.
