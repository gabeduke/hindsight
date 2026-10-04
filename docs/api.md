# HTTP API

Twenty-two routes, registered in `internal/api/api.go` (`SetupRoutes`). Everything
else the server answers is the static UI under `web/static`.

There is **no authentication and no rate limiting**. `DELETE /api/delete`
destroys takes and `POST /api/trigger` writes hundreds of megabytes, for anyone
who can reach the port. Keep it on a LAN or a tailnet; do not expose it to the
internet.

| Endpoint | Purpose |
|---|---|
| `GET /api/status` | Health, ring fill, per-channel dB, disk, live tempo, version |
| `GET /api/live` | WebSocket: min/max peak bins (~100/s) plus peak-hold |
| `GET /api/phone` | WebSocket: a phone streams a recording into a new take |
| `GET /api/envelope` | The buffer ribbon's amplitude envelope over the whole ring |
| `POST /api/trigger?seconds=N` | Save the last N seconds; `0` is the whole ring |
| `GET /api/jams` | Takes, starred first then newest first. Sends an ETag |
| `GET /api/take?file=` | One take, in the same shape as an entry of `/api/jams` |
| `PATCH /api/take?file=` | Edit a take's label, star, trim, BPM, downbeat, lane kinds and flags |
| `POST /api/take/flags?file=` | Add one flag to a take |
| `PATCH /api/take/flags?file=&id=` | Move or relabel one flag |
| `DELETE /api/take/flags?file=&id=` | Remove one flag |
| `POST /api/flag` | Flag a moment at the ring's newest frame (the main page's *Flag now*) |
| `DELETE /api/flag` | Remove one live mark (`?frame=`), or every one (`?all=1`) |
| `GET /api/peaks?file=` | Precomputed waveform, so phones do not download audio to draw one; with a range, that range's peaks |
| `GET /api/download?file=[&dl=1]` | Stream inline, or force a download |
| `DELETE /api/delete?file=` | Remove a take and its sidecars |
| `POST /api/cut?file=` | Export a region of a take as a new take, with 3ms declick fades |
| `GET /api/slice?file=&from=&to=` | A region as a 16-bit WAV with the same fades a cut gets, for auditioning |
| `GET /api/render?file=&from=&to=` | An MP3 of a region, streamed from ffmpeg with the cut's fades, for the share sheet |
| `GET /api/midi?file=` | The take's `.mid` decoded to notes in frames, one track per device and channel, for the lanes |
| `GET /guide.md` | The user guide, compiled into the binary, for `/guide.html` to render |
| `GET /api/bundle?file=&from=&to=` | A zip of the region: WAV with the cut's fades, the MIDI re-based to it, and its manifest |

`GET` routes also accept `HEAD`, except `/api/live` and `/api/phone`, which
are WebSocket upgrades, and `/api/render` and `/api/bundle`, which stream.

---

## `GET /api/status`

The poll everything else hangs off. The UI reads it every two seconds.

```json
{
  "version": "dev",
  "is_recording": true,
  "capture_healthy": true,
  "capture_waiting": false,
  "last_error": "",
  "device": "Demo signal generator (synthetic, 96 BPM)",
  "xruns": 0,
  "ring_seconds": 60,
  "buffered_seconds": 4.82,
  "sample_rate": 48000,
  "channels": 8,
  "save_channels": [1, 2],
  "channel_rms": [-15.54, -15.54, -46.0, -46.0, -46.0, -46.0, -46.0, -46.0],
  "floor_db": -60,
  "last_saved": "",
  "saving": false,
  "disk_free_gb": 262.28,
  "disk_percent": 71.69,
  "min_free_gb": 1,
  "midi_connected": true,
  "midi_bpm": 96,
  "midi_devices": [
    { "id": 1, "name": "EP-136", "node": "/dev/snd/midiC2D0", "clock": true, "connected": true, "events": 0, "bytes": 3373 },
    { "id": 2, "name": "Orchid", "node": "/dev/snd/midiC3D0", "clock": false, "connected": true, "events": 1204, "bytes": 3612 }
  ]
}
```

- `save_channels` is **1-indexed**, matching how the hardware labels its inputs
  and how `SAVE_CHANNELS` is written.
- `channel_rms` is dBFS per channel, from the newest 10 ms bin, clamped at
  `floor_db`.
- `midi_bpm` is `null` whenever there is no defensible reading over the last
  eight seconds — which is also what a connected interface with clock-send
  switched off looks like. `midi_connected` and a null `midi_bpm` together are
  a normal state, not an error.
- `midi_connected` is about the clock device (`MIDI_CLOCK_DEVICE`), not any
  MIDI device at all. `midi_devices` is every rawmidi port the watcher has
  open, always an array; `clock` marks the tempo source. A device that
  enumerated as a power sink rather than a MIDI port -- the Orchid connected
  before it finished booting -- is simply absent from it.
- `capture_healthy` is what the installer greps for to decide whether the
  service actually came up recording.
- `capture_waiting` is true when capture is down only because no interface
  with enough channels is there to open (switched off, still booting,
  unplugged). Capture keeps retrying; the main page says *waiting for the
  interface* rather than reporting an error.
- `version` is stamped at build time; a development build reports `dev`.

## `GET /api/live`

WebSocket. The server pushes a frame whenever level bins have accumulated —
each bin is 10 ms wide, so roughly 100 bins a second, batched per frame.

Every array is per channel, so at `CHANNELS=8` each has eight entries:

```json
{
  "bins": [{ "min": [-0.31, -0.29, ...], "max": [0.30, 0.28, ...], "rms": [-15.5, -15.5, ...] }],
  "peak": [-12.4, -12.6, -60, -60, -60, -60, -60, -60],
  "clip": [false, false, false, false, false, false, false, false]
}
```

`min`/`max` are the true sample extremes per channel in −1..1, which is what
lets the client draw a real waveform envelope rather than mirroring a single
RMS scalar. `peak` is a decaying peak-hold in dBFS; `clip` says a sample hit
full scale during the frame.

The server pings every 25 s and expects a pong within 60 s. It reads from the
socket but ignores the contents; reading is what surfaces close frames. Origin
is not checked — the app is reached by hostname, IP and `.local` alias, so
origin pinning would only break access.

## `GET /api/phone`

WebSocket. A phone records into it, and the recording becomes a take. The
Phone button on the main page is its client (`web/static/lib/phone/`).

```
phone → {"type":"start","id":"<recording id>","rate":48000}
Pi    → {"type":"ready","next":0,"name":"jam_2026-10-04_213000.wav"}
phone → binary: uint32 LE chunk number, then interleaved stereo float32 LE
Pi    → {"type":"ack","next":12}          chunks 0–11 are on disk
phone → {"type":"stop","chunks":40}       40 chunks were sent in all
Pi    → {"type":"saved","name":"jam_2026-10-04_213000.wav","seconds":4,"partial":false,"reason":"stop"}
```

- **The recording id** is made by the phone, 8–64 characters of
  `[A-Za-z0-9_-]`, and names the recording rather than the connection. After a
  dropout the phone reconnects and sends the same `start`; `ready` says which
  chunk the Pi is waiting for, and the phone resends from there. A chunk
  already written is ignored, and one that arrives early waits for those
  before it.
- **The audio** is stereo (a mono input is sent as dual mono) at the phone's
  rate, 8–192 kHz. The Pi writes it as it arrives, as 32-bit 48 kHz PCM,
  resampling when the rate differs, into the take's hidden `.part` file. A
  chunk is any whole number of frames; the page sends a tenth of a second.
- **Stop** gives the number of chunks sent. The Pi finishes the take once it
  holds them all: the header is filled in, `.peaks.json`, `.peaks.bin` and a
  `.meta.json` labelled *Phone* (with `created` set to when recording
  started) are written, and the WAV is renamed into place. The preview is
  encoded afterwards and `MAX_SAVES` applies, as after a save.
- **`saved`** reports how it ended. `reason` is `stop`, `limit` (three hours,
  just under what a WAV header can hold), `disk` (free space fell under
  `MIN_FREE_GB`; checked at the start and every five seconds or so),
  `disconnected` or `error`. An empty `name` means nothing was recorded. A
  phone that reconnects within ten minutes of the end gets the same `saved`.
- **A phone that doesn't come back** within ten minutes has its recording
  finished as *Phone (partial)*, as does one with a chunk that never arrived.
  A restart mid-recording recovers what reached the disk the same way, at
  startup, and encodes its preview.
- **`first`** in `start` is the oldest chunk the phone still holds. It only
  matters when the Pi doesn't know the recording (it restarted, or the
  result was dropped ten minutes after the end): the Pi then starts a new
  take at that chunk, marked partial, instead of waiting for chunks the
  phone no longer has.
- **Errors writing** never cost audio already on disk: the take is finished
  from what reached the file, as partial, or if even that fails, the `.part`
  is left for the next startup to recover (`saved` with `reason: "error"`
  and no name).
- **Refusals** are `{"type":"error","error":"…"}` in place of `ready`: a
  malformed start, a rate outside 8–192 kHz, the disk under `MIN_FREE_GB`,
  or eight recordings already in progress. A chunk is at most 256 KB, and at
  most 8 MB of chunks may wait for a missing one.

The browser opens the mic only on a secure page, so this is used from the
Pi's HTTPS address (`tailscale serve`), or from `localhost`.

## `GET /api/envelope`

What the buffer ribbon draws: a dB-coded amplitude envelope of the entire ring,
not just what the browser has been open for.

| Query | Default | Notes |
|---|---|---|
| `buckets` | `400` | Clamped to 1..600 |
| `spans` | *(none)* | Comma-separated capture lengths in seconds; `0` means the whole ring, matching `/api/trigger` |

```json
{
  "ring_seconds": 60,
  "buffered_seconds": 4.99,
  "edge_seconds": 10,
  "buckets": "AAAAAAAAAOA=",
  "signal_seconds": [4.99, 4.99],
  "flags": [{ "age_seconds": 1.5, "frame": 24000 }]
}
```

`buckets` is base64: one byte per bucket, holding peak magnitude across the
save channels, dB-coded over −60..0 dBFS as `round((db + 60) × 255 / 60)`. A
consumer divides by 255 and has exactly the value the live meters would draw.
Peak, not mean — a peak survives downsampling.

`signal_seconds` is parallel to the `spans` you asked for: how many seconds of
each window were above the signal gate. That is what lets the ribbon tell you
whether a 7-minute capture would actually contain anything.

`edge_seconds` is the age at the ribbon's right edge and the newest age its
logarithmic axis can address.

`flags` is every live mark still in the ring, oldest first. `age_seconds`
positions the tick on the ribbon's log axis, in the same currency the rest of
the envelope speaks; `frame` is the mark's absolute ring frame, which the
client sends back to `DELETE /api/flag?frame=` to undo a mistap.

Returns 503 if the envelope is unavailable, 400 if `buckets` or `spans` will
not parse. `Cache-Control: no-store`.

## `POST /api/trigger?seconds=N`

Copies the last `N` seconds out of the ring and writes a WAV. `seconds=0`, or
omitting it, means the whole ring.

The response is not sent until the WAV, its `.peaks.json` and `.peaks.bin`
are on disk, and the BPM stamped. Only the `_preview.mp3` is backgrounded, so a take appears in
the list with `has_peaks` already true and `has_preview` false for the length of
one ffmpeg encode — which is what the UI's "waveform pending…" row is waiting
on.

```json
{ "status": "saved", "name": "jam_2026-09-09_145852.wav", "seconds": 10, "buffered": 22.8 }
```

| Status | When |
|---|---|
| 400 | `seconds` is not a non-negative number |
| 409 | Nothing is buffered yet |
| 507 | Free space is below `MIN_FREE_GB` |
| 500 | The write itself failed |

If a MIDI clock is present, the take's tempo is stamped into its sidecar after
the WAV is safely on disk. If anything was received over MIDI during the
window, a `.mid` and a `.manifest.json` are written beside the take too (see
`GET /api/download`). A MIDI failure of any kind — no device, a parse error, a
panic — produces a take with no BPM and no `.mid`, and nothing else.

With `MIDI_SNAP_BARS` on (the default) and a clock whose bar phase is known,
the window is moved back to the last downbeat the ring still holds, so the
take may be up to one bar longer than `seconds` asked for and its first frame
is bar 1 of the `.mid`. A whole-ring save, which cannot go back, is moved
forward to the first downbeat instead.

## `GET /api/jams`

Every take in `OUTPUT_DIR`, **starred first, then newest first**. Starring is
how a take stays in reach once newer ones have pushed it down.

"Newest" is the take's `created` time: written into its sidecar when it is
saved or cut, and for a take older than that field, read from its
`jam_<timestamp>` name (local time), falling back to the file's modification
time. It used to be the modification time alone, which moved an old take back
to the top -- and out of the pruner's reach -- whenever a flag edit rewrote
its cue chunk.

```json
[{
  "name": "jam_2026-09-09_145852.wav",
  "size_mb": 3.66,
  "duration_seconds": 10,
  "created": "2026-09-09T14:58:52-04:00",
  "channels": 2,
  "sample_rate": 48000,
  "has_preview": true,
  "has_peaks": true,
  "has_midi": true,
  "preview_name": "jam_2026-09-09_145852_preview.mp3",
  "midi_name": "jam_2026-09-09_145852.mid",
  "label": "",
  "starred": false,
  "bpm": 96,
  "flags": [{ "id": "f100", "frame": 100 }, { "id": "r9c41e0a2", "frame": 900, "label": "drop" }],
  "downbeat_frame": null,
  "lane_kinds": { "bento ch1": "notes" },
  "source": { "name": "jam_src.wav", "start_frame": 1000, "end_frame": 9000 }
}]
```

`source` is present only on a take that was cut from another (see
`POST /api/cut` below); it is absent for a take saved from the ring.

Duration and layout come from each file's own header, so takes recorded under
an older channel configuration still report correctly.

Every flag has an `id`, which is what the per-flag endpoints below address it
by. A flag saved before ids existed reads as `f<frame>`, and keeps that id
from then on even if it moves.

The response carries an `ETag`; send it back as `If-None-Match` and an
unchanged list answers 304. That is what keeps the 5-second poll from
re-rendering the list and interrupting a playing preview. The ETag is a hash
of each take's file sizes and modification times, from one directory listing,
and the takes are cached against the same signatures, so a 304 costs no
header parsing and no sidecar reads, and a change re-reads only the takes it
touched.

A take appears only once it is complete: saves and cuts write the audio to a
hidden `.<name>.part` file and rename it into place last.

## `GET /api/take?file=`

One take, in exactly the shape of an entry of `GET /api/jams`. The waveform
page loads with this rather than fetching the whole list, and fetches it again
when it comes back into view, to pick up edits made on another device.
`Cache-Control: no-cache`. 400 for a bad `file`, 404 if there is no such
take.

## `PATCH /api/take?file=`

Merges fields into a take's `.meta.json` sidecar. It is a merge, not a replace:
an absent field is left alone, so starring a take cannot silently clear its
label.

```bash
curl -X PATCH 'http://127.0.0.1:5000/api/take?file=jam_2026-09-09_145852.wav' \
  -H 'Content-Type: application/json' \
  -d '{"label":"warm-up","bpm":128,"starred":true}'
```

| Field | Type | Notes |
|---|---|---|
| `label` | string | Control and Unicode format characters stripped, trimmed, capped at 120 runes |
| `starred` | bool | |
| `trim` | `{start_frame, end_frame}` or `null` | `start_frame` must be `>= 0`, `end_frame` must exceed `start_frame`, and `end_frame` must not pass the take's frame count; `null` clears |
| `bpm` | number or `null` | 20–400, rounded to two decimals; rejects NaN and ±Inf; `null` clears |
| `flags` | `[{id?, frame, label}]` or `null` | A full replacement of the take's flags. An `id` that isn't one the server could have made is dropped, and the flag gets a legacy one. Capped at 512; `frame` must be `>= 0` and less than the take's frame count; `null` clears. `label` is sanitized like the take label (control characters stripped, trimmed, 120 runes). Kept for scripts: the UI uses the per-flag endpoints below, because a full replacement from a page that has been open a while silently undoes a flag another device added |
| `downbeat_frame` | integer or `null` | Where bar 1 falls, for the waveform page's grid. `>= 0` and less than the take's frame count; `null` clears |
| `lane_kinds` | `{"<track name>": "drums"\|"notes"}` or `null` | A full replacement of the take's per-lane overrides for `GET /api/midi`'s drum guess. At most 64 entries; keys sanitized like labels; `null` clears |

The response is the merged result:

```json
{ "label": "warm-up", "starred": true, "trim": null, "bpm": 128, "flags": [], "downbeat_frame": null, "lane_kinds": {} }
```

If `flags` changed, the sidecar write is also mirrored into the WAV as RIFF
`cue ` points, with labelled flags also written as `labl` records in a `LIST`/`adtl` chunk so DAWs show the name beside the marker. That second write can fail on its own — a take whose layout
`WriteCues` does not recognise, say — without the sidecar edit failing with
it: the response carries a non-empty `cue_error` when it does, and the status
stays 200, because the sidecar (the source of truth) already saved.

| Status | When |
|---|---|
| 400 | Missing or bad `file`, malformed JSON, trailing content, or a field out of range |
| 404 | No such take |
| 409 | The sidecar was written by a **newer build** than this one. Rewriting it would drop fields this build does not know about |
| 500 | The sidecar write failed for any other reason. The detail is logged, not returned — the real error names absolute paths and the temp-file scheme |
| 507 | Disk full |

Every write to a take's sidecar -- this PATCH, the per-flag endpoints, the
saver's tempo and flag stamps, the MIDI exporter's downbeat -- runs under a
per-take lock, from the read through the cue-chunk rewrite. Two edits at once
both land; before the lock, the second silently discarded the first.

The tempo range is deliberately far wider than any interface will produce,
because the stamped BPM is a device's guess rather than ground truth — see the
MIDI section of [architecture.md](architecture.md). The field exists to be
overridden, including for takes whose clock reading was confidently wrong.

## `POST /api/take/flags?file=`, `PATCH /api/take/flags?file=&id=`, `DELETE /api/take/flags?file=&id=`

One flag at a time, by id, so two devices editing the same take's flags can't
undo each other's work.

```bash
# add
curl -X POST 'http://127.0.0.1:5000/api/take/flags?file=jam_2026-09-09_145852.wav' \
  -H 'Content-Type: application/json' -d '{"frame":96000,"label":"drop"}'
# relabel or move
curl -X PATCH 'http://127.0.0.1:5000/api/take/flags?file=jam_2026-09-09_145852.wav&id=r9c41e0a2' \
  -H 'Content-Type: application/json' -d '{"label":"the drop"}'
# remove
curl -X DELETE 'http://127.0.0.1:5000/api/take/flags?file=jam_2026-09-09_145852.wav&id=r9c41e0a2'
```

| Field | Notes |
|---|---|
| `id` | `POST` only, optional: the new flag's id, `r` and eight lowercase hex characters. Made by the page, so it can label or delete a flag before the `POST` answers |
| `frame` | Required for `POST`, optional for `PATCH`. `>= 0` and less than the take's frame count |
| `label` | Optional. Sanitized like the take label |

Without an `id`, the server makes one. A `POST` whose `id` the take already
has adds nothing and answers as if it had, so a retry is harmless. Two flags
may share a frame if their ids differ. The page sends its flag requests for a
take one at a time, in order, so a label sent straight after an add never
arrives first. Each call runs under the take's lock, rewrites
the WAV's cue points like the whole-array PATCH, and answers:

```json
{ "flag": { "id": "r9c41e0a2", "frame": 96000, "label": "drop" }, "flags": [ ... ], "cue_error": "..." }
```

`flag` is the flag added, changed or removed; `flags` is the take's whole list
afterwards, so the caller can resync; `cue_error` appears only when the
sidecar saved but the cue chunk could not be rewritten.

| Status | When |
|---|---|
| 400 | Bad `file`, malformed body, missing `frame` (`POST`) or `id` (`PATCH`, `DELETE`), a malformed `id`, a frame out of range, or a take already carrying 512 flags |
| 404 | No such take (including one deleted while the request waited for the lock), or no flag with that `id` |
| 409 | The sidecar was written by a newer build |
| 500 | The sidecar write failed. The detail is logged |
| 507 | Disk full |

## `POST /api/flag`

Marks a moment of interest at the newest frame the ring holds — the live
counterpart to a take's `flags`. It does not require a healthy capture:
`capture_healthy: false` means no new audio is arriving, not that there is
none, and marking a moment in audio you can still capture is the point of the
feature.

```json
{ "frame": 43199, "age_seconds": 0 }
```

`frame` is the mark's absolute ring frame — the same value `/api/envelope`
later reports it at — so the caller can draw the tick immediately rather than
waiting for the next poll.

| Status | When |
|---|---|
| 409 | The ring is empty. This is the only case with nothing to mark |
| 503 | Capture is not attached to this build at all |

Marking the same frame twice collapses to one flag, which is what happens on
repeated presses while capture is dead and the ring's frame counter has
stopped advancing.

## `DELETE /api/flag`

Removes live marks. Backs undo of a mistap.

| Query | Notes |
|---|---|
| `frame` | Removes the one mark at this absolute frame |
| `all` | Clears every live mark. Only the literal values `1` or `true` trigger it — `?all=0` and `?all=false` are left alone, not read as truthy |

```json
{ "status": "removed" }
```

| Status | When |
|---|---|
| 400 | Neither `frame` nor `all` given, or `frame` does not parse |
| 404 | No mark at that `frame` |
| 503 | Capture is not attached to this build at all |

## `GET /api/peaks?file=`

The `.peaks.json` written alongside the take: a precomputed min/max waveform, so
a phone can draw a take without downloading the audio.

```json
{ "version": 1, "channels": 2, "sample_rate": 48000, "duration": 10, "buckets": 1026, "data": [[...]] }
```

400 if `file` is missing or is not a bare `.wav` name, 404 if peaks have not
been generated. Served immutable — a take's peaks never change.

With `from`, `to` (frames, `0 <= from < to <= frames`) and `buckets`
(`1..4096`) given together, the peaks are computed on demand over exactly
that range instead of served from the file. The response has the same shape
plus `"from"`, and `duration` describes the range. All three or none: a
partial set is 400. The waveform page uses this for every zoomed view.

When each bucket spans at least 256 frames, the answer comes from the take's
peaks pyramid (`.peaks.bin`: min and max per 256 frames, as 16-bit values)
rather than from the audio, so a zoomed-out view of a 15-minute take reads at most
1.3 MB instead of most of the WAV's 350. Values are then rounded outward
to the nearest 1/32768, and a bucket edge that falls inside a 256-frame block
takes in that whole block (at most 5ms). Deeper zooms, and takes whose
pyramid has not been built yet, read the WAV exactly as before.

## `GET /api/download?file=[&dl=1]`

Serves the take, its mp3 preview, its `.mid` or its `.manifest.json`, with
range requests. Only `.wav`, `.mp3`, `.mid` and `*.manifest.json` names in
`OUTPUT_DIR` are addressable; anything with a path in it is rejected. A `.mid`
is sent as `audio/midi`.

Inline by default so `<audio>` can stream it. `dl` adds a
`Content-Disposition: attachment` header instead — **any non-empty value**, so
`dl=0` and `dl=false` force the download just as `dl=1` does. 400 if `file` is
missing or rejected, 404 if it is not there.

## `POST /api/cut?file=`

Body:

```json
{ "start_frame": 480000, "end_frame": 998400, "label": "the drop" }
```

Writes frames `[start_frame, end_frame)` of the take as a new take
`jam_<now>.wav` in the same directory, with a linear 3ms fade at each edge
and the audio between them byte-identical to the source. The new sidecar
carries the given `label` (sanitized like a take label; default
`"<source label or stem> · <m:ss>–<m:ss>"`, with tenths of a second for a
region under ten seconds, and a cut of a cut replacing the span rather than
adding another), the source's `bpm` and `lane_kinds`, any flags inside the
region rebased to it, and a `source` field `{name, start_frame, end_frame}`.
The source's downbeat is carried onto the cut's grid: with a BPM, the first
bar line at or after the region's start; without one, only a downbeat inside
the region. Star and trim are not copied. The source is never modified.
The cut appears in the list only once it is complete, and `MAX_SAVES` is
enforced afterwards, as after a save -- sparing the cut and the take it was
cut from, which can leave the list one or two over until the next capture. The preview mp3 is rendered in the
background.

Response: `200 {"name": "jam_2026-09-10_221441.wav"}`.

| Status | When |
|---|---|
| 400 | Bad `file`, malformed body, inverted or out-of-range frames, or a region shorter than two fades (289 frames at 48kHz) |
| 404 | No such take |
| 507 | Below `MIN_FREE_GB` |

If the source take has a `.mid`, the cut gets the region of it: re-based so
the cut's first frame is tick 0, with the source's tempo lane over that
stretch, notes sounding at the region's start clipped to it and notes still
sounding at its end closed there. Its manifest carries a `source` block naming
the take and frames it came from, and its `downbeat` is the first bar line of
the source at or after the region's start — reported, not aligned, since the
region was chosen by ear rather than by the grid.

## `GET /api/slice?file=&from=&to=`

Streams frames `[from, to)` as a complete **16-bit** PCM WAV with the same
3ms fades `POST /api/cut` applies, so what the waveform page loops is exactly
what a cut will produce. 16-bit because browsers cannot reliably decode
32-bit integer WAV. A take with more than two channels plays the
`SAVE_CHANNELS` pair, as previews and shares do. Capped at 60 seconds.
`Content-Length` is exact.

| Status | When |
|---|---|
| 400 | Bad `file`, non-integer or inverted frames, past the end, or over 60s |
| 404 | No such take |

## `GET /api/render?file=&from=&to=`

Streams frames `[from, to)` as a 128 kbps MP3 straight from ffmpeg — the
preview encoder pointed at a region, with the same 3ms declick fades a cut
gets and a sample-exact trim. Nothing is written to disk or cached. Capped
at 10 minutes. `Content-Disposition` names the file
`<label or stem> <m.ss>-<m.ss>.mp3`, or `<label or stem>.mp3` for the whole
take, so the share sheet shows a readable title. No `Content-Length`: the
stream's size is unknown until it ends.

Renders run one at a time: each is an ffmpeg process, and two at once on a
Pi starve the capture path of CPU. A second request waits for the first to
finish, and gives up without starting ffmpeg if its client disconnects
while waiting.

| Status | When |
|---|---|
| 400 | Bad `file`, non-integer or inverted frames, past the end, over 10 minutes, shorter than two fades (289 frames at 48kHz), or a non-32-bit take |
| 404 | No such take |

## `GET /api/midi?file=`

The take's `.mid` decoded server-side into notes on the take's frame
timeline, so the take page draws lanes with the same math it draws the
waveform with.

```json
{
  "ppq": 960, "sample_rate": 48000, "frames": 1440000,
  "tempo": [{ "frame": 0, "bpm": 82 }],
  "downbeat_frame": 0,
  "tracks": [
    { "name": "bento ch1", "device": "bento", "channel": 1, "kind": "drums",
      "notes": [{ "s": 4800, "e": 9600, "p": 36, "v": 100 }] }
  ]
}
```

`s` and `e` are start and end frames, `p` the pitch, `v` the velocity. Notes
are sorted by `s`; a note still sounding at the end of the file ends at the
take's last frame. `kind` is `drums` for channel 10, or for a track with at
most 16 distinct pitches whose notes are mostly shorter than a quarter of a
beat; the sidecar's `lane_kinds` overrides it per track. Served immutable,
like peaks: a take's `.mid` never changes.

| Status | When |
|---|---|
| 400 | Missing or bad `file` |
| 404 | No such take, or no `.mid` beside it |
| 422 | The `.mid` does not decode |

## `GET /api/bundle?file=&from=&to=`

Streams frames `[from, to)` as a zip a DAW opens in one drop:
`<stem>.wav` at the take's native 32-bit depth with the cut's 3ms fades,
`<stem>.mid` re-based so the region's first frame is tick 0 with the tempo
lane over that stretch, and `<stem>.manifest.json`. Nothing is written to
disk. Named `<label or stem> <m.ss>-<m.ss>.zip`, or `<label or stem>.zip`
for the whole take. A take without a `.mid` bundles the WAV alone and the
response carries `X-Hindsight-Midi: none`.

| Status | When |
|---|---|
| 400 | Bad `file`, non-integer or inverted frames, past the end, over 10 minutes, shorter than two fades, or a non-32-bit take |
| 404 | No such take |

## `DELETE /api/delete?file=`

Removes the take and every sidecar: `_preview.mp3`, `.peaks.json`,
`.peaks.bin`, `.meta.json`, `.mid` and `.manifest.json`. Takes the `.wav`
name.

```json
{ "status": "deleted", "name": "jam_2026-09-09_145852.wav" }
```

Succeeds whether or not the files were there. 400 if `file` is missing, has a
path in it, or has an extension other than `.wav`.

---

## Names that are kept on purpose

`jam_saves` and `GET /api/jams` predate the rename to Hindsight. They keep
their names deliberately: the endpoint is baked into installed PWAs and cached
service workers, and renaming it would break them for no gain.
