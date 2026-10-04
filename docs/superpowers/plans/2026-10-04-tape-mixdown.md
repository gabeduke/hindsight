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
- **■ cancels it.** Anything that moves the transport during the pass breaks
  it, and nothing is saved.
- **The take is the dashcam's.** The ring span goes through the saver's
  `SaveRange`, so it gets peaks, a preview and MIDI as any take does; then
  its sidecar gets the tape's name, tempo and bar 1 at frame 0. Its `.mid`
  is what the MIDI devices played, as for any take; a `.mid` carrying the
  tape's own tempo waits for phase 3, when the tape leads the clock.
- **Stems are offline renders of the loaded tape only:** its audio is
  already in memory, and a Pi shouldn't load another tape's to export it.
  Each stem is the track at its level and pan, mutes and solos ignored,
  24-bit, all from bar 1 to the same end, so they drop into a DAW lined up.
  One export renders at a time.
- **No mixed stereo file in the export.** The tape's own sum would lack the
  Sidekick's FX; the mixdown is the real mix.

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
