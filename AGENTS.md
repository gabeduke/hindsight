# Working on Hindsight

Notes for anyone — person or agent — making changes here. Everything in this
file is a rule that has already caught something out, not a style preference.
If a rule below sounds arbitrary, the reason it exists is in the sentence
after it.

## The checks to run

No package.json, no bundler, no dependencies. Node's own test runner:

```sh
node --test 'web/static/lib/*.test.js' 'web/static/lib/wave/*.test.js' \
  'web/static/lib/phone/*.test.js' 'web/static/lib/help/*.test.js' \
  'web/static/lib/tape/*.test.js' 'web/static/lib/edit/*.test.js' \
  'web/static/lib/bar/*.test.js' 'web/static/lib/objects/*.test.js' \
  'web/static/lib/play/*.test.js'
./scripts/test-release-scripts.sh
gofmt -l . && go vet ./... && go test -race ./...
```

**Adding a directory under `web/static/lib/` means adding it to the
`node --test` globs in `.github/workflows/ci.yml`.** They are named one by
one, so a new directory's tests are invisible to CI until it is listed — a
whole suite silently never ran because of this.

Keep the glob list in this file and in `ci.yml` in step with each other.

## Releases

Every merge to `main` cuts a dated release and installs onto real Pis, so a
merge is a deployment.

`paths-ignore` in `.github/workflows/release.yml` holds what does *not*
deserve one: `docs/superpowers/**`, `docs/images/**`, `design/**`,
`.github/**`. It skips only when **every** changed file matches, so a PR
carrying a spec and the code it describes still releases.

Anything not on that list releases, `docs/guide.md` included — that one is
embedded in the binary by `docs/embed.go`, so it genuinely ships. To skip a
release for something unlisted, end the commit subject with `[skip ci]`.

`scripts/test-release-scripts.sh` asserts that filter by reading the
patterns out of the workflow, because the failure mode is the quiet one: a
feature that silently stops shipping.

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
  added for one sheet reached every existing settings note. If a class is
  already in use, say so in a comment and reuse its styling.
- **Never hide the only route to something.** The about line on Capture was
  `display: none` in one window shape; it carries the only Settings button
  anywhere in the app, so that shape had no way in at all. `styles.test.js`
  now fails if any rule hides it.

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

## Installing a release on a Pi

`POST /api/update` on the Pi installs a release — empty body means the
latest, or `{"tag":"v2026.10.14.10"}` for a particular one:

```sh
curl -X POST http://<pi>/api/update            # the latest
curl -X POST http://<pi>/api/update -d '{"tag":"v2026.10.14.10"}'
```

It answers `202` with the tag it started, and refuses when it should:
`409` while a take is saving or a phone is recording, `409` if an update is
already under way, and `400` for a tag below `UpdateFloor`
(`internal/api/releases.go`) — installing one older than the Update button
would take the button away.

`GET /api/update` is what the page polls for progress;
`GET /api/update/releases` lists what can be installed.

## The Go side cannot be built everywhere

Cloud agent sandboxes generally block the Go module proxy, so `go build` and
`go test ./...` fail there on downloads — not on your code. The JS tests,
`gofmt` and the shell tests all run fine.

**Do not merge Go changes you could not run.** Build and test them somewhere
with a working toolchain (a clone on a real machine), then merge.

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
