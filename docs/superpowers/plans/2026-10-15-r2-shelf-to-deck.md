# Shelf to deck (R2) — implementation plan

**Goal:** Under the rooms flag, a cassette or a reel box comes off its shelf
and into the deck as an object on PUT IT ON, and goes back on ⏏, with the
Choreography board's timings; the sound starts at SEAT whatever the frames
do.

**Spec:** `docs/superpowers/specs/2026-10-15-r2-shelf-to-deck-design.md`,
which keeps every rule of R1 (`2026-10-15-scene-contract-design.md`).

## Global Constraints

- Behind `hindsight.rooms`. With it off, nothing new loads, listens or
  draws: everything new is in the doorway's and the chair's modules, fetched
  only with the flag on, or in pure modules nothing imports with it off.
- The page writes state; models step on the shared ticker; renderers only
  draw. The sound, the door, the vibration and the deck's contents change on
  a clock (`setTimeout`) started at the press, never on a frame.
- Reduced motion is the ticker's: `dt = Infinity` lands every model. The
  conductor reads `ticker.reduced`, never the media query.
- CSS in one block at the end of `styles.css`, *Rooms R2*, every selector
  under a room class; the motion tokens in its `:root`.
- `sw.js` → `hindsight-shell-v85`; every new file under `lib/` in `SHELL`.
- No new `lib/` directory: the models go in `lib/scene/`, the conductor in
  `lib/room/`.

---

- [x] **`motion.js`: `slack(sag, velocity, dt)`**, the loose tape as an
  underdamped spring pulled taut; a test that it overshoots a little, settles,
  and is the same at 20 Hz and 120 Hz.
- [x] **`lib/scene/choreo.js`:** the frames (PICK, PULL, TURN, FLY, SEAT,
  SPIN UP), `HOLD`, `SEATED`, `EJECT_MS`, the motion tokens as numbers,
  `bezier()` for the eases, and `frameAt(t, from, to, turn)` → the drawing.
  Tests: each frame's boundaries, the lift of 6 px, the pull to 1.12, the
  turn, the arc above the straight line, the fit to the window, the tilt.
- [x] **The tokens in step:** a test reads `--t-*` and `--ease-*` from
  `styles.css` and compares them with `choreo.js`, and checks they're in
  neither the dark block nor `objects.css`.
- [x] **`lib/scene/flight.js`:** `FlightModel` — the playhead toward the
  goal's target (1× forward, 1080/700 back), the view from `frameAt`, parks
  once it arrives. Tests with a fake `dt`: hold at PULL, reverse mid-pull,
  1080 ms in, 700 ms back, one huge `dt` lands, `Infinity` lands.
- [x] **`lib/scene/deck.js`:** `DeckModel` — the door (open travel, shut
  with 2 px past), the reels (`spin` toward a rate once the door is shut,
  coasting on a stop), the slack kicked by a stop. Tests: 2 px overshoot,
  no spin until shut, reaches speed in about `EASE_MS`, coasts, slack,
  `Infinity` lands and doesn't turn.
- [x] **`models.js`** registers `flight` and `deck` — **changed in the build:**
  they are registered by the doorway's own scene (`HIFI_MODELS` in
  `lib/room/hifi.js`), not in `models.js`, which every flagged-off page that
  draws an object (`objects.html`, the chair, the Studio) loads. A page
  without the rooms flag never fetches `choreo.js`, `flight.js` or `deck.js`.
  `models.js` says so.
- [x] **`lib/room/carry.js`:** the conductor — `pick`, `putBack`, `put`,
  `eject`, `finish`; one in flight; SEAT and LAND on timers; reduced motion
  lands at once and asks for a cross-fade; vibration only at a real SEAT on a
  touch screen. Tests with a fake clock, timers and ticker: **the sound at
  SEAT with no frame drawn**, once; at once on a forced finish and never
  again; a second pick mid-flight; eject stops the sound at the press;
  reduced motion.
- [x] **The doorway** (`room/doorway.js`):
  - a scene on the shared ticker with the deck object and a DOM renderer;
  - the deck art grows a window, a door, the seated face and the tape;
    ⏏ beside ▶;
  - the drawers: the deck (door, reels or hubs, the tape's sag) and the
    flight (the ghost: spine, face, shadow), both only writing transforms;
  - a spine or reel box picked: PICK and PULL, held while its card is open,
    back when it closes;
  - PUT IT ON: the take's sound at SEAT; a tape loaded first (asking), its
    ▶ to the Pi at SEAT;
  - ⏏ (the deck's or the dock's): the sound stops, then the flight back;
  - `view-transition-name` on the one thing away from its shelf;
  - reduced motion: a 150 ms cross-fade (WAAPI where there's no View
    Transition);
  - `from` and `to` measured again on scroll and resize.
- [x] **`swap.js`:** `playTape`, the ▶ half of `putTapeOn`, so the room can
  load first and play at SEAT. Test.
- [x] **The chair:** ⏏ remembers where its deck was and the window wears the
  take's name; the doorway flies it home from there.
- [x] **CSS:** the *Rooms R2* block — the tokens, the window, the door, the
  cassette face, the reels' slots, the ghost; P5's spin animation and pull
  keyframes stood down under the room's classes. A scope test like P5's
  (`styles.test.js`: every selector under a `room-` class, and the tokens the
  only thing on `:root`).
- [x] **Tips:** the deck's ⏏ in `tips.js` and the guide's §9.
- [x] `sw.js` v85 and `SHELL`.
- [x] **Look:** each frame paused with `page.clock`, at 390×844 and
  1440×900, both schemes; eject; reduced motion; flag off unchanged.
- [x] **Measure:** frame times with the CPU throttled 4×, put on and eject.
- [x] **`scripts/smoke-shelf-to-deck.mjs`:** the same checks in a browser, for
  whoever changes this next: flag off loads nothing; the sound at SEAT through
  a 200 ms long frame; one name at a time; frame times at 4×; reduced motion.
- [x] Every check in `AGENTS.md`; the PR against `rooms/p5-scene`.
