# The take page

The take page (`wave.html`, *Open*) is the one place a take is edited: a
header, the overview, an editing canvas in three zones, the keys under it,
the MIDI, and the notes drawer docked beside it (*Open*, below).

`web/static/lib/wave/` holds the page; `lib/edit/` and `lib/help/` hold what
it shares with the Studio. The pure parts of each are node-tested.

| Module | What it does |
|---|---|
| `edit/gestures` | The pointer machinery any editing surface extends: a drag pans, a hold then a drag selects (with the view scrolling under a finger held at an edge), taps and double-taps, pinch and wheel, and rollback on a cancel or a second finger |
| `edit/editor-bar` | The editor bar's gesture core: the ZOOM and POSITION pads, the ◂ ▸ steps, their arrow keys and the wheel move a point, and a whole gesture (a drag, a held key, a burst of notches) is saved once, so it is one undo step. The page says what the point is, where a move lands and how it is saved |
| `wave/view` | The take's editing canvas, in three zones. The ruler: the notes' pins on top (a tap is its note, said on the tap's click; a drag moves it), bar numbers below, the playhead handle ▾ (drag to scrub silently) and bar 1 (drag the downbeat). The body: the waveform. The grips: In and Out at the selection's ends and the move handle between them |
| `wave/geometry` | Pixel and frame math, the bar grid and ruler ticks, Snap, In/Out with a pending point |
| `wave/draw` | Waveform drawing: `levelsFor`/`levelsOfColumns`, `takeGain`, `lift`, `smooth` and `drawBars` -- every view of a take (cassette, spine, tape block, take page, overview) draws on the take's own scale (one gain per take). `drawColumns`, on the meters' dB scale, draws a list row only |
| `wave/tape-strip` | Trace on tape: `paintOxide` paints the brown strip, `drawTrace` the glowing line along a take's envelope (one glow pass per call; blur in CSS px, scaled to device pixels) |
| `wave/rowwave` | A list row's waveform and its playback, with the selection's bracket |
| `wave/tiles` | Fetches and caches `/api/peaks` ranges, drawing the coarsest thing it has until the finer tile arrives |
| `wave/overview` | The whole-take strip: drag, tap and double-tap-to-fit navigation |
| `wave/clock` | The one playback position: the preview MP3, or with Loop on, `/api/slice` looped in Web Audio, sample-exact |
| `wave/lanes`, `wave/rising` | The MIDI lanes (with a menu per lane) and the rising-notes view |
| `wave/share` | Getting a rendered MP3 or bundle off the phone |
| `wave/page` | Owns the take's editable state and wires the rest together; hands Open (`room/open.js`) a handle on it |
| `room/open` | Open's words over the page: the notes drawer docked (or a sheet, with the list under the keys on a phone), GRAB, KEEP's length, the tag, and what was made from the take |
| `help/tips`, `help/help` | Every control's tip; titles on a computer, help mode on a phone, opening with a page's `HINTS` |
| `help/markdown` | Renders the guide for `/guide.html`, from `/guide.md`, which the binary serves compiled in (`docs/embed.go`) |
| `link`, `socket`, `live`, `tape/poll-gate`, `tape/changes` | Reads that time out, the wake-up refetch, the *Reconnecting…* note; a socket that replaces itself (`socket.js`'s `connectSocket`), for the live meters (`live.js`) and the tape's changes (`tape/changes.js`, see *The revision*, `push.md`); one poll at a time, and a nudge's poll after it (see *Waking up*, `shell.md`) |
| `toast` | Both pages' toasts, with an optional action ("Flag deleted · Undo"), and one carried to the next page |
| `takes`, `trash` | The Listening Room's list, with select mode for several takes at once; *Recently deleted* |

A few rules hold the page together:

- **One finger moves along the take, always.** Nothing in the waveform's
  body is draggable; what can be dragged lives in the ruler or the grip
  strip, so gestures never compete.
- **Repeat is a toggle** (the bar's ⟲; the code says `loop`), off on every open. Off, the preview plays from the
  playhead straight through; on, the selection is fetched as a slice and
  looped sample-exact. Practice speed applies only to the preview.
- **In and Out** set the selection's ends at the playhead. The first of a
  pair waits as a pending point until the other completes it.
- **The page is the state's owner.** It loads its take with
  `GET /api/take?file=` and fetches it again when it comes back into view,
  merging what another device changed (notes, name, star, tempo, grid, and
  the selection unless it has an unsaved one). Notes (the Pi's flags) go one
  at a time through `/api/take/flags`; the header's rename, star and tempo
  through the PATCH.
- **Undo is the Pi's.** ↶ and every toast's *Undo* call `POST /api/take/undo`
  and put back the take it answers with; edits still on their way are sent
  first, so Undo acts on what's on screen.
- **Back is the browser's back** when the list is where you came from, so the
  list keeps its scroll; the list also restores it when the browser reloads
  it instead. The take menu's *Previous take* and *Next take* step through
  the takes in the order the list last showed.
- **Tips live in one file,** `lib/help/tips.js`, and the guide's §9 table is
  the same list; a node test fails if they differ or if any `data-tip` in the
  UI has no tip.

## Open

How the page is laid out (decided in `listening-back.md`, *Open, on a
tablet and wider*, and the-studio-space.md's *Open* row; flows J2.5, J2.9,
J3.1):

- **The header** is the frame's (`css/chrome.css`): ‹ Takes, the take's
  name (its menu: Rename…, Previous and Next take, the downloads, Reset
  the downbeat, Tag… under 1000 px, Delete last), ★, its tag, then ↶ and ☰.
- **Under the waveform:** with a selection, its In/Out row; then **GRAB**
  (`#take-grab`, the primary: `room/open.js` says how many bars), **KEEP**
  (`#save-take`, saying how much) and **More** (`#more-btn`, a `menu()`:
  Share or Download, the DAW bundle, the WAV and MIDI, Delete); then
  **Fine tune ▸** (`#fine-tune`: the downbeat row, Snap, practice speed,
  Level) and **MIDI ▸** (`#midi`: the lanes and the piano roll), each a
  `.fold-key` folding out a `.take-fold`, closed on every open. MIDI ▸ shows
  from the take's first paint (`take.has_midi`), so nothing moves when
  the MIDI loads; the piano roll draws only while MIDI ▸ is open.
- **The notes drawer** is `#notes-dock`, the grid's second column from 860
  px: the page is a viewport-high two-column grid from its first paint
  (`styles.css`, *The bench*), whatever the take has. Under 860 px the dock
  is not shown, the drawer is a sheet from ✎, and `#notes-here` lists the
  notes under the keys (`docs/architecture/rooms.md`, *The notes drawer*).
- **✎ is the only pencil:** `#note-now` in the bar's own keys (and the
  phone's mini player), F, and a tap on a pin. A double tap on the
  waveform zooms in four times about it (as close as it goes, out to the
  whole take), and **− Fit +** (`.wave-zoom`, over the waveform's corner)
  zoom by twos about the middle.
- **A note's pin** is a numbered tag (`objects/pennant.js` `drawPin`), its
  number its row's (`notes.js` `notesOf`: by frame, then id). On a touch
  screen (a finger or a pen, `GestureSurface.coarse`) a pin and a grip
  take 44 px across. A dropout is a ⚠ row among the notes (the source's
  `dropouts()`), with ▶ from a second before, and nothing to edit.
- **Words:** the MIDI's fold says MIDI and its lanes count what was played
  (*6 played*, *60 hits*), so *notes* means only yours; ⟲ says Repeat; Undo
  says *adding a note*. *Three things worth knowing* is help mode's opening
  on this page (`help.js` `HINTS`), not a card.
