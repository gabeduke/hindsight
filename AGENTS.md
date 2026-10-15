# Working on Hindsight

Notes for anyone — person or agent — making changes here. Everything in this
file is a rule that has already caught something out, not a style preference.
If a rule below sounds arbitrary, the reason it exists is in the sentence
after it.

This file is the rules. How to run things — the demo, deploying, screenshots,
the probes — is in `docs/development.md`. What state things are in goes stale,
so it isn't here either: read the newest `docs/superpowers/*-handoff.md`, then
`git log`.

## The checks to run

No package.json, no bundler, no dependencies. Node's own test runner:

```sh
node --test 'web/static/lib/*.test.js' 'web/static/lib/wave/*.test.js' \
  'web/static/lib/phone/*.test.js' 'web/static/lib/help/*.test.js' \
  'web/static/lib/tape/*.test.js' 'web/static/lib/edit/*.test.js' \
  'web/static/lib/bar/*.test.js' 'web/static/lib/objects/*.test.js' \
  'web/static/lib/play/*.test.js' 'web/static/lib/rooms/*.test.js'
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
- **Scope a new rule to the thing you are adding.** A bare `.set-note` rule
  added for one sheet reached every existing settings note. Then Play mode's
  overlay rule, a bare `.play`, reached the Takes page's Play buttons and
  turned one into a blank sheet over a phone's whole screen. If a class is
  already in use, say so in a comment and reuse its styling.
- **A per-device flag hides markup, not CSS.** `styles.css` is on every page
  of every kit, so a flagged feature's rules ship to everyone the day it
  merges. The `.play` sheet above reached every kit with Play mode switched
  off.
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

`docs/development.md` has the demo command. `scripts/smoke-*.mjs` are the
Playwright checks that already exist.

## Where things live in the UI

- **Settings is only on the Capture page** (`index.html`), at the foot:
  "Hindsight v… · Settings · the guide". Not on tape, takes, wave or guide.
  Worth remembering before telling someone to go to Settings.
- **Per-device switches** (localStorage, this browser only) go in
  `web/static/lib/device-prefs.js` — one line each. They save as they are
  clicked, and have no Save and no Restart, because they are not the Pi's.
- **The Pi's settings** come from `/api/settings`: shared by everyone who
  opens the app, applied on restart. A preview one person turns on for their
  own phone does not belong there.

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

`docs/superpowers/specs/` holds a dated design note per change, and
`docs/superpowers/plans/` the build order. Write the spec, agree the
decisions, then build. Specs merge without cutting a release (above), so
they are cheap to land.
