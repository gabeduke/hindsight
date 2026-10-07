# HTTP API

Fifty-three routes (one, `/api/trigger`, in two forms), twenty-six of them the tape's and its clipboard's, registered in `internal/api/api.go` (`SetupRoutes`). Everything
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
| `POST /api/trigger?from=F[&to=T]` | Save any span of the ring, in absolute frames; no `to` is now |
| `GET /api/jams` | Takes, starred first then newest first. Sends an ETag |
| `GET /api/take?file=` | One take, in the same shape as an entry of `/api/jams` |
| `PATCH /api/take?file=` | Edit a take's label, star, tag, trim, BPM, downbeat, lane kinds and flags |
| `GET /api/tags` | The tags: `{"tags":[{"id","name","color"}]}`, `color` 1–8 a slot in the stripe palette |
| `PUT /api/tags` | Replace the whole tag list (at most 24; names unique, 24 characters). A tag with no `id` gets one |
| `POST /api/take/flags?file=` | Add one flag to a take |
| `PATCH /api/take/flags?file=&id=` | Move or relabel one flag |
| `DELETE /api/take/flags?file=&id=` | Remove one flag |
| `POST /api/take/undo?file=[&op=]` | Undo the newest change to a take, or the one named |
| `GET /api/trash` | Deleted and pruned takes, most recently deleted first |
| `POST /api/trash/restore?file=` | Put a take back from the trash, starred |
| `DELETE /api/trash?file=` | Delete one take from the trash for good (`?all=1`: empty it) |
| `GET /api/export?file=…&file=…` | One zip of several takes: WAVs, sidecars, MIDI |
| `POST /api/flag` | Flag a moment at the ring's newest frame (the main page's *Flag now*) |
| `DELETE /api/flag` | Remove one live mark (`?frame=`), or every one (`?all=1`) |
| `GET /api/peaks?file=` | Precomputed waveform, so phones do not download audio to draw one; with a range, that range's peaks |
| `GET /api/download?file=[&dl=1]` | Stream inline, or force a download |
| `DELETE /api/delete?file=` | Move a take and its sidecars to the trash |
| `POST /api/cut?file=` | Export a region of a take as a new take, with 3ms declick fades |
| `GET /api/slice?file=&from=&to=` | A region as a 16-bit WAV with the same fades a cut gets, for auditioning |
| `GET /api/render?file=&from=&to=` | An MP3 of a region, streamed from ffmpeg with the cut's fades, for the share sheet |
| `GET /api/midi?file=` | The take's `.mid` decoded to notes in frames, one track per device and channel, for the lanes |
| `GET /guide.md` | The user guide, compiled into the binary, for `/guide.html` to render |
| `GET /api/bundle?file=&from=&to=` | A zip of the region: WAV with the cut's fades, the MIDI re-based to it, and its manifest |
| `GET /api/tapes` | The tapes, newest change first, and which is loaded |
| `POST /api/tapes` | A new, empty tape |
| `GET /api/tapes/state?id=` | One tape, with the transport and catch state when it's the loaded one |
| `PATCH /api/tapes?id=` | Name, tempo, bars, loop, a track's mix, a clip's level or nudge, or remove a clip |
| `DELETE /api/tapes?id=` | Delete a tape that isn't loaded, and free the audio only it used |
| `POST /api/tapes/load?id=` | Make a tape the loaded one: the one the transport plays |
| `POST /api/tapes/transport?id=` | Play, stop or locate, now or on the next beat, bar or loop |
| `POST /api/tapes/catch?id=` | Put the last pass, or the last N bars, from an input onto a track |
| `POST /api/tapes/record?id=` | Arm a track (stopped) or punch in at the next bar (playing) |
| `DELETE /api/tapes/record?id=` | End the punch and keep what it covered (`?cancel=1`: keep nothing); disarm |
| `POST /api/tapes/tap?id=` | A free-loop tap: the first waits, the second makes the loop |
| `DELETE /api/tapes/tap?id=` | Forget a first tap |
| `POST /api/tapes/drop?id=` | Put the clipboard, or a span of a take, onto the tape |
| `POST /api/tapes/send?id=` | Send a take, or a selection, onto the tape by its tempo and downbeat |
| `POST /api/tapes/edit?id=` | Lift, copy, split, join, slide, multiply or reverse |
| `POST /api/tapes/mixdown?id=` | Play the loop or the whole tape once and save what the mixer put out as a take |
| `GET /api/tapes/export?id=` | The loaded tape as a zip of stems and a tempo map |
| `GET /api/tapes/clip?id=&clip=` | One clip as a 16-bit WAV, to share |
| `GET /api/tapes/listen?id=` | The loop (or the whole tape) as a 16-bit WAV, to play and record over on a phone |
| `POST /api/tapes/undo?id=`, `POST /api/tapes/redo?id=` | Step the tape's history back or forward |
| `POST /api/tapes/clone?id=` | A copy of a tape, sharing its audio |
| `POST /api/tapes/cleanup` | Delete pool audio that no tape, and no tape's history, uses |
| `GET /api/tapes/peaks?file=` | A pool file's whole-file waveform, or with `from`, `to` and `buckets` just a range of it |
| `GET /api/tapes/slice?file=&from=&to=` | A 16-bit WAV of a range of a pool file |
| `GET /api/clipboard` | What's on the clipboard |
| `GET /api/clipboard/audio` | The clipboard, its tracks summed, as a WAV to audition |
| `POST /api/clipboard` | Copy a take's span or a span of the ring onto it |
| `DELETE /api/clipboard` | Empty it |
| `GET /api/crate` | The clips kept on the crate, newest first |
| `POST /api/crate` | Keep a take's span, a span of the ring, a tape clip, or the clipboard |
| `PATCH /api/crate?id=` | Rename a kept clip, or bring a deleted one back |
| `DELETE /api/crate?id=` | Delete a kept clip, for a week |
| `GET /api/crate/audio?id=` | A kept clip as a 16-bit WAV |
| `POST /api/crate/split` | A take's Split here: two kept clips, either side of a frame |

`GET` routes also accept `HEAD`, except `/api/live` and `/api/phone`, which
are WebSocket upgrades, and `/api/render`, `/api/bundle` and `/api/export`,
which stream.

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

A client treats 4 s without a frame as a dead socket and reconnects (a sleeping
tablet drops it without a close), so a stalled capture looks like one: the
socket is replaced every few seconds until frames come again. That costs
nothing, and the server sends no heartbeat message for it.

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
  "flags": [{ "age_seconds": 1.5, "frame": 24000 }],
  "total_frames": 239520,
  "sample_rate": 48000
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

`total_frames` is the ring's newest absolute frame when the envelope was
drawn, and `sample_rate` its rate: a point `age` seconds back on the ribbon is
frame `total_frames − age × sample_rate`, which is what a span save asks for.

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

## `POST /api/trigger?from=F[&to=T]`

Saves the absolute ring frames `[F, T)` as a take: any span the ring still
holds, ending in the past or now (no `to`). The ribbon's selection and a
flag's *Save from here to now* use it; frames are the clock `total_frames`
and the live flags' `frame` are on.

```json
{ "status": "saved", "name": "jam_2026-10-04_014412.wav", "seconds": 92.4,
  "from_frame": 1234000, "to_frame": 5669200, "clamped": false, "buffered": 900 }
```

- A start older than the ring's oldest frame is moved to it (plus a second,
  once the ring is full and overwriting, re-checked just before the copy
  starts), and `clamped` says so.
- The audio is copied out of the ring in short chunks (`Ring.Range`, a
  fraction of a millisecond each under the ring's lock), the selected pair
  only, and written as it goes, so a long span never holds up recording. If
  the ring overwrites the span while it's being saved, the save fails (409)
  and nothing is left behind.
- The take's `created` is when its last frame was played (through the clock
  bridge), so the list sorts it by when it happened; its name, like every
  take's, is from when it was saved, so it can never be the name of a take
  deleted earlier, whose pages a phone may have cached. Its BPM is read over
  the span's own times. Live flags inside it come with it, and
  MIDI is exported for the span as for any save. `MIDI_SNAP_BARS` doesn't
  move it: the span is what was selected.

| Status | When |
|---|---|
| 400 | `from` or `to` isn't a frame number, or `to` isn't after `from` |
| 409 | Nothing is buffered, or the span is no longer (or not yet) in the ring |
| 507 | Free space is below `MIN_FREE_GB`, even after emptying the trash |
| 500 | The write itself failed |

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
  "tag": "t3f9a01",
  "bpm": 96,
  "flags": [{ "id": "f100", "frame": 100 }, { "id": "r9c41e0a2", "frame": 900, "label": "drop" }],
  "downbeat_frame": null,
  "lane_kinds": { "bento ch1": "notes" },
  "source": { "name": "jam_src.wav", "start_frame": 1000, "end_frame": 9000 }
}]
```

`source` is present only on a take that was cut from another (see
`POST /api/cut` below); it is absent for a take saved from the ring.

`origin` is `"phone"` on a phone recording and `"tape"` on a tape mixdown, and
absent on a take saved from the ring. A mixdown also has `tape_id`, the id of
the tape it was mixed from, so the shelf can fold one tape's mixdowns together;
mixdowns made before the field existed have none.

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

One take, in exactly the shape of an entry of `GET /api/jams`, plus `undo`
(below). The take page loads with this rather than fetching the whole list,
and fetches it again when it comes back into view, to pick up edits made on
another device. `Cache-Control: no-cache`. 400 for a bad `file`, 404 if
there is no such take.

```json
{ "name": "jam_2026-09-09_145852.wav", "...": "...", "undo": { "count": 3, "next": "rename" } }
```

`undo.count` is how many of the take's logged changes (at most 50) came from
this device, and `undo.next` what `POST /api/take/undo` would undo first:
`rename`, `selection`, `tempo`, `downbeat`, `lanes`, `flag added`,
`flag moved`, `flag renamed` or `flag deleted`.

**Devices.** The pages send `X-Hindsight-Client: <id>`, a random id kept per
browser (up to 32 of `A-Z a-z 0-9 - _`), on every edit and on these reads.
Each logged change keeps it, so a device's Undo walks back through its own
changes and never another's. A request without one (a script) sees, and
undoes, everyone's.

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
| `tag` | string | The `id` of a tag in `GET /api/tags`, or `""` to clear it; any other id is a 400. A take whose tag has since been dropped from the list reads as untagged. Not undoable |
| `trim` | `{start_frame, end_frame}` or `null` | `start_frame` must be `>= 0`, `end_frame` must exceed `start_frame`, and `end_frame` must not pass the take's frame count; `null` clears |
| `bpm` | number or `null` | 20–400, rounded to two decimals; rejects NaN and ±Inf; `null` clears |
| `flags` | `[{id?, frame, label}]` or `null` | A full replacement of the take's flags. An `id` that isn't one the server could have made is dropped, and the flag gets a legacy one. Capped at 512; `frame` must be `>= 0` and less than the take's frame count; `null` clears. `label` is sanitized like the take label (control characters stripped, trimmed, 120 runes). Kept for scripts: the UI uses the per-flag endpoints below, because a full replacement from a page that has been open a while silently undoes a flag another device added |
| `downbeat_frame` | integer or `null` | Where bar 1 falls, for the waveform page's grid. `>= 0` and less than the take's frame count; `null` clears |
| `lane_kinds` | `{"<track name>": "drums"\|"notes"}` or `null` | A full replacement of the take's per-lane overrides for `GET /api/midi`'s drum guess. At most 64 entries; keys sanitized like labels; `null` clears |

The response is the merged result, with the take's `undo` state; `undo.op`
is the id of the change this request recorded, for a toast's *Undo*:

```json
{ "label": "warm-up", "starred": true, "trim": null, "bpm": 128, "flags": [], "downbeat_frame": null, "lane_kinds": {},
  "undo": { "count": 2, "next": "tempo", "op": "r1f0c9a3e" } }
```

Each field a person changes, and each flag, is logged in the take's
`.history.json` with its value before and after and the device that made it,
under the take's lock. Starring is not logged. A change by the same device
to the same field within 2 s of the last, starting where it ended, extends
that step, so a held nudge is one step; adding and removing never merge.
`undo.op` is the newest change the request recorded.

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

## `GET /api/tags`, `PUT /api/tags`

The tags the takes are sorted by: a name and a color, one list for the whole
rig, kept in `OUTPUT_DIR/tags.json`. A take names at most one tag, by `id`, in
its sidecar (`tag` on `PATCH /api/take`).

```json
{"tags": [{"id": "t3f9a01", "name": "Ideas", "color": 6}]}
```

`color` is 1–8: a slot in the page's stripe palette (`--stripe-1` …
`--stripe-8`). `PUT` replaces the whole list, so a client sends back what it
read with its change; a tag sent without an `id` is given one, and an `id` is
kept across renames. At most 24 tags; names are sanitized like labels, 1–24
characters, and unique ignoring case. Anything else is a 400 and the saved
list is left as it was.

Dropping a tag from the list does not touch the takes that wore it: their
sidecars keep the id, and a take whose tag is not in the list is untagged.

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
{ "flag": { "id": "r9c41e0a2", "frame": 96000, "label": "drop" }, "flags": [ ... ], "cue_error": "...",
  "undo": { "count": 4, "next": "flag deleted", "op": "r77a0e1d2" } }
```

`flag` is the flag added, changed or removed; `flags` is the take's whole list
afterwards, so the caller can resync; `cue_error` appears only when the
sidecar saved but the cue chunk could not be rewritten; `undo` is as for the
`PATCH`.

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

## `POST /api/take/undo?file=[&op=]`

Undoes one change to a take: this device's newest (see *Devices* above), or,
with `op`, the one with that id (what a toast's *Undo* sends, so it still
means what it said after later edits). The change leaves the log once it is
undone or skipped; a sidecar write that fails leaves it there.

It is undone only if its field still holds what the change left there. If
something else changed it since -- another device, a script -- it is
skipped rather than overwritten:

```json
{ "undone": "flag deleted", "take": { "...": "..." }, "undo": { "count": 1, "next": "rename" } }
{ "skipped": "rename", "take": { "...": "..." }, "undo": { "count": 0 } }
```

`take` is the take afterwards, in the shape of `GET /api/take`. A flag change
rewrites the cue chunk, with `cue_error` as for the flag endpoints. 409 when
there is nothing to undo (or no change with that `op`); 404 for no such take.

## `DELETE /api/delete?file=`

Moves the take and every sidecar (`_preview.mp3`, `.peaks.json`,
`.peaks.bin`, `.meta.json`, `.history.json`, `.mid`, `.manifest.json`) to
the trash, `OUTPUT_DIR/.trash/<name>/`. Takes the `.wav` name.

```json
{ "status": "trashed", "name": "jam_2026-09-09_145852.wav" }
```

Succeeds whether or not the take was there. 400 if `file` is missing, has a
path in it, starts with a dot, or has an extension other than `.wav`; 409 if
an older take of the same name is still in the trash (a new take never gets
a trashed take's name, so only a file put there by hand can). `MAX_SAVES`
pruning goes to the trash the same way.

## `GET /api/trash`, `POST /api/trash/restore?file=`, `DELETE /api/trash`

```json
{ "keep_days": 7, "takes": [ { "name": "jam_…wav", "...": "...", "deleted_at": "2026-10-04T01:18:00Z", "reason": "deleted" } ] }
```

Each take is in the shape of a `GET /api/jams` entry, plus when it was
deleted and why (`deleted`, or `pruned` for `MAX_SAVES`). Most recently
deleted first. Its `preview_name` and `midi_name` aren't downloadable while
it's in the trash; restore it first.

`POST /api/trash/restore?file=` moves it back and stars it, so the next
prune doesn't take it straight back, and answers with the take. 404 if it
isn't in the trash; 409 if a take of that name exists again.

`DELETE /api/trash?file=` deletes one for good (404 if it isn't there);
`DELETE /api/trash?all=1` empties the trash, whatever the clock says about
when things went in.

The trash also empties itself: after 7 days, and, oldest deletion first,
whenever free space falls under `MIN_FREE_GB` -- checked every 10 minutes and
before every save, cut and phone recording, so the trash is never why a
capture is refused.

## `GET /api/export?file=…&file=…`

One zip of up to 100 takes, streamed: each take's `.wav` (stored, not
deflated), its `.meta.json`, and its `.mid` and `.manifest.json` when it has
them, under their own names. Repeated names count once. 400 for no `file`
or a bad one; 404 naming the first take that isn't there.

---

## The tape: `/api/tapes…`

Every tape route answers 404 when the tape is off (`TAPE` unset). One tape is
*loaded*: the one the transport plays and catches go onto. Routes name their
tape with `?id=`. Every change except delete and clone is made to the loaded
tape only, and any other id is refused with 409, so a page that's out of date
can't edit the wrong tape. PATCH, load, undo and redo answer with the new
state, as `GET /api/tapes/state` would; create and clone with the tape; catch
and drop with the clip.

Errors: 400 for a bad parameter, a track or clip that doesn't exist, or a span
that runs past the end of the tape; 404 for a tape that doesn't exist (to
state, load, delete or clone); 409 for a tape that isn't the loaded one,
nothing to undo, or a catch that can't happen (not lined up, no complete
pass, not in the ring yet or gone from it, or the output slipped against the
recording during the span); 507 for low disk.

### `GET /api/tapes`, `POST /api/tapes`

```json
{ "loaded": "2026-10-04_song-one",
  "tapes": [ { "id": "2026-10-04_song-one", "name": "Song one", "created": "…", "bpm": 120,
               "bars": 1, "seconds": 2, "clips": 1, "size_mb": 0.4, "modified": "…" } ] }
```

`POST` takes `{name, bpm?, bars?}` and answers with the new tape. A tape's id
is its creation date and a slug of its name. A new tape has `TAPE_TRACKS`
tracks, every one on bus A at −6 dB; with `bpm` and `bars` it starts with that
loop, otherwise its first loop sets the tempo.

### `GET /api/tapes/state?id=`

```json
{ "tape": { "id": "…", "name": "Song one", "sample_rate": 48000, "length": 17280000,
            "grid": { "frames": 96000, "bars": 1 }, "loop": { "in": 0, "out": 96000, "on": true },
            "tracks": [ { "n": 1, "bus": "A", "gain_db": -6, "pan": 0,
                          "clips": [ { "id": "c1a2b3c4", "file": "audio/drop_….wav", "src": 480,
                                       "frames": 96000, "at": 0, "layer": 0, "gain_db": 0, "source": "take" } ] } ] },
  "loaded": true, "undo": 1, "redo": 0, "bpm": 120,
  "sources": [ { "name": "aux", "leaks": [], "clean": true, "peak_db": -120 } ],
  "live": { "playing": true, "pos": 41984, "heard": 37888, "delivered": 229376, "late": 0,
            "output": "Demo loopback (the demo source hears it)", "delta": 2048, "aligned": "exact",
            "cycles": [ { "out": 96000, "in": 0, "len": 96000 } ], "failed": [] } }
```

- **Frames throughout.** `grid.frames` is the first loop's exact length, and
  the tempo is derived from it (`bpm`), because a bar at most tempos isn't a
  whole number of frames.
- **A clip** plays `frames` of its pool `file` from `src`, at tape frame
  `at`. The file carries handles either side, where the source had them:
  `TAPE_HANDLE_S` (2 s by default), and never less than the 10 ms the
  crossfades read, so a trimmed edge can be dragged back out. `layer` 0 is the
  base; a catch onto audio goes on a layer above it, summed. `source` is
  where it came from, and `clean` is set when no tape bus was in that source.
  A caught clip has `peak_db`, its loudest sample when caught (−120 for
  digital silence), so the page can say when a catch came from a source with
  nothing in it.
- **`sources`** lists what a catch can take from, and whether each is clean
  on this tape: no unmuted audio on a bus that leaks into it. `peak_db` is
  its meter: the loudest sample of the last 0.3 s, in dBFS (−120 for digital
  silence; absent with no capture, or when no audio has arrived since the
  last reading, so a meter doesn't hold what it heard before a dropout).
- **`live`**, only for the loaded tape:
  - `pos` is the render head and `heard` the frame the device is playing.
  - `delta` is ring frame minus output frame: where what the tape played
    lands in the capture. `aligned` is `exact` when the output says (the
    demo), `locked` when it's been measured by correlation, `estimated`
    from the clocks alone, and `none` before anything is known; catches
    need anything but `none`, and a clip records how its catch was lined
    up in its own `aligned`.
  - `output` is the device the tape plays through, "" while it's away.
  - `count_in` is the frames of count-in left; `record` is the punch or
    armed track, if any; `tapped` is set while a free loop's first tap
    waits for the second.
  - `cycles` are the last complete passes of the loop, as played (a pass
    begun before the loop was moved isn't one); `late` counts device periods
    played as silence because nothing was rendered in time;
    `failed` lists pool files that couldn't be read.
  - `mixdown` is the last mixdown ([below](#post-apitapesmixdownid)).
  - `clock`, when the tape leads (`TAPE_CLOCK=lead`): `{"mode": "lead",
    "devices": […], "pulses": N, "running": bool}` -- the devices it's
    sending to, the pulses sent, and whether the followers have been started;
    in the demo also `heard_bpm`, the tempo its stand-in follower hears.

`HEAD` is accepted. It's polled a few times a second, so it's `no-store`.

### `PATCH /api/tapes?id=`

Any of:

All of it is one change: if any field is refused, none is made.

| Field | Change |
|---|---|
| `name` | Rename (not undoable) |
| `click` | The metronome on bus A while playing, on or off (not undoable). A new tape has it on; the first catch or drop turns it off |
| `tempo: {bpm, bars}` | Set the tempo of an empty tape: 20–400 BPM, 1–64 bars. Refused once the tape has audio |
| `bars` | Relabel the loop's bar count (1–64) without changing its length |
| `loop: {in?, out?, on?}` | The loop, in tape frames |
| `track: {n, name?, bus?, gain_db?, pan?, mute?, solo?}` | A track's mix: bus `A` or `B`, gain −60..12 dB, pan −1..1 |
| `clip: {id, gain_db?, nudge_ms?, remove?, tile?}` | A clip's level (−60..12 dB), its nudge (±500 ms), take it off, or `tile`: copies end to end to the loop's end wherever its layer is free (400 if there's no room) |

Each PATCH is one undo step. Changes to the same track's level or pan, or the
same clip's level or nudge, within 2 s of each other are one step, so a
dragged slider undoes in one go.

### `DELETE /api/tapes?id=`, `POST /api/tapes/load?id=`, `POST /api/tapes/clone?id=`

Delete answers 409 for the loaded tape. It then frees, in the background,
every pool file that no remaining tape uses, counting undo histories. Load
stops the transport at the loop's start and answers with the state. Clone
takes an optional `{name}` and answers with the new tape; it shares the
original's pool files.

### `POST /api/tapes/transport?id=`

`{"action": "play" | "stop" | "locate", "quantum": "now" | "beat" | "bar" | "loop", "pos": F, "count_in": true}`.
`count_in` starts a play with a bar of click, from the playhead's bar.
The action takes effect on the exact output frame its quantum falls on
(`now`, the default, at the next block). Answers 200 `{"status":"queued"}`,
with `kept` when a stop ended a punch (below).
`play` is 409 when the tape has no output (a build without PortAudio);
`locate` still moves it. Loading a tape stops the transport and forgets the
passes played, so a pass of one tape is never caught onto another.

### `POST /api/tapes/catch?id=`

`{"track": 2, "source": "aux", "pass": 1}` catches a whole pass of the loop:
1 is the last complete one. `{"out": F}` instead names a pass by the output
frame it began at (a `cycles` entry's `out`), so a tap catches the pass that
was on screen even if another has finished since. `{"track": 2, "source": "aux", "bars": 4}` catches
the last 4 bars up to the last bar line the ring has heard. `replace: true`
clears what's under it instead of adding a layer.

The span is the range of the ring that heard what the tape played then, by
`delta`, written once into the pool with handles either side (as much of
`TAPE_HANDLE_S` as the ring has: before it, as far back as the ring holds
short of its oldest second; after it, what had arrived by the catch, at
least 10 ms) and placed where it was played. A catch across the loop's end is split into two clips. It
waits up to two seconds for the newest audio to reach the ring. Answers
`{"clip": …}` (the part played first, when split).

### `POST /api/tapes/record?id=`, `DELETE /api/tapes/record?id=`

`POST {"track": 2, "source": "aux", "replace": false}` arms the track while the tape is stopped
(`{"record": {"state": "armed", …}}`), or punches in while it plays
(`"state": "on"`). Nothing is recorded specially -- the ring always is; a
punch notes the output frame it was asked at, less a quarter second (`from`),
so a Rec just after a downbeat means that bar. 400 on a tape with no tempo
(a punch needs bars); 409 if a track is already recording.

With a track armed, the next `play` counts in a bar of click and plays from
the playhead's bar, and the punch starts there.

`DELETE` ends it and keeps what it covered, answering
`{"kept": {"clip": …, "frames": F, "track": 2}}`: with the loop on, the last
full pass inside it; otherwise, or with no full pass, the bars from the first
bar line it played to the last complete one before the tape stopped, moved,
or the punch ended. What wrapped round the loop is placed in pieces where it
played; `clip` is the first piece and `frames` all of it. A punch ended
before the tape reached a bar line (in its count-in) keeps nothing:
`{"kept": null}`. A `stop` during a punch stops the tape first, then does the
same, and its answer carries `kept`; if the catch fails, the tape has still
stopped. `?cancel=1` keeps nothing; on an armed track, it disarms. 409 if
nothing is recording.

### `POST /api/tapes/tap?id=`, `DELETE /api/tapes/tap?id=`

`POST {"track": 1, "source": "aux"}` on an empty tape with no tempo. The tap
is timed when it arrives and turned into a ring frame by the capture's clock.
The first answers `{"stage": "first"}`; it's forgotten after two minutes, or
if the next names another track or source. The second snaps both to the
strongest attack in the source from 250 ms before to 50 ms after, makes the
span the first loop on the track -- its bar count the one nearest the last
tape's tempo, or 90 BPM -- and starts it playing in phase, answering
`{"stage": "loop", "clip": …, "bpm": 96, "bars": 1}`. Taps closer than half
a second, or making a tempo outside 20–400 BPM, are 400; a tape with a tempo
takes no taps (400). `DELETE` forgets a first tap.

### `POST /api/tapes/drop?id=`

`{"track": 1}` drops the clipboard: at the playhead (what's heard, while
playing), on that track and the next for each further clipboard track,
replacing what's under it; or, on an empty tape with no tempo, as its first
loop, its bar count the one nearest the last tape's tempo. Stopped, the
playhead moves to the drop's end. Answers
`{"clip": …, "tracks": 1, "end": F}` once the playhead has moved; 409 if the
clipboard is empty, 400 if its tracks don't fit from that one, it would run
past the end of the tape, or, as a first loop, it makes no tempo of 20–400
BPM. A clipboard longer than 60 s dropped on an empty tape isn't a first loop:
it's laid down with the loop off, and the tape has the clipboard's tempo, if
it has one, else none. A drop during a count-in lands where the tape will start, and doesn't
move it. `{"track": 3, "merge": true}` is a merge drop: every clipboard track
onto that one track, layered, and `tracks` is 1.

`{"take": "jam_….wav", "from": F, "to": T, "track": 1, "bars": 0}` copies
frames `[from, to)` of a take into the pool (its `SAVE_CHANNELS` pair, for a
multichannel take). On an empty tape with no tempo, it becomes the first loop
at bar 1, `bars` long (0: the bar count that puts it nearest 90 BPM), unless
it's longer than 60 s, when it's laid down as it is with the loop off and no
tempo.
Otherwise it goes at the playhead, replacing what's under it, and is refused
if it would run past the end of the tape. Answers `{"clip": …}`.

With `"at": F` the span goes at tape frame `F` instead -- how a part recorded
on a phone over the tape goes back where it was played. It's layered on what's
there unless `"replace": true`. `"loop": {"in": I, "out": O}` says it was
played over that loop going round: it must still be the tape's loop (409 if
it was moved or turned off meanwhile), the part must sit inside it and be no
longer than it, and a span that runs past Out carries on from In, as two clips
on one layer. `"source": "phone"` labels it. Answers
`{"clip": …, "clips": […]}`: the first, and all of them.

### `POST /api/tapes/send?id=`

The take page's **Send to tape**. `{"take": "jam_….wav", "track": 1}` sends
the whole take; with `"from": F, "to": T` (both, in take frames) just that
span. The Pi reads the take's `bpm` and `downbeat_frame` from its sidecar, so
what it uses is what's saved, and places it by what it finds:

- **With a tempo** (20–400 BPM): one clip, loop off, no loop made. The
  take's downbeat goes on a tape bar line; a span that starts before the
  downbeat sits that far before it, and one that starts after sits as far
  past the bar line before it as it does in the take. If that is before the
  tape's start, it all moves on by whole bars. On a tape with no audio, the
  tape takes the take's tempo (4 bars, as the empty-tape form does) and the
  downbeat goes on bar 1 or, with a count-in, as early as it can. On a tape
  with audio and the same tempo (within 0.1%) it goes on the first bar line at
  or after the playhead, replacing what's under it. With another tempo, or
  none, it goes at the playhead as it is, unstretched, with a `warning`.
- **With no tempo:** on an empty tape, a span up to 60 s is the first loop
  (as a first-loop drop); a longer one is one clip, loop off, and the tape
  gets no tempo. Otherwise it goes at the playhead.

Answers `{"clip": …, "mode": "grid" | "first-loop" | "linear" | "as-is",
"bpm": 120, "tempo_set": true, "bar": 2, "warning": "…", "end": F}`: `bpm` is
the tape's tempo afterwards, `bar` the tape bar (from 1) the take's downbeat is
on (left out when a selection doesn't include the downbeat), `end` the tape frame after the clip. Stopped, the playhead moves to the
start of the clip. 400 for a span that isn't in the take, a take longer than a
track, or one that would run past the end from where it lands; both name the
limit in minutes and `TAPE_LENGTH_S`. 404 for no such take, 409 for a tape that
isn't the loaded one.

### `POST /api/tapes/edit?id=`

The tape's editing (step 7a): `{"op": …, "track": 1, …}`, each edit one undo
step. Nothing is cut out of any audio: an edit only changes which part of a
pool file a clip plays and where. Answers the tape's state, as
`/api/tapes/state` does, with `"edit": {"op": …, "clips": N, "frames": F}`
added.

| `op` | Takes | Does |
|---|---|---|
| `lift` | `track`, or `"all": true` | The loop's In to Out, on that track or every track (kept apart, so the clipboard has four), onto the clipboard, leaving silence. The answer's `edit.clipboard` is the new clipboard |
| `copy` | `track`, or `"all": true`; or `clips` | The same, leaving the tape as it is. With `clips` (ids), those clips instead, as they lie: a clipboard track for each track from the highest of them to the lowest, each clip as far from the first as it is on the tape |
| `split` | `track`, `pos` (left out: the playhead) | Cuts every clip on the track that runs across `pos` in two there, on every layer |
| `join` | `clip` | Joins a clip to the next on its layer, if that one carries straight on in the same recording at the same level and nudge: what a split made |
| `slide` | `clip`, `at`, `to` | Moves a clip to start at `at`, on track `to` (left out or 0: its own track; not `track`, which every edit sends as the selected one), on the lowest layer free there. The page snaps `at` to the grid; the server takes it as given |
| `multiply` | | Doubles the loop: everything in it is copied into the span after it, replacing what was there, and Out moves on by the loop's length. `edit.frames` is the new length |
| `trim` | `clip`, `edge` (`in` or `out`), `at` | Moves the clip's start (`in`) or end (`out`) to tape frame `at`. Trimming the start moves `at` and `src` together, so the audio stays where it was played. Clamped: either edge no further out than where its pool file still has the 10 ms overhang beyond it (or where the clip already starts or ends, if further), neither past the clip beside it on its layer or the tape's ends, and at least 10 ms left. `edit.clip` is the clip as trimmed |
| `repeat` | `clip`, `count` | Lays `count` copies (1–64) of the clip end to end after it on its track, all on one layer so they crossfade where they meet: the clip's own, if it's free for them all, else the lowest free for them all. The copies are new clips of the same audio, not linked. 400 for a count out of range or copies that would run past the end of the tape |
| `move` | `clips`, `dt`, `dtrack` | Moves the clips `dt` frames later and `dtrack` tracks down, together, each onto the lowest layer free where it lands (the lowest of them first, so parts stacked stay stacked). Refused whole if any would go before the start, past the end, or off the tracks |
| `remove` | `clips` | Takes the clips off the tape |
| `duplicate` | `clips` | Lays a copy of the clips right after them, the earliest copy where the last of them ends, each on its own track on the lowest layer free there |
| `reverse` | `clip`, or `clips` | Plays the clip backwards (or each of `clips`, as one undo step): its audio, with its handles either side, is written reversed to a new pool file, and the clip plays that, with `reversed: {"file", "end"}` naming where it came from (frame i of the new file is frame end−1−i of `file`). On a reversed clip, plays it forwards again from the original file, with no new file |

400 for a lift or copy with no loop, or nothing in it; a split with no clip
across `pos`; a join with nothing to join; a slide off either end of the tape, or onto a
track that doesn't exist;
a multiply that would run past the end; a trim with no `at`, no such `edge`,
or no room at all; a move, remove, duplicate, reverse or copy of `clips` with
none, or one that isn't there; a move of nowhere, or one that would take a
clip off the tracks or either end of the tape; a duplicate or repeat that
would run past the end; a reverse or trim of a clip that changed meanwhile, or a
reverse of one whose audio is shorter than it; or an unknown `op`. 409 for a
tape that isn't the loaded one; 507 when a reverse would need disk the tapes'
volume doesn't have; 500 when the audio a reversed clip turns back to can't
be read.

### `POST /api/tapes/mixdown?id=`

`{"all": false}` (or no body) mixes down the loop; `{"all": true}`, or a
tape with no loop, the whole tape, from frame 0 to the end of its last clip.
The tape plays that span once -- the loop ignored, the click silent, a 3 ms
fade at either edge -- then stands back at its start while
`TAPE_MIXDOWN_TAIL_S` more is recorded, and that span of the ring is saved
as a take, as `POST /api/trigger?from=&to=` would save it. The span is found
through the measured Δ alone: `TAPE_LATENCY_MS` is for a player hearing the
tape late, and the tape itself isn't. The take's sidecar gets the tape's
name as its label, the tape's id as its `tape_id`, the tape's tempo as its
BPM, and as `downbeat_frame` the first bar line in it (0 when the span starts
on one, as a loop does).

It answers at once with `{"mixdown": {"id", "tape", "state": "playing",
"from", "to", "tail"}}` (tape frames, and the tail in frames). The tape's
state then carries the same object as `live.mixdown`, its `state` moving to
`tail` once the pass is played, `saving`, and then `done` with `take` (the
take's file name), or `failed` with `error`. A stop, locate or load during
the pass, or a stop, locate, play or load during the tail, cancels it, and
nothing is saved. It also fails, saving nothing, if the renderer fell behind
during the pass (the take would have a gap) or the output slipped against
the recording.

409 if there's no output, no capture or no saver; if the output isn't lined
up yet; or if a mixdown is already under way or a track is recording or
armed. 400 for an empty tape, or a span that with its tail and 5 s spare
wouldn't fit in the ring (the message gives the limit); 507 when the takes'
disk is below `MIN_FREE_GB`. During the pass and the tail, a punch is 409.

### `GET /api/tapes/export?id=`

The loaded tape (409 for any other) as `<name> stems.zip`:

- `<name>/<n> <track name>.wav` for each track with clips: 32-bit float
  stereo, from tape frame 0 to the end of the last clip on any track, so
  every stem is the same length. Each is the track alone through the tape's
  renderer, at its level and pan; mutes and solos are left out.
- `<name>/<name>.mid` when the tape has a tempo: the tempo, 4/4, and the
  loop's In and Out as markers, at 480 PPQ.
- `<name>/MISSING.txt` if any of the tape's audio couldn't be read: those
  clips are silent in the stems.

The zip is rendered as it streams, one export at a time (409 while another
is), and 400 for a tape with nothing on it. A client that stops reading for
30 s loses the download and frees the slot. `HEAD` answers the same status a
`GET` would start with, without rendering anything.

### `GET /api/tapes/clip?id=&clip=`

One clip of a tape as a 16-bit stereo WAV, for the share sheet: frames
`[src, src+frames)` of its pool file at the clip's `gain_db` (not the
track's level or pan), with the 3 ms declick at either end. Named
`<tape> track <n>.wav` (`… reversed.wav` for a reversed clip) in
`Content-Disposition`, with a `Content-Length`; `HEAD` answers the headers
alone. 400 for no such clip, 404 for no such tape, 500 for a pool file that
can't be read. A client that stops reading for 30 s loses the download.

### `GET /api/tapes/listen?id=`

The loaded tape's mix as a 16-bit stereo WAV, for the tape page's *Overdub on
this device*: every track at its level and pan, mutes and solos as they are,
bus A and bus B summed, through the renderer the tape plays with (without the
Sidekick's strips). With the loop on, it's the loop, rendered as a pass after
the first, so its seam crossfades as the tape's does and the file loops
without a click; `all=1`, or the loop off, gives the tape from its start to
the end of its last clip. `click=1` adds the click on every beat (on an empty
tape with the loop off, a bar of it). Headers: `X-Tape-From` and
`X-Tape-Frames` (the tape frames it holds), `X-Tape-Loop` (`true` for the
loop), and `Content-Length`; `HEAD` answers them alone. 400 for a tape with
nothing to hear (and no click asked for), 409 for a tape that isn't loaded.

### The clipboard: `/api/clipboard`

The app's one clipboard, kept in `TAPE_DIR/clipboard.json` so it survives a
restart; 404 when the tape is off.

- `GET` answers `{"clipboard": null}` or
  `{"clipboard": {"tracks": [[clip…]], "frames": F, "from": "jam_….wav", "created": …}, "seconds": 2.5}`.
  Its clips are laid out from frame 0.
- `POST {"take": "jam_….wav", "from": F, "to": T}` copies a take's span: the
  take's pair (`SAVE_CHANNELS`' for a multichannel take, both sides of a mono
  one) is written into the pool with handles either side (`TAPE_HANDLE_S`,
  where the take has them). A take's own WAV is
  never referenced, since flag edits rewrite it.
- `POST {"ring_from": F, "ring_to": T, "source": "main"}` copies a span of
  the ring, in absolute frames (`ring_to` left out: up to now), from a
  `TAPE_SOURCES` pair (left out: `main`, or the first there is). A start
  that has left the ring moves to the oldest audio, a second in, and the
  answer has `"clamped": true`; 409 if the span has left it altogether or
  isn't in it yet.
- Both answer the new clipboard; 400 for a copy longer than a track; 507 for
  low disk.
- `GET /api/clipboard/audio` is its first minute, every track summed, as a
  16-bit stereo WAV, with `Range` and `HEAD`. 404 when it's empty.
- `DELETE` empties it. Its audio stays until a clean-up finds nothing using
  it; the clean-up keeps whatever the clipboard holds. A `clipboard.json`
  that can't be read is reported by `GET` as `error`, and kept from the
  clean-up (every copy is) until `DELETE` clears it.

### The crate: `/api/crate`

The clips you keep, between a take and a tape (step B1), in
`TAPE_DIR/crate.json`; 404 when the tape is off. A kept clip is a window onto
a pool file, as a tape clip is:
`{"id", "name", "file", "src", "frames", "reversed"?, "bpm"?, "source": {"kind": "take" | "ring" | "tape" | "clipboard", "take"?, "from"?, "to"?, "tape"?, "what"}, "created", "deleted"?}`.
`source.what` says where it came from in words (*Tuesday jam, 0:42–1:10*).

- `GET` answers `{"clips": […], "sample_rate": 48000}`, newest first, without
  deleted ones. `?q=` keeps those whose name has it in it, any case;
  `?take=jam_….wav` those kept from that take.
- `POST` keeps one, and answers `{"clip": …, "clamped": false}`:
  - `{"take": "jam_….wav", "from": F, "to": T}` copies the take's span into
    the pool, as the clipboard's copy does, with handles. It's named for the
    take (its label, or when it was made) and where the span starts.
  - `{"ring_from": F, "ring_to": T, "source": "main"}` does the same from the
    ring, clamped as the clipboard's is.
  - `{"tape": id, "clip": id}` keeps a clip of the loaded tape, by reference:
    nothing is copied.
  - `{"clipboard": true}` keeps the clipboard, by reference, when it holds one
    clip (400 otherwise).

  404 for no such take; 400 for a span not in it; 507 for low disk.
- `PATCH ?id=` takes `{"name": "…"}` (1–120 characters) or
  `{"restore": true}`, and answers `{"clip": …}`.
- `DELETE ?id=` marks it deleted: gone from the list, back with `restore` for
  7 days, after which the list lets go of it and a clean-up frees its audio.
- `GET /api/crate/audio?id=` is the clip as a 16-bit stereo WAV
  (`?download=1`: as an attachment), with `HEAD`.
- `POST /api/tapes/drop?id=` with `{"crate": id, "track": 1}` drops it as the
  clipboard drops: at the playhead, replacing what's under it, one undo.
- `POST /api/crate/split` with `{"take": "jam_….wav", "at": F}` is a take's
  *Split here*: two kept clips, the take's frames before `at` and from `at`
  to its end, named *take · A* and *take · B*, and answers
  `{"clips": [a, b]}`. The take isn't changed. 400 unless each half is at
  least 10 ms; 404 for no such take.

404 for a kept clip that isn't there. The crate is a root for the clean-up,
its deleted clips too until they're let go of; a `crate.json` that can't be
read stops the clean-up altogether.

### `POST /api/tapes/undo?id=`, `POST /api/tapes/redo?id=`

Step back or forward one version of the tape: up to 100, kept in its
`tape.json`, shared by every device. 409 when there's nothing to step to.

### `GET /api/tapes/peaks?file=`

The `.peaks.json` beside a pool file, in the shape `/api/peaks` gives for a
whole take. `file` is a clip's `file`; anything outside the pool is 400.
Pool files never change, so it's cached for good.

With `from`, `to` and `buckets` (all three, in frames, as `/api/peaks` takes
them) it computes the peaks of `[from, to)` on demand instead: 400 for a
partial set, a bad range or a range past the end, 404 for a pool file that
isn't there.

### `GET /api/tapes/slice?file=&from=&to=`

A 16-bit WAV of frames `[from, to)` of a pool file, both channels, as
`/api/slice` does for a take (`HEAD` gives the headers and no body). The tape's
clip editor reads the audio round a point from it. 400 for a name outside the
pool, a bad or past-the-end range, or more than 60 s; 404 for a pool file that
isn't there. Pool files never change, so it's cached for good.

---

## Names that are kept on purpose

`jam_saves` and `GET /api/jams` predate the rename to Hindsight. They keep
their names deliberately: the endpoint is baked into installed PWAs and cached
service workers, and renaming it would break them for no gain.
