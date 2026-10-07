# *Play all*, and flags that step on to the next take (C2)

**Date:** 2026-10-07 · **Status:** step C2 of the
[DAW-style editing plan](2026-10-07-daw-editing-plan.md), approved by Gabe on
2026-10-07 · **Repo:** `hindsight`

## Why

After a session there are a dozen takes to listen back to. A recorder like
the Zoom R20 plays them one after another. On Hindsight each one has to be
picked and played by hand, and then you wait for it to end.

The flags have the same gap. **◂⚑ ⚑▸** stop at the take's first or last
flag. To go through every flag of the evening, you go back to the list for
each take.

## What

### *Play all*, on the takes page

- **▶ Play all**, beside **Select** in the header:
  - It plays the takes shown, in the order shown, one after another. A
    filter, a tag or a search first makes it play just those. Folded takes
    (cuts, earlier mixes) aren't played; their spine is.
  - It plays each take from its selection's In to its Out, or the whole take
    without one. So it plays the part that was kept, and the warm-up a
    selection leaves out is skipped.
  - It starts at the picked take, or at the first with none picked.
  - It plays through the bar's take source (the row's own player). Each take
    is picked as it plays, so the bar, the cassette pane and the spine
    follow it. Its spine is ringed in the playing green and scrolled into
    view.
- **It stops moving on** in any of these cases:
  - at the end of the list;
  - on **■ Stop** (the same key, which also pauses);
  - on Pause, in the bar or on the spine;
  - on ⏏;
  - on **Loop**, which stays on that take and keeps it playing;
  - when a take is picked by hand.
- **Polls** wait while it's between two takes, as they already wait while a
  take plays.
- **The key** is off in select mode, and Select stops Play all.
- **Pure parts** in `lib/playall.js`, tested: `spanOf` (the part played),
  `firstOf`, `nextOf` and `atEnd`.

### ◂⚑ ⚑▸ on the take page

- **Past the first or last flag,** they go on to the take before or after,
  in the list's order (the order ◂ ▸ use):
  - **◂⚑** lands on that take's last flag;
  - **⚑▸** lands on its first;
  - a take with no flags opens at its start.

  So pressing the same key walks every flag of a run of takes.
- **The take opens stopped,** and ▶ plays on. A browser won't let a page
  that hasn't been tapped start sound, and the take page's clock would wait
  for a tap.
- `landFlag` in `lib/wave/geometry.js`, tested. The landing travels in
  `sessionStorage` (`hindsight.land`), read once.

## Not in this step

- Play all on the Capture page's shelf: it's for listening back, which is
  the takes page's job.
- Crossfades between takes. Play all is for listening back, not a mix.

## Tests

- **Node:**
  - `playall.test.js`: the span played, where it starts, the next take, the
    end;
  - `geometry.test.js`: `landFlag`.
- **Smoke** (`smoke-takes.mjs`):
  1. ▶ Play all plays the picked take and then the next, each ringed.
  2. The key says ■ Stop.
  3. A take picked by hand stops it.
  4. ⚑▸ past the last flag opens the next take at its first flag.
  5. ◂⚑ past the first flag goes back to the take before.
- **Guide:**
  - §3.1: Play all, and two [demo] checks;
  - §4: the flags;
  - two `TIPS` and §9 rows;
  - `sw.js` goes to v48, with `/lib/playall.js` in `SHELL`.
