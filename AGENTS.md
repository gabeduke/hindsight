# Working on Hindsight

Notes for anyone — person or agent — making changes here. Everything in this
file is a rule that has already caught something out, not a style preference.
If a rule below sounds arbitrary, the reason it exists is in the sentence
after it.

This file is the rules. How to run things — the demo, deploying, screenshots,
the probes — is in `docs/development.md`; how the pieces fit, and the words
the UI uses, in `docs/architecture.md`. What state things are in goes stale,
so it isn't here either: read `docs/plan/STATE.md`, then `git log`. Don't read
`CHANGELOG.md`: it is generated, and `git log` has the same lines.

## The checks to run

No package.json, no bundler, no dependencies. Node's own test runner (Node 22,
as CI: 20 has no glob support in `--test` and no global `navigator`):

```sh
node --test 'web/static/lib/*.test.js' 'web/static/lib/wave/*.test.js' \
  'web/static/lib/phone/*.test.js' 'web/static/lib/help/*.test.js' \
  'web/static/lib/tape/*.test.js' 'web/static/lib/edit/*.test.js' \
  'web/static/lib/bar/*.test.js' 'web/static/lib/objects/*.test.js' \
  'web/static/lib/play/*.test.js' 'web/static/lib/scene/*.test.js' \
  'web/static/lib/rooms/*.test.js' 'web/static/lib/buffer/*.test.js' \
  'web/static/lib/room/*.test.js' 'web/static/lib/rig/*.test.js' \
  'web/static/lib/shell/*.test.js' 'web/static/lib/ui/*.test.js'
./scripts/test-release-scripts.sh
gofmt -l . && go vet ./... && go test -race ./...
```

**Adding a directory under `web/static/lib/` means adding it to the
`node --test` globs in `.github/workflows/ci.yml`.** They are named one by
one, so a new directory's tests are invisible to CI until it is listed — a
whole suite silently never ran because of this. `paths.test.js` now fails
when a directory with tests is missing from them.

Keep the glob list in this file and in `ci.yml` in step with each other.

**A new regression test has to fail against the unfixed code.** Revert the
fix, watch the test go red, put the fix back. This project has shipped a test
that could not fail, and found out only by reverting.

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

**Do not merge Go changes you could not run.** Build and test them on a
machine with a working toolchain, then merge.

## Releases

**Only a change to what a kit runs cuts a release.** `paths` in
`release.yml` is an allow-list of what ships: `cmd/`, `internal/`, `go.mod`,
`go.sum`, `web/`, `deploy/` (but not the hub's manifests in `deploy/hub`, apart
from its Dockerfile), and `docs/guide.md`, which the binary embeds. A merge
that touches none of those — a spec, a doc, this file, a dev script, the
Makefile — cuts nothing, and its commits ride along in the next code
release's notes. A merge that touches any of them releases, so a spec landed
with its code still ships.

A release ships twice over: the hub on the cluster is redeployed at once (the
*Point the hub at …* commits move `deploy/hub` to the new image), and every
kit's Update button offers the new tarball. So a merge of code is a
deployment, even though no Pi installs anything until someone asks it to.

**Commit subjects are the release notes.** The `CHANGELOG.md` entry is every
non-merge commit subject since the last tag, and the release picker on each
kit shows those lines to whoever is deciding whether to update. Write them
for that person.

**A new file that ships goes on the list.** `scripts/test-release-scripts.sh`
reads the patterns out of the workflow, checks what should and shouldn't
release, and fails if the "Assemble the archive" step packs anything the list
doesn't cover. The failure mode is the quiet one: a change that builds and
never ships.

## The repo is public

**No tracked file carries home network details**: no LAN or tailnet address,
no tailnet or MagicDNS name — in code, docs, comments or commit messages. The
history was squashed once to get them out. The deploy target lives in the
untracked `deploy.local.env`; docs say `<pi-host>`; screenshots are taken
against the demo on localhost, so no real hostname is in the URL bar.

## The service worker cache

**Any change under `web/static/` needs `CACHE` bumped in
`web/static/sw.js`** (`hindsight-shell-vNN`). Without it, phones keep serving
the old shell.

`caches.addAll` rejects as a whole, so one stale entry in `SHELL` costs the
entire offline cache rather than one file. `web/static/lib/paths.test.js`
resolves every module specifier, `<script src>`, stylesheet link and shell
entry against the disk — add a file to `SHELL` when you add it to `lib/`.

## Moving a file under lib/

Moving a module one directory deeper breaks every relative import inside it
(`./theme.js` → `../theme.js`) and **nothing fails until a browser loads a
blank page**. Run `paths.test.js`. It exists because that mistake was made
and caught by hand.

## CSS

- `web/static/objects.css` holds **materials** — what the objects are made of
  (oxide, paper, plastic, metal, the VU faces). Every token in it is the same
  in both schemes, which is why it has no dark block. A token that follows
  the scheme belongs in `styles.css` next to its dark value;
  `lib/objects/materials.test.js` fails if one lands in the wrong file,
  because that mistake is invisible until someone opens the app at night.
- `styles.css` holds layout, type and chrome.
- **`css/` holds a stylesheet per place**, the CSS plan's split
  (`docs/plan/the-studio-space.md`, *Under the hood*): `css/chrome.css` is
  the header on every page (and a phone's tabs), `css/bar.css` the bar, all
  of each. A page links the ones it shows, after `styles.css`; each is in
  `sw.js`'s `SHELL`; a test reads them through `cssOf(page)`, never
  `fileCss('styles.css')` alone, or it stops seeing a rule the day the rule
  moves.
- **Scope a new rule to the thing you are adding.** A bare `.set-note` rule
  added for one sheet reached every existing settings note. Then Play mode's
  overlay rule, a bare `.play`, reached the Takes page's Play buttons and
  turned one into a blank sheet over a phone's whole screen. If a class is
  already in use, say so in a comment and reuse its styling.
- **A per-device flag hides markup, not CSS.** `styles.css` is on every page
  of every kit, so a flagged feature's rules ship to everyone the day it
  merges. The `.play` sheet above reached every kit with Play mode switched
  off.
- **A test reads the stylesheets through `web/static/lib/stylesheets.js`**
  (`cssOf`, `fileCss`, `rules`, `block`, `section`, `tokens`), never with a
  brace matcher of its own: eighteen files once had eight copies of one, and
  a copy that slips passes a test that should fail. It is node-only, so it
  stays out of `sw.js`'s `SHELL`.
- **Change the rule that wins, not one a later rule overrides.** The deck's
  restyle set the keys and the fields again, in grouped lists, three
  thousand lines below their first rules, and 181 first values stood there
  reading like the answer while changing nothing. `lib/css-cascade.test.js`
  fails on a declaration that a later rule, with the same selector in the
  same `@media`, always overrides: delete it, or merge the two.
- **A canvas reads its colours by token, and its fallback is the light
  value.** `lib/css-tokens.test.js` fails on a token no stylesheet defines
  (the buffer's playhead drew in an undefined `--ok`'s fallback from the
  day it shipped) and on a fallback that has drifted from the palette.
- **The stylesheets' costs only go down.** `lib/css-budget.test.js` counts
  hex and rgba literals outside the token blocks, z-index numbers,
  `!important`, `@media` conditions, written-in durations and font-weights
  with no face. Reuse a token, a condition or a z-index rather than add
  one; when a count drops, the test prints the number to lower it to.
- **Times are tokens.** A new transition or animation takes its time and
  its ease from the motion tokens (`--t-*`, `--ease-*`, `--spring-*`; the
  times still written out are the budget's `durations`), which are
  `lib/objects/motion.js`'s, written by `scripts/motion-tokens.mjs`: change
  them there, never in `styles.css`. A key's `:active` rule draws `.down`
  as well (`lib/ui/keys.js` adds it under a finger, where Chrome holds
  `:active` back); `lib/ui/keys.test.js` fails on one that doesn't.
- **Never hide the only route to something.** The about line on Capture was
  `display: none` in one window shape; it carries the only Settings button
  anywhere in the app, so that shape had no way in at all. `styles.test.js`
  now fails if any rule hides it.

## Look at it before it merges

**A UI change is looked at in a browser, against the demo, before it
merges**: at phone and desktop size, in both schemes, with its flag on and
off. Play mode merged having never been rendered, because the sandbox it was
built in couldn't run the server. The first look found that it couldn't open
at all (its overlay shared the ▶ key's id), that its keys moved the record
track on the Pi, and the full-screen sheet above. The node tests passed
throughout. They test logic; none of them can see a page.

## The user flows are the goal

**Before reporting any change to what the app does, run
`node scripts/flows.mjs` and put its table in your report.** `docs/flows.md`
is how Gabe uses the app, as stories, each with a Playwright flow that
drives the demo like a user (real taps and holds on a tablet profile and a
desktop one) and fails on any page error. The shell merged with 1,790 green
unit tests and a Studio that threw on every load; the flows caught it.

- A core flow that fails is a regression, yours or already on main: say
  which. Don't edit a flow's expectations to make it pass unless the story
  changed, and then change the story in `docs/flows.md` too.
- A change to a journey adds or extends its flow. A story that isn't built
  yet is a `todo` flow: it reports, it doesn't fail the run.
- Look at the screenshot a failing flow saves.

## Older design notes

Code comments that cite `docs/superpowers/…` point at the dated specs and
plans deleted on 2026-10-18; what still holds is in `docs/architecture.md`.
When you need the history behind one, read it from git:
`git show 62b3c1c^:docs/superpowers/specs/<file>`.

## Where things live in the UI

- **The header is one frame on every page** (`css/chrome.css`;
  `docs/architecture.md`, *The frame*): three zones -- what you're working
  on, Studio | Listening Room centred, the tools -- laid out by one rule set
  and by no page of its own (`styles.test.js` fails on a rule elsewhere
  that places it, or one there for a page). A room's context goes in the
  start zone through the header slot; its ↶ ↷ before ☰ in the tools. J5.1
  fails if the switch moves between the Studio, the Listening Room, Capture
  and Open. The tempo, where it plays and the alignment are on the bar's
  display, not in the header.
- **Settings, the rig, help mode, the guide and Releases** are the header's
  one menu (☰, `lib/nav.js` `mountHeaderTools`), last in the tools, top
  right on every page (Gabe, 2026-10-22). A new app-wide tool goes in the
  menu, never beside ☰. ☰ is the only way to most of them, so
  `styles.test.js` fails if a rule hides it or one of its items. **☰ means
  that menu and nothing else**: a tab or a key gets an icon of its own
  (the Listening Room's spines, the shelf's List). The Settings sheet's
  first line (`lib/settings.js`, `aboutLine`) carries the version,
  Releases, the guide and the rig as well.
- **A thing's name is its menu**: the tape's in the Studio (the tapes and
  New tape, Rename…, Duplicate, the mix and the bounces, Record from this
  phone…, Delete this tape… last) and the take's on Open (Rename…, the
  takes either side, the downloads, Delete last). What acts on a thing goes
  in its name's menu, on `lib/ui/menu.js`, never in a ⋯ beside it; a row
  that destroys is last, red, after a line, and one that can't be undone
  asks in `#confirm` first, never `window.prompt`. How the Studio is shown
  (the snap, the loop's lock, Fit, the fold, Ask before) is ⌗'s View menu
  beside the ruler.
- **A key's picture is an icon from `web/static/icons/ui.svg`**, through
  `lib/ui/icons.js` (`icon`, `setIcon`) or the same `<svg class="i …">`
  markup, never a unicode glyph: each platform drew those in a fallback font
  of its own, and the bar's ✎ ran off a tablet in CI's fonts. A new one is a
  `<symbol>` in the sprite and a name in `ICONS`; `icons.test.js` fails on a
  name the sprite hasn't got. **Any change to the sprite moves its address**
  (`SPRITE`'s `?v=`, a hash of the file), in `icons.js`, `sw.js`'s `SHELL`
  and every `<use>`: a browser keeps the SVG a `<use>` names by its URL, even
  across a reload, so a symbol new to the old address draws a blank key.
  `icons.test.js` fails and names the new address. A script changes a key's
  icon with `setIcon`, never by typing a glyph into it; the glyphs scripts
  still type, in the regions not drawn yet, are counted (`TYPED`) and only
  go down. A test or a flow reads a key's state (`.playing`,
  `aria-pressed`), never its picture.
- **The bar's keys live in its zones** (`css/bar.css`, `#np` in
  `shell.html` and `wave.html`; `docs/architecture.md`, *The bar*): the
  deck, the transport, the verb, the modes, the end, the strip. A new key
  goes in the markup, in its slot, saying in `data-for` (and `data-mini`)
  which sources it shows for; never appended by a script, never shown or
  hidden by a `:not()` list. ▶ must not move: J1.13 fails if it does, or if
  the bar runs off a tablet. What plays, its tempo and where it plays are
  keys on the bar's display (the source's menu, the tempo's, the output
  sheet); ▾ only opens a menu, and the bar folds by its grabber.
- **Per-device switches** (localStorage, this browser only) go in
  `web/static/lib/device-prefs.js` — one line each. They save as they are
  clicked, and have no Save and no Restart, because they are not the Pi's.
- **The Pi's settings** come from `/api/settings`: shared by everyone who
  opens the app, applied on restart. A preview one person turns on for their
  own phone does not belong there.

## UI architecture guardrails

`web/static/lib/architecture.test.js` enforces these rules so POC shortcuts do
not come back:

- **Controller → Model → Renderer (no DOM scraping or synthetic clicks):**
  Views under `lib/room/`, `lib/rooms/`, and `lib/play/` read structured state
  from controllers/models and call explicit controller methods. They must never
  scrape text out of legacy DOM nodes (`readBar`, `readRows`) or dispatch
  `.click()` onto hidden legacy controls (`clickControl`).
- **Visual objects come from `lib/objects/` and `lib/scene/`:** Do not define
  bespoke reel/cassette/VU markup or CSS `@keyframes` spin animations outside
  `lib/objects/`. Any surface showing reels, cassettes, or meters mounts
  `ReelWindow`, `CassetteFace`, or `VUMeters` on the shared `ticker`.
- **60fps shared `ticker` interpolation:** Network poll callbacks (`200 ms`)
  only update target state (`heard`, `playing`, `at`, `sampleRate`). Every
  playhead, reel, ruler cursor, overview cursor, and time counter steps on
  `lib/objects/motion.js`'s shared `ticker` (`Loop`) and parks (`return false`)
  when paused.
- **Frame-zero hiding:** What a room view replaces is hidden by `styles.css`
  from the first paint (e.g. `body:not(.room-rack) :is(#takes, …)`), never
  solely by a class added after an async `import()` or network `fetch()`.
  The two rooms are the only layout: there is no `:root[data-rooms]` gate,
  and the test fails if one comes back.
- **Shell views & router (unified player & pushState navigation):**
  Views under `lib/shell/views/` (Studio, Listening Room, Capture) mount inside
  the single shell document (`shell.html`). Views never construct their own
  Audio for the bar (the engine owns it), never assign `location` directly to a
  room path (navigation goes through router / `ctx.go`), share one ID
  namespace across all rooms and templates, and route all DOM listeners, polls,
  and ticker steps through `ctx.on`, `ctx.every`, and `ctx.loop` so inactive
  views stay completely quiet.
- **One press:** the app's hold, tap and double-tap times, and their slops,
  are named once, in `GESTURE` (`lib/ui/press.js`): eleven holds with four
  thresholds had grown before it. The test fails on a hold or double-tap time
  written out anywhere else, and lists the numbers that only look like one.
  A *new* key that taps, double taps or holds is a `pressMachine` /
  `bindPress`, not another copy. Most of the older holds are still their own
  machines, with only their numbers in `GESTURE`; `docs/plan/STATE.md` lists
  them.
- **One way to close things:** a menu, popover, sheet, drawer or selection
  opens on the page's stack (`lib/ui/layers.js`; `ctx.layers` in a view),
  with an `onClose` that puts it away, and closes with `layer.close()`.
  Back and Escape then close it in turn, a press outside closes a menu, and
  a switch of rooms closes the menus. Never a history entry or an Escape
  ladder of its own: with both a CloseWatcher and an entry, Back takes two
  presses. A handler that keeps Escape for itself (a field's own, a drag let
  go) calls `preventDefault()`. The test fails on a `pushState` outside the
  router and the stack, and lists the one still its own.
- **One menu:** a menu, or a key's ▾ panel, is `menu()` or `splitKey()`
  (`lib/ui/menu.js`): it opens on the stack, is placed beside its key by
  `place()`, moves the keyboard along it, grows in and fades out, and its
  rows are `menuItem`s. Six menus once had five ways to be placed, two to
  be dismissed, and rows of 40 px beside rows of 48. The test fails on an
  `aria-haspopup` a script sets up outside `menu.js`, and lists the ones
  still their own. Every menu in the Studio is on it, and Open's take menu;
  Open's More, Send to and lane menus are still their own, to move in
  Open's pass.

## Getting code onto a Pi

**A release:** `POST /api/update` on the Pi installs one — empty body means
the latest, or `{"tag":"v2026.10.14.10"}` for a particular one:

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

**Unreleased code:** `make pi-status`, `make deploy-dry`, then `make deploy`
(or `make deploy-static` for `web/static` alone, no restart) — *Deploying to
a Pi* in `docs/development.md`. It mirrors the tree it runs from with
`--delete`, untracked files included, so deploy from a tree that holds what
you mean to ship, and read the dry run's deletions before the real thing. A
full deploy restarts the service, and a restart empties the ring: check the
rig is idle first.

## Momentary gestures must not touch undo

`lib/play/` is a performance surface: pads are *held*, not committed. The
existing track-mute PATCH goes through the undo stack, so wiring a momentary
pad to it would leave tens of undo entries behind after one jam. A
performance path has to bypass undo entirely. Nothing audible is wired yet
for exactly this reason.

## Specs before code

A non-trivial change starts as a short spec in `docs/plan/`: the decisions,
agreed with Gabe, then the build order. Build it. When it lands, fold
anything lasting into `docs/architecture.md` (or `docs/flows.md`, for a
journey), update `docs/plan/STATE.md`, and delete the spec: git history
keeps it, and a pile of landed specs is what agents then read as current.
Specs merge without cutting a release (above), so they are cheap to land.
