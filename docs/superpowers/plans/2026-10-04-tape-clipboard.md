# The clipboard, Drop and the ruler — step 6d of the editing-model roadmap

**Spec:** [editing model](../specs/2026-10-03-editing-model-design.md),
"The clipboard"; [tape](../specs/2026-10-03-tape-design.md), *Drop*,
placement and tiling, *replace*, the phone page's ruler. **Checks:**
[guide](../../guide.md) §4, §6, §8.4. **Branch:** `tape-clipboard`, stacked
on `tape-punch`. The last part of step 6.

## Decisions taken while building

- **The clipboard is a file,** `clipboard.json`, read on every use: two
  devices share it, it survives a restart, and the clean-up reads it as a
  root without the engine telling it.
- **Copy from the ribbon copies MAIN,** what the ribbon draws; the API takes
  any `TAPE_SOURCES` name.
- **Send to tape is now Copy then Drop,** as the spec says, so the clipboard
  holds it for more drops. The old `drop {take, from, to}` form stays in the
  API for scripts.
- **Drop replaces** (the OP-1's rule), on every layer of the span, and moves
  the playhead only while stopped -- moving it while playing would jump the
  music.
- **Tile is a verb, not a flag:** *Repeat to the loop's end* lays real copies
  (references, no audio copied) wherever the clip's layer is free, so they
  can be edited one by one.
- **The ruler selects whole bars** and sets the loop from them. The lanes
  show the loop and a bar either side, so it can grow a bar at a time; there
  is no zoom yet (step 7's gestures).
- **A track's sheet** opens on a second tap of its number: name, level, pan.
- **The header reads the loop's bars,** not the first loop's, once the ruler
  has changed it.

## After the independent review

Fixed: copies had no length cap and the audition loaded the whole copy
through the engine's pool (now a copy is at most a track, and the audition
is its first minute, read straight from the files and served with ranges
and HEAD for phones); Replace cleared only layer 0 (now every layer under
it); a vertical swipe starting on the ruler located or looped (now it
scrolls); a corrupt clipboard.json blocked every clean-up and couldn't be
cleared from the page; the ribbon's Copy failed where Save clamps; a drop's
toast could fail after a successful drop; two quick drops could land in one
place (the playhead's move is now waited for), and a drop during a count-in
moved its start. Also: tile applies a gain or nudge sent with it, and says
when the loop is off; the last tape's tempo is read before the edit.

## Tasks

1. `clipboard.go`: the file, Copy from a take or the ring, Drop, the
   audition; the clean-up's root. Tests.
2. API: `/api/clipboard` (GET, audio, POST, DELETE), `drop {track}`, the
   `tile` clip patch, `replace` on punches. Tests.
3. Page: the clipboard row, Layer/Replace, the ruler, the track sheet, the
   clip sheet's Repeat; Copy on the take page and the ribbon; Send to tape
   as Copy + Drop; tips.
4. Docs.
