# Settings in the app, and any audio interface

**Date:** 2026-10-09 · **Status:** asked for and approved by Gabe on
2026-10-09 · **Repo:** `hindsight`

## Why

A second Pi is going to Gabe's brother-in-law with a Focusrite Scarlett Solo
(4th Gen) instead of the EP-136. Today that means SSH, an edited
`hindsight.env` and a restart, and the defaults assume the EP-136: eight
channels, a device named `EP-136`, and a take that writes channels 1/2 as
left/right. On the Solo, 1 is the mic and 2 the instrument, so a take of
voice and guitar comes out hard left and hard right.

Gabe wants the interface chosen from what's plugged in, and settings in
general changed from the app rather than from the env file.

## Decisions (Gabe, 2026-10-09)

- **Not an editor for `hindsight.env`.** A typo there makes the service
  crash-loop, which takes down the page that would fix it.
- **No config library.** Layering is a few lines; the work is validation,
  what a change does to a running ring, and describing settings to the UI.
- **One registry of settings drives everything:** loading, validation, the
  API, the settings sheet.
- **The app's values live in `~/hindsight/settings.json`** and win over the
  env file, which stays the defaults. Every existing install behaves the same
  until something is changed in the app.
- **Changes apply on restart**, from a *Restart* button. Almost every setting
  shapes something allocated once (the ring, the meters, the MIDI watcher, the
  tape), and a restart is what the Update button already does.

## What

### The registry (`internal/config/settings.go`)

One `Setting` per app-editable value. Its key is the env variable's name, so
docs, env file and `settings.json` share one vocabulary:

```go
type Setting struct {
    Key     string   // "RING_SECONDS"
    Group   string   // Input, Buffer, Saving, MIDI, Tape
    Label   string
    Help    string
    Kind    string   // int, float, bool, text, choice
    Min     float64  // int/float
    Max     float64
    Choices []string // choice
    Unit    string   // "s", "ms", "GB"
}
```

Every value is carried as a string and parsed the way the env file already
is, so `settings.json` and the env file can never disagree about a format.
Unlike `envInt`, which falls back to the default on a parse error, the
registry rejects a bad value outright.

**In the app:** `DEVICE_MATCH`, `CHANNELS`, `SAMPLE_RATE`, `SAVE_CHANNELS`,
`SAVE_MIX`, `SAVE_ALL_CHANNELS`, `INPUT_LATENCY_MS`, `RING_SECONDS`,
`MIN_FREE_GB`, `MAX_SAVES`, `MIDI_CAPTURE`, `MIDI_CLOCK_DEVICE`,
`MIDI_DEVICES`, `MIDI_IGNORE`, `MIDI_LATENCY_MS`, `MIDI_SNAP_BARS`, `TAPE`,
`TAPE_TRACKS`, `TAPE_LENGTH_S`, `TAPE_HANDLE_S`, `TAPE_MIXDOWN_TAIL_S`,
`TAPE_SOURCES`, `TAPE_CLOCK`, `TAPE_CLOCK_OUT`, `OUTPUT_LATENCY_MS`,
`TAPE_LATENCY_MS`.

**Env file only:** `PORT`, `STATIC_DIR`, `OUTPUT_DIR`, `TAPE_DIR`,
`UPDATE_REPO`, `FRAMES_PER_BUFFER`, `MIDI_RING_EVENTS`, `TAPE_DEMO_ALIGN`,
`SETTINGS_FILE`. These say where things are or are for development; a wrong
one from a phone could orphan the takes or stop the page loading.

### Layering

`config.Load()` reads each value from, in order: `settings.json`, the
environment, the built-in default. `settings.json` is
`$SETTINGS_FILE`, default `~/hindsight/settings.json`: a flat JSON object of
key → string. A key the registry doesn't know is ignored and logged, so an
older binary starts with a newer file.

**A bad file never stops Hindsight.** If `settings.json` can't be read or
parsed, or the config it produces fails validation, Hindsight logs why,
starts on the environment and defaults alone, and reports the problem on
`GET /api/settings` so the sheet can show it and offer to reset.

### API

- **`GET /api/settings`** returns the registry with, for each setting: its
  `value` now in effect, the `running` value the process started with,
  where it came from (`app`, `env`, `default`) and the `default`. Also
  `restart_needed` (any `value` ≠ `running`), `error` (the file problem, if
  any) and `inputs`, the audio inputs connected now (name, channels).
- **`PUT /api/settings`** takes `{"KEY": "value", "OTHER": null}`: set, or
  reset to the env/default (removed from the file). The whole result is
  validated as `Load` would validate it. Nothing is written on any error
  (400, naming the key). The file is written atomically (temp file, fsync,
  rename).
- **`POST /api/restart`** refuses with 409 for what would cut the Update
  button short (`busy()`: a take saving, a phone recording, the tape
  recording or playing), else answers 202 and restarts: the server shuts down
  as it does on SIGTERM, then the process re-execs itself. Under systemd that
  keeps the same unit; under `go run` it works too.

No authentication, as for every other endpoint: whoever can reach the page
can already delete takes.

### Any interface

- **`DEVICE_MATCH=auto`** (the new default) picks the input itself: of the
  hardware inputs PortAudio lists (ALSA's `hw:` devices on the Pi, ignoring
  `default`, `pulse`, `dsnoop` and the rest), the one with the most input
  channels; on a tie, the first. A named match works as before.
- **`CHANNELS=auto`** (the new default) opens every input the chosen device
  has. The ring is sized at startup, so Hindsight looks once before it
  allocates; if nothing is plugged in yet it sizes for two. When the
  interface that turns up has a different number of inputs, Hindsight
  restarts itself to fit it (unless something is busy, in which case it
  records the first channels and waits).
- **`MIDI_CLOCK_DEVICE`** defaults to the audio device's name when
  `DEVICE_MATCH` names one, as now. Under `auto` it defaults to the card name
  of the interface found at startup (the part of the PortAudio name before
  the colon, e.g. `EP-136 K.O. Sidekick`), which matches its MIDI port.
- **`/api/status`** gains nothing new; `device` already says what's open.

Existing installs are unchanged: their `hindsight.env` sets `DEVICE_MATCH` and
`CHANNELS`. `hindsight.env.example` comments both out, so a new install is
auto.

### The mono mix

**`SAVE_MIX=stereo|mono`**, default `stereo`. `mono` writes the
`SAVE_CHANNELS` inputs averaged into one signal, on both channels of the
take: voice and guitar in the middle, at −6 dB each so the sum can't clip.
`SAVE_ALL_CHANNELS` ignores it. The meters and ribbon are unchanged (they show
the inputs, which is what you set levels by).

Only the writer changes: a take's WAV is still stereo, so previews, peaks,
the tape and every reader of a take see what they always have.

### Known interfaces

None hard-coded beyond what's above. With `auto` everywhere, the EP-136 opens
its eight channels and saves 1/2 (MAIN); the Solo opens its inputs and saves
1/2. The sheet suggests *Mono mix* when the input has exactly two channels
and `SAVE_MIX` is stereo.

### The sheet

**Settings**, in the about line at the foot of Capture beside *Releases*
(`Hindsight v… · Releases · Settings · the guide`). A sheet like *Releases*:

- Grouped as the registry says, Input first. The interface is a list of
  what's connected plus *Automatic*; channels, *what to keep* (stereo pair /
  mono mix / every channel) and the pair below it.
- Buffer length shows the RAM it will take
  (`seconds × rate × channels × 4`) against the Pi's memory.
- Each field shows where its value comes from, and a *Reset* when it's set in
  the app.
- MIDI and Tape start collapsed.
- **Save** writes; then a strip says *Restart to apply. The ring starts
  empty.* with **Restart**, which waits for the page to come back like the
  Update button does.

## Testing

- Registry: every key parses its default; bad values rejected per kind;
  `Load` with a file overrides env; a bad file falls back and reports.
- `PUT` validates the whole config (e.g. `SAVE_CHANNELS=3,4` with
  `CHANNELS=2` is refused) and writes nothing on error; `null` removes.
- `POST /api/restart` refuses while busy.
- Mono mix: a two-channel block averages into identical L/R.
- Auto pick: candidate filtering and choice over a fixed device list.
- The demo boots with the new defaults.
- On the second Pi with the Solo: auto picks it, a take in mono mix is
  centred, a change in the sheet survives the restart.

## Later

- Applying some settings live (`MAX_SAVES`, `MIN_FREE_GB`) without a restart.
- Recording two interfaces at once (the multi-arm request).
