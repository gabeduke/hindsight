# The play look

**Not agreed yet: Gabe picks a direction first.** Gabe, 2026-10-29: more
time and care on the UI, to make it *intuitive, immersive, professional and
fun*. *"I like the teenage engineering visuals on the op-1 field for
instance, they are simple, fun and make playing music more joyful."*

The canvas is "Hindsight · Play look" (`DHqPaBAGJyqDz4PErR4Qir`). Its first
row is the demo as it is today (tablet 1280×800, phone, both schemes), with
what the audit found as notes. Below that come three directions, drawn on
the same screens with the same tape (*Song sketch*, Drums, Bass, Keys,
Verse and Chorus, a cue clip, 96 BPM). The boards come from
`~/programming/hindsight-design/play/gen.py`, which reuses `reel/gen.py`'s
parts, the same way `listen/` and `transport/` do. Each direction is
nothing but a token set and a few material rules, which is how it would
be built (decision 2).

This spec sits beside `the-studio-space.md`, not in place of it: its step 12
(polish: the reels' inertia, lamps in tempo, the room listening with you)
is where several of the steps below land. It leaves room for the two looks
Gabe has asked for before: the Zoom-recorder theme for his brother's kit,
and a Listening Room built from objects that could later become 3D.

## What the audit found

At 1280×800 (the Pixel tablet), 390×844 and 1440×900, in both schemes, from
a seeded demo and from the flows' storyboard (`node scripts/flows.mjs
--storyboard`):

- **No colour has one job.** Orange is Download, Capture, GRAB's ring and the
  feed's 30 s mark. Amber is the LCD, track 3, the Loop lamp and the flag.
  Red is recording, the armed track and the Verse section. Blue is track 1,
  the Chorus section and focus. So a colour doesn't tell you anything at a
  glance.
- **Words do what numbers should.** The bar's counter is 19 px and its
  tempo 12 px, on a tablet read from arm's length. The buffer explains
  itself in full sentences (*copying it off the feed: the bar after it is
  still being played*, *Grab copied it, with room either side…*).
- **Too many keys at once.** GRAB opens a buffer of about twenty controls
  over the tape and pushes the tracks under the bar (already in hand as
  step 11). The Studio on a tablet shows about forty keys.
- **Five type families**: Barlow Condensed, Plex Sans, Plex Mono, Permanent
  Marker, and Caveat, which is declared and never used.
- **Empty rooms.** The Listening Room's shelf wall is mostly dark, empty
  planks with three spines in a corner. The phone's player leaves a third of
  its height blank, and the strip under the reels is black.
- **Open** is still three generations stacked: the tip card, Download as
  the orange key, and half the screen an empty piano roll (step 10).
- **What works and stays**: the bar as a deck (reels, the display, one
  transport everywhere), keys that say what they act on, the feed ribbon,
  masking-tape names, the spines, tap plays and hold selects, Undo in every
  toast, help mode, the scene contract and the shared ticker.

## What the OP-1 field gets right, and what of it fits

The OP-1 field is a reference for its principles, not a look to copy. We
take none of teenage engineering's artwork, typefaces, colour scheme or
trade dress. Hindsight keeps its own palette, fonts and objects.

1. **One colour, one job.** Few colours, and each one always means the
   same control. You read the screen at a glance.
2. **One display, big and black.** The graphics live on the display. The
   body around it is quiet, and the keys are plain.
3. **Numbers first, large.** The thing you play by (bar, tempo, level) is
   the biggest thing on the screen.
4. **Objects that move with the music.** Reels, needles and characters
   animate in time, so the machine feels alive, and what is happening
   shows without a label.
5. **Few controls at once.** A screen shows what you play with now. The rest
   is one press away.
6. **Playful, bold graphics**: flat shapes and thick lines rather than
   rendered realism.

Hindsight already has most of the raw material: four track colours
(`--t1`–`--t4`), black wells and an amber LCD, reels and VU faces on the
shared ticker (`lib/objects/`), the scene contract for objects
(`lib/scene/`), the motion tokens, and the icon sprite. What it lacks is the
discipline: colours with jobs, a type scale, and fewer things on screen at
once.

## The directions

- **A · Deck, tidied.** Today's materials (gradient keys, the oxide ribbon,
  metal reels, the wooden shelf), with the colour jobs, the type scale and
  fewer words applied. Least change, and least gain in fun.
- **B · Signal (recommended).** A flat body, black displays as the only dark
  surfaces, and colour only where it means something. Flat reels (a ring,
  a hub and three spokes) turn on the display. Keys are flat with a 2 px lip
  so they still look pressable. The bar counter is 44 px and the phone's
  is 64. The phone's empty third becomes the tape's mini-map, the section
  line and the cue pads under the thumb. The Listening Room is a light
  shelf wall, labelled on its planks, with a lamp that follows the take.
  Drawn light and dark.
- **C · Toybox.** B's colour jobs, louder: 2 px ink outlines, round shapes,
  each lane tinted its track's colour, and the Listening Room as an
  isometric room of objects (shelf, tapes, deck, lamp, armchair, rug), each
  its own group. The most fun and the most art to keep up. Its room is the
  natural first step to the 3D room.

## Decisions to agree

My recommendation first in each.

1. **The direction: B, Signal.** It answers the brief (simple, legible,
   alive) and keeps the deck, the spines and the masking tape. A is the
   fallback if B feels too far from the reel-to-reel. C's room is kept for
   later, as the Listening Room's 3D step (decision 8), not as the app's
   look.
2. **Signal ships as a theme, and today's look stays as "Reel".** A theme is
   a per-device switch (`lib/device-prefs.js`, decision 0050) that sets
   `data-theme` on `<html>` before the first paint. Its stylesheet,
   `css/theme-signal.css`, holds only custom properties, light and dark. To
   get there, the materials that are written out today become tokens
   first: the keys' gradients, the wells' insets, the clips' fills, the
   shelf. Then the Zoom look is one more file. The alternative is
   replacing Reel outright, which is less code but takes away the
   reel-to-reel look and builds no seam for the Zoom theme.
3. **One colour, one job, in every theme**, Reel included:

   | Colour | Its one job |
   |---|---|
   | Red | Recording: ●, the armed track, REC. Nothing else. |
   | Orange | It goes to the shelf: KEEP, Capture, Download, the ribbon's last 30 s. |
   | Amber | The clock: playhead, bar, tempo, Loop and metronome lamps, the cue ring. |
   | Green | Live: the feed, sync, the Pi. |
   | `--t1`–`--t4` | A track, wherever it shows: its head, clips, cue pads and the SMK-37's pads. |

   So **track 3 moves from amber to violet**. Sections keep the colours
   people give them, but drawn as a stripe, never as a fill. The flag keeps
   its yellow, darker than the amber.
4. **Type: three families and a hand.** Barlow Condensed for numbers and
   key labels, Plex Sans for words, Plex Mono only inside the LCD, and
   Permanent Marker only for names a person writes (tracks, spines). Caveat
   goes. A type scale goes in the tokens, so a theme can change the faces
   without each rule naming a size.
5. **Numbers first.** On the tablet the bar's counter goes from 19 to
   about 44 px, and the tempo from 12 to 26. On the phone's player the
   counter is 64. J1.13 (▶ never moves, the bar fits a tablet) is the
   bar's limit, so the display takes width from the transport's
   whitespace, not from its keys.
6. **Words off the screen.** A key says what it does in two or three words.
   An explanation goes in help mode (`?`), never in a caption beside the
   key. The buffer's sentences go first. That waits for the clip drawer
   (step 11), so this spec doesn't touch code that session is writing.
7. **Things move with the music, on the ticker.** The Loop and metronome
   lamps light on the beat. An armed ● breathes on the beat. A cue pad's
   ring fills to the bar line. Reels keep turning at tape speed (Signal
   draws them flat, an SVG the model turns, in place of the Blender
   frames). The Listening Room's lamp follows the take's level. All of it
   runs on `lib/objects/motion.js`'s `ticker`, never `@keyframes` (the
   canvas animates with CSS only because a mockup has no ticker), and it
   all holds still under reduced motion. This is `the-studio-space.md`'s
   step 12, in Signal's terms. No UI sounds: the ring is always listening.
8. **The Listening Room: Signal's shelf wall now, C's room later.** The
   room as objects (shelf, tapes, deck, lamp, chair, each a `SceneObject`
   on the scene contract) gets its own spec once Signal has landed. It is
   the step toward the walkable 3D room. Until then nothing on the backdrop
   is pressable (`AGENTS.md`).
9. **Open gets the look in its own pass** (`the-studio-space.md` step 10),
   not here.

## What it touches

- `web/static/styles.css` (the scheme tokens; new material tokens) and
  `web/static/objects.css` (the materials, whose values become tokens that
  a theme can set). `lib/objects/materials.test.js` still decides which
  file a token belongs in.
- New: `css/theme-signal.css`, listed in `sw.js`'s `SHELL` and linked on
  every page after `styles.css`. A test fails on a theme file that sets
  anything but custom properties, or sets one the base doesn't define.
- `lib/device-prefs.js`: one line, `theme`. A boot snippet sets
  `data-theme` before the first paint (frame-zero, decision 0051).
- `lib/theme.js` `tokenCache`: forgotten when the theme changes as well as
  when the scheme flips, so canvases repaint in the new colours.
- `lib/objects/reels.js` / `spin.js`: a flat reel renderer beside the
  Blender frames, chosen by the theme.
- Every step: `docs/architecture/css-and-motion.md` (*The stylesheets*, a new
  *Themes* section), and `AGENTS.md`'s *CSS* rules where one changes.

## Build order

Each step is its own small PR. Each is looked at in a browser at 1280×800,
1024×768, phone and desktop, in both schemes and both themes once there
are two. Each runs `node scripts/flows.mjs` and puts the table in the PR,
and none grows `css-budget` or the layout baseline.

1. **This spec**, and Gabe's choice of direction.
2. **The colour jobs, in Reel** (decision 3): track 3 to violet, sections as
   stripes, orange only for keeping, amber only for time. It shows in
   today's look, so everyone sees whether the jobs read right before any
   theme exists.
3. **The type scale** (decisions 4 and 5): scale tokens, Caveat gone, the
   bar's counter and tempo bigger, the phone player's counter at 64.
4. **The seam** (decision 2): materials as tokens, the `theme` device pref,
   `data-theme` at frame zero, `tokenCache` reset, the theme-file test. No
   visible change.
5. **Signal's tokens**, light and dark, behind the device pref: body, flat
   keys, black displays, solid clips.
6. **Signal's objects**: flat reels on the ticker, the flat VU face.
7. **In time with the music** (decision 7), after the cue lane (step 11)
   lands, since the ring is drawn on its pads.
8. **The phone's player**: the tape's mini-map, the section line, the cue
   pads under the thumb.
9. **The Listening Room in Signal**: the light shelf wall, labels on the
   planks, the lamp following the take.
10. **Words off the screen** (decision 6), once the clip drawer has landed.
11. **Signal as the default**, if Gabe wants it after a week on the tablet.
    Reel stays one tap away.

Later, each with its own spec: the room as objects (decision 8) and the
Zoom-recorder theme.

When a step lands, fold what lasts into `docs/architecture/css-and-motion.md`
and `AGENTS.md`, strike it here, and update `docs/plan/STATE.md`. When the
last one lands, delete this spec.
