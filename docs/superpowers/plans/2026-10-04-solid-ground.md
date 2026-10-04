# Solid ground — step 1 of the editing-model roadmap

**Spec:** [editing model](../specs/2026-10-03-editing-model-design.md),
"Fixes to the base app". **Checks:** [guide](../../guide.md), the "step 1"
lists in §3 and §4. **Branch:** `solid-ground`, stacked on `tape-design`.

Invisible on purpose: the app looks the same afterwards, it just stops losing
edits and does less work on the Pi.

**Local build note.** This sandbox can't reach `proxy.golang.org`, so builds
use a scratch modfile with `golang.org/x/sys` replaced by a GitHub clone. The
repo's `go.mod` is untouched. CI is unaffected.

## Decisions taken while planning

- **Creation time.** It comes from a `created` field written at save, cut and
  phone upload. A take that predates the field gets it from its `jam_<ts>`
  name (local time), and failing that from its modification time. Nothing is
  written during a list request. The spec said "stamp from mtime on first
  sight"; parsing the name gives the same answer without a write on a GET.
  The spec is updated to match.
- **Flag ids.**
  - A new flag gets `r` plus 8 random hex characters. A legacy flag with no
    id reads as `f<frame>`, which is deterministic, so ids are stable across
    polls before anything is written.
  - `NormalizeFlags` dedupes by id, and by frame only for flags with no id.
    That keeps today's behaviour for old sidecars and old clients.
  - The whole-array PATCH stays, for scripts and compatibility; the UI stops
    using it.
- **The per-take lock** is a keyed mutex in `internal/audio`: `LockTake(wav)`
  returns an unlock, and `UpdateMeta(wav, fn)` is the locked read-modify-write
  helper. The bundle package uses `UpdateMeta` for its downbeat writes.
- **Atomic saves.**
  - Save and Cut write the WAV to `.<name>.part` in the same directory. A
    dot-prefixed name with a non-`.wav` extension is invisible to
    `ListTakes`.
  - The sidecars are written under the final names, with cue points into the
    `.part` file, and the WAV is renamed into place last.
  - The exporter never reads the WAV, so it gets the final path.
  - A `.part` file left by a crash is removed at startup.

## Tasks

1. **Flag ids and normalisation** (`internal/audio/meta.go`). `Flag.ID`,
   `EnsureFlagIDs`, `NewFlagID`, and dedupe by id. Tests cover legacy
   behaviour unchanged, ids assigned, and same-frame distinct ids kept.
2. **The per-take lock** (`internal/audio/takelock.go`): `LockTake` and
   `UpdateMeta`. Route `stampTempo`, `stampFlags`, the exporter's downbeat and
   the MIDI cut's downbeat through `UpdateMeta`, and hold `LockTake` across
   the PATCH handler and cue writes. A test: 50 concurrent `UpdateMeta`
   calls, each adding a flag, keep all 50.
3. **Creation time** (`meta.go`, `save.go`). `Meta.Created`, stamped at Save
   and Cut. `ListTakes` uses `created`, then the name, then the modification
   time. A test: rewriting a take's cue chunk doesn't change its place in
   the list or its prune order.
4. **Atomic Save and Cut** (`save.go`, `cut.go`), plus the startup sweep of
   stale `.part` files. Tests: a listing during a save never shows the take
   until it's complete; a cut's failure leaves nothing behind.
5. **Granular flag endpoints** (`internal/api`):
   - `POST /api/take/flags?file=` with `{frame, label}`;
   - `PATCH /api/take/flags?file=&id=` with `{frame?, label?}`;
   - `DELETE /api/take/flags?file=&id=`.

   Each runs under the lock, validates against the take's length, and
   rewrites cue points. Each returns `{flag, flags, cue_error?}`. Tests
   include two clients adding flags concurrently and both surviving.
6. **The UI moves to them** (`web/static/lib/takes.js`, `lib/wave/page.js`).
   Add, label and delete become granular calls. The take page loads with
   `GET /api/take?file=` and refetches on returning to view, merging the
   server's flags, label and BPM, and the selection unless an edit is
   pending.
7. **`GET /api/take?file=`** returns one take, in the list's shape.
8. **The `/api/jams` cache** (`internal/audio/takelist.go`).
   - One `ReadDir`, then `Info()` per entry: every sidecar's size and
     modification time come from the same listing.
   - A per-take signature (the WAV, `.meta.json`, and whether the preview,
     peaks and `.mid` exist), with the take struct cached by signature.
   - The ETag is a hash of the signatures, so a 304 costs no JSON, no header
     parsing and no sidecar reads.
   - Tests: the ETag is stable; it changes on a meta write or a new preview;
     the cache drops deleted takes.
9. **Smaller data fixes.**
   - The trim PATCH is bounds-checked against the take's length.
   - Cuts carry `lane_kinds`, and the source's downbeat shifted onto the cut's
     grid (the first bar line at or after the cut's start when a BPM is
     known, otherwise only a downbeat inside the region).
   - Cut labels become `<label> · m:ss–m:ss`.
   - Pruning runs after a cut (`Saver.Prune`).
10. **Slices play the configured pair** (`slice.go`). A take with more than
    two channels slices to the `SAVE_CHANNELS` pair, as previews and renders
    already do; `SliceBytes` follows.
11. **Shares are queued:** a one-slot semaphore around `RenderMP3`, released
    on completion or client cancel.
12. **A peaks pyramid** (`internal/audio/pyramid.go`).
    - What it is: a `.peaks.bin` beside each take, holding min and max per
      256-frame bucket for each written channel, as int16.
    - When it's written: at save and cut from the data in hand, and lazily
      for old takes on their first range request.
    - How it's used: `RangePeaks` aggregates from it whenever an output bucket
      spans at least 256 frames, and reads the WAV only for deep zooms.
    - Housekeeping: `RemoveTake` deletes it.
    - Tests: the pyramid's answer matches `RangePeaks` from the WAV within one
      base bucket at the edges, and is identical for aligned ranges.
13. **Docs.**
    - `README.md`: the endpoint count and the "live waveform" picture.
    - `architecture.md`: the waveform page section, plus the new lock, cache
      and pyramid.
    - `api.md`: the index row, the delete sidecars, the new endpoints.
    - `configuration.md`: the sidecar list.
    - `sw.js`: the shell list and cache version.
    - Stale comments in `meta.go`, `api_test.go`, `styles.css`, `takes.js`
      and `share.js`.
    - Spec statuses.

## Verification

- `go vet ./...` and `go test ./...` with the scratch modfile.
- `node --test 'web/static/lib/wave/*.test.js'`.
- A demo-mode smoke test with `curl` against every changed endpoint,
  following the guide's step 1 checks.
- An independent review of the diff before the PR.
