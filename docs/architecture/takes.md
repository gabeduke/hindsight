# Takes on disk

A take is a WAV in `OUTPUT_DIR` and the sidecars beside it, all sharing its
stem:

| File | Written | Holds |
|---|---|---|
| `jam_<ts>.wav` | at save, cut or the end of a phone recording | The audio, 32-bit, plus RIFF `cue ` points mirroring the flags |
| `.meta.json` | at save or cut, then on every edit | Label, star, selection, tempo, downbeat, flags, lane kinds, creation time, a cut's source |
| `.peaks.json` | at save or cut | 1024 min/max buckets for the whole take, drawn before anything finer arrives |
| `.peaks.bin` | at save or cut; backfilled at startup for older takes | The peaks pyramid: min and max per 256 frames |
| `_preview.mp3` | in the background after a save or cut | What the list plays, and what the waveform page scrubs |
| `.mid`, `.manifest.json` | at save, when MIDI was flowing; a cut gets its region of the source's | The take's MIDI and how it lines up |
| `.history.json` | on every edit a person makes | The last 50 changes, for Undo |

## A take appears only when it's complete

Save and cut write the audio to a hidden `.<name>.part` file, write the
sidecars under the final names, and rename the WAV into place last. The list
only shows `.wav` files, so it never offers a take that is still being
written; a 15-minute save takes long enough that it used to. A take's name
is reserved by creating its `.part` exclusively, so a save and a cut in the
same second can't both write to one file. At startup, a `.part` left by a
crash is removed with the sidecars of the take that never made it, along with
sidecar temp files and any `.meta.json`, `.peaks.json`, `.peaks.bin` or
`.history.json` whose take is gone.

## One writer per take at a time

Every read-modify-write of a take's sidecar holds that take's lock
(`audio.LockTake`, or `audio.UpdateMeta` for the whole cycle): the PATCH, the
per-flag endpoints, the saver's tempo and flag stamps, the MIDI exporter's
downbeat, and `RemoveTake`. The lock also covers rewriting the WAV's cue
chunk, so two cue rewrites never interleave. Before it, two edits landing
together meant the second silently threw the first away. The API handlers
check the take still exists once they hold the lock, so an edit queued behind
a delete answers 404 instead of writing a sidecar for a take that's gone.

Flags carry ids, so an edit names the flag it changes rather than replacing
the list. A flag from before ids reads as `f<frame>`.

## Saving any span of the ring

`Saver.SaveRange` (`internal/audio/saverange.go`) saves absolute ring frames
`[from, to)`, the clock flags already use, so a span picked on the ribbon or
starting at a flag is the audio that was there, however long ago. It reads
through `Ring.Range`: the chosen channel pair only, a chunk at a time under
the ring's lock with the window re-checked before each, and writes as it
goes (`wavWriter`), so a minutes-long span never holds up the ring writer.
`SnapshotAt`, which copies the newest N frames of every channel under one
lock, stays for the capture buttons. The take's name, `created` time and
tempo window come from when its frames were played, through the clock
bridge; MIDI is exported for the span like any save.

## Undo

`internal/audio/history.go`. The API records each edit a person makes -- the
PATCH and the per-flag endpoints, not the saver's own stamps -- as a diff of
the sidecar before and after, under the take's lock: one operation per field
(name, selection, tempo, downbeat, lanes) and one per flag, by id, each with
its JSON value before and after and the device that made it (the pages send
a random per-browser id). The newest 50 are kept in `.history.json`. Each
device's Undo walks back through its own operations only.
A change to the same thing within 2 s, carrying on from where the last ended,
extends that step instead of adding one, so a held nudge undoes in one go;
adding and removing never merge, because a removal's toast needs a step of
its own to undo.

Undo puts an operation's "before" back only while the field still holds its
"after"; otherwise the step is dropped and reported as skipped. The log is
rewritten only after the sidecar, so a failed write keeps the step. That is what
keeps an Undo on one device from overwriting a change made since on another,
and it lets a toast undo its own step by id even after later edits to other
things. There is no redo.

## The trash

`internal/audio/trash.go`. Deleting a take and `MAX_SAVES` pruning both move
the take and its sidecars into `OUTPUT_DIR/.trash/<stem>/` with `rename`,
beside a `trashed.json` saying when and why; restoring moves them back and
stars the take. `takeFiles` is the one list of a take's files that deleting,
trashing and restoring share. Every change to the trash holds one lock
(after the take's own, when both are needed), so emptying can never catch a
take half-moved; a crash half-way leaves sidecars beside a WAV that's in the
trash, and the startup sweep puts them back with it. A new take never gets
the name of one in the trash, and a delete never replaces one there. A janitor empties trash older than 7 days, at
startup and every 10 minutes, and `EnsureFree` empties it oldest first while
free space is under `MIN_FREE_GB`; every write that refuses for low disk (a
save, a cut, a phone recording) calls it first, so the trash is never why a
capture fails. Nothing in the trash is hard-linked, so emptying it frees what
it says.

## When a take was made

The list sorts, and the pruner trashes, by the `created` time in the
sidecar. A take older than that field falls back to the time in its name,
then to the file's modification time. Modification time alone was wrong:
rewriting the cue chunk on a flag edit made an old take look new.

## The list is cached

`/api/jams` is asked by each open page's takes model (`lib/models/takes.js`)
when the take list's revision moves (`push.md`, *The takes' revision*), and
on its fallback poll: every five seconds with no push, every thirty with
it. It costs one directory listing: each take's signature is the size and modification time of
its WAV and sidecar, the sidecar's inode (every sidecar write is a new file,
so two same-size edits within one clock tick still differ), and which other
sidecars exist, all from that one listing. Takes are cached by signature, and the ETag is a hash of the
signatures, so an unchanged list answers 304 without opening a file, and a
changed one re-reads only the takes that changed. The same listing, without
the takes (`TakeList.ETag`), is what the take list's revision watches.

## The peaks pyramid

The waveform page asks `/api/peaks` for ranges as it zooms. Zoomed out on a
long take, a range spans minutes of audio, and answering it from the WAV
meant reading most of the take off the SD card. The pyramid holds min and max
per 256 frames, per channel, as int16 (about 1.3 MB for a 15-minute stereo
take). Any request whose buckets are at least 256 frames wide is answered
from it; deeper zooms read the WAV, which is a short read at that zoom
anyway. It is built in the same loop that writes the WAV, so it costs no
extra read, and it is checked against the take's channels and length before
use. Takes older than the pyramid get one in the background at startup.

## Phone recordings

A phone records into `/api/phone` (`internal/api/phone.go`), and the take is
written as the audio arrives (`internal/audio/phone.go`):

- **Name first.** The take's name is reserved when recording starts, from
  the start time, so the take sorts by when it was played. A marker,
  `.<stem>.phone.json`, holds the phone's rate and the start time.
- **Audio as it arrives.** Chunks are written in order into the `.part` file
  as 32-bit 48 kHz stereo; a chunk that arrives early, after a reconnect,
  waits for those before it. A phone at another rate goes through a
  windowed-sinc resampler (`resample.go`): centred, so the output starts on
  time, and tracked in exact ratios, so a long recording doesn't drift.
- **The pyramid grows** with the audio, so finishing needs no read of the
  take; the whole-take `.peaks.json` is drawn from the pyramid too.
- **Finishing** patches the WAV header's sizes, writes the sidecars, renames
  the WAV into place and removes the marker. A recording whose phone never
  comes back is finished as *Phone (partial)* after ten minutes.
- **Audio on disk is never thrown away.** A write error finishes the take
  from what reached the file; a failure even then leaves the `.part` and its
  marker for the startup sweep.
- **A restart mid-recording** leaves a `.part` with its marker; the startup
  sweep finishes it as a partial take, its length read from the file, rather
  than deleting it as it does an unfinished save, and the preview backfill
  encodes its preview. The phone, still recording, names the oldest chunk it
  holds when it reconnects, and the Pi starts a second partial take there.

The page side is `web/static/lib/phone/`: an AudioWorklet that taps raw float
PCM, an uploader that numbers chunks, keeps them until they're acked and
resends after a reconnect, and the recorder sheet.

## Shares queue

`GET /api/render` runs ffmpeg. Two at once on a Pi compete with the capture
path for CPU, so renders take turns: a second request waits, and gives up
without starting ffmpeg if its client goes away first.
