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
  - The span's whole 256-frame buckets come from the take's peaks pyramid,
    which is built at save, so they read no audio. The part buckets at its
    two ends (under 256 frames each) are read from the WAV. That way a loud
    entry just past Out, where Snap often puts it, doesn't count. A take
    without a pyramid falls back to `RangePeaks` reading the WAV.
  - It answers `Level{peak_db, gain_db}`: the gain that brings the peak to
    **−1.5 dBFS** (`NormalizePeakDB`), leaving room for the MP3 encoder to
    overshoot on a dense, saturated part. A −20 dBFS square wave at −1
    clipped in 16-bit; at −1.5, realistic material decodes well under full
    scale.
  - The gain is capped at **+24 dB** (`MaxNormalizeGainDB`), so a
    near-silent take's hiss isn't shared at full volume.
  - Silence gets no gain. A peak already over −1.5 dBFS comes down a
    little. A gain that rounds to zero is 0, never −0.
- **`GET /api/render?…&normalize=1`** applies the gain with ffmpeg's
  `volume=`, last in the filter chain (`RenderArgs`' `gainDB`).
  - It says the gain in `X-Hindsight-Gain-Db`, and drops the header on a
    render that fails before its first byte.
  - A span whose level can't be read is shared as it is, and the page says
    so.
- **`GET /api/level?file=&from=&to=`** answers the same Level, for the
  page, with the same refusals as a render (a 16-bit take is a 400).

### On the take page

- **Level**, a toggle in the toolbar beside Practice speed, remembered per
  device (`wave.level`).
  - **On:** it reads the selection's level (or the whole take's) and says
    the gain: *Level +6.2 dB*. The number follows every change of the
    selection: made here, cleared, an Undo, or another device's edit. A
    screen reader hears the gain through a status line. The chip lights an
    LED when on, and keeps its width as the number changes.
  - **The take plays here at that gain.** The preview's `<audio>` can't go
    past full volume, so Level routes it through the AudioContext
    (`Clock.route`), with a GainNode and, after it, a limiter at −1 dBFS.
    Played past the selection, louder parts are held under full scale
    instead of clipping. The slice engine's loop goes through the same
    path, and one already playing is rerouted.
  - **Routing waits for a tap**, as iOS starts an AudioContext only in one:
    Level's own tap, or ▶. A Level remembered from last time routes at the
    first ▶.
    - The context is resumed in the tap, not awaited, and from
      `interrupted` as well as `suspended`.
    - The audio session plays through the silent switch, as the tape's
      stream does.
    - Once routed it stays, at 0 dB when Level is off.
    - A gain change glides (`setTargetAtTime`), so it doesn't click.
  - **Share** says the gain on its key (*Share · 0:12 · +6.2 dB*), asks for
    `normalize=1`, and toasts *Levelled +6.2 dB*. What's heard is what's
    shared. If the page couldn't read the level, the chip says *Level –*;
    if the Pi couldn't, the share goes as recorded and the page says so.
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
    - a quiet span ending 15 frames before a loud entry is measured on its
      own frames;
    - `RenderArgs` puts the volume last, and none without a gain.
  - `api_test.go`: a −12 dBFS tone has Level −12/+10.5; the bad requests; a
    normalized render's header (with ffmpeg), and none without.
- **Node:** `gainText` in `share.test.js`.
- **Smoke** (`smoke-takes.mjs`):
  1. Level says its gain;
  2. the take plays with it on;
  3. Share asks for `normalize=1` and says *Levelled*;
  4. Level off is as recorded.
- **By hand:** a demo take shares at about −1.5 dBFS (`ffmpeg …
  volumedetect`).
- **Not checked on a real iPhone:** ½× and 2× through the routed path, and
  locking the screen mid-play with Level on. The playhead may also lead the
  routed sound by the output's latency, tens of ms.
- **Guide:**
  - §4: Level, Share, and a [demo] check;
  - a `TIPS` and §9 row;
  - api.md: `normalize`, `GET /api/level`;
  - `sw.js` goes to v51.
