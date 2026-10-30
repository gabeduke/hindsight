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

**A controller in the demo.** The demo has no MIDI watcher, but with
`TAPE_CONTROLLER` set it starts one for controllers alone, and
`HINDSIGHT_DEMO_CARDS` and `HINDSIGHT_DEMO_SND_DIR` point it at a cards file
and a directory of FIFOs standing in for rawmidi nodes, as the tests do. So a
key "on the controller" is bytes written into the FIFO:

```bash
mkdir -p /tmp/hs/snd && mkfifo /tmp/hs/snd/midiC3D0
printf ' 3 [SMK37          ]: USB-Audio - SMK-37\n                      M-VAVE SMK-37\n' > /tmp/hs/cards
TAPE_CONTROLLER=smk HINDSIGHT_DEMO_CARDS=/tmp/hs/cards HINDSIGHT_DEMO_SND_DIR=/tmp/hs/snd \
  RING_SECONDS=120 PORT=5173 CGO_ENABLED=0 go run ./cmd/hindsight --demo &
exec 3>/tmp/hs/snd/midiC3D0        # the controller plugged in
printf '\x99\x28\x64' >&3          # a pad on channel 10, E2: BREAK held
printf '\x99\x28\x00' >&3          # let go
exec 3>&-                          # unplugged
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
`flock`); on a Mac, run it in a container (below).

The JavaScript under `web/static/lib/` has tests under node's built-in
runner — no package.json, no dependencies. The globs name each directory, so
the full command is in `AGENTS.md`, kept in step with `ci.yml`.

### On a Mac

- `go test ./...` builds the capture path, which is cgo against PortAudio:
  `brew install portaudio` once. Anything that doesn't touch the audio device
  also builds with `CGO_ENABLED=0`. The `ld: warning: … malformed
  LC_DYSYMTAB` lines are linker noise, not failures.
- `test-release-scripts.sh` needs Linux, like the Pi whose updater it tests:
  bash 4 for `mapfile`, and `flock`. Under macOS's bash 3.2 it reports
  failures that aren't real, then stops before its release-filter checks.
  Run it in a container instead:

  ```sh
  docker run --rm -v "$PWD":/w -w /w python:3.12-slim bash -c '
    apt-get -qq update && apt-get -qq install -y git curl >/dev/null &&
    git config --global --add safe.directory /w &&
    ./scripts/test-release-scripts.sh'
  ```

### In a cloud sandbox

Cloud agent sandboxes generally block the Go module proxy, so `go build` and
`go test ./...` fail there on downloads — not on your code. The JS tests,
`gofmt` and the shell tests all run.

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

The rest of the UI is checked by the user flows: `node scripts/flows.mjs`
(`make flows`) drives Gabe's journeys in Playwright against a demo it boots
itself, on a tablet and a desktop profile. The stories, how to run them and
how to write a new one are in [flows.md](flows.md).

### A CSS change that should change nothing

Tidying the stylesheets — a dead rule out, two rules merged, a literal
made a token — is meant to leave every screen as it was, and
`scripts/css-snapshot.mjs` proves it: the computed style of every element
(and its `::before` and `::after`) on the Studio, its ☰, the tape's and
⌗'s menus, the
phone's player pulled up, the Listening Room and its ☰, a take's page,
Capture and the rig, at the three flow profiles, in both schemes.

```bash
node scripts/css-snapshot.mjs --out=/tmp/before.json      # before the change
node scripts/css-snapshot.mjs --diff=/tmp/before.json     # after: element, property, before → after
```

It boots and seeds a demo of its own as the flows do (`HINDSIGHT_BIN` and
`STATIC_DIR` work the same), takes a few minutes, and exits 1 on any
difference. Two runs on one tree diff empty: what moves on its own (clocks,
meters, reels, the takes' file names) is masked the same way each time, as
its header says. Canvas drawing is not a computed style, so a change to a
colour a canvas reads still needs a look.

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
checkout it's in. Nor what the Pi keeps beside the checkout: `hindsight.env`,
the Settings sheet's `settings.json`, the tape, the hub's certificate and
the updater's releases. `test-release-scripts.sh` fails if one comes off
deploy.sh's list.

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
(the play-mode sound design is in git history).

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

The Studio and the Listening Room are views in one document, `shell.html`
(how the shell, the router, the view contract and the engine work is in
[architecture/shell.md](architecture/shell.md), *The shell*). They are the only layout.
`/`, `/tape.html` and `/takes.html` all serve the shell; `/` shows the Studio
when the tape is on (always, now) and Capture otherwise. The header's two
tabs are links the router takes (`lib/nav.js`, `navTabs`). Settings, the rig,
help mode, the guide and Releases are the header's one menu (☰,
`mountHeaderTools`), top right on every page, and the Settings sheet's first
line has the version, Releases, the guide and the rig too.

`lib/shell/views/studio.js` mounts the tape page (`lib/tape/page.js`,
`mountTapePage(ctx)`), the feed, KEEP and the buffer (`lib/rooms/mount.js`),
and Play mode, all gated on its `ctx`. The feed and the buffer still speak to
the tape page in events, as Play mode does: `hindsight:clipboard` tells the
page the buffer changed, and `hindsight:tape-changed` asks it to reload its
tape state (and unfold the lanes if folded via `#tracks-fold-btn`).

- `mount.js` — the Studio view's entry for the feed: it loads `studio.js`.
- `studio.js` — mounts the templates, drives them with Capture's modules, and
  wires the unified Media Player (`#np`) 3-way source switcher (`Feed` ·
  `Tape` · `Shelf`) plus seamless continuation of a carried Shelf take.
- `keep.js` — KEEP's request and its Undo, and Flag now's.

### GRAB and a cue clip's drawer

`web/static/lib/buffer/` is GRAB and a cue clip's drawer (it was the
Studio's buffer, the clipboard made visible; the directory kept its name).
`studio.js` mounts it; its markup is `shell.html`'s `buffer-` templates, the
drawer in the dock above the bar. On the Pi a GRAB is a cue clip with lanes
and a grab (`internal/tape/cuegrab.go`): it copies a span of the ring at
once, by Catch's own arithmetic for the last N bars, with handles of a bar
either side, and the window is trimmed in place. `docs/architecture/tape.md`,
*The cue lane*, has the rest.

It speaks to the tape page in events: it reads `hindsight:tape-state`
(which carries the tape, the armed track and its input, the sources, the
snap and the lanes' view), hears `hindsight:cue-select` from a held pad,
says `hindsight:cue-selected`, and sends `hindsight:tape-changed` after any
change. It draws over the lanes only in a layer of its own (`lanes.js`);
folding them is a class on the body (`fold.js`), which changes heights and
nothing else.

- `buffer.js` — mounts it and drives it: GRAB, the drawer or the sheet,
  DROP, KEEP, TOSS.
- `cueclip.js` — a cue clip as a board (`boardOf`), the dial's arithmetic,
  GRAB's words.
- `model.js` — the numbers, tested: where DROP lands, the window's steps.
- `keys.js` — the drawer's keys, as a table for P3's control bus to fold in.
- `draw.js`, `lanes.js`, `fold.js`, `audition.js`, `api.js`.

## The Listening Room

`web/static/lib/room/` is the Listening Room (its words: *Vocabulary* in
[architecture/rooms.md](architecture/rooms.md)). The shelf is the room seen from the
doorway (`doorway.js`), mounted by `lib/shell/views/room.js`, and a take's
page is Open (`open.js`, on `wave.html`).

The room doesn't copy what it stands in. The room view and `wave/page.js`
each hand `start()` a handle on what they already run — the
rack's list, its selection and Play all, and the bar; a take, its flags and its
clock — and the room draws itself around them:

- `doorway.js` — the shelves (this month's takes, the archive by month), the
  deck (`ReelWindow` driven at 60fps from `NowPlaying.onChange`), and the
  dock (`#np` with its 3-way `Feed` · `Tape` · `Shelf` source switcher).
  A take's notes are the notes drawer's (`drawer.js`, the shell's and
  Open's: `docs/architecture/rooms.md`, *The notes drawer*).
- `open.js` — the take page (`wave.html`) with the rooms' words laid over it:
  `✎ Note`, `GRAB` beside `KEEP`, the take's notes one line each with `▶` and
  `GRAB`, its tag beside its star, and its family lines (`Made from`, `From
  this take`, `Earlier bounces`).
- `shelves.js`, `notes.js` — what's on which shelf, and a note's span for the
  Studio's buffer. Pure or fetch-injected, and tested without a browser.

There are no records any more: a bounce is a take from
a tape, on that tape's spine, and `Meta.Record` (`audio.Record`) on a take
that has it is ignored, not migrated. The Pi still accepts the field; nothing
in the rooms sends it. The room's colours are materials, in
`objects.css` (`--room-*`), and the same in both schemes;
`room/contrast.test.js` holds every label to 4.5:1. The sketchbook's hand is
Caveat, from `@fontsource/caveat` 5.2.8 on the npm registry (latin 500 and
700), in `fonts/` with its licence.

To try it with something on every shelf, run the demo,
KEEP a few takes, bounce a short tape from the tape's name for a take on a
tape's spine, and give a take an older `created` in its `.meta.json` to fill
a month's box in the archive.

## The rig

`rig.html` and `web/static/lib/rig/` are the rig, reached from the device
chip in both rooms' headers.

- **The server owns the picture.** `GET /api/rig` (`internal/rig`,
  `internal/api/rig.go`) builds it from the settings, the tape and what's
  plugged in on every read; the page draws it and never stores one.
- **Profiles** are `internal/rig/profiles/*.json`, embedded: a USB interface
  by its id from ALSA's `usbid`, a MIDI port by name. The Sidekick's taps are
  `TAPE_SOURCES`' default. The demo says its interface is the Sidekick
  (`SetRigUSB` in `cmd/hindsight`), since its routing is the Sidekick's.
- **A cable is a request:** `patch.js` turns a drag, or a choice from the
  keyboard (`picker.js`), into the write that route already takes. A restart
  cable is pending (dashed amber) until `restart_needed` clears; RESTART is
  the settings sheet's own (`restartHindsight` in `settings.js`).
- `desk.js` is what's drawn, from the graph alone; `cables.js` where a cable
  runs; `kinds.js` how each kind is drawn, by width and dash as well as
  colour.
- **The cables are ropes** (R4). Each is a
  `cable` object in a scene on the shared ticker: `page.js` measures the
  sockets' holes and sets each rope's ends, `lib/scene/cable.js` hangs and
  swings it, and `ropes.js` (an SVG renderer) only draws it, in
  `.rig-wires`, which takes no input. `lib/scene/plug.js` has the plug's
  numbers: it snaps into a socket within 24 px of its hole (or over its
  button), and comes out once pulled 48 px. A drag from a socket with one
  cable in it holds that cable's plug; otherwise it draws a new one.
  `gesture.js` holds the calls a drag and its drop make, so they have tests:
  what letting go does (a pulled plug is unplugged only if it's let go over
  no socket at all: onto one it can't go into, nothing changes), whether the
  click a drag leaves behind is spent (it isn't a tap on a rope), and when a
  drop's rope is made again so the new cable carries on from it. The names
  beside the jacks are lifted above the ropes, with a halo, so a rope reads
  as running behind a name (`lib/rig/layers.test.js` holds the stacking).
- **Cables are led, not left to hang.** A rope with only its two ends knows
  nothing of the desk, so it swung across other sockets and through names.
  `route.js` measures the desk (`page.js` hands it every jack's hole and every
  name, title and lamp as rectangles) and finds each cable the cheapest way
  through the gaps: a search on a 4 px grid where crossing something costs a
  great deal, a turn a little, and a lane an earlier cable took costs more, so
  cables between the same places run side by side. What it finds are
  waypoints (`via`) that `lib/scene/cable.js` pins the rope to; it hangs
  between them. A long route is simplified (pulled taut over clear ground),
  never dropped. `Leader` (in `route.js`) decides when to run: not for an
  unchanged layout, at once for a new or removed cable, and once, 100 ms
  later, for a burst of layout changes (a first paint lays the desk out three
  times), because a busy phone desk is about a tenth of a second of work. A
  name's box is its text, not its block. A cable in the hand, or being pulled, is free of it, and a jack you
  drew (declared) is still a straight line. `route.test.js` runs it against
  the demo desk as the browser laid it out (`lib/rig/testdata/desk-*.json`,
  measured at 1440 and 390 px).
- **Multi-arm** (`arm.js`): the tape keeps `rec_tracks`, and every recording
  sends `pairs`. A tap on ● on a track's header arms just it and a hold arms
  it as well (or takes it off); the keys arm one. `warn.js` is the amber dot on a header whose input hears the
  tape.

Run the demo with `SETTINGS_FILE` set when you try the rig: its restart
cables write settings, and the default file is `~/hindsight/settings.json`.

## The object library

`web/static/lib/objects/` holds the physical things the app draws, one
module each, with their tests beside them: the VU meters (`vu.js`), the reels
and the reel window (`reels.js`, `reel-window.js`), the cassette
(`cassette.js`, `cassette-geom.js`), the rendered parts of both (`spin.js`,
below), the ribbon (`ribbon.js` and its draw and
maths), the LCD's words (`lcd.js`), grease pencil (`grease.js`), a flag's
pennant (`pennant.js`). A page keeps its layout and behaviour and asks the
module for the object. The icons are not objects but chrome: one drawn set,
`web/static/icons/ui.svg`, used through `lib/ui/icons.js` (the output
button's speaker and headphones among them).

Two things are objects without a module. The masking tape that track names
and a take's flags are written on is all CSS (`.tt-head .tt-name` and
`.detail-flag` in `styles.css`), so only its marker ink moved, to
`objects.css`. The transport keys are the app's buttons — every `.icon-btn`,
in rules across `styles.css` — and every key colour follows the scheme, so
they stay chrome; their lit materials (`--mute-*`, `--solo-*`) are in
`objects.css`.

**The rendered parts.** The reels' flanges and the cassette's hubs are
drawn from frames rendered in Blender (`spin.js`, the sheets in
`web/static/sprites/`): one turn of each part's symmetry, a step further
round in each cell, under a lamp that stays put, so the highlights hold
still while the metal turns under them. The reels' and the cassette's
models turn them; a drawer shows the nearest cell and turns it the rest of
the way, half a step at most. A reel winding to a jump is drawn from cells
rendered with the shutter open. To change one, edit and run the scene:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --factory-startup --python scripts/blender/spools.py
```

It needs `cwebp` (`brew install webp`), takes about twenty seconds, and
prints the sheets' new addresses for `spin.js` and `sw.js`'s `SHELL`;
`spin.test.js` fails until both have them, and if the grid in `spools.py`
and in `spin.js` disagree. `--factory-startup` keeps a Blender that is open
for something else, and its add-ons, out of it. Until a sheet has loaded,
the drawn part shows.

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

## The scene

`web/static/lib/scene/` is the shape every drawn thing has, so a new way of
drawing one (a 3D deck, cables as ropes) can be built without learning the
app. Three parts, three owners (the rules are *The scene contract* in
[architecture/css-and-motion.md](architecture/css-and-motion.md)):

- **State** is plain data the page writes, with `obj.set(patch)` on a
  `SceneObject` (`object.js`): a level, a poll of the tape, how far a take
  has played. It is frozen; `set` makes a new snapshot only when something
  changed.
- **A model** (`vu.js`, `reels.js`, `cassette.js`, `ribbon.js`, `cable.js`,
  listed in `models.js`) steps each object on the shared ticker and derives
  its **view**: the needle's angle, the reels' turn, a rope's points. Models
  are pure and tested with a fake ticker. The rope steps at a fixed 120 Hz
  and interpolates, which is how a verlet rope stays the same at any frame
  rate.
- **A renderer** draws views and never writes state; `Scene` (`scene.js`)
  throws if one calls `set` while drawing. `renderer.js` documents the duck
  type (`mount`, `frame`, `hit`, `twin`, `destroy`); `dom.js` is the DOM
  renderer, which calls each object's drawer from `lib/objects` only when
  its view or state changed.

A `Scene` steps its models and then its renderers once a frame, and parks
with the ticker once every model has settled. `VUMeters`, `ReelWindow`,
`CassetteFace` and `Ribbon` each keep one, so the pages use them as before;
the bench builds one scene for everything on it.

Everything that animates is on `motion.js`'s one `ticker`. A loop that only
runs while something plays (the bar, the take page's clock, rising notes, a
row's playhead, Play all) is a `Loop`, which leaves the ticker when it stops
wanting frames. Reduced motion is the ticker's: it hands every step
`dt = Infinity`, and a model given that lands at once.

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

### Installing a release

**A release:** `POST /api/update` on the Pi installs one — empty body means
the latest, or `{"tag":"v2026.10.14.10"}` for a particular one
([0012](decisions/0012-agents-install-releases.md)):

```sh
curl -X POST http://<pi-host>/api/update            # the latest
curl -X POST http://<pi-host>/api/update -d '{"tag":"v2026.10.14.10"}'
```

It answers `202` with the tag it started, and refuses when it should:
`409` while a take is saving or a phone is recording, `409` if an update is
already under way, and `400` for a tag below `UpdateFloor`
(`internal/api/releases.go`) — installing one older than the Update button
would take the button away.

`GET /api/update` is what the page polls for progress;
`GET /api/update/releases` lists what can be installed.

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

## Gotchas

- `gh pr edit` fails on this repo (the retired projects API). Use
  `gh api -X PATCH repos/gabeduke/hindsight/pulls/<n> -F body=@file`.
- On the Pi, the service's log is
  `journalctl _SYSTEMD_USER_UNIT=hindsight.service`;
  `journalctl --user -u` finds nothing.
- A demo without `TAPE_DIR` and `SETTINGS_FILE` writes `~/hindsight`. The
  flows runner sets both to a temp dir.
- A red Go test is not a flake until its log says so (the known ones were
  fixed on 2026-10-22).
- The end-to-end sound check without ears: output `both`
  (`PUT /api/tapes/output`), record `/api/tapes/stream` while a script holds
  pads on `/api/tapes/play`, and read the level every 50 ms: BREAK reads 0,
  STOP falls to 0 over a beat.
- Node 22 for the JS tests (as CI): 20 has no glob support in `--test`
  and no global `navigator`.
- The layout checks settle each screen and look twice, which makes a whole
  run of the flows about 9 minutes locally.
- Not a bug: a take tapped while its preview encodes says "Still encoding"
  and loads when ready, which is why `t.api.keep` waits.

## Design canvases

claude.ai artifacts, private to Gabe:

- Room, Studio & Rig: `Ls32s93iBGoT7jUcHQb54Y`
- One player, two rooms (the shell): `9oJSxmvQhTnrBvVr2Uiz5o`
- Interaction model: `KwreNYVjPb8Kt3RMgrAbPr`
- The wireframes (every view at tablet, phone and desktop size):
  `9VDEexPH2bUo1vVzxZBSQx`
- The SMK-37's surface: `WrryAkACiz1AgNHGBMYAWV`

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
