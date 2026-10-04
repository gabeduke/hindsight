# Tempo from the recording

**Date:** 2026-10-04 · **Status:** design approved by the owner 2026-10-04 ·
**Repo:** `hindsight`

## Why

The first real tape loop stuttered at every wrap. The take was a stylophone
beat at about 125.25 BPM, set on a rotary dial; the tape's tempo was the
empty-tape form's default, 90 BPM. A loop of 90-BPM bars held 89.04 of the
stylophone's eighth-note pulses, so the pulse carried through the seam but
the pattern jumped about nine pulses at each wrap. Remade at the right tempo,
it worked, and the owner's workflow -- loop four bars, overdub, release the
loop and jam on -- did exactly what they wanted.

Nothing in the path from a take to a tape carried the take's tempo across:

1. **The take's BPM is the MIDI clock's.** It read 125.32 against a measured
   125.25 -- 15 ms over eight bars, an audible flam at the seam. And the
   clock can be wrong outright: `meta.go` records one reading 129.87 against
   a project set to 92.
2. **The take page's Snap is off by default**, so a selection isn't whole
   bars unless the owner turns it on.
3. **A drop onto an empty tape guesses the bar count** from the clipboard's
   length, hinted by the *previous tape's* tempo, and only from 1, 2, 4, 8,
   16 or 32 bars. A six-bar selection gets a wrong tempo.
4. **The empty-tape form starts at 90 BPM**, whatever was just played.

The tape already does the hard part. Its grid is a loop length in frames, not
a rounded BPM, and with Snap on, the take page puts In and Out on bar lines
from the take's BPM and downbeat. A selection of exactly eight bars becomes a
tape whose grid is exactly those eight bars. So the fix is to make the take's
tempo right, and let the tape inherit it.

## What changes

### 1. Measuring a tempo: `internal/tempo`

A new pure-Go package with no cgo and no imports from the rest of the app:

```go
// Measure finds the pulse in mono samples at sampleRate. hint is a tempo
// to prefer between readings of the same pulse (half or double time), or
// 0 for none.
func Measure(samples []float32, sampleRate int, hint float64) (Result, bool)

type Result struct {
    BPM        float64 // beats per minute, quarter notes
    Confidence float64 // 0..1: how strongly the audio repeats at that period
}
```

- **Onset envelope.** RMS energy in short hops, then the rise in log energy
  from hop to hop, half-wave rectified, mean removed.
- **Coarse period.** Autocorrelate the envelope over beat periods for
  40–240 BPM, in tenths of a 10 ms hop (a beat is rarely a whole number of
  hops). Score each by its autocorrelation at 1, 2, 3 and 4 beats, weighted
  towards 120 BPM so a period three beats long doesn't outscore the beat.
- **Octave choice.** A hint within 8% of the best reading, or of its half
  or double time, picks that; else a strong peak within 8% of the hint
  (at least 0.8 of the best) wins; else the best's octave in 80–160 BPM.
  A hint far from every reading is ignored: the clock is a hint, never a
  fact.
- **Refine.** Find the autocorrelation peak near the longest multiple of the
  beat that fits in half the window, at a 1 ms hop, at 8, 16, 32… beats,
  each peak's centre of mass above half its height, fitted by least squares,
  and divide by the number of beats. Over a minute of audio this is precise
  to well under 0.01 BPM, the precision the take's two decimals keep.
- **Confidence** is the normalised autocorrelation at the refined lag. Below
  a threshold (fixed by the tests), `Measure` answers false: free time, a
  drone or silence gives no tempo rather than a wrong one.

Tests use synthetic audio only: click and noise-burst patterns at off-grid
tempos (125.25, 83.47, 172.4), with timing jitter and noise, with a right
hint, a wrong hint (92 against 125), a half-time hint, no hint; and noise and
a sine with no beat, which must give no tempo.

### 2. Measuring every take

After a save writes its WAV and stamps the clock's BPM (as now), a background
job measures the tempo from up to two minutes from the middle of the take:

- **Where:** the saver's background work (`afterSave`, which ring saves and
  ribbon saves both reach), and the phone recording's background step in
  `api/phone.go`. Mixdowns already carry the tape's tempo and are left alone.
- **Never in the way:** it runs with the preview encode, under the same
  recover rule as `stampTempo`. A failure or panic is logged and costs only
  the measurement.
- **Never over the owner:** it writes the BPM only if the BPM is still what
  the save stamped (compare-and-set inside `UpdateMeta`). An edit made in
  those seconds wins.
- **Hint:** the clock's BPM if the save stamped one; none for a phone take.
- **Kept as:** the BPM to two decimals, as now, plus a new optional sidecar
  field, `tempo_from`: `clock` (stamped from MIDI), `audio` (measured), or
  `you` (edited on the take page, which sets it). Additive, so no
  `MetaVersion` bump. Takes without it read as before.
- **Shown:** the take page's tempo reads, for example, *125.25 bpm ·
  measured*, or *· clock*. Nothing for `you` or for a take that predates
  this.

Takes saved before this ships aren't re-measured. Editing the BPM covers them.

### 3. A take onto a tape

- **Send to tape** moves out of the take page's More menu into the toolbar,
  beside Save as take and Share, when the tape is on. (One button: the
  restyle in progress rearranges this page, and a smaller change merges
  more easily.) Copy stays in More.
- **Snap defaults to Bar** on a take with a BPM, unless the owner has chosen
  a snap before (the stored `wave.snap` preference wins).
- **The clipboard carries a tempo.** `Clipboard` gains `BPM float64`
  (`bpm,omitempty`), set from the take's sidecar when a take is copied.
  Copies from the ring and the tape leave it 0.
- **A drop onto an empty tape** with a clipboard BPM counts bars as
  `round(frames / barFrames(bpm))`. If that is 1–64 bars and the frames are
  within 1% of a bar of that many whole bars, the grid is the clipboard's frames as that many bars, so the
  loop is exactly what was selected. Otherwise it falls back to today's
  guess, hinted by the clipboard's BPM instead of the last tape's.
  `DropTake`, the phone recording's path, does the same with the take's BPM
  when no bar count is given.

### 4. The empty-tape form

Its BPM starts at, in order: the clipboard's BPM, the newest take's BPM, the
last tape's, 90. The tape state's answer gains `suggest_bpm` for an empty
tape with no grid. The API layer works it out, since only it knows both the
takes and the tape.

## Not in this

- **Finding the downbeat.** Bar 1 is where the save started (bar-snapped
  from the clock when there is one) or where the owner drags it. With the
  loop's length right, the seam is clean wherever it starts.
- **Re-measuring old takes**, or a "measure again" button.
- **Stretch.** It only matters when takes at different tempos are layered.

## Checks

- [unit] `internal/tempo` on the synthetic cases above.
- [unit] Save → `tempo_from: audio` and the measured BPM; an edit between
  the stamp and the measurement survives; a beatless take keeps the clock's
  BPM and `tempo_from: clock`.
- [unit] A clipboard from a take with a BPM carries it; a drop of six bars at
  125.25 onto an empty tape makes a six-bar grid of exactly the clipboard's
  frames; a drop with no BPM behaves as today.
- [unit] `suggest_bpm` follows the order above.
- [node] Snap's default with and without a stored preference.
- [demo] The demo's 96 BPM loop: capture 30 s, open it → *96.00 bpm ·
  measured* (±0.02). Select eight bars with Snap on, Send to tape on an
  empty tape → *96.0 BPM · 8 bars*, and the seam is clean.
- [rig] A stylophone take → its measured BPM within 0.05 of the period the
  owner hears; loop eight bars of it with no stutter at the wrap.
- [offline] Measure the stylophone take from 2026-10-04 (in the Pi's tape
  pool as `copy_2026-10-04_095937.wav`; too big for the repo, so run by hand)
  → 125.1–125.4, against the clock's 125.32. By hand, its pattern repeats
  every 3.833 s, eight beats, which is 125.2 BPM.
