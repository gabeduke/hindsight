# The Listening Room (P5) — implementation plan

**Goal:** Under the rooms flag, the Takes page is the Listening Room seen
from the doorway, and a take's page is the chair: putting something on and
writing down what you hear come first, and nothing the rack or the take page
does is lost.

**Spec:** `docs/superpowers/specs/2026-10-15-listening-room-design.md`

## Global Constraints

- Behind `hindsight.rooms` (`lib/rooms/flag.js`), this device only. With it
  off, `takes.html` and `wave.html` are exactly as today: no room markup, no
  listeners, no requests. The room's modules are fetched only with it on.
- No new page. The doorway is `takes.html`, the chair `wave.html`
  (`?file=` for a take, `?tape=` for a tape). Both URLs keep working.
- The room reuses the rack's machinery rather than copying it:
  `shelf-page.js` and `wave/page.js` each hand the room a small handle
  (`TakesList`, the sheet, `TakeDetail`, Play all, the bar; the take's state,
  its flags, its clock), and the room's own modules live in `lib/room/`.
  Shared files change additively.
- The room is materials: its tokens go at the end of `objects.css`, the same
  in both schemes. Its header and tabs follow the scheme. Every label sits on
  its own plate or card and passes 4.5:1.
- Accessible as drawn: every place is a button, every shelf a list of
  buttons, in reading order tapes, takes, the archive, records, then the deck.
  The scene is decoration (`aria-hidden`); without room to draw it, or with
  reduced data asked for, the shelves render as plain rows.
- CSS in one block at the end of `styles.css`, *Rooms P5*, every selector
  under a class only the room's pages wear (`room-on`, `chair-on`).
- `sw.js` → `v82`; every new `lib/room/` file and the Caveat fonts in
  `SHELL`; `lib/room/` in the `node --test` globs of `AGENTS.md` and `ci.yml`.

---

- [ ] **Go: `Meta.Record`.** `audio.Record {cut, side, cover}` on the
  sidecar and on the takes list (`Take.Record`); `PATCH /api/take` sets it
  (`record`: an object, or `null` to clear), validated (side `A` or `B`,
  cover a stripe slot 0–8, cut a time, now when absent), and answers it.
  Tests in `api_test.go` and `meta_test.go`.
- [ ] **Caveat:** `@fontsource/caveat@5.2.8` from the npm registry, latin
  500 and 700 as `fonts/caveat-500.woff2`, `fonts/caveat-700.woff2`, with
  `fonts/OFL-caveat.txt`; `@font-face` beside the others; `SHELL`.
- [ ] **`lib/room/` pure modules, with tests:**
  - `shelves.js`: the four shelves from the takes, the tapes and now —
    tapes; this month's takes folded into families (`fold`), newest first,
    NEW for one under a day old; the archive by month (`SEP · 22`); records,
    newest cut first. Records stand only on the Records shelf. The rack's
    filter (`matches`) applies.
  - `notes.js`: notes numbered in time order; a note's span (to the next
    note, or eight bars at the take's tempo, 16 s without one, whichever is
    sooner, inside the take); the clipboard body `{take, from, to}`.
  - `record.js`: the mark `{cut, side, cover}`; a take's cover (its
    stripe), a tape's (its id hashed onto the stripes); what CUT A RECORD
    does for a take (mark it, or cut its IN–OUT span first) and a mixdown's
    progress from `live.mixdown`.
  - `swap.js`: whether loading a tape has to ask first (the Studio's tape is
    playing, counting in, recording, armed or mixing down), and the question.
  - `mount.js`: `start({page, flagOn, load})` — null with the flag off,
    without loading anything.
- [ ] **The doorway** (`room/doorway.js`, from `shelf-page.js`'s handle):
  - the room (wall, lamp, window, rug, the chair) as decoration;
  - the shelves as lists of buttons: reel boxes, cassette spines (NEW
    sticker, the gap a pulled spine leaves), month boxes, LP sleeves;
  - a spine opens the take's sheet, whose head is the card: PUT IT ON, TO
    THE STUDIO, then Play all from here, CUT A RECORD, MP3 and DAW bundle,
    above the rack's own (star, tag, rename, family, delete, WAV);
  - a tape's card: PUT IT ON (load and play on the Pi, asking first if the
    Studio's tape is busy), TO THE STUDIO, CUT A RECORD (a mixdown, its
    progress a plain bar on the turntable);
  - a month's box opens today's rack, filtered to that month;
  - the deck, the turntable and the sketchbook as places; the dock is the
    now-playing bar with SIT DOWN;
  - *Search the shelves* opens the rack's filter;
  - a View Transition cross-fade from shelf to deck.
- [ ] **`shelf-page.js` handle:** with the flag on, `wide` never opens the
  side pane (a spine always opens its sheet), a room filter for the month,
  list changes heard, Play all from a take.
- [ ] **The chair** (`room/chair.js`, from `wave/page.js`'s handle):
  - STAND UP, CUT A RECORD in the header;
  - the deck close up: the bar's reels and LCD, the name on masking tape,
    |◂ ◂◂ ▶ ▸▸ ⏏ and NOTE HERE;
  - the take on tape: its trace on oxide, notes as numbered grease marks;
  - the sketchbook: the title, the date, the notes (words edited in place,
    deleted, each *to the studio*), one sticker from the tag and the gold
    star, and the note field;
  - TOOLS: the take page as it is (the waveform, IN, OUT and Cut, tempo and
    downbeat, the MIDI lanes, Send to, More).
- [ ] **A tape in the chair** (`wave.html?tape=`): the deck plays it on the
  Pi; its sections as read-only notes; CUT A RECORD; TO THE STUDIO.
- [ ] **`wave/page.js` handle:** with the flag on, `?tape=` goes to the
  chair instead of failing; the handle exposes the take, its flags, the
  playhead and seek, add/edit/remove a flag, and a redraw hook.
- [ ] **Materials:** the room's tokens at the end of `objects.css` (walnut,
  the wall's dusk, the lamp, paper, cardboard, vinyl, brass plates);
  `materials.test.js` lists them.
- [ ] **CSS:** the *Rooms P5* block; a test that its selectors are scoped to
  the room's classes.
- [ ] **Flag off, nothing:** tests that the pages' room entry loads nothing
  with the flag off, and that `takes.html` and `wave.html` carry no room
  markup.
- [ ] **Structure tests:** `paths.test.js` (Caveat in `SHELL`, every
  `lib/room/` file), `pages.test.js`, `styles.test.js`.
- [ ] `sw.js` v82 and `SHELL`; `lib/room/` in the globs.
- [ ] **Docs:** `development.md`, *The Listening Room*; `api.md`, `record`.
- [ ] **Look:** doorway, chair (take and tape) and phone, 390×844 and
  1440×900, both schemes, flag on and off, against the demo. A take's whole
  trip: shelf → deck → NOTE HERE → *to the studio* → the clipboard holds its
  span and the Studio opens. Cut a record from a take and from a tape.
