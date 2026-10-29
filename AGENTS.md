# Working on Hindsight

For anyone, person or agent, making changes here. Each rule has already
caught something out; its link is the decision record with the incident.

- **Why** a rule or a design is so: `docs/decisions/README.md`, a line per
  decision.
- **How the pieces fit**, and the words the UI uses: `docs/architecture.md`,
  the index of `docs/architecture/`, one file per area.
- **What is open**: `docs/plan/STATE.md`, then `git log`.
- **How to run things** (the demo, testing, deploying, screenshots, the
  probes, the gotchas): `docs/development.md`.

Don't read `CHANGELOG.md`: it is generated, and `git log` has the same lines.

## When the right way is bigger than the task

- **Build the interface first, or stop and say so.** If a change needs a
  model, a controller method or a shared helper that doesn't exist yet,
  add it (its own commit, or its own PR if it is large) and then use it.
  If that is more than the task can carry, stop and report what is
  missing: never ship the feature around it. These count as reaching
  around: reading state back out of the DOM, a `setTimeout` to win a
  race, copying a helper instead of moving it somewhere both can import,
  `!important`, a `catch` that swallows, a second way to do what
  `lib/ui/` already does.
  ([0020](docs/decisions/0020-build-the-interface-first.md))
- **An exception is Gabe's decision, not a fix.** Never add an entry to an
  allow-list, a budget, `TYPED`, `scripts/flows/layout-known.json` or a
  "still their own" list to turn a check green. They exist so the numbers
  only go down. Report the failure, and what it would take to fix it
  properly. ([0021](docs/decisions/0021-exceptions-are-gabes-decision.md))
- **A pull request names the interfaces it touches**: the module, what it
  exports, who calls it, and whether that changed. A change to one goes in
  its file under `docs/architecture/` in the same pull request, not in a
  later tidy-up. ([0022](docs/decisions/0022-a-pr-names-its-interfaces.md))
- **Review the diff, not the summary.** Before a merge, someone who did not
  write the change reads the diff against these rules: a fresh agent given
  the code and this file, not the author's account of it.
  ([0023](docs/decisions/0023-review-the-diff-not-the-summary.md))

## The checks to run

No package.json, no bundler, no dependencies. Node's own test runner, on
Node 22 as CI:

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

On a Mac, and in a cloud sandbox: `docs/development.md`, *Testing*.

- **A new directory under `web/static/lib/` goes into the `node --test`
  globs in `.github/workflows/ci.yml` and the list above**, which name each
  directory and are kept in step; `paths.test.js` fails on a directory with
  tests missing from `ci.yml`.
  ([0024](docs/decisions/0024-ci-names-every-test-directory.md))
- **A new regression test has to fail against the unfixed code.** Revert
  the fix, watch the test go red, put the fix back.
  ([0025](docs/decisions/0025-a-regression-test-fails-first.md))
- **Do not merge Go changes you could not run.** Build and test them on a
  machine with a working toolchain, then merge.
  ([0026](docs/decisions/0026-go-changes-merge-only-after-running.md))

## Releases

- **Only a change to what a kit runs cuts a release.** `paths` in
  `release.yml` is an allow-list of what ships: `cmd/`, `internal/`,
  `go.mod`, `go.sum`, `web/`, `deploy/` (not the hub's manifests in
  `deploy/hub`, apart from its Dockerfile), and `docs/guide.md`, which the
  binary embeds. A merge touching none of those (a spec, a doc, this file, a
  dev script, the Makefile) cuts nothing, and its commits ride along in the
  next code release's notes; one touching any of them releases, so a spec
  landed with its code still ships. **A merge of code is a deployment**,
  even though no Pi installs anything until someone asks it to: the hub is
  redeployed at once (the *Point the hub at …* commits move `deploy/hub` to
  the new image), and every kit's Update button offers the new tarball.
  ([0027](docs/decisions/0027-what-cuts-a-release.md))
- **A new file that ships goes on the list.** `scripts/test-release-scripts.sh`
  reads the patterns out of the workflow, checks what should and shouldn't
  release, and fails if the "Assemble the archive" step packs anything the
  list doesn't cover. ([0027](docs/decisions/0027-what-cuts-a-release.md))
- **Commit subjects are the release notes**: `CHANGELOG.md` is every
  non-merge subject since the last tag, and each kit's release picker shows
  them to whoever is deciding whether to update. Write them for that person.
  ([0028](docs/decisions/0028-commit-subjects-are-release-notes.md))

## The repo is public

**No tracked file carries home network details**: no LAN or tailnet address,
no tailnet or MagicDNS name — in code, docs, comments or commit messages. The
deploy target lives in the untracked `deploy.local.env`; docs say
`<pi-host>`; screenshots are taken against the demo on localhost.
([0029](docs/decisions/0029-the-repo-is-public.md))

## The service worker cache, and moving files

- **Any change under `web/static/` needs `CACHE` bumped in
  `web/static/sw.js`** (`hindsight-shell-vNN`), or phones keep serving the
  old shell. **A file added to `lib/` is added to `SHELL`**: `caches.addAll`
  rejects as a whole, so one stale entry costs the whole offline cache.
  ([0030](docs/decisions/0030-bump-the-service-worker-cache.md))
- **Moving a module** one directory deeper breaks every relative import in
  it (`./theme.js` → `../theme.js`), and nothing fails until a browser loads
  a blank page: **run `paths.test.js`**, which resolves every module
  specifier, `<script src>`, stylesheet link and shell entry against the
  disk. ([0031](docs/decisions/0031-paths-test-guards-moves.md))

## CSS

How the stylesheets are laid out: `docs/architecture/css-and-motion.md`,
*The stylesheets*.

- `web/static/objects.css` holds **materials** (oxide, paper, plastic,
  metal, the VU faces), the same in both schemes, so it has no dark block; a
  token that follows the scheme goes in `styles.css` beside its dark value,
  and `lib/objects/materials.test.js` fails if one lands in the wrong file.
  `styles.css` holds layout, type and chrome.
  ([0032](docs/decisions/0032-materials-and-scheme-tokens.md))
- **`css/` holds a stylesheet per place**: `css/chrome.css` is the header
  on every page (and a phone's tabs), `css/bar.css` the bar, all of each. A
  page links the ones it shows, after `styles.css`; each is in `sw.js`'s
  `SHELL`; a test reads them through `cssOf(page)`, never
  `fileCss('styles.css')` alone, or it stops seeing a rule the day the rule
  moves. ([0033](docs/decisions/0033-a-stylesheet-per-place.md))
- **Scope a new rule to the thing you are adding.** If a class is already
  in use, say so in a comment and reuse its styling.
  ([0034](docs/decisions/0034-scope-new-css-rules.md))
- **A per-device flag hides markup, not CSS.** `styles.css` is on every page
  of every kit, so a flagged feature's rules ship to everyone the day it
  merges. ([0035](docs/decisions/0035-flags-hide-markup-not-css.md))
- **A test reads the stylesheets through `web/static/lib/stylesheets.js`**
  (`cssOf`, `fileCss`, `rules`, `block`, `section`, `tokens`), never with a
  brace matcher of its own. It is node-only, so it stays out of `SHELL`.
  ([0036](docs/decisions/0036-one-stylesheet-reader-for-tests.md))
- **Change the rule that wins, not one a later rule overrides.**
  `lib/css-cascade.test.js` fails on a declaration that a later rule, with
  the same selector in the same `@media`, always overrides: delete it, or
  merge the two. ([0037](docs/decisions/0037-change-the-rule-that-wins.md))
- **A canvas reads its colours by token, and its fallback is the light
  value.** `lib/css-tokens.test.js` fails on a token no stylesheet defines
  and on a fallback that has drifted from the palette.
  ([0038](docs/decisions/0038-canvas-colours-by-token.md))
- **The stylesheets' costs only go down.** `lib/css-budget.test.js` counts
  colour literals outside the token blocks, z-indexes, `!important`,
  `@media` conditions, written-in durations and faceless font-weights.
  Reuse a token, a condition or a z-index rather than add one; when a count
  drops, the test prints the number to lower it to.
  ([0039](docs/decisions/0039-css-costs-only-go-down.md))
- **Times are tokens.** A new transition or animation takes its time and
  ease from the motion tokens (`--t-*`, `--ease-*`, `--spring-*`; the times
  still written out are the budget's `durations`), which are
  `lib/objects/motion.js`'s, written by `scripts/motion-tokens.mjs`: change
  them there, never in `styles.css`. A key's `:active` rule draws `.down`
  too (`lib/ui/keys.js` adds it under a finger, where Chrome holds `:active`
  back); `lib/ui/keys.test.js` fails on one that doesn't.
  ([0040](docs/decisions/0040-times-are-tokens.md))
- **Never hide the only route to something.** `styles.test.js` fails on a
  rule that hides the way to Settings (☰), the menu's Releases, guide or
  rig, or the Settings sheet's first line, which carries them too.
  ([0041](docs/decisions/0041-never-hide-the-only-route.md))

## Look at it, and run the flows

- **A UI change is looked at in a browser, against the demo, before it
  merges**: at phone and desktop size, in both schemes, with its flag on
  and off. No node test can see a page.
  ([0042](docs/decisions/0042-look-at-it-before-it-merges.md))
- **Before reporting any change to what the app does, run
  `node scripts/flows.mjs` and put its table in your report.**
  `docs/flows.md` is how Gabe uses the app, as stories, each a Playwright
  flow that drives the demo like a user (real taps and holds on a tablet
  profile and a desktop one) and fails on any page error.
  ([0043](docs/decisions/0043-the-user-flows-are-the-goal.md))
  - A core flow that fails is a regression, yours or already on main: say
    which. Don't edit a flow's expectations to make it pass unless the
    story changed, and then change the story in `docs/flows.md` too.
  - A change to a journey adds or extends its flow. A story not built yet
    is a `todo` flow: it reports, it doesn't fail the run.
  - Look at the screenshot a failing flow saves.

## Older design notes

A comment citing `docs/superpowers/…` points at the specs deleted on
2026-10-18 (`git show 62b3c1c^:docs/superpowers/specs/<file>`); one citing a
gone `docs/plan/` spec, at one deleted when it landed (`git log
--diff-filter=D -- docs/plan/<file>`, then `git show <commit>^:<path>`).
What still holds is in `docs/architecture/` and `docs/decisions/`.

## Where things live in the UI

- **The header is one frame on every page** (`css/chrome.css`;
  `docs/architecture/shell.md`, *The frame*): three zones (what you're
  working on; Studio | Listening Room, centred; the tools), laid out by one
  rule set and by no page of its own (`styles.test.js` fails on a rule
  elsewhere that places it, or one there for a page; J5.1 if the switch
  moves between the Studio, the Listening Room, Capture and Open). A room's
  context goes in the start zone through the header slot,
  its ↶ ↷ before ☰. The tempo, where it plays and the alignment are on the
  bar's display, not in the header.
  ([0044](docs/decisions/0044-one-header-frame.md))
- **Settings, the rig, help mode, the guide and Releases** are the header's
  one menu (☰, `lib/nav.js` `mountHeaderTools`), last in the tools, top
  right on every page. A new app-wide tool goes in it, never beside ☰, and
  nothing hides ☰ or its items (*CSS*, above). **☰ means that menu and
  nothing else**: a tab or a key gets an icon of its own (the Listening
  Room's spines, the shelf's List). The Settings
  sheet's first line (`lib/settings.js`, `aboutLine`) carries the version,
  Releases, the guide and the rig too.
  ([0019](docs/decisions/0019-one-header-menu.md))
- **A thing's name is its menu**: the tape's in the Studio, the take's on
  Open (their rows: `docs/architecture/shell.md`, *The frame*). What acts
  on a thing goes in its name's menu, on `lib/ui/menu.js`, never in a ⋯
  beside it; a row that destroys is last, red, after a line, and one that
  can't be undone asks in `#confirm` first, never `window.prompt`. How the
  Studio is shown (the snap, the loop's lock, Fit, the fold, Ask before) is
  ⌗'s View menu beside the ruler.
  ([0045](docs/decisions/0045-a-things-name-is-its-menu.md))
- **A key's picture is an icon from `web/static/icons/ui.svg`**
  (`lib/ui/icons.js` `icon`, `setIcon`, or `<svg class="i …">` markup),
  never a unicode glyph; a new one is a `<symbol>` and a name in `ICONS`.
  **A change to the sprite moves its address** (`SPRITE`'s `?v=`, its hash)
  in `icons.js`, `SHELL` and every `<use>`: `icons.test.js` fails and names
  the new address, and fails on a name the sprite hasn't got. Scripts change
  an icon with `setIcon`, never by typing a glyph; the glyphs scripts still
  type, in the regions not drawn yet, are counted (`TYPED`) and only go
  down. Tests and flows read a key's state
  (`.playing`, `aria-pressed`), never its picture.
  ([0046](docs/decisions/0046-icons-not-glyphs.md))
- **The bar's keys live in its zones** (`css/bar.css`, `#np` in
  `shell.html` and `wave.html`; `docs/architecture/bar.md`): the deck, the
  transport, the verb, the modes, the end, the strip. A new key goes in the
  markup, in its slot, saying in `data-for` (and `data-mini`) which sources
  it shows for; never appended by a script, never shown or hidden by a
  `:not()` list. ▶ must not move: J1.13 fails if it does, or if the bar
  runs off a tablet. What plays, its tempo and where it plays are keys on
  the bar's display (the source's menu, the tempo's, the output sheet); ▾
  only opens a menu; the bar folds by its grabber.
  ([0047](docs/decisions/0047-the-bars-keys-live-in-its-zones.md))
- **A sheet or a drawer that follows the finger** is `createSheet`
  (`lib/ui/sheet.js`; `docs/architecture/shell.md`, *Sheets*): detents, a
  flick, the lid spring, and its layer on the stack the one way out; never
  a drag of its own. The phone's player is the first; the notes drawer is
  meant to be the second. Recording from a phone is the page's one
  recorder (`phoneRecorder`), whatever key starts it.
- **Moving between rooms** is the router's View Transition
  (`docs/architecture/shell.md`, *Moving between rooms*), drawn by
  `css/rooms-motion.css` (on every page, after `styles.css`), which gives the
  header and the bar view-transition names only while a switch is drawn
  (`html[data-turn]`), and nothing else: their layout is their own
  stylesheets'. A room's entrance is CSS keyed on
  `html[data-arriving="<room>"]`, set for the length of a turn into it. The
  switch only flips classes and what is shown; `show()` runs after the turn, so nothing heavy goes in the switch.
  A `prewarm` view mounts out of sight: no class on `<body>` (those are its
  `bodyClass`), nothing in the header, the dock or the bar but through its
  slots, nothing to the room shown (only a room mounting shown restores a
  scroll). Its `hide()` runs before its first `show()`, so every show puts
  back what hide put away, and what it runs outside `ctx` (Capture's ribbon
  timer) stops in hide and starts in show.
  ([0048](docs/decisions/0048-rooms-turn-and-prewarm.md))
- **A take is named by `takeTitle`** (`lib/rooms/takename.js`), wherever a
  person reads it: its name, or the time on its spine. Never a take's file
  or its date stamp on screen (Open's page is the one still to move, in
  Open's pass). ([0049](docs/decisions/0049-one-name-for-a-take.md))
- **The Listening Room** is the shelf wall and the List
  (`docs/architecture/rooms.md`, *The library*). Its toolbar is the search
  (`#shelf-q`: give it behaviour by its id, wherever the header puts it),
  the chips, Sort ▾ and Shelf | List; a shelf's All › and the search open
  over the room on the stack. The drawn room is a backdrop, not a surface:
  put nothing on it to press.
  ([0058](docs/decisions/0058-the-studio-is-a-place.md))
- **Per-device switches** (localStorage, this browser only) are a line
  each in `lib/device-prefs.js`, saved as clicked, with no Save and no
  Restart: they are not the Pi's. **The Pi's settings** (`/api/settings`)
  are shared by everyone and applied on restart; a preview one person turns
  on for their own phone does not belong there.
  ([0050](docs/decisions/0050-per-device-switches-and-pi-settings.md))

## UI architecture guardrails

`web/static/lib/architecture.test.js` enforces these, so the rooms'
proof-of-concept shortcuts don't come back
([0051](docs/decisions/0051-ui-architecture-guardrails.md)):

- **Controller → Model → Renderer:** views under `lib/room/`, `lib/rooms/`
  and `lib/play/` read structured state from controllers and models and
  call explicit controller methods; they never scrape text out of the DOM
  or `.click()` a hidden control. The test checks it where it went wrong:
  `lib/room/doorway.js` hears the bar through `np.onChange`, never by
  polling the DOM with `setInterval` (`readBar` is only its fallback for a
  bar with no `snapshot()`), and in the rooms only `lib/bar` writes the
  bar's display ids (`#position`, `#np-time`, …).
- **Visual objects come from `lib/objects/` and `lib/scene/`:** no reel,
  cassette or VU markup or `@keyframes` spin outside `lib/objects/`; reels,
  cassettes and meters are `ReelWindow`, `CassetteFace` and `VUMeters` on
  the shared `ticker`.
- **60fps on the shared `ticker`:** a poll (`200 ms`) only updates target
  state (`heard`, `playing`, `at`, `sampleRate`); every playhead, reel,
  cursor and time counter steps on `lib/objects/motion.js`'s `ticker`
  (`Loop`) and parks (`return false`) when paused.
- **Frame-zero hiding:** what a room view replaces is hidden by
  `styles.css` from the first paint (e.g. `body:not(.room-rack) :is(#takes,
  …)`), never solely by a class added after an async `import()` or
  `fetch()`. The two rooms are the only layout: there is no
  `:root[data-rooms]` gate, and the test fails if one comes back.
  ([0003](docs/decisions/0003-rooms-are-the-only-ui.md))
- **Shell views and the router:** views under `lib/shell/views/` (Studio,
  Listening Room, Capture) mount inside `shell.html`. They never construct
  Audio for the bar (the engine owns it), never assign `location` to a room
  path (navigation is the router's, `ctx.go`), share one id namespace, and
  route every DOM listener, poll and ticker step through `ctx.on`,
  `ctx.every` and `ctx.loop`, so a view not shown is quiet.
- **One press:** the hold, tap and double-tap times, and their slops, are
  named once, in `GESTURE` (`lib/ui/press.js`). The test fails on a hold or
  double-tap time written out anywhere else, and lists the numbers that
  only look like one (`NOT_GESTURES`). A *new* key that taps, double taps
  or holds is a `pressMachine` / `bindPress`, not another copy. Most older
  holds are still their own machines, with only their numbers in `GESTURE`;
  `docs/plan/STATE.md` lists them. ([0054](docs/decisions/0054-one-press.md))
- **One way to close things:** a menu, popover, sheet, drawer or selection
  opens on the page's stack (`lib/ui/layers.js`; `ctx.layers` in a view),
  with an `onClose` that puts it away, and closes with `layer.close()`; so
  Back and Escape close it in turn, a press outside closes a menu, and a
  switch of rooms closes the menus. Never a history entry or an Escape
  ladder of its own (Back would take two presses). A handler that keeps
  Escape for itself (a field's own, a drag
  let go) calls `preventDefault()`. The test fails on a `pushState` outside
  the router and the stack, and lists the ones still their own in
  `OWN_HISTORY`. ([0055](docs/decisions/0055-one-way-to-close-things.md))
- **One menu:** a menu, or a key's ▾ panel, is `menu()` or `splitKey()`
  (`lib/ui/menu.js`): it opens on the stack, is placed beside its key by
  `place()`, moves the keyboard along it, grows in and fades out, and its
  rows are `menuItem`s. The test fails on an `aria-haspopup` a script sets
  up outside `menu.js`, and lists the ones still their own, with why, in
  `OWN_MENUS`. ([0056](docs/decisions/0056-one-menu.md))

## Getting code onto a Pi

- **A release** is installed with `POST /api/update` on the Pi (empty for
  the latest, or `{"tag":"v2026.10.14.10"}`), which refuses while a take is
  saving, a phone is recording or an update is under way, and below
  `UpdateFloor`: `docs/development.md`, *Installing a release*.
  ([0012](docs/decisions/0012-agents-install-releases.md))
- **Unreleased code:** `make pi-status`, `make deploy-dry`, then `make
  deploy` (`make deploy-static` for `web/static` alone, no restart):
  *Deploying to a Pi* in `docs/development.md`. It mirrors its tree with
  `--delete`, untracked files included, so deploy from a tree holding only
  what you mean to ship, and read the dry run's deletions first. A full
  deploy restarts the service, which empties the ring: check the rig is idle.

## Momentary gestures must not touch undo

`lib/play/` is a performance surface: pads are *held*, not committed, and a
performance path bypasses undo entirely (wired to the track-mute PATCH, one
jam would leave tens of undo entries). Play mode has been audible this way,
held-only and outside undo, since v2026.10.15.3; every new performance
control stays off the undo stack too.
([0006](docs/decisions/0006-tape-mods-undo-tricks-held-only.md))

## Specs before code

A non-trivial change starts as a short spec in `docs/plan/`: the decisions,
agreed with Gabe, then the build order. Build it. When it lands, fold what
lasts into its file under `docs/architecture/` (a journey into
`docs/flows.md`, a decision into `docs/decisions/`), update
`docs/plan/STATE.md`, and delete the spec: git keeps it, and a pile of
landed specs is what agents then read as current. Specs merge without
cutting a release, so they are cheap to land.
([0057](docs/decisions/0057-specs-before-code.md))
