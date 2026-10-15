# Shelf to deck (R2)

**Date:** 2026-10-15 · **Status:** proposed; the brief is R2 of
[the scene contract](2026-10-15-scene-contract-design.md), and keeps every
rule of its *The contract (R1)* · **Repo:** `hindsight` · **Canvas:** the
*Choreography* board (part A), *Listening Room · from the doorway* and *in
the chair*, in
[Hindsight — Room, Studio & Rig](https://claude.ai/artifact/Ls32s93iBGoT7jUcHQb54Y)
· Builds on [the Listening Room](2026-10-15-listening-room-design.md) (P5)

## Why

P5 puts a take on the deck with a cross-fade: the spine is on the shelf, then
it's on the deck. The room is meant to feel like a place where you take a
cassette off a shelf and put it in a machine. The brief gives the move frame
by frame, and the rule that matters most: **the picture follows the sound,
never the other way.**

## What

Under the rooms flag only. With it off, nothing here loads.

### Where it happens

| Move | Where | What runs |
|---|---|---|
| **Pick** | the doorway: a spine or a reel box | PICK and PULL. It stays out while its card is open, and goes back in if the card closes |
| **Put it on** | the doorway: the card's PUT IT ON | TURN, FLY, SEAT, SPIN UP, from its slot into the deck's window |
| **Eject** | the doorway: ⏏ on the deck (new), or the dock's ⏏ | the same, backwards, in about 700 ms |
| **Eject** | the chair's ⏏ | across pages: it flies from where the chair's deck was into its slot |

- A **take** is a cassette, a **tape** a reel box. A **record** keeps P5's
  cross-fade onto the turntable: the turntable's moves are R7's.
- PICK and PULL answer the press on the spine; the rest answers PUT IT ON.
  P5 already splits the two presses (the card is between them), so the
  timeline holds at 300 ms while the card is open. The timings are the
  Choreography board's:

  | Frame | At | For | What |
  |---|---|---|---|
  | PICK | 0 | 120 ms | It lifts 6 px; its shadow deepens |
  | PULL | 120 | 180 ms | It slides out, 1 → 1.12. Its gap stays open |
  | TURN | 300 | 200 ms | Spine to face (`rotateY` 90° → 0), so the label reads |
  | FLY | 500 | 420 ms | An arc to the deck's window, shrinking to fit, tilted into the turn |
  | SEAT | 920 | 160 ms | The door shuts, 2 px past and back; 10 ms of vibration on a phone. **The sound starts** |
  | SPIN UP | 1080 | 450 ms | The reels catch up with the sound (`spin`, `EASE_MS`) |

- **Eject:** the sound stops at the press. The reels coast and the tape takes
  up a little slack (`slack()`, planned in the object library); the door
  opens; the frames run backwards at 1080/700 speed.

### Two objects, two models

Each a scene object, stepped on the shared ticker. The page writes state; the
models derive the views; the DOM renderer only draws.

| Kind | State the page sets | View the model derives |
|---|---|---|
| `flight` (new) | `goal` (`out`, `deck` or `shelf`), `from` (the slot's rect), `to` (the window's rect), `turn` (a spine that turns to show its face) | the playhead and its frame, and the drawing: the centre, lift, tilt, shadow, and the spine's and the face's turn and scale |
| `deck` (the contract's) | `loaded`, `playing`, `door`, `travel` (the door's height) | the door's offset (with its 2 px), the reels' angle and rate, the tape's sag |

- The flight's state is a **target on the timeline**: `out` is 300 ms, `deck`
  is 1080, `shelf` is 0. The model moves its playhead toward it, at 1× going
  forward and 1080/700 going back, so a card closed mid-pull just reverses.
- The page measures `from` and `to` again on a scroll or a resize, so the
  flight follows a deck that moves.
- The deck spins its reels only once its door is shut: that is SPIN UP
  starting at 1080, without a timer of its own.
- `slack(sag, velocity, dt)` joins `lag`, `ballistic` and `spin` in
  `motion.js`: the loose tape as an underdamped spring pulled taut.

### Nothing waits on the animation

The things that matter happen on a clock, not on frames. A small conductor
(`lib/room/carry.js`) runs each move:

- at the press it sets a timer for SEAT: the sound, the door, the vibration,
  and the deck's `loaded`. A dropped frame, a parked ticker or a hidden tab
  can't delay it;
- **one thing in flight:** a second pick, PUT IT ON or ⏏ mid-flight finishes
  the first at once (it lands, and if it was going into the deck its sound
  starts then) and only then starts its own;
- the flight model only shows what's happening. Its playhead is real time, so
  frame and clock agree; if they don't, the clock wins.

A tape's sound is the Pi's: PUT IT ON loads it (asking first, as P5 does),
then the flight runs, and ▶ goes to the Pi at SEAT.

### Reduced motion

- The ticker passes `dt = Infinity`, so both models land at once: SEAT is
  now, and so is the sound.
- The change is a **150 ms cross-fade** (`startViewTransition`, with the
  root's fade at 150 ms), with no flight and no vibration. Where there's no
  View Transition, the Web Animations API fades the deck's window and the
  slot instead.
- The reels don't turn, as P5's don't with reduced motion.

### View Transitions, and why the flight isn't one

- The take that is away from its shelf wears `view-transition-name:
  take-<id>` (a tape `tape-<id>`): the ghost in flight, the face in the deck,
  the chair's window. One element at a time, so a View Transition is never
  aborted by a name worn twice.
- The flight itself is the `flight` model drawn by the DOM renderer, not a
  View Transition, because a transition can't do what the move needs:
  - hold half way while the card is open;
  - follow a deck that scrolls (a phone);
  - leave the page live: a transition's overlay takes the taps meanwhile;
  - and R1 says motion comes from the models on the shared ticker.
- **FLIP where there's no transition to carry it:** the chair's ⏏ remembers
  where its deck was (`sessionStorage`, a few seconds), and the doorway, once
  its shelves are drawn, flies it from there into its slot. A cross-document
  transition can't do this one: the doorway's shelves are drawn after its
  first frame, so there's no spine yet to match.

### The deck, drawn

- A **window** over the reels, with a smoked **door** that drops shut.
- A take seats as a **cassette** in the window; its hubs are the reels
  within, and the big reels hide. A tape is the big reels.
- The reels get slots in their flanges, so a turn can be seen, and turn from
  the deck model instead of a CSS animation.
- The tape between the reels sags with the slack.
- ⏏ on the deck, beside ▶, when a take is on it.

### Motion tokens

In `styles.css`, in the R2 block's `:root`: they don't follow the scheme, so
they have no dark value, and they aren't materials, so they aren't in
`objects.css`.

| Token | Value | For |
|---|---|---|
| `--t-touch` | 120ms | the answer to a finger |
| `--t-move` | 200ms | slides and turns |
| `--t-flight` | 420ms | between places |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | |
| `--ease-flight` | `cubic-bezier(.3,0,.2,1)` | |
| `--ease-seat` | `cubic-bezier(.34,1.56,.64,1)` | the overshoot |

The timeline in `lib/scene/choreo.js` uses the same numbers; a test reads the
tokens out of `styles.css` and fails if the two drift.

## Decisions (recommended picks)

1. **The flight is on the ticker, not a View Transition,** for the four
   reasons above. The name goes on the one thing that's away from its shelf.
2. **The clock starts the sound,** not a frame. The models are pictures of
   the clock.
3. **The timeline holds at PULL** while the card is open, because P5 put a
   card between the two presses.
4. **A take seats as a cassette** in the deck's window; a tape is its reels.
5. **Records stay a cross-fade** until R7 gives the turntable its moves.

## Not in this

- **The camera move** from the doorway to the chair: R3.
- **The turntable's moves** and the lathe: R7.
- **Sound effects.** The thunk at SEAT is a vibration, not a sample: the
  sound is the tape's.

## Checks

- The models with a fake `dt`: the timeline's frames, the hold, reversing,
  eject in 700 ms, reduced motion landing at once; the deck's door overshoot
  of 2 px, spin-up held until the door is shut, the coast and the slack.
- The conductor with a fake clock and timers: **the sound starts at SEAT with
  no frame drawn**, once, and at once on a forced finish; one thing in
  flight; reduced motion: no vibration, the sound now, a cross-fade.
- The tokens in `styles.css` match `choreo.js`, and are in neither the dark
  block nor `objects.css`.
- **60 fps:** frame times in headless Chromium with the CPU throttled 4×
  (CDP `Emulation.setCPUThrottlingRate`), put on and eject, reported. A real
  phone is for Gabe.
- **Look:** each frame, paused (`page.clock`), at 390×844 and 1440×900, in
  both schemes; flag on and off.
