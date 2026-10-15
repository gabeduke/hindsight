# Development

## The demo is the fast path

```bash
RING_SECONDS=120 CGO_ENABLED=0 go run ./cmd/hindsight --demo
```

That runs the whole application — ring, levels, envelope, saving, previews, the
UI — against a synthetic 96 BPM loop, with no hardware and no PortAudio.

`CGO_ENABLED=0` is not optional here. Go enables cgo by default wherever a C
compiler exists, and the PortAudio binding's only directive is
`#cgo pkg-config: portaudio-2.0`, so a default build on a machine without the C
library fails with `Package 'portaudio-2.0' not found` before anything runs.
The build tags in `internal/audio` mean the flag costs nothing: `CGO_ENABLED=0`
selects `source_nocgo.go`, and the demo source never needed the device path.

`RING_SECONDS=120` deliberately shrinks the ring. The default is the Pi-sized
`900`: 900 × 48000 × 8ch × 4 bytes is a ~1.38 GB allocation at startup, and the
ribbon takes fifteen real minutes to fill, so you would spend most of a session
looking at an empty one. Two minutes fills in two. The cost is one button — the
UI hides any capture tier longer than the ring, so you get `30s`, `2m` and
`Full 2m` but not `7m`; see [configuration.md](configuration.md). The README
and `scripts/screenshots.mjs` use the same 120. CI uses 30, because it only
needs the process to boot.

Anything that is not specifically about the audio device can be developed and
tested this way, and CI checks that the demo still boots without cgo on every
run. That includes MIDI: the demo's sequencer plays along with the loop, so a
demo take gets a `.mid` and a manifest, and `scripts/midi-calibrate.py --note 36`
run on it should report a median offset within a couple of milliseconds. Its
spread will be wide: the demo's bass and hats never stop, and the transient
detector is written for isolated hits, which the real rig can play and the demo
cannot. The rawmidi readers are
tested against FIFOs standing in for device nodes, so the hotplug and
backlog behaviour is covered on a Mac too.

**Port 5000 is occupied by ControlCenter on macOS** (AirPlay Receiver). Use
`PORT=` for anything you run locally:

```bash
RING_SECONDS=120 OUTPUT_DIR=/tmp/hindsight PORT=5173 \
  CGO_ENABLED=0 go run ./cmd/hindsight --demo
```

`--version` prints the build version and exits. It reads `dev` unless the
binary was stamped by the release workflow.

## Building against real hardware

PortAudio is cgo, so the C library and headers have to be present:

```bash
brew install portaudio            # macOS
sudo apt install portaudio19-dev  # Debian / Raspberry Pi OS
go build ./cmd/hindsight
```

A macOS build compiles and runs, and will try to open whatever PortAudio
enumerates there. Useful for exercising the device path; it is not the target,
and no macOS interface has been tested against it.

## Testing

```bash
gofmt -l .
go vet ./...
go test -race ./...
./scripts/test-release-scripts.sh
```

`test-release-scripts.sh` covers `next-tag.sh` and `changelog-entry.sh` — the
two shell scripts the release workflow depends on, which otherwise would only
ever be exercised by a real release — plus the updater behind the Update
button and `release.yml`'s release filter. It needs Linux (bash 4 and
`flock`); `AGENTS.md` has the container command for running it on a Mac.

The JavaScript under `web/static/lib/` has tests under node's built-in
runner — no package.json, no dependencies. The globs name each directory, so
the full command is in `AGENTS.md`, kept in step with `ci.yml`.

### Checking the waveform page by hand

The gestures and the share flow are not covered by the node tests, so after
touching `view.js`, `overview.js`, `share.js`, `rising.js` or `page.js`, check by hand:

- **Overview strip** — drag it to pan the main waveform, tap to jump, double-tap
  to fit the whole take
- **Pan** — one-finger drag on the main waveform slides the view under the
  finger; pinch zooms
- **Hold-select** — press and hold on the main waveform for ~350ms until a band
  appears under the finger, then drag to draw a region
- **Edge auto-scroll while selecting** — holding the drag near either edge of
  the main waveform during a hold-select scrolls the view in that direction
- **Implicit loop** — playback loops the region with no Loop toggle to find;
  clearing the region returns to plain playback from the cursor
- **Fit quiet takes to the height** — a quiet take's waveform fills the
  canvas with the fit toggle on (the default); turning it off draws the
  take at its true amplitude. The toggle is Fine tune's `Waveform` row,
  between `Position` and `Downbeat`
- **Region length** — Fine tune's own `Region` row, the first row of the
  grid, shows the length in seconds, and bars too when the take has a BPM;
  it reads `—` with no region. The action row beside Play is unchanged: it
  shows `whole take`, or just the start/end times
- **Fine tune** — the disclosure's rows, in order: `Region` (the length),
  the `Start`/`End` nudges, the `Position` readout, the `Waveform` fit
  toggle and the `Downbeat` reset, then Export as take and Delete region —
  all of them moving the same region the hold drew
- **Share on a phone** — over `tailscale serve` (HTTPS), the button opens the
  share sheet with the rendered MP3; over plain HTTP it falls back to
  Download
- **Export as take** — produces a new take with declick fades at the region's
  edges
- **Rising notes (bench)** — at 860px and wider a take with MIDI is two
  columns; press Play and bars grow out of the keys and rise, drum hits
  flash their pads; pause freezes the picture; tapping the wave to seek
  redraws it; a region loop wraps the rise with it
- **Rising notes (phone)** — the header's Notes button opens the pane
  fullscreen with its own Play and bar.beat readout; the back gesture or the
  header's back link closes it and playback carries on
- **Speed chip** — ½× slows the audio and the rise together with the pitch
  kept; a region loop ignores it and plays at 1×

The rest of the UI is checked by hand and, when something needs it, by a
throwaway Playwright script in a scratch directory. Those are not committed;
there is no runner to add one to.

## Deploying to a Pi

`deploy.sh` rsyncs the tree, builds on the Pi (PortAudio is cgo, so it is built
where it runs) and restarts the service. It needs an **untracked**
`deploy.local.env` next to it (a git worktree reads the main checkout's):

```bash
# deploy.local.env — not tracked, never commit it
HINDSIGHT_HOST=pi@<pi-host>
```

```bash
make pi-status           # is the rig idle? (not saving, meters at the floor)
make deploy-dry          # what a deploy would send and delete, by content
make deploy              # sync, rebuild, restart (./deploy.sh)
make deploy-static       # sync web/static only (./deploy.sh --static)
```

A restart clears the ring, so check `make pi-status` and read `make deploy-dry`'s
deletions first. The sync never sends, or deletes on the Pi, `.claude`,
`.playwright-mcp` or `.superpowers`: tooling scratch that belongs to the
checkout it's in.

`--static` takes about a second: no rebuild, no restart. The UI is served with
`http.FileServer` straight from disk on each request, so an HTML, CSS or JS
change is live on the next reload. Use the full deploy only when Go code
changed.

If an ssh agent is holding your key hostage — 1Password installs a global
`IdentityAgent` in `~/.ssh/config`, and signing fails whenever the vault is
locked — set `HINDSIGHT_NO_AGENT=1` in `deploy.local.env` to bypass it with a
throwaway ssh config. `HINDSIGHT_SSH_KEY` picks the key.

The older `DASHCAM_*` spellings of these variables still work, so an existing
`deploy.local.env` keeps working after the rename.

## Play mode

`web/static/lib/play/` is the performance surface — momentary pads rather
than edits, quantised to the tape's grid. It is behind a per-device flag:

```js
localStorage.setItem('hindsight.play', '1')   // on, this device only
localStorage.removeItem('hindsight.play')     // off
```

With the flag off nothing is built: no button, no listeners, no markup. That
is what lets it ship in every release while the kits are being used.

- `surface.js` — the event bus. `press`/`release` in, `arm`/`fire`/`end`/`idle`
  out, on the grid. Pure logic; no DOM, no network.
- `clock.js` — the tape's time in the surface's: the grid the pads land on and
  the ring's sweep, from the frame the poll says is being heard. Pure.
- `keymap.js` — the PC keyboard and touch adapters. Keys are read by physical
  `code`, so the layout stays under the same fingers on any keyboard. Web MIDI
  will be a third adapter over the same bus, which is the point of the split.
- `screen.js` — the surface itself.
- `mount.js` — the flag, and the entry button it creates.

The coupling to the tape page is two events: `hindsight:tape-state`, which
`lib/tape/page.js` dispatches after each poll, and `hindsight:play-transport`,
Play mode's Space, which the page answers exactly as it would ▶. Play mode
imports nothing from the page. While it is open it owns the keyboard: it
listens in the capture phase and stops every key, because the page's own keys
(R is ● Rec, 1–4 arm a track) would otherwise fire underneath a jam.

The surface is drawn in its own materials (`--pad-*` in `objects.css`), so it
is the same dark instrument in both schemes; `styles.test.js` keeps its rules
off the scheme's tokens and its classes off everything else.

**The pads are audible.** The sound is in `internal/tape/trick.go`
(`docs/superpowers/specs/2026-10-14-play-mode-sound-design.md`).

**How a trick works.** A trick is a **read head** that leaves the transport
while a pad is held. The transport keeps counting underneath, so on release
the tape is back in time with nothing resynchronised.

**How a press reaches the Pi.** `lib/play/link.js` sends each press and
release over `GET /api/tapes/play` the moment it happens, and the Pi
quantises it on its own render head. Sending on the grid line instead would
add the Wi-Fi trip on top, and the press would land late.

**What comes back.** The Pi sends back two things:
- **The lead:** how long a press takes to be heard. The surface draws it as
  the gap between a pad going dim and going bright.
- **When each press will be heard.** This moves the pad's bright moment to
  match.

**Undo.** None of it touches the tape's State, so a jam leaves undo and
`tape.json` exactly as they were.

**What's tested where:**
- `trick_test.go` checks each trick's shape, and the return in time to the
  sample.
- `play_test.go` checks the socket. A pad sounds while any connection holds
  it, and a connection that drops lets go of what it held.
- `link.test.js` checks the page's side.

`BenchmarkRenderABlock` is the number to watch on a Pi: one 21 ms block with
four tracks, plain and under each trick.

## The two rooms

`web/static/lib/rooms/` is the Studio and the Listening Room
(`docs/superpowers/specs/2026-10-15-rooms-design.md`), behind a per-device
flag like Play mode's:

```js
localStorage.setItem('hindsight.rooms', '1')   // on, this device only
localStorage.removeItem('hindsight.rooms')     // off
```

or *Settings › This device › Two rooms*. It is read once, when a page loads.

With it on, the three tabs are two: **Studio**, the tape page while the tape
is on and Capture while it's off, and **Listening Room**, the takes and a
take's page (`lib/nav.js`, `navTabs` and `studioRedirect`). Two inline
scripts in the pages' heads run before anything draws:

- `studio-redirect`, in `index.html`: `/` goes to the tape page, on the
  `hindsight.tapeOn` the nav cached last time (only a 2xx or a 404 from
  `/api/tapes` is cached).
- `rooms-early`, on every page with the switch: it marks the document, and
  `styles.css` keeps the switch out of sight until `nav.js` has rewritten it,
  so the three old tabs never paint (and shows it anyway after two seconds).

With the tape on, `/` is the Studio, so Capture can't be reached: everything
Capture has is in the Studio, or `pages.test.js` names where it went. The
tape page as the Studio gains Capture's feed above the lanes — the ribbon,
the L/R meters, KEEP (`POST /api/trigger`), Flag now, Phone and Capture's
readouts — and under them the input diagnostic and the about line with
Settings. Their markup is `<template>`s in `tape.html`, so with the flag off
none of it is in the page; `lib/rooms/mount.js` is the only thing the page
loads, and it fetches `studio.js` only with the flag on.

The Studio and the tape page import nothing of each other's. They speak in
events, as Play mode does: `hindsight:crate-changed` asks the page to read
the crate again after the ribbon's Keep as clip.

- `flag.js` — the flag. The other rooms steps import it; keep its API.
- `mount.js` — the tape page's entry: the flag, then `studio.js`.
- `studio.js` — mounts the templates and drives them with Capture's modules.
- `keep.js` — KEEP's request and its Undo, and Flag now's.

## The Listening Room

`web/static/lib/room/` is the Listening Room
(`docs/superpowers/specs/2026-10-15-listening-room-design.md`), on the same
flag as the two rooms. With it on, the takes page is the room seen from the
doorway and a take's page is the chair. With it off, neither page loads
anything of it: `mount.js` reads the flag and stops.

The room doesn't copy the pages it stands in. `shelf-page.js` and
`wave/page.js` each hand `start()` a handle on what they already run — the
rack's list, its sheet and Play all, and the bar; a take, its flags and its
clock — and the room draws itself around them:

- `doorway.js` — the shelves (tapes, this month's takes, the archive by
  month, records), the deck, the turntable, the sketchbook and the dock. The
  rack is still on the page under it: a spine opens the rack's own sheet,
  with the room's card at its head (PUT IT ON, TO THE STUDIO, Play all from
  here, Cut a record, MP3, DAW bundle), and a month's box opens the rack
  filtered to that month.
- `chair.js` — the take page rearranged: its reel window, LCD and keys are
  the deck close up; its name and star are in the sketchbook; In, Out, the
  tempo and the whole page fold under TOOLS. `wave.html?tape=ID` puts a tape
  in the chair, played on the Pi, its sections as read-only notes.
- `shelves.js`, `notes.js`, `record.js`, `swap.js` — what's on which shelf,
  a note's span for the Studio's buffer, cutting a record, and asking before
  taking the Studio's tape. Pure or fetch-injected, and tested without a
  browser.

A record is a take with a mark: `PATCH /api/take` `{"record": {cut, side,
cover}}` (`audio.Record`). The room's colours are materials, in
`objects.css` (`--room-*`), and the same in both schemes;
`room/contrast.test.js` holds every label to 4.5:1. The sketchbook's hand is
Caveat, from `@fontsource/caveat` 5.2.8 on the npm registry (latin 500 and
700), in `fonts/` with its licence.

To try it with something on every shelf, run the demo with `TAPE=true`,
KEEP a few takes, mark one as a record with the PATCH above, and give a take
an older `created` in its `.meta.json` to fill a month's box in the archive.

## The object library

`web/static/lib/objects/` holds the physical things the app draws, one
module each, with their tests beside them: the VU meters (`vu.js`), the reels
and the reel window (`reels.js`, `reel-window.js`), the cassette
(`cassette.js`, `cassette-geom.js`), the ribbon (`ribbon.js` and its draw and
maths), the LCD's words (`lcd.js`), grease pencil (`grease.js`), a flag's
pennant (`pennant.js`) and the output icons (`icons.js`). A page keeps its
layout and behaviour and asks the module for the object.

Two things are objects without a module. The masking tape that track names
and a take's flags are written on is all CSS (`.tt-head .tt-name` and
`.detail-flag` in `styles.css`), so only its marker ink moved, to
`objects.css`. The transport keys are the app's buttons — every `.icon-btn`,
in rules across `styles.css` — and every key colour follows the scheme, so
they stay chrome; their lit materials (`--mute-*`, `--solo-*`) are in
`objects.css`.

`motion.js` holds the shared physics: `ballistic` for a needle (the VU
standard, 300 ms to 99 % with 1 % overshoot), `lag` for a first-order
approach, `spin` for a reel with inertia, and one `Ticker` that every animated
object shares so there is one `requestAnimationFrame` loop rather than one per
object.

`web/static/objects.css` holds what those objects are made of — metal reels,
lit keys, tape oxide, cassette paper and plastic, the VU meters' backlit
faces, the LCD's amber, grease pencil and marker. Every token in it is the
same in both schemes, which is why it has no dark block: an object is an
object, and brown tape is brown in a dark room.
A token that *does* follow the scheme belongs in `styles.css`, next to its
dark value; `lib/objects/materials.test.js` fails if one ends up in the wrong
file, because that mistake is invisible until someone opens the app at night.

Every page loads `objects.css` before `styles.css`. The two declare disjoint
tokens, so the order is for reading rather than for the cascade.

Everything in `motion.js` is frame-rate independent, and `ballistic` is the
exact step response rather than an integrator — so the motion is identical at
120 Hz and at 20 Hz, which is the range a phone pointed at a Pi actually
covers.

**The bench** is at `/objects.html`: every object, on its own, in each of its
states, with a speed control for watching motion at ⅒×, a size slider that
sets every object to one width (Phone, Tablet and Deck are the widths the
cassette gets in Takes on a 390 px phone, an 820 px tablet and a 1280 px
desktop), and *Save a still*, which downloads the bench as it is on screen as
a PNG named for its scheme and width — so a change can be judged against the
picture of what was there before. It is not linked from the app and is not
shipped UI — if the bench and a page disagree, the page is right. It is the
place to judge a change to an object without loading a rig and getting a take
into the right shape.

Adding a directory under `lib/` means adding it to the `node --test` globs in
`.github/workflows/ci.yml`; they are named one by one, so a new directory's
tests are invisible until it is listed.

## Releases

Merging to `main` builds and publishes a release, but only when the merge
changed something a kit runs. `paths` in `release.yml` is that allow-list:
the binary's sources (`cmd/`, `internal/`, `go.mod`, `go.sum`, and
`docs/guide.md`, embedded by `docs/embed.go`), the UI (`web/`), and what
`install.sh` and the updater put on a Pi (`deploy/`, less the hub's cluster
manifests, which Argo reads from `main` directly). A spec, a doc, `AGENTS.md`,
a dev script or the Makefile cuts no release; its commits ride along in the
next one's notes. A merge that touches anything on the list releases, so a
spec landed with its code still ships.

`scripts/test-release-scripts.sh` reads the list from the workflow, and fails
if the archive step packs a path the list doesn't cover.

To skip a release for a change that is on the list, put `[skip ci]` at the
end of the commit subject, as the changelog and hub-image commits do.

What a release publishes:

- a tag `vYYYY.MM.DD.N`, where `N` increments per release that UTC day. It is
  the highest existing suffix plus one, not a count — a deleted tag leaves a
  gap rather than causing a collision
- `hindsight_<tag>_linux_arm64.tar.gz` and `SHA256SUMS`
- a `CHANGELOG.md` entry, committed back to `main` with `[skip ci]`

The binary is built inside a `debian:bookworm` container on an arm64 runner.
Raspberry Pi OS Bookworm ships glibc 2.36 and Ubuntu 24.04 links 2.39, so a
binary built on the bare runner would not start on the Pi.

Nothing about this can be rehearsed before it is on `main` — the first merge
is also the workflow's first run.

## The Python probes

Diagnostics, not part of the runtime. They are in `scripts/` in the repo and
are deliberately not shipped in the release tarball.

| Script | Question it answers |
|---|---|
| `channel-probe.py` | Which USB channel pair carries the master? Holds peak dBFS per channel over a run and prints a verdict per pair |
| `midi-probe.py` | What does the interface actually send over MIDI, and when? Walks three phases and prints a verdict per question |
| `take-envelope.py` | What does a take look like? Reduces a WAV to a base64 amplitude envelope, so a 346 MB take can be judged without copying it off the Pi |
| `midi-calibrate.py` | How far does a take's MIDI sit from its audio? Matches note-ons in the `.mid` to transients in the WAV and prints the `MIDI_LATENCY_MS` to set |
| `midi-dump.py` | What is in a take's `.mid`? Tempo lane, markers, every track's name, message counts, note range and first events with their times, so a file can be checked on the Pi without a DAW |

All three are standard library only — no pip, no virtualenv. What they reach
for differs:

- `channel-probe.py` talks to the HTTP API, so it runs from anywhere that can
  reach the Pi.
- `take-envelope.py`, `midi-calibrate.py` and `midi-dump.py` read the take
  off disk directly and touch no API at all, so they run wherever the files
  are.
- `midi-probe.py` shells out to `amidi`, which comes from **`alsa-utils`**
  (`sudo apt install alsa-utils`); without it the script exits with
  `amidi not found. Install alsa-utils.` It has to run on the Pi, with the
  interface plugged in.

`midi-probe.py` and `take-envelope.py` are also where several of the MIDI and
envelope decisions are argued out, in their docstrings. Worth reading before
changing either subsystem.

## Screenshots

`docs/images/{desktop,tablet,phone}.png` are captured against the demo, never
against real hardware — this repo is public, and a screenshot of the real rig
would put its hostname in the URL bar.

Playwright is not a dependency of this repo — there is no `package.json`. The
script imports it, so it has to be installed somewhere Node's ESM resolver will
find from `scripts/`, which in practice means the repo root:

```bash
npm install --no-save playwright@1.49.0     # creates ./node_modules (gitignored)
npx playwright install chromium

RING_SECONDS=120 OUTPUT_DIR=/tmp/hindsight-shots PORT=15173 \
  go run ./cmd/hindsight --demo &
HINDSIGHT_URL=http://127.0.0.1:15173 node scripts/screenshots.mjs
```

Delete `node_modules/` afterwards; nothing else needs it.

It fills the ring for 45 seconds so the ribbon has structure to show, takes one
capture so the library is not empty, waits for the waveform to actually mount,
and then shoots three viewports at 2× scale. The demo signal is derived from a
sample counter rather than the clock, so the waveform is identical run to run
and a re-shoot produces a comparable image.

## Conventions

**No tracked file carries home network details.** No tailnet name, no MagicDNS
hostname, no LAN or CGNAT address, in code, comments, docs or commit messages.
This repository's history was squashed once to remove exactly that. Use
`$HINDSIGHT_HOST`, `<pi-host>`, `<pi-host>.<tailnet>.ts.net`. Personal
configuration lives in `deploy.local.env`, which is untracked.

**Comments say why, not what.** The expensive findings in this codebase — the
busy-poll, the 7.1 fold, the ALSA backlog, the pre-fader tap — are recorded
next to the code that works around them, because the code alone looks
arbitrary. Keep doing that; it is most of what these docs are made of.
