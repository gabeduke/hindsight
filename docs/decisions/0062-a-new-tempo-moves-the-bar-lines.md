# 0062. A new tempo moves the bar lines, not the audio

**Date:** 2026-10-30. Gabe, after trying a tape: *"can't set the tempo
anywhere."* The options were mapped in `docs/plan/tempo.md`; Gabe took its
recommendations (*"merge anything, we roll forward"*).

## Decision

A tape's tempo can be set at any time, with audio down, as a **re-grid**:
the grid gets a new bar length, and every clip, the loop and the cycle log
keep their frames. Nothing is stretched or resampled.

## How

- **The bar count stays, the frames follow** (`Grid.Retempo`; `PATCH
  /api/tapes {tempo:{bpm}}` with no bars). Bar 1 stays at frame 0. A tempo
  and bars in one PATCH are refused: they would say two things at once.
- **The loop keeps its frames.** After a re-grid it need not be a whole
  number of bars, and the click goes out of phase at the wrap where the
  tempo disagrees with what was played: that tells you. The alternative,
  Out moving to keep the bar count, would cut the audio off or pad it.
- **Refused during a punch** (409, *waits for recording*), since a punch
  counts bars. BPM 20 to 400.
- **One step of undo**, kind `tempo`: nudges, taps and a typed tempo within
  2 s coalesce.
- **The tempo key on the bar's display opens one panel**: the BPM to type
  (↑ ↓ a tenth, Shift a whole BPM), −1 and +1, TAP (four taps or more, the
  mean of the last eight), and the bar counts below.
- **The click and the clock out follow at once**: a new grid while playing
  is a jump (Stop, then the followers start again on it).

## Why

The tape's rule is that audio is never touched. Varispeed (the tape plays
faster, pitch with it) needs a resampler on every track's render path and
fractional positions everywhere Catch reads; stretch needs a stretcher the
repo hasn't got, minutes of a Pi's CPU and a pool that grows. A re-grid is
one value every reader already takes fresh, and it is what a DAW does to
audio that isn't warped. It covers the common case: the first loop's tempo
was a guess, or the grid is a guide to play to next.

## What it rules out

Changing the audio to fit a tempo, in the Studio. Varispeed may come later
as its own feature (a nudge that bends the pitch, or locking to a clock that
drifts); stretch only ever offline, for a bounce.

## See

`docs/architecture/tape.md` (*The model*), `docs/architecture/bar.md` (the
tempo's panel), J1.20 in `docs/flows.md`. What is still open (one tempo on
screen, what `follow` means) is `docs/plan/tempo.md`.
