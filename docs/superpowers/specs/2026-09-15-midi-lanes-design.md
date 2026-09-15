# MIDI lanes on the take page, and the DAW bundle

**Date:** 2026-09-15 · **Status:** approved by the owner in chat · **Repo:** `hindsight`

## Goal

Show the MIDI that was captured beside a take, on the take page, in a form a
musician reads at a glance: one lane per track under the waveform, sharing
its zoom, its region and its playhead. And let a region leave the Pi as
something a DAW opens in one drop: the audio and the MIDI together, tempo
and bar 1 already agreed.

This is the first of three sub-projects that implement the owner's Claude
Design canvas (`Hindsight Mobile.dc.html`, turn 5, and its `HANDOFF.md`).
The home screen redesign and the cleanup chips and settings screen are
separate specs. The falling-notes view is deferred to its own plan and
builds on the endpoint defined here.

## What the owner decided

| Question | Decision |
|---|---|
| Scope of this pass | Lanes and the DAW bundle. Falling notes next, on the same endpoint |
| Time axis | The lanes share the **zoomable wave canvas** viewport, not the whole-take overview |
| Drum lanes | Channel 10 is drums; otherwise a heuristic; a **per-track override** saved in the sidecar |
| Where notes are decoded | **On the server**, one JSON endpoint in frames |
| Tablet bench | **Deferred** with falling notes: its right pane is that view |
| Action row | Play · DAW bundle · Share MP3, with the region length in the Share label |

Rejected: decoding the SMF in the browser (a second parser and a second copy
of the tempo math, next to a Go decoder that was just fuzzed); a notes JSON
sidecar written at save time (a fifth artifact type the delete and cut paths
would both have to learn, and absent on every existing take).

## The notes endpoint

`GET /api/midi?file=<take>.wav`

Reads the take's `.mid`, decodes it with `internal/smf.Decode`, walks the
conductor track with `midi.FromConductor`, and converts every note to frames
at the take's sample rate. The page thinks in frames everywhere; this is
what lets a lane use the wave view's `frameToX` unchanged.

```json
{
  "ppq": 480,
  "sample_rate": 48000,
  "frames": 1440000,
  "tempo": [{ "frame": 0, "bpm": 82.0 }],
  "downbeat_frame": 0,
  "tracks": [
    {
      "name": "bento ch1",
      "device": "bento",
      "channel": 1,
      "kind": "drums",
      "notes": [{ "s": 4800, "e": 9600, "p": 36, "v": 100 }]
    }
  ]
}
```

- `s` and `e` are start and end frames, `p` is the MIDI pitch, `v` the
  velocity 1–127. Notes are sorted by `s`. A note-on with no matching
  note-off ends at the last frame of the take.
- `tempo` is the conductor's tempo events in frames; one entry for a take
  with a single tempo. `downbeat_frame` comes from the manifest's downbeat
  when present, else 0.
- `kind` is `"drums"` or `"notes"`: the server's guess, then the sidecar's
  `lane_kinds` override applied on top. The browser never classifies.
- `name` is the SMF track name; `device` is that name without its ` chN`
  suffix, the same split `internal/bundle/cut.go` already makes.
- Served with the same immutable caching as `/api/peaks`: a take's `.mid`
  never changes after it is written. A change to `lane_kinds` is a sidecar
  edit and the page applies it locally, so a cached response going stale
  on `kind` is harmless.

| Status | When |
|---|---|
| 400 | Missing or bad `file` |
| 404 | No such take, or the take has no `.mid` |
| 422 | The `.mid` exists but does not decode |

### Drum classification

A track is drums when its channel is 10, or when it has at most 16 distinct
pitches **and** its 90th-percentile note length is under a quarter of a
beat at the tempo in force at the take's middle. Both conditions, because a
sparse bass line has few pitches but long notes, and a fast arpeggio has
short notes but many pitches. The sidecar's `lane_kinds` wins over the
guess in either direction.

## The sidecar field

`Meta` in `internal/audio/meta.go` gains

```go
// LaneKinds overrides the notes endpoint's drum/notes guess per track,
// keyed by SMF track name. Optional and additive, like BPM and Flags.
LaneKinds map[string]string `json:"lane_kinds,omitempty"`
```

`PATCH /api/take` accepts `lane_kinds` as a full replacement of the map
(like `flags`), values restricted to `drums` or `notes`, keys sanitized like
labels and capped at 64 entries. No `MetaVersion` bump: older readers
ignore the field, which is the rule for a bump.

## Lanes on the page

A new module `web/static/lib/wave/lanes.js` exports `class Lanes`.

```js
new Lanes({ container, tracks, totalFrames, getState, getView, onKindChange })
lanes.draw()        // repaint every visible lane from the current view and state
lanes.destroy()
```

`container` is a new `<div id="lanes" class="lanes">` between the wave
canvas and the action row. For each track the module builds a card:

- **Header** (DOM, 26px): an 8px colour swatch, the track name, the note
  count and, for melodic tracks, the device name, and a chevron. Tap
  toggles collapse. A 500ms press-and-hold flips `kind` and calls
  `onKindChange(name, kind)`, which the page turns into a PATCH.
- **Body** (a canvas, `touch-action: pan-y`): repainted by `draw()`.

Body heights: melodic 56px, drums 36px, collapsed 18px. Each body paints,
in order: the panel background; bar lines from `gridLines(view, st.grid)`,
the same call the wave makes, so the two grids cannot drift; the rows; the
notes; the region shade in the wave's exact `rgba(52,211,153,0.14)` with
2px accent edges; the cursor as a 1px `--ink` line.

- **Melodic rows:** row height is the body height divided by the track's
  pitch span `hi − lo + 1`, floored at 4px. Every C row is tinted
  `--panel-2`. A note is a rect from `frameToX(s)` to `frameToX(e)`, at
  least 2px wide, in its row.
- **Drum rows:** one row per distinct pitch, lowest at the bottom, each
  tick 2px wide with height `0.25 + 0.7·v/127` of the row.
- **Collapsed:** one row; every note is a rect at 15%–85% of the height.
- **Velocity is opacity** everywhere: `0.3 + 0.7·v/127`.
- **Colours** by track order, drums always amber: `#fbbf24` drums,
  `#34d399`, `#3b9dd4`, `#f87171`, `#a78bfa`, cycling.

The page calls `lanes.draw()` from the same three places the wave repaints:
`viewChange`, `regionChange`, and the clock tick. Notes are culled to the
visible frame range before painting.

Collapse state is a per-viewer convenience in `localStorage` under
`wave.lanes.<take>`, so a lane stays collapsed on the next visit to the same
take. The kind override is take state and lives in the sidecar.

The lanes container scrolls vertically and is capped at 40vh, so four lanes
never push the transport off a phone screen. A take with no `.mid` renders
no container at all; nothing on the page moves.

## The DAW bundle

`GET /api/bundle?file=<take>.wav&from=<frame>&to=<frame>`

Streams a zip, `Content-Disposition` naming it `<label or stem>
<m.ss>-<m.ss>.zip`, or `<label or stem>.zip` for the whole take. Contents:

| Entry | What |
|---|---|
| `<stem>.wav` | Frames `[from, to)` at the take's native bit depth, with the cut's 3ms fades |
| `<stem>.mid` | The region's MIDI re-based to tick 0, tempo lane over that stretch, sounding notes clipped at the start and closed at the end |
| `<stem>.manifest.json` | The cut manifest, with `source` naming the take and frames |

The MIDI part is `internal/bundle/cut.go`'s `CutMIDI`, refactored: the
region-to-SMF logic becomes `RegionMIDI(srcWav string, start, end int64)
(mid []byte, manifest []byte, err error)`, and both the file-writing cut and
the streaming bundle call it. Behaviour of `POST /api/cut` does not change;
its tests are the regression net for the refactor.

A take without a `.mid` bundles the WAV alone, and the response carries
`X-Hindsight-Midi: none` so the page's toast can say the zip has no MIDI.
Validation matches `/api/render`: bad or inverted frames, past the end, or
over ten minutes are 400; missing take 404.

## Action row and layout

Phone row, left to right: **Play** (fixed width), **DAW bundle**
(secondary), **Share MP3 · 0:12** (primary, the region length in the label,
"Share MP3 · whole take" without a region), and the existing clear-region
disc beside the Share button. The standalone region text leaves the row;
the Fine tune disclosure still shows the region's bars and length.

At `min-width: 860px` the primary style moves to the bundle button, whose
label becomes **Download DAW bundle**, and Share MP3 becomes secondary. The
buttons do not move; only weight and label change. The two-column bench
from the canvas is deferred with falling notes.

Bundle tap: fetch the zip, hand it to `shareOrDownload` like an MP3, with
the button reading "Bundling…" meanwhile. A browser that cannot share files
downloads it, as Share already does.

## Errors

- Notes fetch fails: one toast, and the page behaves exactly as today with
  no lanes.
- 422: the toast says the `.mid` is unreadable and links the raw download.
- Bundle fails: toast in the share button's style, button restored.
- A kind-override PATCH fails: toast, and the lane keeps the new kind
  locally until reload.

## Testing

**Go**
- `internal/api`: notes endpoint against a fixture `.mid` with a tempo
  change mid-file, asserting frames on both sides of the change; 404 for a
  take without MIDI; 422 for a corrupt file; `lane_kinds` override applied.
- Drum classification table: channel 10; few pitches and short (drums);
  few pitches and long (notes); many pitches and short (notes).
- `internal/bundle`: `RegionMIDI` yields bytes identical to what `CutMIDI`
  wrote before the refactor for the same region; the bundle handler's zip
  lists exactly three entries with the expected names, and one entry when
  the take has no `.mid`.
- `PATCH /api/take` rejects a `lane_kinds` value other than `drums`/`notes`.

**Node** (`node --test 'web/static/lib/wave/*.test.js'`)
- `lanes.test.js`: note-to-rect geometry for melodic and drum lanes at two
  zoom levels; culling outside the view; the collapsed row; colour
  assignment with drums first and not first.

**By hand**
- Demo mode (`RING_SECONDS=120 CGO_ENABLED=0 go run ./cmd/hindsight --demo`
  on a spare port): the demo sequencer writes a `.mid`, so a capture shows
  lanes. Check at 390 and 1024 wide: zoom and pan keep lanes aligned with
  the wave, region shade matches, playhead moves in both, collapse and
  long-press work, the bundle opens in a DAW with the WAV on bar 1.
- Pi: `./deploy.sh` (Go changed), then a real take with bento playing.

## Out of scope

The falling-notes view and the tablet bench; lane reordering; per-lane
mute or solo; colouring by velocity; anything under the cleanup chips.
