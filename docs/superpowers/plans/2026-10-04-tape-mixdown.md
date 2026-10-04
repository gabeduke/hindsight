# Mixdown and export — step 7b of the editing-model roadmap

**Spec:** [tape](../specs/2026-10-03-tape-design.md), *Mixdown*, the API's
`mixdown` and `export`, `TAPE_MIXDOWN_TAIL_S`. **Checks:**
[guide](../../guide.md) §8.6. **Branch:** `tape-mixdown`, stacked on
`tape-edit`. The last part of step 7 (tape phase 2).

## Decisions taken while building

- **A mixdown is a transport mode, not an edit.** A "once" action plays a
  span from its start to its end with the loop ignored and stops; the
  tape's own loop setting is left alone. The click is silent through it,
  and its edges get the 3 ms declick, since the pass can start and stop
  mid-clip.
- **The loop, or the whole tape.** The spec says "set In and Out around the
  song", but the ruler grows the loop a bar at a time, so the menu also
  offers the whole tape, from bar 1 to the end of the last clip.
- **It answers at once.** A mixdown takes as long as the music; the page
  follows it through `live.mixdown` and offers to open the take.
- **■ cancels it,** through the pass and the tail. Anything that moves the
  transport then breaks it, and nothing is saved. Afterwards the playhead is
  back where the pass started.
- **The take is the dashcam's.** The ring span goes through the saver's
  `SaveRange`, so it gets peaks, a preview and MIDI as any take does; then
  its sidecar gets the tape's name, tempo and its first bar line. Its `.mid`
  is what the MIDI devices played, as for any take; a `.mid` carrying the
  tape's own tempo waits for phase 3, when the tape leads the clock.
- **Stems are offline renders of the loaded tape only:** its audio is
  already in memory, and a Pi shouldn't load another tape's to export it.
  Each stem is the track at its level and pan, mutes and solos ignored,
  32-bit float so a track's gain can't clip it, all from bar 1 to the same
  end, so they drop into a DAW lined up.
  One export renders at a time.
- **No mixed stereo file in the export.** The tape's own sum would lack the
  Sidekick's FX; the mixdown is the real mix.

## After the independent review

Fixed:
- A whole-tape mixdown clicked at Out: the pass rendered the looping mix,
  whose seam logic joins Out to In. It now renders a loop-off mix built
  beside it.
- A late render left a silent gap in a take that still said *done*. The
  transport now notes any late render inside the pass, and nothing is saved.
- `TAPE_LATENCY_MS` shifted the mixdown's window.
- When the server refused an export, the page navigated to raw JSON. It
  now asks with `HEAD` first, then downloads.
- A stalled download held the export slot. It now has a write deadline,
  moved on each block.
- ■ during the tail did nothing. There's now a `tail` state, and a stop or
  play then cancels.
- A load while the pass was still queued left the mixdown hanging.
- The slip check ran before the tail was in.
- A punch could start alongside a mixdown. The two now take the same locks
  in the same order.
- Also:
  - the disk is checked before the music, not after;
  - `downbeat_frame` is the span's first bar line, and none for a clamped
    save;
  - the tail setting can be 0 and is capped at 30 s;
  - the pass ends on its last frame rather than a block later;
  - a bars catch that crossed Out on a straight pass isn't split as if it
    wrapped;
  - stems are 32-bit float, so a track's gain can't clip them, and the zip
    names any unreadable audio;
  - a panic while preparing an export frees the slot.

## Tasks

1. Transport: the "once" action, its status, and breaking it; the click-free
   render with edge fades. Tests.
2. `mixdown.go`: start, follow, map through Δ, wait for the tail, save,
   label. Tests with a fake saver.
3. `export.go`: stems and a tempo map in a zip. Tests.
4. API: `POST /api/tapes/mixdown`, `GET /api/tapes/export`;
   `TAPE_MIXDOWN_TAIL_S`; the saver handed to the engine. Tests.
5. Page: the tape menu's *Mix down the loop*, *Mix down the whole tape* and
   *Export stems*; the readout while it plays; the toasts. Tips.
6. Docs.
