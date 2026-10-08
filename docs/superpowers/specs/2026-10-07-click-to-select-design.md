# Click to select

**Date:** 2026-10-07 · **Status:** asked for by Gabe on 2026-10-07, after
the [DAW-style editing plan](2026-10-07-daw-editing-plan.md) shipped ·
**Repo:** `hindsight`

## Why

A tap on a clip opened its sheet. That's a fair way to learn what a clip
can do, but in the way once you know: every edit started with a dialog to
close, and the trim grips only showed after closing it. Gabe asked for DAW
behaviour instead: click to select, then act from a bar or with keys.

## What

### A click selects

- **A tap or click on a clip selects it**, with its trim grips and ⟳ corner,
  and nothing pops up. A tap on an empty part of a lane lets go and puts
  the playhead there, as before.
- **Shift, ⌘ or Ctrl with a click** adds a clip to the selection or takes it
  off. On a touch screen, the bar's **Select more** makes plain taps do that.
- **A double-click, Enter or Details…** opens the one selected clip's sheet.
  Its *Select more* key goes: the bar has it.
- Holding and dragging a selected clip still moves the selection
  (2026-10-07-select-clips-design.md); trim and ⟳ are as they were.

### The clip bar

What was the several-clips bar (`#multi-bar`) is now the bar for any
selection. It sits over the transport and is a `toolbar`.

- **It says what's selected:** *Track 2 · 10.0 s · take* for one clip,
  *3 clips* for more.
- **Its keys:** Split, Copy, Duplicate, Reverse, Keep, Move here, Details…,
  Select more, Remove, Done. Each is one undo.
  - Split, Keep and Details… are one clip's, and hidden for several.
  - Split is lit only while the playhead is inside the clip. It cuts on the
    clip's own track, whichever track is selected.
  - Each key names its key in `aria-keyshortcuts` and its tip.
- **On a phone** it floats just above the mini player, not down the page
  under the drawers. Its keys scroll sideways in one row. A lane the bar
  would cover scrolls up into view when the clip is picked. On its side, a
  short phone gets a one-row bar, so the lanes keep some height.

### Keys

| Key | Does |
|---|---|
| Delete / Backspace | Removes the selection |
| ⌘C / Ctrl+C | Copies it |
| ⌘D / Ctrl+D | Duplicates it, and selects the copy |
| ⌘A / Ctrl+A | Selects every clip on the tape |
| S | Splits at the playhead (as before) |
| Enter | Opens the one clip's sheet |
| ← → | Move the selection a step of **Slide snaps to** (a bar, beat or eighth; 0.1 s without a grid or with Off) |
| Shift + ← → | A bar (1 s without a grid) |
| Escape | Lets go, once nothing nearer (a menu, a preview, a drawer) is open |

The arrows only move clips from the page: not from a focused key, field or
slider, not while a clip is aligned, and not on a held key's repeats (one
edit per press). Without a selection they're the page's as before.

## How

- `lib/tape/selection.js` is the selection as data: `none`, `only`, `all`,
  `toggle` (with `adding`, so Select more keeps a selection of one as a
  multi), `ids` and `keep` (drops clips no longer on the tape).
- `page.js` keeps `state.picked` and `state.multi` as before, set through
  `setSel`. `renderClipBar` replaces `renderMulti`.
- `geometry.js` `keyStep(grid, snap, sampleRate, big)` is the arrows' step.

## Not in this step

- Sections still open their sheet on a second tap. They select the loop,
  not clips.
- A sidebar or inspector. On the 1024 bench a sidebar costs lane width the
  bar doesn't; the sheet stays as Details….
- Up and down moving clips between tracks. They pick the track, as before;
  dragging moves clips between tracks.

## Tests

- **Node:**
  - `selection.test.js`: none, only, all, toggle with and without adding,
    keep.
  - `geometry.test.js`: `keyStep` with each snap, Shift, and no grid.
- **Smoke** (`smoke-tape.mjs`):
  - a tap selects with the bar naming it and no sheet;
  - a double-click and Enter open the sheet;
  - → moves a bar, and ↶ restores it;
  - Escape lets go;
  - trim, slide, ⟳ and several clips go through the new selection;
  - ⌘A selects every clip;
  - fades open from a double-click;
  - Keep is the bar's;
  - at 390×844 and 667×375 the bar sits on the player and the tapped lane
    isn't under it.
- **Guide:**
  - §8.2 *Selecting clips* replaces *Several clips at once*;
  - §9 rows for the bar's keys replace `clip-select` and the old multi
    rows;
  - the [demo] checks follow.
- `sw.js` goes to v52 and caches `selection.js`.
