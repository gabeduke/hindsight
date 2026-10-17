# Plan: retire the legacy UI, then the shell, the cue lane and the output switch

**Date:** 2026-10-16 · **Spec:**
[2026-10-16-shell-player-and-cue-lane-design.md](../specs/2026-10-16-shell-player-and-cue-lane-design.md)

Gabe is on the two-room layout for good (*"I won't be going back to the previous
ui for any reason"*) and uses the app as a PWA, so separate HTML pages are fine
for everything that is not a room. Agreed in the same message: the cue lane is
stored with the tape; a clip thrown while Cue is soloed waits for the next bar.

Each phase is its own branch and merge, each UI phase is looked at in a browser
(phone and desktop, both schemes) before it merges, and each opens with a
short design check against the spec. Every phase that touches `web/static/`
bumps `CACHE` in `sw.js`, and a new `lib/` directory is added to the
`node --test` globs in `AGENTS.md` and `ci.yml`.

The shell is still the answer for gapless audio: it only removes the need for
the Studio and the Listening Room to be pages. Takes, Rig, Guide and Settings
stay ordinary pages.

## Phase 0 · Retire the legacy UI

Makes every later phase smaller: one layout, no flag branches in the shell.

- Make the rooms layout unconditional: `lib/rooms/flag.js` returns true and
  goes (callers lose their `roomsOn()` branches); the `Two rooms` per-device
  switch leaves `lib/device-prefs.js`; `:root[data-rooms]` becomes plain CSS and
  the early script that sets it leaves every `<head>`.
- Delete what only the old layout used: the legacy Capture page markup in
  `index.html` and the tape page's non-Studio layout in `tape.html` (the
  templates the Studio replaced), the CSS that styled them, and the
  `.about`-line Settings/Guide route (Settings lives in `.appbar-end` now).
- Keep Play behind its own flag: it is a separate feature, not the old UI.
- `carry.js` stops asking the flag; the hand-off stays until the shell lands.
- Delete tests that only asserted the legacy layout; keep the ones that
  assert shared behaviour. The repo rule stands: a new test must fail against
  the code it fixes.
- Update `AGENTS.md` ("Where things live in the UI" names the flag) and
  `docs/guide.md`.

**Risk:** a legacy path that something still reaches, e.g. a phone with the
flag off and an old cached shell. The cache bump handles the shell; deleting
is irreversible in the UI only, since git has it.
**Size:** large by lines, low by difficulty. **Model/effort:** Opus, medium, for
the audit of what is only-legacy (a wrong delete is silent); Sonnet for the
mechanical deletions and test pruning afterwards.

## Phase 1 · The shell and the one player

- Spec → plan (this phase's own plan file) → build.
- One shell document owns the header, the player and the engine; Studio and
  Listening Room mount as views through a small `pushState` router. Views take
  the engine; they never create audio.
- Mount/unmount contract per view: listeners, `ticker` entries and polls are
  released on unmount (a view off screen costs nothing).
- `tape.html` and `index.html` keep working as direct URLs (they serve the shell
  and open the right view), so the PWA's installed start URL and bookmarks do
  not break.
- Acceptance: play a take, then the tape, then the live feed in the Listening
  Room; switch to the Studio and back; nothing stops and the position does not
  jump. Checked on a real phone too, since iOS suspends audio on its own rules.

**Risk:** the highest of the set. Each view assumes it owns `document`; iOS audio
session rules. **Model/effort:** Opus, high, for the design and the
engine/lifetime work; the view re-mounting after it can be Opus medium.

## Phase 2 · The cue lane

- Stored with the tape (`/api/tapes/state`): a `cue` list of clips with source,
  in/out, loop flag and level. Go side first (`internal/api`, with tests and
  `go test -race`), then the lane.
- Lane head and Cue solo button, aligned to the lanes; throw a clip from the
  Shelf, from the buffer sheet's drop and from a track.
- Launch on the next bar, loop until tapped, Shift for now; trim via the clip
  editor; annotate (a flag with words, via the drawer in Phase 4).
- Drag a clip down to a track: copy, the cue clip stays.
- The first cut sits above the four tracks at their usual height.

**Risk:** the audio scheduling on the bar line (real-time). **Model/effort:**
Opus, high, for the engine and the Go store; Opus, medium, for the lane UI.
Go changes are not merged unless they were built and tested on a machine with
the Go toolchain (this one has it).

## Phase 3 · The output switch

- Live feed / Playback in the bar, in both rooms; Cue solos Playback to the cue
  lane alone. Replaces the Feed / Tape / Shelf switch's roles as in the spec.
- The Pi never monitors, so this changes what the browser plays and nothing on
  the Pi.

**Size:** small once Phase 1 and 2 exist. **Model/effort:** Opus, medium.

## Phase 4 · Notes as a bookmark drawer; the Sketchbook object leaves

- A bookmark tab appears when a clip is loaded; pulling it opens the notes
  overlay (the existing notes dialog, moved) and drops a flag at the playing
  frame. Works on a cue clip in the Studio too.
- Remove the Sketchbook object from the room (`space.js`, `art/corner.js`,
  `--room-book-*` tokens, its contrast and architecture-test lines, the tip and
  the guide rows).

**Model/effort:** Opus, medium, for the drawer (UI/feel); Sonnet, low, for the
removal and test pruning.

## Phase 5 · Tracks collapse while the cue lane is open

Mirror of `body.buffer-fold`: heights only, so a lane's x never moves. Last
because it changes the Studio's heights everywhere. **Model/effort:** Opus,
medium.

## Order and checkpoints

0 → 1 → 2 → 3 → 4 → 5. Phase 4 can move earlier, before 1, if the Sketchbook
object bothers the Listening Room more than it is worth waiting for: it does
not depend on the shell.

After each merge: the release cuts, the hub redeploys, and the Pi is updated
with `POST /api/update` once the rig is idle (a restart empties the ring).
Handoff notes go in `docs/superpowers/` as the others do.
