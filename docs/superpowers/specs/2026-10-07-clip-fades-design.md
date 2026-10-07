# Clip fades (A5)

**Date:** 2026-10-07 · **Status:** step A5 of the
[DAW-style editing plan](2026-10-07-daw-editing-plan.md), approved by Gabe on
2026-10-07 · **Repo:** `hindsight`

## Why

A clip's ends only ever get the 3 ms declick, or the 5 ms crossfade where
they meet audio. A part can't swell in, or a tail ring out and die away, the
way a DAW's fade handles let you.

## What

- **Model:** `Clip.FadeIn` and `Clip.FadeOut`, in frames, default 0
  (`fade_in`, `fade_out` in JSON, left out when 0).
  - `Clip.fades()` clamps them as they play. Neither is longer than the
    clip. Two that would overlap are shortened alike, to share the clip
    (`clipFades` in `geometry.js` mirrors it).
- **Render:** an equal-power curve in `Mix.sample`. The gain rises on a sine
  over the fade in and falls on one over the fade out (`fadeGain`), so a fade
  over a beat sounds even.
  - **Underneath:** the declick and the crossfade still apply.
  - **A clip that fades out** has faded by its end. So where it meets the
    next clip, the crossfade takes nothing of its overhang.
  - **Shared WAVs** (`ClipWAV`) apply the fades too.
- **Through the edits:**

  | Edit | Fades |
  |---|---|
  | Split, a cut by a replace or lift (`cutRange`), the loop seam's split (`placeWrapped`) | Each piece keeps the fade of the end it has, and a new cut has none |
  | A window for lift, copy or ×2 (`window`) | An edge it cuts through has none |
  | Join | Keeps the outer two |
  | Reverse | Swaps them: backwards, its end is its start |
  | Trim, slide, move, repeat, duplicate | Keep them as they are, as lengths from the edges |
- **Edit:** `PATCH /api/tapes {clip: {id, fade_in?, fade_out?}}`, 0 to the
  clip's length, as one undo step.
- **UI:** the clip sheet gets *Fade in* and *Fade out* rows of six keys:
  *off · 10 ms · ⅛ beat · ¼ beat · 1 beat · 1 bar* (`fadeOptions`).
  - The beat and bar keys need a tempo; a key longer than the clip is greyed
    out.
  - The clip's length is lit. One set another way, by a trim say, lights
    none.
  - The block draws each fade as a shaded corner under an equal-power curve.
  - Handles on the block's top corners were left out, as the plan says: they
    would fight the ⟳ corner on a phone.

The plan's *"⅛ · ¼ beat"* is read as an eighth and a quarter of a beat. A
quarter of a beat is 156 ms at 96 BPM, and an eighth 78 ms: two short lengths
between 10 ms and a whole beat.

## Tests

- **Go:**
  - the curve: silence at the first frame, −3 dB halfway, full after;
  - the same falling, and the last frame silent;
  - fades longer than the clip share it;
  - split keeps the outer fades, join restores them, reverse swaps them, a
    lift's middle has none and the ends keep theirs;
  - a shared WAV is faded;
  - the API's fades, and fades refused below 0 and past the clip.
- **Node:** `fadeOptions` (with and without a tempo), `fadeOption`,
  `clipFades`.
- **Smoke:** Fade in → 1 beat sets a beat's frames and lights the key; off
  takes it off.
- **Guide:** §8.5's Fade row and four [demo] checks; a `TIPS` and §9 row.
