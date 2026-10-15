# The scene contract, and the render briefs (R1–R7)

**Date:** 2026-10-15 · **Status:** proposed; the direction is agreed in
[Two rooms and a rig](2026-10-15-rooms-design.md) · **Repo:** `hindsight` ·
**Canvas:** *Scene contract and render briefs* and *Choreography* in
[Hindsight — Room, Studio & Rig](https://claude.ai/artifact/Ls32s93iBGoT7jUcHQb54Y)
· Builds on [the object library](2026-10-14-object-library-design.md)

## Why

Gabe, 2026-10-14: *"We started work on extracting visual assets into objects
that we can improve over time and eventually add physics to. I expect that we
would eventually introduce a more 3 dimensional space… For rendering we can
pass off those tasks to new sessions or agents to tackle the problem in a
more scoped fashion."*

The object library gave each physical thing a module, but not one shape:

- the spec's `states`, `make` and `geom` API was never built;
- only `vu.js` and Play mode use the shared ticker. `ReelWindow`,
  `NowPlaying`, `CassetteFace`, `wave/clock.js`, `rising.js` and `rowwave.js`
  each run their own `requestAnimationFrame`.

Handing *"make the deck load like a real one"* or *"draw the Sidekick in 3D"*
to a fresh session needs a contract that session can build to without
learning the app: what an object is, who changes it, what draws it.

## The contract (R1)

### Three parts, three owners

```
the page          the model                the renderer
writes state  →   step(dt) on the ticker →  draws the view
(targets)         (derives the view)        (reads only)
```

- **State** is plain data the page owns. It holds targets: *loaded take 41*,
  *rate 0.5*, *cable from ch1 to track 2*. The page sets it from what it
  fetched. Objects don't fetch; the object library decided that.
- **The model** steps each object on the shared ticker (`motion.js`'s
  `ticker`), with `lag`, `ballistic` and `spin`, and derives its **view**: the
  reel's angle, the needle's position, the rope's points. Models are pure and
  tested, so every renderer moves identically.
- **A renderer** draws views. It never writes state, and never computes
  motion.

### The code

`web/static/lib/scene/` (new). Plain ES modules, no TypeScript, no bundler:

```js
// object.js
export class SceneObject {
  constructor(id, kind, state = {}) {}
  get state() {}        // a frozen snapshot
  set(patch) {}         // the page's only way in; emits 'change'
  get view() {}         // what the model derived on the last step
  on(event, fn) {}      // → off(); 'change', and from renderers: 'pick',
                        //   'drop', 'hover', 'plug', 'unplug'
  emit(event, detail) {}
}

// scene.js
export class Scene {
  add(obj) {}  remove(id) {}  get(id) {}  objects() {}
  start() {}   // steps every model on lib/objects/motion.js's ticker
  stop() {}
}

// A renderer, duck-typed, documented in renderer.js:
//   mount(el, scene)   build its DOM, SVG or WebGL canvas
//   frame(dt)          draw; called from the same ticker, after the models
//   hit(x, y)          → an object id or null
//   twin(id)           → the real <button> laid over that object
//   destroy()
```

### Kinds and their state

| Kind | State the page sets | View the model derives | First renderer |
|---|---|---|---|
| `reels` | `rate`, `pos`, `length` | `angle` for each reel, the pack radii (`ReelMotion`) | DOM: `ReelWindow` |
| `deck` | `loaded`, `playing`, `door` | the door's angle, and the reels within | DOM |
| `cassette` | `take`, `label`, `stripe`, `played`, `out` (off the shelf) | the hubs' angle, the packs, the lift | DOM: `CassetteFace` |
| `record` | `take`, `label`, `cover`, `spinning` | the platter's angle | DOM |
| `vu` | `level` | the needle and its velocity (`ballistic`) | DOM: `VUMeters` |
| `shelf` | `items` (ids in order), `gap` | each item's slot | DOM |
| `device` | `profile`, and each port's `lit` and `level` | — | DOM, then three.js (R6) |
| `cable` | `from`, `to`, `kind`, `pending`, `declared` | the rope's points (R4) | SVG |

### Rules every renderer keeps

1. **Motion comes from the models,** so flat and 3D move identically, and
   tests drive them with a fake `dt`.
2. **Every interactive object has a DOM twin:**
   - a real `<button>` laid over it, for focus, keys and screen readers;
   - WebGL draws over accessible markup, and never replaces it;
   - `twin(id)` returns it, and a 3D renderer moves it each frame to the
     object's projected position.
3. **Drop frames, never input.** Picks and drags go through `hit()` and the
   twins, never through the draw loop.
4. **Reduced motion is the ticker's job.** It already passes `dt = Infinity`,
   so every model settles at once. A renderer never checks the media query.
5. **Park when still.** The ticker parks when no step asks for another frame.
   A model that has settled returns `false`.
6. **Big assets stay out of `SHELL`.** `caches.addAll` rejects as a whole, so
   one missing model would cost the offline shell.
   - Models, textures and a vendored three.js go in their own cache,
     `hindsight-assets`, which `activate` doesn't delete with the shell.
   - Each file name carries a version (`ep-136.v1.glb`), so a release only
     downloads what changed.
7. **No bundler, no CDN.**
   - three.js, when R6 needs it, is one pinned ES module under
     `web/static/vendor/three/` with its licence. It is imported lazily by the
     rig alone, behind a flag.
   - Its loaders import the bare specifier `three`, so `rig.html` carries an
     import map. `paths.test.js` learns to resolve through it instead of
     calling that a bundler.
   - The Pi is often offline, so nothing is fetched from elsewhere.

### What R1 builds

- `lib/scene/` and its tests, using a fake ticker.
- The DOM renderer, wrapping today's objects: `ReelWindow`, `CassetteFace`,
  `VUMeters` and `Ribbon` keep their drawing, but take their motion from
  models.
- **One shared ticker**, an app-wide motion item agreed in the object
  library spec. The six private `requestAnimationFrame` loops above move onto
  `motion.js`'s `ticker`.
- The bench at `/objects.html` runs on the scene. That is how R1 is judged:
  **no visible change**, at every size, in both schemes.

## The render briefs

Each brief is one session's work, with its own short spec when it's picked
up. Every one assumes R1, and keeps every rule above.

| | Brief | Size | After |
|---|---|---|---|
| R1 | The scene contract (above) | S–M | — |
| R2 | Shelf to deck | M | R1, P5 |
| R3 | The room in 2.5D | L | R1, P5 |
| R4 | Cables | M | R1, P6 |
| R5 | Device models | L | P6's profiles |
| R6 | The rig in 3D | L | R4, R5 |
| R7 | Cut a record | M | R3 |

### R2 · Shelf to deck

**Goal:** a cassette or a reel box comes off its shelf and into the deck as an
object, and goes back on eject. The timings are the canvas's *Choreography*
board:

| Frame | At | For | What |
|---|---|---|---|
| PICK | 0 | 120 ms | The spine lifts 6 px; its shadow deepens. This alone answers the touch |
| PULL | 120 | 180 ms | It slides out toward you, scale 1 → 1.12. The gap it leaves stays open while it's out |
| TURN | 300 | 200 ms | `rotateY` 90° → 0: the face, so the label can be read |
| FLY | 500 | 420 ms | An arc to the deck's window, shrinking to fit, tilting into the turn |
| SEAT | 920 | 160 ms | The door closes with a 2 px overshoot, and a 10 ms vibration on a phone. **The sound starts here** |
| SPIN UP | 1080 | 450 ms | The reels catch up with the sound (`spin`, `EASE_MS`), as a capstan does |

- **Eject** is the same, backwards, in about 700 ms. A stop gives the tape a
  little slack as the reels coast; `slack()` was planned in the object
  library and lands here.
- **View Transitions** carry the object from shelf to deck:
  `view-transition-name: take-<id>`, with FLIP on the Web Animations API where
  unsupported. Cross-document transitions are already declared in each page's
  head.
- **One thing in flight.** A second pick mid-flight finishes the first at
  once, then starts.
- **Reduced motion:** a 150 ms cross-fade, no flight and no vibration.
- **Motion tokens,** in `styles.css` (they don't follow the scheme, and they
  aren't materials):

  | Token | Value | For |
  |---|---|---|
  | `--t-touch` | 120ms | the answer to a finger |
  | `--t-move` | 200ms | slides and turns |
  | `--t-flight` | 420ms | between places |
  | `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | |
  | `--ease-flight` | `cubic-bezier(.3,0,.2,1)` | |
  | `--ease-seat` | `cubic-bezier(.34,1.56,.64,1)` | the overshoot |

- **Done when:**
  - 60 fps on a mid-range phone;
  - nothing waits on the animation: the sound starts on SEAT even if a frame
    drops;
  - reduced motion cross-fades.

### R3 · The room in 2.5D

- **Goal:** the Listening Room as layered planes:
  - the wall and window;
  - the shelves;
  - the hi-fi;
  - the chair and the side table.

  Each plane sits at a depth, with a little parallax: at most 12 px, from the
  pointer. Device tilt needs a permission prompt on iOS, so it's not used.
- **The camera move** from the doorway to the chair is the cross-document
  View Transition from `takes.html` to `wave.html`: the hi-fi scales up to
  become the chair's deck.
- **Done when:**
  - it matches the canvas's doorway and chair boards;
  - it holds 60 fps on a phone;
  - with reduced motion it simply cuts;
  - a screen reader still gets P5's lists.

### R4 · Cables

- **Goal:** the rig's cables as ropes:
  - verlet integration, about 16 points a cable, with gravity sag;
  - a few constraint passes a step;
  - plugs that snap within 24 px of a socket, and a pull to unplug.
- **Drawn kinds** keep their width and dash, so they're told apart without
  colour (P6's legend).
- **Done when:**
  - twelve cables hold 60 fps on a phone;
  - the ticker parks once they settle;
  - keyboard patching (P6) still works with the ropes drawn over it.

### R5 · Device models

- **Goal:** `.glb` models of the Sidekick, the Bento, the kit and the SMK-37,
  built in Blender, with the sources kept outside `web/` so a release doesn't
  ship them.
- **The constraints:**
  - Y up, in metres, with the origin at the centre of the device's footprint;
  - under 300 KB each, with textures at 512 px or less, and no compression
    extensions that would need another decoder vendored;
  - **every port is an empty named `port:<id>`**, for the profile's port id,
    so cables and DOM twins find it;
  - **no makers' logos or wordmarks.** The repo is public; labels come from
    the profile.
- **Done when:** a test reads each model's node names from its JSON chunk and
  finds an empty for every port in its profile.

### R6 · The rig in 3D

- **Goal:** a three.js renderer on the same contract.
  - It draws R5's models and R4's ropes, as tubes.
  - It moves each port's DOM twin to the port's projected position, every
    frame.
- **The way in:**
  - behind its own per-device flag, `hindsight.rig3d`;
  - loaded lazily from the asset cache;
  - it falls back to the flat rig if WebGL won't start.
- **Done when:**
  - flat and 3D swap with no change to `/api/rig` or the page's code;
  - four devices and twelve cables hold 60 fps on a phone;
  - the rig still opens offline after a first visit.

### R7 · Cut a record

- **Goal:** the lathe. The canvas's *Choreography* board, part B:

  | Frame | For | What |
  |---|---|---|
  | BLANK | 400 ms | A lacquer drops onto the platter as the export starts |
  | CUT | the export | The cutting head travels from rim to label **at the export's real progress** (`live.mixdown` for a tape). If the export stalls, so does the head |
  | LABEL | 300 ms | The title, the date, the side, and the source's colour |
  | SLEEVE | 400 ms | Into its sleeve, cover from the source's colours |
  | FILE | 500 ms | Onto the Records shelf |

- **A failed export:** the head lifts, the lacquer is set aside, nothing
  reaches the shelf, and the note says why.
- **Reduced motion:** P5's plain progress bar.
- **Done when:**
  - the head's position always equals the export's progress;
  - a failure never shelves a record.

## Decisions (recommended picks)

1. **State, model, renderer: three owners.** Only the page writes state; only
   models compute motion; renderers only draw.
2. **The DOM twin is the control.** WebGL never receives a click a button
   can't.
3. **A separate, versioned asset cache,** so models survive a release and
   never risk the offline shell.
4. **three.js only for the rig,** vendored and pinned, lazy, behind a flag,
   with an import map. Everything else stays DOM, SVG and canvas.
5. **R1 is judged by no change.** The bench, at every size and in both
   schemes, looks as it does today.

## Not in this

- **Physics beyond ropes and reel inertia:** no rigid bodies, nothing thrown.
  The scene's state can carry positions later.
- **A 3D room.** R3 is planes with depth; a modelled room is a later brief,
  if the planes run out.
- **Sound from the scene,** such as a seat's *thunk*. Hindsight's sound is the
  tape's.
