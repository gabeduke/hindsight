# Normalize on share (C5)

**Date:** 2026-10-07 · **Status:** step C5 of the
[DAW-style editing plan](2026-10-07-daw-editing-plan.md), approved by Gabe on
2026-10-07 · **Repo:** `hindsight`

## Why

Hindsight records with headroom, so a quiet riff shared to a phone plays
back quiet. A recorder like the Zoom has *Normalize*: bring the loudest
moment up to just under full scale. The way to do that today is a DAW.

## What

### On the Pi

- **`audio.LevelOf(wav, saveChannels, from, to)`** reads a span's peak on
  the pair a share plays: the configured pair of a take with more than two
  channels, otherwise its own.
  - It reads the peak from the take's peaks pyramid, which is built at save,
    so no audio is read. A take without a pyramid falls back to
    `RangePeaks` reading the WAV.
  - It answers `Level{peak_db, gain_db}`: the gain that brings the peak to
    **−1 dBFS** (`NormalizePeakDB`), leaving room for the MP3 encoder to
    overshoot.
  - The gain is capped at **+24 dB** (`MaxNormalizeGainDB`), so a
    near-silent take's hiss isn't shared at full volume.
  - Silence gets no gain. A peak already over −1 dBFS comes down a little.
- **`GET /api/render?…&normalize=1`** applies the gain with ffmpeg's
  `volume=`, last in the filter chain (`RenderArgs`' `gainDB`).
  - It says the gain in `X-Hindsight-Gain-Db`.
  - A span whose level can't be read is shared as it is.
- **`GET /api/level?file=&from=&to=`** answers the same Level, for the
  page.

### On the take page

- **Level**, a toggle in the toolbar beside Practice speed, remembered per
  device (`wave.level`).
  - **On:** it reads the selection's level (or the whole take's) and says
    the gain: *Level +6.2 dB*. The number follows the selection as it
    changes.
  - **The take plays here at that gain** (`Clock.setGain`). The preview's
    `<audio>` can't go past full volume, so Level routes it through the
    AudioContext with a GainNode. The slice engine's loop goes through the
    same node. Once routed it stays routed, at 0 dB when Level is off;
    nothing changes until Level is first turned on.
  - **Share** asks for `normalize=1` and toasts *Levelled +6.2 dB*. What's
    heard is what's shared.
- **Off:** everything is as recorded. The DAW bundle is always as recorded.

The plan put the toggle in "the share sheet", with a separate *Level* toggle
for previews. Share has no sheet of its own here (it hands the MP3 straight
to the phone's), so one toggle does both. That's also what makes the
preview "match" the share: they can't disagree.

## Not in this step

- Level on the takes list's cassettes. Each is a plain `<audio>`, and
  routing every row through Web Audio isn't worth it to hear a list louder.
- Loudness (LUFS) normalization. Peak is what a recorder's Normalize does,
  and it's what a pyramid can answer without reading audio.

## Tests

- **Go:**
  - `level_test.go`:
    - the gain for a range of peaks, the cap and silence;
    - `LevelOf` from the WAV and from the pyramid, which agree;
    - `RenderArgs` puts the volume last, and none without a gain.
  - `api_test.go`: a −12 dBFS tone has Level −12/+11; the bad requests; a
    normalized render's header (with ffmpeg), and none without.
- **Node:** `gainText` in `share.test.js`.
- **Smoke** (`smoke-takes.mjs`):
  1. Level says its gain;
  2. the take plays with it on;
  3. Share asks for `normalize=1` and says *Levelled*;
  4. Level off is as recorded.
- **By hand:** a demo take at −7.5 dBFS shares at −0.9 dBFS
  (`ffmpeg … volumedetect`).
- **Guide:**
  - §4: Level, Share, and a [demo] check;
  - a `TIPS` and §9 row;
  - api.md: `normalize`, `GET /api/level`;
  - `sw.js` goes to v51.
