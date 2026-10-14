# The object library: making the physical things addressable

**Date:** 2026-10-14 · **Status:** proposed to Gabe · **Repo:** `hindsight`

## Why

Hindsight is already built out of physical objects. The `:root` block says so
in its own comments: *"tape: oxide and trace, the same in both schemes — tape
is an object"*, *"cassettes: paper, printed stripes and plastic"*, *"Masking
tape on the track heads, written on in marker"*, *"Grease pencil"*. That's a
material system, thought through, and it's why the app looks like something
rather than like a web page.

What's missing is that **no object has an address**. A cassette is:

- geometry in `lib/cassette-geom.js` (132 lines),
- construction in `lib/cassette.js` (333 lines),
- materials in a `:root` comment block in `styles.css`,
- appearance somewhere in the other ~3,500 lines of `styles.css`,
- and, for some objects, inline `<svg>` in one or more of the five pages.

So "make the tapes more realistic" is not a task anyone — a person or a model
— can pick up and do. It's a hunt. And the result can only be judged by
loading a rig, getting a take into the right state, and looking at it in
context, in one theme, at one size.

Gabe, 2026-10-14: *"start extracting all of our visual asset objects so that
we could start improving the design a little bit at a time… especially as the
AI models improve, they may end up getting physics or other high quality
upgrades."* Exactly right, and the extraction is the whole job. An object you
can see alone, in both themes, at every state, is an object that can be
replaced wholesale and judged honestly. An object smeared across four files
can only be nudged.

The third gap is motion. Nothing here has **physics**. The VU needle is
`transition: transform 140ms cubic-bezier(.25,.8,.35,1)` — a real VU meter has
ballistics: 300 ms to full scale and a percent or two of overshoot, which is
most of why a needle reads as a needle. The reels turn at a rate rather than
spinning up and coasting down. Tape has no slack. These are small, shared,
testable functions that today don't exist anywhere to be shared.

## What

### 1. One module per object

`web/static/lib/objects/`, one file per physical thing, each owning its
geometry, its DOM/canvas construction, its state→appearance mapping, and its
own `.test.js`:

| Module | Object | Moved from |
|---|---|---|
| `cassette.js` | A take as a cassette; spines on the shelf | `lib/cassette.js`, `lib/cassette-geom.js` |
| `reels.js` | The deck's reel-to-reel window | `lib/tape/reels.js`, `lib/bar/reel-window.js` |
| `vu.js` | Needle meters in their bezels | `lib/vu.js` |
| `ribbon.js` | The buffer ribbon — tape in the ring | `lib/ribbon.js`, `lib/ribbon-draw.js` |
| `lcd.js` | The amber counter window | `lib/bar/lcd.js` |
| `pennant.js` | A flag stuck in the tape | `styles.css` + page SVG |
| `label.js` | Masking tape, written in marker | `styles.css` |
| `grease.js` | Grease-pencil In/Out marks | `styles.css`, `lib/wave/grease.js` |
| `keys.js` | Transport keys and silkscreen legends | `styles.css` |
| `icons.js` | Speaker, headphones, cassette, the rest | `icons/*.svg`, `lib/tape/out-switch.js` |

Every module exports the same three things, so the bench and the pages treat
them alike:

```js
export const states = { … }   // every state this object can be in, named
export function make(opts)    // build it; returns {node, set(state)}
export function geom(opts)    // pure numbers, no DOM — unit-testable
```

Pages stop drawing objects and start asking for them. The page keeps layout
and behaviour; the object keeps what it looks like.

### 2. Materials, split out

`web/static/objects.css`, imported first by `styles.css`: the `:root` blocks
that describe **stuff** — metal, paper, plastic, oxide, phosphor, ink, grease,
masking tape — lifted out whole, comments and all, and left alone otherwise.
`styles.css` keeps layout, typography and the app chrome.

This is a cut, not a rewrite. Both schemes keep the same token names and the
same values; nothing on screen changes in this step. The point is that after
it, a material upgrade is a diff to one short file, and an object upgrade is a
diff to one module, and neither can silently disturb a page's layout.

### 3. The object bench

A new page, `/objects.html`, behind the same per-device flag pattern (not in
the tab bar, reachable from ⋯ → *Object bench*):

- Every object, every state in its `states` export, side by side.
- Both schemes at once, in two columns.
- A size slider, so an object is checked at phone, tablet and the deck's own
  size rather than at whatever size it happens to be on the page that uses it.
- A motion row: play a state change at 1×, ¼× and ⅒×. (The motion-polish spec
  checked frames through CDP's `Animation.setPlaybackRate`; this puts the same
  check on a page where anyone can use it.)
- A still button that renders the grid to a PNG, so two versions of an object
  can be put side by side.

This is the part that makes "a little bit at a time" actually work. It's also
what makes the object a good target for a model: a tight brief ("the cassette
shell is flat; give the plastic depth and a highlight that moves with the
hub"), one file to change, and a bench that shows all eight states and both
schemes before and after. The `design/*.dc.html` boards stay what they are —
layout boards for whole screens; the bench is for one object at a time.

### 4. Physics, shared

`lib/objects/motion.js` — small, pure, frame-rate independent, and tested
against a fake clock:

- **`ballistic(value, target, dt)`** — the real VU response: ~300 ms to 99 %
  of full scale, ~1 % overshoot, then settle. Replaces the needle's CSS
  transition, and gives every future meter the same hand.
- **`spin(omega, targetOmega, inertia, dt)`** — reels spin up and coast down
  instead of switching rate. The supply reel's inertia falls as tape leaves it
  and the take-up reel's rises; `cassette-geom.js` already computes both
  radii, so the numbers are there.
- **`slack(tension, dt)`** — tape takes up slack on a transport change. This
  is what sells a stop.
- **One ticker.** All animated objects share a single `requestAnimationFrame`
  loop that steps every registered object, and parks itself when none are
  moving. Fifteen objects each running their own rAF is a real cost on a phone
  pointed at a Pi, and it's the kind of thing that only shows up on someone
  else's hardware — which now includes two other people's kits.
- **Reduced motion** collapses physics to instant state changes at the ticker,
  once, instead of per object.

## Decisions (recommended picks)

1. **Extract before improving. Nothing looks different when this lands.** A
   PR that moves code and changes appearance can't be reviewed: you can't tell
   a regression from an intention. Move first, with the bench proving the
   before and after match; improve in the PRs after.
2. **One PR per object, after the scaffolding.** The scaffolding PR brings
   `objects/`, `objects.css`, `motion.js`, the bench, and two objects moved
   (VU and reels — the two with motion). Then one PR per remaining object,
   each small enough to look at.
3. **SVG stays SVG, canvas stays canvas.** The ribbon and the waveforms are
   canvas because they're per-sample and redraw constantly; the cassette and
   the VU are SVG because they're shapes with states. Don't unify it — the
   split is correct and the bench hides the difference anyway.
4. **The bench ships in the release, behind the flag.** Not a dev-only page.
   When Gabe's brother says the cassettes look wrong on his phone, the bench
   is the thing to point him at, and it has to be on the kit already.
5. **Objects don't fetch.** A module takes state and draws it. Nothing in
   `objects/` calls the API, so the bench can render every state without a Pi
   and the tests don't need a fake server.

## How this meets Play mode

`2026-10-14-play-mode-design.md` adds track keys, trick pads and a loop ring.
Those are objects, and they're the first ones that would be born in the
library rather than moved into it — which makes the extraction worth doing
first rather than alongside. The loop ring in particular wants the ticker and
`spin()` on day one.

## Checks

- **Nothing changed:** bench stills for every object, in both schemes, taken
  before the move and after, compared pixel for pixel. A material or geometry
  change in a "move" PR shows up as a diff and is a bug.
- `geom()` unit tests move with their objects; the existing
  `cassette-geom.test.js`, `ribbon-draw.test.js`, `vu.test.js` keep passing
  under their new paths.
- Motion tested against a fake clock: ballistic overshoot within tolerance,
  `spin` monotone to target, the ticker parks when everything is still, and
  reduced motion skips to the target in one step.
- The Pi 4B is the device that matters: the bench's motion row at 1× on a
  phone against a Pi-served page, watched for dropped frames, before the
  ticker lands in the pages that ship.

## Not in this

- **Any new look.** Deliberately. See decision 1.
- **A design-token pipeline or build step.** `objects.css` is hand-written CSS
  like everything else here; Hindsight has no bundler and shouldn't grow one
  for this.
- **Replacing the `design/*.dc.html` boards.** Different job, both stay.
