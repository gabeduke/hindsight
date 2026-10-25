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
- Then, on the Listening Room: *"a lot of wasted space that could be
  dedicated to organization of the music library. Maybe the room view is
  just part of the entrance animations when you enter or switch between
  areas. A more 3 dimensional feel would help with my idea to make this
  more of a studio feel."*

It builds on `the-studio-on-one-screen.md` and `listening-back.md`. Their
open steps join one build order below. Where this spec changes one of their
decisions, the row says so.

## What the audit found

Measured on the demo, the tablet (1024×768, touch) first.

- **The bar is where most of the friction is.** It runs off the tablet's
  right edge: by 8 px with the tape in it, by 61 px with a take (✎ ends at
  x 1085), and at 800 px wide (a Pixel Tablet held upright) Catch shows
  41 px of itself. **▶ moves**: x 389, 447 or 462 on the tablet, and from
  x 62 to x 260 on a phone, depending on the room and the source. Record
  isn't beside Play: ⟲ sits between them, and Catch is 488 px from ▶.
  The bar's Feed | Tape | Shelf switch can leave the room. **▾ means four
  things** (a length menu, Catch's menu, fold the bar, put the phone's
  player away), and two of them sit 10 px apart.
- **The frame moves between pages.** Studio | Listening Room is top left
  in the rooms and top centre on Open and Capture, so a tap where it
  usually is lands on the brand. ☰ means the app menu, the phone's
  Listening Room tab and the shelf's List. ⋯ and ☰ sit side by side, and
  the tape's name is a third menu.
- **Panels hide what they act on.** GRAB's buffer pushes the cue lane and
  all four tracks under the bar, so DROP ON TRACK 1 is pressed blind, and
  it is the one surface that Back, Escape or a swipe can't close. Back with
  a menu open switches rooms; ☰ stays open across a room switch.
- **The phone.** The pulled-up player puts every control in the top third
  and leaves the bottom 440 px empty; it closes with ▾ Down in the far
  corner and can't be swiped. Recording from the phone, the job the phone
  is for, is the seventh item in ⋯.
- **The Listening Room** spends the tablet on a picture: the shelf is a
  quarter of the screen, takes past the seventh are hidden, the deck does
  nothing when tapped, Search's results sit under the keyboard, and List is
  a 24 px tag. On a phone it is three cards above 400 px of nothing.
- **Open** is three generations stacked: Download is the orange key, five
  ✎ controls, In/Out in two places, and the waveform halves 0.4 s after
  every open when the MIDI pane arrives.
- **Motion is mostly cuts.** The one fluid moment is the cassette's flight
  from the shelf to the deck. Menus, sheets, the folds, GRAB, DROP, the
  phone player and the room switch appear in one frame. While the tape
  plays, the Studio redraws every lane each frame with a forced layout:
  at 4× CPU it falls to 18 fps.
- **The code makes moving a button cost 7 or 8 files.** `styles.css` is
  6,034 lines in build-phase order; the bar alone has 232 selectors in 14
  sections and hides keys with `!important` lists. There are 6 menu
  implementations, 3 kinds of sheet, 3 schemes for Back, Escape in 16
  files, and 11 hold gestures with 4 thresholds (300, 350, 400, 500 ms).

What works and stays: the bar as a tape deck (reels, the amber LCD, one
transport in every room), keys that name what they act on (*GRAB 8 BARS ·
from aux · armed*), the feed ribbon, the masking-tape track names and the
VU faces, the cassette spines, tap plays and hold selects, Undo in every
toast, help mode, the scene contract and the shared ticker.

## Decisions

| | |
|---|---|
| One frame on every page | The header is three zones, the same on the Studio, the Listening Room, Open and Capture (and the Rig when it becomes a view): **what you're working on** at the left, **Studio \| Listening Room** in the centre (as iPadOS 18's tab bars), and **↶ ↷ ☰** at the right. The left is the tape's name ▾ in the Studio, the search field in the Listening Room, ‹ Takes and the take's name ▾ on Open. The brand shows only from 1280 px, left of everything. On a phone the rooms stay bottom tabs, and the header is the context (one 44 px pill), ↶ and ☰. ☰ is only ever the app menu: the shelf's List and the phone's Listening Room tab get icons of their own. |
| The name is the menu; ⋯ goes | The tape's name opens its menu: the tapes and New tape; Rename, Duplicate; Share the mix, Bounce the loop, Bounce the whole tape, Export stems, the last bounce; Record from this phone…; then **Delete this tape…** last, red, after a divider, through the confirm sheet (never the native prompt, and always by id). Open's take name does the same for the take (Previous and Next take, downloads, Delete). The options in today's ⋯ (snap, lock the loop, Ask before Insert and Delete time) go to the ⌗ View menu. *Changes* `the-studio-on-one-screen.md`, where ⋯ stayed and gained the snap and the lock. |
| The bar has one shape | The bar is a grid of fixed zones: **[reels + display] [\|◀ ▶ ●/↺] [the verb] [modes] … [the end]**, plus the strip under them. Zones keep their place in every room and for every source: **▶ never moves.** The tape's verb is Catch ▾; a take's end is ⏏, **Open ›** and ✎ (`listening-back.md`, step 1). It fits with no sideways scroll at 800, 1024 and 1280 px, laid out end first. Nothing is added to the bar by DOM order: scripts put keys into named slots. |
| The transport's order | **\|◀ ▶ ● Catch** then **⟲ ♩**: Record beside Play as in every DAW, and Catch, Record's after-the-fact twin, beside Record (Ableton keeps Capture beside Record). ● is always red; its key glows while armed or recording. ♩ becomes a metronome glyph. With a take in the bar, ↺ 5 s takes ●'s place and ⟲ says Repeat. |
| The display says what plays | The bar's LCD shows the source (**TAPE**, **FEED** or the take's name), the tempo and where it plays (**JAM ROOM**, **PHONE**, **BOTH**, **THIS TABLET**). A tap on the tempo opens the tempo menu (Logic's convention); a tap on the source opens *The tape · The live feed · recent takes · Go to the shelf ›*; a tap on the output opens the output sheet. So the tempo pill, the header's output button and the Feed \| Tape \| Shelf switch go. *Changes* J2.3's switch, and moves the output's way in from the header tools (`the-studio-on-one-screen.md`, step 1) to the bar. |
| ▾ only opens a menu | The bar folds with a grabber on its top edge (tap, or drag down); the lanes fold from the ⌗ View menu; the phone's player closes with a grabber and a swipe down. Catch's ▾ is its own 44 px key, as GRAB's and KEEP's are. |
| One way to close things | Menus, popovers, drawers, sheets, the phone player and a selection all sit on one stack. **Back and Escape close the top one first**, and only then leave a room. A tap outside closes a menu. Switching rooms closes menus. On a phone, a menu opens as a bottom sheet. |
| The library | The Listening Room is a **shelf wall**: the takes as cassette spines on shelves that fill the screen, one shelf per month, then ★ and a shelf per tag, drawn in light perspective. On top: the search field (left zone), **Sort ▾** and a **Shelf \| List** switch. Tap plays, a double tap opens, a hold selects, as now. Search opens the List with the field pinned and the results right under it, matching what's printed on a spine. On a phone the library is the List, grouped by day under month headers, with the search pinned; the shelf wall is one tap away. *Changes* `listening-back.md`'s deck: the drawn room is no longer the screen. |
| The studio is a place | The drawn room becomes **where you are**, not what you look at. The Studio's desk and the library's shelf wall are two walls of one space, and switching rooms **turns a CSS-perspective camera** from one to the other (tab order: the Studio left, the library right) while the header and the bar, the desk in front of you, hold still. The room shows in full as you walk in, then falls back to ambient light behind the shelves. Opening a take **dollies in** to it; ‹ Takes dollies back out. No 3D engine: CSS 3D transforms and View Transitions on the compositor. "Flat first" stands; three.js stays the Rig's. |
| Motion | One set of tokens and springs in `lib/objects/motion.js`, mirrored in CSS and kept in step by a test (as `choreo.test.js` does). A touch shows within one frame. **Nothing teleports**: a GRAB peels off the ribbon into the cue lane, a cue clip flies to its track, KEEP sends a spine to the Listening Room's tab, the mini player grows into the full one. Sheets and drawers follow the finger and settle on a spring, flicks included. Anything waiting for the bar line shows its countdown; lamps pulse in tempo. Only transform and opacity animate. Reduced motion turns travel into fades. Haptics where the device has them, never as the only answer. **No UI sounds**: the ring is always listening. |
| The phone | The pulled-up player is a sheet you drag: grabber at the top, the reels and display as its art, the strip, then the transport in the thumb's reach and the output at the foot. A drag up from the mini player opens it; a swipe down or Back closes it. |
| Recording from a phone | A big red **●** in the phone's mini player records from the phone, with its input on a ▾; *Record from this phone…* in the name's menu is the second way in. *Changes* `the-studio-on-one-screen.md`, where ● Phone moved into ⋯. |
| Open | `listening-back.md`, step 3, as agreed, plus: the frame above; the selection gets the Studio's action bar; the page's grid is set from the first paint, so nothing jumps when MIDI arrives; − Fit + on the waveform, and a double tap zooms (notes come from ✎ alone); grips and pins 44 px on touch. |
| Under the hood | The CSS splits into one file per place (tokens, base, kit, chrome, bar, studio, room, take, play, rig, guide…), each listed in `sw.js` and checked by ratchet tests. Shared modules in `lib/ui/`: `layers.js` (the one stack), `menu.js`, `sheet.js` (detents, swipe, flick), `press.js` (tap, double tap, hold: one table of thresholds), an SVG icon sprite in place of the unicode glyphs, and `dom.js`. Each lands with its first user, never as a sweep. |

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

1. **Foundations, nothing visible.** A safety net for the CSS (one
   stylesheet reader for the tests, a computed-style snapshot diff, the
   213 overwritten declarations gone, the JS fallbacks matching the
   tokens, a budget that only goes down); the Studio's frame budget while
   it plays (the playhead by transform, lanes repainted only when they
   change); one `lib/ui/press.js`.
2. **The stack and the menus.** `layers.js` (Back and Escape close the top
   thing first; switching rooms closes menus), then `menu.js` for ☰, the
   name's menu and the ▾ keys, with menus growing from their key; the icon
   sprite, header first (~~the header, the bar and the ruler~~: landed, in
   `docs/architecture.md`, *Icons*; the rest of the glyphs go as their
   regions are rebuilt). The motion tokens and springs, and keys that
   press within a frame.
3. **The frame.** The header's three zones on every page; the tape's name
   as its menu; ⋯ goes; the tempo and the output into the bar's display.
4. **The bar.** `bar.css`: the zones, the transport's order, Catch's own
   ▾, the grabber, the source on the display, and the fit at 800, 1024
   and 1280; then `listening-back.md` step 1 (Open › and ✎ in the end
   zone, the double tap on a spine). A layout check that ▶ stays put.
5. **The studio as a place.** The room switch as a camera turn with the
   header and the bar held still; the rooms mounted before the first
   switch, so it never stalls.
6. **The library.** The shelf wall, Sort, Shelf \| List, search into the
   List; the phone's List; the room as entrance and ambient light.
7. **The phone.** `sheet.js`; the player as a sheet you drag; ● records
   from the phone.
8. **The Studio's heads and ruler** (`the-studio-on-one-screen.md`, steps 3
   and 4): the heads on touch, the ⌗ View menu everywhere, the budget.
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

When a step lands, fold what lasts into `docs/architecture.md` (*The UI*,
*Vocabulary*) and `AGENTS.md` (*Where things live in the UI*), and strike it
here. When the last one lands, delete this spec.
