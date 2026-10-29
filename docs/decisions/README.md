# Decisions

One file per decision: what was decided, when, Gabe's words where they were
written down, why, and what it rules out. AGENTS.md holds the rules as
rules; the story behind each is here. A new decision is the next number,
`NNNN-kebab-title.md`, and a line below.

## The product, as Gabe decided it

- [0001](0001-devices.md) The devices it is designed for
- [0002](0002-two-nouns-takes-and-tapes.md) Two nouns, takes and tapes; a tap plays
- [0003](0003-rooms-are-the-only-ui.md) Rooms are the only UI: a shell, not a hand-off
- [0004](0004-wake-lock-and-the-rec-chip.md) A wake lock while it plays or records, and the REC chip
- [0005](0005-the-cue-lane-lives-with-the-tape.md) The cue lane lives with the tape and launches on the bar line
- [0006](0006-tape-mods-undo-tricks-held-only.md) Tape mods go through undo; tricks are held-only
- [0007](0007-multi-arm-by-cables.md) Multi-arm by cables; ● arms one, holding adds
- [0008](0008-studio-keys.md) The Studio's keys
- [0009](0009-the-crate-leaves-the-screen.md) The crate leaves the screen, not the Pi
- [0010](0010-flat-first.md) Flat first
- [0011](0011-open-is-its-own-page.md) Open is its own page, for now
- [0012](0012-agents-install-releases.md) An agent installs releases; Gabe does not pull them by hand
- [0013](0013-push-a-nudge-not-the-state.md) The tape's state is pushed as a nudge, not the state
- [0014](0014-a-takes-grab-is-the-feeds-grab.md) A take's GRAB is the feed's GRAB
- [0015](0015-the-pi-5-first.md) The instrument targets the Pi 5
- [0016](0016-measure-latency-in-use.md) Measure latency in use, first
- [0017](0017-our-own-controller-firmware.md) The SMK-37 runs firmware of Hindsight's own
- [0018](0018-every-press-answers.md) Every press answers, at once, where the player is looking
- [0019](0019-one-header-menu.md) The header's one menu, top right

## How the work is done (the reasons behind AGENTS.md)

- [0020](0020-build-the-interface-first.md) Build the interface first, or stop and say so
- [0021](0021-exceptions-are-gabes-decision.md) An exception is Gabe's decision, not a fix
- [0022](0022-a-pr-names-its-interfaces.md) A pull request names the interfaces it touches
- [0023](0023-review-the-diff-not-the-summary.md) Review the diff, not the summary
- [0024](0024-ci-names-every-test-directory.md) CI names every test directory
- [0025](0025-a-regression-test-fails-first.md) A new regression test has to fail against the unfixed code
- [0026](0026-go-changes-merge-only-after-running.md) Go changes merge only after they've run
- [0027](0027-what-cuts-a-release.md) Only a change to what a kit runs cuts a release
- [0028](0028-commit-subjects-are-release-notes.md) Commit subjects are the release notes
- [0029](0029-the-repo-is-public.md) The repo is public: no home network details
- [0030](0030-bump-the-service-worker-cache.md) Any change under web/static bumps the service worker cache
- [0031](0031-paths-test-guards-moves.md) Moving a file under lib/ runs paths.test.js
- [0032](0032-materials-and-scheme-tokens.md) Materials in objects.css, scheme tokens in styles.css
- [0033](0033-a-stylesheet-per-place.md) A stylesheet per place
- [0034](0034-scope-new-css-rules.md) Scope a new CSS rule to the thing you are adding
- [0035](0035-flags-hide-markup-not-css.md) A per-device flag hides markup, not CSS
- [0036](0036-one-stylesheet-reader-for-tests.md) Tests read the stylesheets through one reader
- [0037](0037-change-the-rule-that-wins.md) Change the rule that wins, not one a later rule overrides
- [0038](0038-canvas-colours-by-token.md) A canvas reads its colours by token, with the light value as fallback
- [0039](0039-css-costs-only-go-down.md) The stylesheets' costs only go down
- [0040](0040-times-are-tokens.md) Times are tokens, and a key goes down at once
- [0041](0041-never-hide-the-only-route.md) Never hide the only route to something
- [0042](0042-look-at-it-before-it-merges.md) A UI change is looked at in a browser before it merges
- [0043](0043-the-user-flows-are-the-goal.md) The user flows are the goal
- [0044](0044-one-header-frame.md) The header is one frame on every page
- [0045](0045-a-things-name-is-its-menu.md) A thing's name is its menu
- [0046](0046-icons-not-glyphs.md) A key's picture is an icon from the sprite
- [0047](0047-the-bars-keys-live-in-its-zones.md) The bar's keys live in its zones, and ▶ never moves
- [0048](0048-rooms-turn-and-prewarm.md) Moving between rooms is a camera turn, and a prewarmed room keeps out of sight
- [0049](0049-one-name-for-a-take.md) A take is called one way: takeTitle
- [0050](0050-per-device-switches-and-pi-settings.md) Per-device switches and the Pi's settings
- [0051](0051-ui-architecture-guardrails.md) The UI architecture guardrails
- [0052](0052-smk37-frames-of-512-bytes.md) The SMK-37's frames are at most 512 bytes
- [0053](0053-smk37-flashing-rules.md) Gabe's rules for flashing the SMK-37
- [0054](0054-one-press.md) One press: the gestures' times are named once
- [0055](0055-one-way-to-close-things.md) One way to close things
- [0056](0056-one-menu.md) One menu
- [0057](0057-specs-before-code.md) Specs before code, deleted when they land
- [0058](0058-the-studio-is-a-place.md) The studio is a place
- [0059](0059-the-studio-on-one-screen.md) The Studio on one screen: a touch head is name, ●, input and ›
- [0060](0060-controller-pads-play-now.md) A controller's pads play now, not on a 16th
