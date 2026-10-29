# The studio space

Agreed with Gabe on 2026-10-24, from the wireframes canvas
(`9VDEexPH2bUo1vVzxZBSQx`: every view at tablet, phone and desktop size,
measured from the demo) and an audit of every view against DAW and mobile
conventions. What he asked for:

- Buttons where someone who uses other phone, tablet and desktop apps looks
  for them: *"buttons are sometimes unintuitive and not in the locations I
  would expect."*
- A DAW as the reference, but its own thing: *"a recording studio I use
  mostly from mobile, tablet interface and light edits rather than deep
  production work."*
- *"Visuals and animations [that] feel fluid and immersive rather than just
  another mobile app."*
- Code that stays easy to change.
- On the Listening Room: *"a lot of wasted space that could be dedicated to
  organization of the music library … A more 3 dimensional feel would help
  with my idea to make this more of a studio feel."*

It takes in the open steps of `the-studio-on-one-screen.md` and
`listening-back.md`, which hold their details.

## Landed

Steps 1 to 6, each now in `docs/architecture/`:

- **Foundations**: one stylesheet reader for the tests, the computed-style
  snapshot (`scripts/css-snapshot.mjs`), the overwritten declarations gone
  (`css-cascade.test.js`), fallbacks matching the tokens
  (`css-tokens.test.js`), the budget (`css-budget.test.js`), the Studio's
  frame budget (*A frame's budget*), and `lib/ui/press.js`.
- **The stack and the menus**: `lib/ui/layers.js` (Back and Escape close
  the top thing first), `lib/ui/menu.js`, the icon sprite (*Icons*), the
  motion tokens (*Motion*), and keys that press within a frame. What is
  still on its own path is in `STATE.md`, *Next*.
- **The frame** (*The frame*): the header's three zones on every page; the
  tape's and the take's names as their menus; ⋯ gone into them and into
  ⌗'s View menu. J5.1, J3.2.
- **The bar** (*The bar*): one shape in fixed zones, ▶ never moving (J1.13),
  ● beside ▶ and Catch beside ●, the display's source, tempo and output
  keys, the grabber, Open › and ✎ at its end.
- **The studio as a place** (*Moving between rooms*): the room switch as a
  camera turn, the header and the bar held still, the rooms mounted before
  the first switch.
- **The library** (*The library*): the shelf wall, Sort, Shelf | List,
  search into the List, a phone's List, the room as entrance. J2.7.

What the audit found that is still open: the phone's pulled-up player puts
every control in the top third and can't be swiped; recording from the
phone is buried in a menu; GRAB's buffer pushes the cue lane and the tracks
under the bar, so DROP is pressed blind; Open is three generations stacked
(Download the orange key, five ✎ controls, the waveform halving when the
MIDI pane arrives); and most motion is still cuts.

What works and stays: the bar as a tape deck (reels, the amber LCD, one
transport in every room), keys that name what they act on (*GRAB 8 BARS ·
from aux · armed*), the feed ribbon, the masking-tape track names and the
VU faces, the cassette spines, tap plays and hold selects, Undo in every
toast, help mode, the scene contract and the shared ticker.

## Decisions still to build

| | |
|---|---|
| The studio is a place | The drawn room becomes **where you are**, not what you look at. The Studio's desk and the library's shelf wall are two walls of one space, and switching rooms **turns a CSS-perspective camera** from one to the other (tab order: the Studio left, the library right) while the header and the bar, the desk in front of you, hold still. The room shows in full as you walk in, then falls back to ambient light behind the shelves. Opening a take **dollies in** to it; ‹ Takes dollies back out. No 3D engine: CSS 3D transforms and View Transitions on the compositor. "Flat first" stands; three.js stays the Rig's. |
| Motion | One set of tokens and springs in `lib/objects/motion.js`, mirrored in CSS and kept in step by a test (as `choreo.test.js` does). A touch shows within one frame. **Nothing teleports**: a GRAB peels off the ribbon into the cue lane, a cue clip flies to its track, KEEP sends a spine to the Listening Room's tab, the mini player grows into the full one. Sheets and drawers follow the finger and settle on a spring, flicks included. Anything waiting for the bar line shows its countdown; lamps pulse in tempo. Only transform and opacity animate. Reduced motion turns travel into fades. Haptics where the device has them, never as the only answer. **No UI sounds**: the ring is always listening. |
| The phone | The pulled-up player is a sheet you drag: grabber at the top, the reels and display as its art, the strip, then the transport in the thumb's reach and the output at the foot. A drag up from the mini player opens it; a swipe down or Back closes it. |
| Recording from a phone | A big red **●** in the phone's mini player records from the phone, with its input on a ▾; *Record from this phone…* in the name's menu is the second way in. *Changes* `the-studio-on-one-screen.md`, where ● Phone moved into ⋯. |
| Open | `listening-back.md`, step 3, as agreed, plus: the frame above; the selection gets the Studio's action bar; the page's grid is set from the first paint, so nothing jumps when MIDI arrives; − Fit + on the waveform, and a double tap zooms (notes come from ✎ alone); grips and pins 44 px on touch. |
| Under the hood | The CSS splits into one file per place (tokens, base, kit, chrome, bar, studio, room, take, play, rig, guide…), each listed in `sw.js` and checked by ratchet tests. Shared modules in `lib/ui/`: `layers.js` (the one stack), `menu.js`, `sheet.js` (detents, swipe, flick), `press.js` (tap, double tap, hold: one table of thresholds), an SVG icon sprite in place of the unicode glyphs, and `dom.js`. Each lands with its first user, never as a sweep. |

The studio as a place has landed but for the dolly into a take (step 10).
Of *Under the hood*, `lib/ui/` has `layers.js`, `menu.js`, `press.js`,
`keys.js` and `icons.js`, and `css/` has `chrome.css`, `bar.css` and
`rooms-motion.css`; `sheet.js` comes with step 7, and the rest of the CSS
files as their places are rebuilt.

### To settle while building

My recommendation first in each.

- **One hold time, 400 ms** (Android's), in place of 300, 350, 400 and
  500. Until Gabe has tried it on the tablet, `lib/ui/press.js` keeps
  today's values by name.
- **The phone's ●, with the tape in the jam room**: a tap records the jam
  room as now; a hold offers *Record from this phone*. With the tape
  playing on this phone, a tap records here.
- **The tablet's track heads** keep step 3's inspector for M, S and level,
  plus a visible way in (a › at the head's end). GarageBand's reveal (drag
  the heads wider to show M, S and level for every track) is the
  alternative if the inspector costs too many taps mid-jam.

## Build order

Each step is its own PR, with its flows updated in `docs/flows.md` and
`scripts/flows/`, looked at in a browser at phone, tablet and desktop size
in both schemes, and the layout baseline shrinking, never growing. **Each
step is a checkpoint**: it merges alone, and `docs/plan/STATE.md` says
what's next.

1–6. Landed (above).
7. **The phone.** `sheet.js`; the player as a sheet you drag; ● records
   from the phone.
8. **The Studio's heads and ruler** (`the-studio-on-one-screen.md`, steps 3
   and 4): the heads on touch, ~~the ⌗ View menu everywhere~~ (landed
   with the frame), the budget.
9. **The notes drawer** (`listening-back.md`, step 2), on `sheet.js`.
10. **Open** (`listening-back.md`, step 3, with the decisions above), and
    the dolly into a take.
11. **The buffer into the cue lane** (`the-studio-on-one-screen.md`, step
    5): cue clips as pads with a ring to the bar line, the clip drawer in
    the dock above the bar, GRAB's peel into the lane and DROP's flight to
    the track. Go, so it releases.
12. **Polish**: the reels' inertia on the bar, KEEP's spine to the shelf,
    lamps in tempo, the room listening with you (its lamp and VU follow
    the take), and the CSS's remaining files.

When a step lands, fold what lasts into `docs/architecture/` (`shell.md`,
`rooms.md`) and `AGENTS.md` (*Where things live in the UI*), and strike it
here. When the last one lands, delete this spec.
