# CSS, icons and motion

## The stylesheets

The CSS splits into one file per place (tokens, base, kit, chrome, bar,
studio, room, take, play, rig, guide…), each listed in `sw.js` and checked
by ratchet tests (`the-studio-space.md`, *Under the hood*, agreed with Gabe
on 2026-10-24; [decision 0033](../decisions/0033-a-stylesheet-per-place.md)). So far `css/` has `chrome.css` (the header on
every page, and a phone's tabs: *The frame*, `shell.md`), `bar.css` (the
bar: `bar.md`) and `rooms-motion.css` (*Moving between rooms*, `shell.md`);
the rest of the files come as their places are rebuilt. Until then
`styles.css` holds layout, type and the rest of the chrome, and `objects.css`
the materials, the same in both schemes. A page links the ones it shows,
after `styles.css`, and a test reads them through `cssOf(page)`
(`lib/stylesheets.js`).

The shared modules beside them go in `lib/ui/`: `layers.js` (the one stack),
`menu.js`, `press.js` (tap, double tap, hold: one table of thresholds),
`keys.js` and `icons.js` (an SVG icon sprite in place of the unicode
glyphs) so far; `sheet.js` (detents, swipe, flick) comes with the phone's
sheet, and `dom.js` with its first user. Each lands with its first user,
never as a sweep.

## Icons

A key's picture is a symbol in one sprite, `web/static/icons/ui.svg`: line
art on a 24 grid, in the key's own ink (`currentColor`), its stroke's width
`styles.css`'s (`svg.i`, 1.75; under 16 px 2.25, and a small ▾ 2.75, as the
kit draws them). The unicode
glyphs the keys had (↶ ⋯ ▾ ✎ ⏏ ⌗ …) were drawn by each platform in a fallback
font of its own, so a key fitted on a laptop ran off a tablet in CI's fonts.

- **In the markup, so it is there at the first paint**: `<svg class="i
  i-undo" width="22" height="22" aria-hidden="true"><use
  href="/icons/ui.svg?v=…#undo"/></svg>`. A script writes the same with
  `icon(name)`, and changes what a key shows with `setIcon(key, name)`, which
  writes only when it changes (`lib/ui/icons.js`). The key says what it
  does (`aria-label`, its words); the icon is hidden from a screen reader,
  and a tap on it is a tap on the key (`pointer-events: none`), so help
  mode's tips and the keys' own handlers see the key.
- **State is the key's, not its picture's**: ▶ is `.playing` while it is
  heard playing, whatever it draws (▶, ❚❚ for a take, ■ for the tape); a
  fold's ▾ turns over by `body.np-fold` or `aria-expanded`, in CSS.
- **A key keeps the width its glyph gave it**: an icon's box is wider than
  its line, and where a ▾ or ⌗ follows a word its blank sides come off the
  key's gap or padding (the rules say so where they do it).
- **The sprite's address moves with it**: `SPRITE` (`lib/ui/icons.js`) is
  `/icons/ui.svg?v=` and the first 8 hex of the file's sha-256, and the
  pages, `sw.js`'s `SHELL` and every script ask for exactly that. A browser
  keeps the SVG a `<use>` names by its URL — across a reload, which is what
  the Update button does, and in its HTTP cache when the app is opened again
  — so a sprite changed at the same address goes on drawing the old copy,
  and a symbol new to it as a blank key. Bumping `CACHE` does not reach it.
  Change the sprite and `icons.test.js` names the new address.
- The loop's lock is two symbols, its body and its shackle, so the page can
  slide the shackle open.
- `lib/ui/icons.test.js` fails on a name a page or a script uses that the
  sprite hasn't got, on a symbol that isn't in `ICONS`, on markup that
  doesn't name the icon it shows, on the sprite missing from `sw.js`'s
  `SHELL`, on an address that isn't the sprite's hash, on an icon written
  under 16 px that isn't drawn heavier, on a key of the header, the bar or
  the ruler that goes back to a glyph or has no tip, and on a script that
  types a glyph into a key: `TYPED` counts, by file, the writes still left
  in the regions not drawn yet, and a count only goes down. The objects bench (`objects.html`) shows every icon.

## The scene contract

`lib/scene/` (the object library is `lib/objects/`). Three parts, three
owners: **the page writes state** (plain data, targets: *loaded take 41*,
*cable from ch1 to track 2*; objects never fetch); **the model steps** each
object on the shared ticker (`lib/objects/motion.js`) and derives its view;
**a renderer draws views** and never writes state or computes motion
(`SceneObject`, `Scene`, and the duck-typed renderer documented in
`lib/scene/renderer.js`: `mount`, `frame`, `hit`, `twin`, `destroy`). Rules
every renderer keeps:

1. Motion comes from the models, so flat and 3D move identically and tests
   drive them with a fake `dt`.
2. Every interactive object has a DOM twin, a real `<button>` over it, for
   focus, keys and screen readers; WebGL draws over accessible markup, never
   replaces it.
3. Drop frames, never input: picks go through `hit()` and the twins.
4. Reduced motion is the ticker's job (`dt = Infinity` settles everything);
   a renderer never checks the media query.
5. Park when still: a settled model returns `false`.
6. Big assets (models, textures, three.js) stay out of the service worker's
   `SHELL`, in a versioned `hindsight-assets` cache.
7. No bundler, no CDN: three.js, when the Rig needs it, is one pinned ES
   module under `web/static/vendor/three/`, lazy, behind a flag.

## A frame's budget

The device this has to be smooth on is a mid-range Android tablet, and its
main thread also feeds a phone's stream. Measured at a 4x CPU throttle,
the Studio fell to 6-18 fps while the tape played, because each frame
redrew every lane and wrote each lane's head before measuring its canvas.
What a frame may do, in the Studio and anything else on the ticker:

- **Put back, don't paint.** The lanes are painted only when what they show
  changes (`laneKey`), or the view moves; while the tape plays each is
  painted twice, as layers, as if none of it had played and as if all of it
  had, its parts lit (`lib/tape/playhead.js` `compositeLane`). A frame cuts
  the two at the playhead and draws the playhead over them; the ruler and
  the overview put back a base the same way. And it puts back only the
  columns the playhead moved over since the last frame (`headBand`), a few
  device pixels, not the canvas: everything else on it is already right.
  A page turn repaints, once.
- **Never measure or read style.** Canvas sizes come from a
  `ResizeObserver`; colours from `tokenCache` (`lib/theme.js`), forgotten
  when the scheme flips. A measure after a DOM write is a forced layout.
- **Write the page only when it changes**, and text that changes often in
  place (`lib/text.js` `setText`): a text node put in or taken out makes
  Chromium check every `:has()` rule above it, and `styles.css`'s
  `body:has(…)` rules make that a style recalculation of most of the page,
  for each digit of a counter. Text written in place is spared that only
  while no `:has()` tests `:empty`: one that does, anywhere, has Chromium
  look again at every `:has()` above any text that changes, so none may
  (`lib/text.test.js`). Likewise an inherited custom property set on
  a container restyles all of it: the bar's `--np-progress` is written only
  where the phone's mini player draws it. And an SVG attribute set to the
  value it has is still a restyle and a layout of its picture: the reels'
  packs are set only when they change.

`lib/tape/playhead.test.js` walks what the playhead's step calls and fails on
a measure, a style read, a write to the page or a lane painted.

## Motion

One set of times, eases and springs for the whole app, in
`lib/objects/motion.js`: `T` (press 0, release 120, touch 120, move 200,
exit 120, sheet 280, room 300, flight 420 ms), `EASES`, and `SPRINGS` as a
damping ratio and a natural frequency (snap, lid, carry, and the VU
needle's). `spring()` is the exact step of any of them, critically damped
and overdamped included, for anything a finger drives or that may turn
round halfway; `springEasing()` is one as a CSS `linear()` and its own
duration, for a move that runs to its end; `project()` is where a flick
comes to rest.

- **The CSS has them as tokens** (`--t-*`, `--ease-*`, `--spring-*` with
  `--t-spring-*`, at the top of `styles.css`), written by
  `node scripts/motion-tokens.mjs --write` from `lib/objects/motion-css.js`;
  `lib/objects/motion-tokens.test.js` fails while the two disagree. A
  spring's curve goes with its own time: over another, it is another
  spring. A browser without `linear()` takes the nearest cubic-bézier.
- **Less motion, in one place:** one `@media (prefers-reduced-motion)`
  block zeroes every time a thing travels in (the fades stay), and the
  ticker follows the setting as it changes. The room switch reads it at
  each switch and crossfades instead of turning (*Moving between rooms*, `shell.md`).
- **Nothing turns by `@keyframes`.** A reel or a hub turns by its model on
  the ticker, drawn from frames rendered in Blender (`lib/objects/spin.js`,
  `scripts/blender/spools.py`): the reels at the tape's speed, each by its
  pack, blurred as they wind to a jump; the cassette's hubs each by how much
  tape is on it. Reduced motion holds them still.
  `lib/architecture.test.js` fails on a stylesheet that spins something.
- **The room switch is a camera turn** between two walls of one space, the
  header and the bar held still: `css/rooms-motion.css`, drawn by the
  router (`shell.md`, *Moving between rooms*, under *The shell*).
- **A key goes down at once** and comes back on the snap spring: its
  `:active` rule draws `.down` too and zeroes the time into it
  (`--t-press`), and `lib/ui/keys.js`, wired once at each page's boot after
  help mode, adds `.down` on the pointer's first touch and keeps it 80 ms,
  so a touch (whose `:active` Chrome holds back) and a quick tap both show
  it. A key's hover rules step aside while it is down, so under a mouse it
  goes down too. The big transport keys travel 2 px; spines and cue clips
  (`.sinks`) sink 2 px by their `translate`. Lamps light at once and fade
  over `--t-move`. `lib/ui/keys.test.js` fails on a key's `:active`
  without its `.down`, and on a hover rule that would hold a pressed key
  up.
