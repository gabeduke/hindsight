# The tape engine — step 6a of the editing-model roadmap

**Spec:** [tape](../specs/2026-10-03-tape-design.md), phase 1;
[editing model](../specs/2026-10-03-editing-model-design.md#roadmap), step 6.
**Checks:** [guide](../../guide.md) §8.2–8.4. **Branch:** `tape-engine`,
stacked on `ribbon`.

Step 6 is split in two so each part can be reviewed and tried on its own:

- **6a (this branch):** everything that runs without the Sidekick's output.
  The model with undo, the store and pool, the renderer, the transport and
  player, catching by pass and by bars, *Send to tape*, the API, and the tape
  page. It plays in the demo through a loopback sink that knows its delta
  exactly.
- **6b (next):** the PortAudio output on the EP-136 with the shared stream
  lifecycle, the aligner (estimated, then locked), free loops from taps,
  punch and arm with the count-in and click, tiling a short catch, *replace*
  and pan on the page, the ruler's bar selection, the clipboard with *Copy*
  on takes and the ribbon.

## Decisions taken while building

- **Frames are the truth.** The grid stores the first loop's length in
  frames and its bar count; tempo is derived. Nothing is stretched, so the
  tempo is fixed once a tape has audio, and *bars* only relabels.
- **Undo is whole versions of the state,** 100 deep, saved with the tape,
  shared by every device. An edit of the same kind within 2 s is one step.
  Name and click aren't undoable.
- **The pool is write-once.** Catches and drops are written once with 10 ms
  either side and their peaks; clips point into them. Clones copy only
  `tape.json`. Deleting a tape cleans up in the background, keeping anything
  any tape's state or history uses and anything under a minute old.
- **Read into memory, never mapped,** so a bumped disk can't fault the
  process that holds the ring.
- **Edges:** a 5 ms equal-power crossfade where audio meets audio (including
  a clip looping into itself at the seam), 3 ms declick next to silence.
- **The player never blocks.** About 100 ms rendered ahead; a late block is
  silence, counted, and the transport counts on, so tape time stays device
  time.
- **History is kept** (position map, cycle log) because catching reads it: a
  catch lands where the tape was when it was played.
- **Catching onto audio layers;** `replace` is in the API but not yet on the
  page.
- **One tape is loaded,** and it's remembered across restarts. Every route
  that changes it names it, so a stale page can't edit the wrong one.
- **The page polls** state five times a second instead of a WebSocket: the
  Pi holds all state, and several devices stay in step with no extra
  protocol.
- **On hardware the engine runs with no sink** until 6b: tapes can be made
  from takes and edited, nothing plays, and catches are refused as not lined
  up.

## Tasks

1. `internal/tape`: model and undo, store and pool, tests.
2. Renderer with crossfades and declicks, tests.
3. Transport, player and engine; demo loopback sink (`audio.Sink`,
   `KnownDelta`); catches and drops; tests with a loopback test sink.
4. Config (`TAPE*`), wiring in `cmd/hindsight`.
5. API: fourteen routes under `/api/tapes`, tests.
6. Web: `tape.html`, `lib/tape/geometry.js` (tested), `lib/tape/page.js`;
   *Send to tape* on the take page; the Tape chip; tips.
7. Docs: guide §8 as built, api.md, architecture.md, configuration.md.
8. Verify in Playwright against `--demo`.
