# The Listening Room (P5)

**Date:** 2026-10-15 · **Status:** proposed; the direction is agreed in
[Two rooms and a rig](2026-10-15-rooms-design.md) · **Repo:** `hindsight` ·
**Canvas:** the *Listening Room* page of
[Hindsight — Room, Studio & Rig](https://claude.ai/artifact/Ls32s93iBGoT7jUcHQb54Y)

## Why

Gabe, 2026-10-14: *"The listening room should be like walking into John
Cusack's apartment from High Fidelity, sit down in a comfy chair, spin some
records while relaxing with a drink or sketchbook."*

The Takes page is a good rack, but it's a tool, and reviewing a jam is not a
tool's job. It's listening, with a pencil. The room keeps every capability
of Takes and the take page, and changes what comes first: **putting
something on, and writing down what you hear.**

## What

This is P5, the room drawn flat: DOM, SVG and CSS, as the canvas's boards
are. Parallax, the camera move and the lathe come later, from the
[scene contract](2026-10-15-scene-contract-design.md)'s briefs R2, R3 and R7.
P5 must work without them.

### Two places to be

| View | Page | Is |
|---|---|---|
| **From the doorway** | `takes.html` | The shelves, the hi-fi, the chair and the sketchbook as places. You browse here |
| **In the chair** | `wave.html` | One tape or take on the deck, close up, with the sketchbook in your lap. You listen here |

Under the rooms flag, the doorway is `takes.html` and the chair is
`wave.html`. **SIT DOWN** goes from one to the other and **STAND UP** comes
back. With the flag off, both pages are as they are.

### The shelves

| Shelf | Holds | From |
|---|---|---|
| **Tapes** | Reel boxes, spine out, named on masking tape | `GET /api/tapes` |
| **Takes · this month** | Cassette spines, newest first. A new one wears a NEW sticker; one pulled out leaves its gap | `GET /api/jams`, folded into families as the rack does now (`shelf.js`: `fold`, `familyOf`) |
| **Archive** | Card boxes by month, *SEP · 22* | The same list, older than this month. A box opens to today's rack view, filtered to its month |
| **Records** | LP sleeves | Takes marked as records (*Cut a record*, below) |

- **Search the shelves** is today's rack filter: names, tags, stars.
- Every capability of the rack stays: star, tag, rename, families, the trash,
  and *Play all*. It moves into a take's sheet, opened from its spine.
- **Picking a spine** pulls it out (lift, then slide). A card offers
  **PUT IT ON** and **TO THE STUDIO**. The full shelf-to-deck flight is
  brief R2; P5 uses a View Transition cross-fade.

### The hi-fi

- **The deck** plays tapes and takes.
  - **A take** plays on this device, as the rack plays it today (`pageBar`,
    `take-source`).
  - **A tape** plays on the Pi through OUT, which means *loading it*: the same
    tape the Studio has. If the Studio's tape is playing, recording or armed,
    the room asks first: *Studio is using "Tuesday groove". Swap it?*
- **The turntable** plays records: takes again, on this device. It has the
  same keys, drawn as a tonearm and a start button.
- **The dock** at the foot is today's now-playing bar in the room's materials:
  - play, the time, the scrubber with grease IN/OUT;
  - **SIT DOWN**;
  - the OUT pill.

### The chair: the sketchbook

`wave.html` under the flag:

- **the deck close up** (the reels, the LCD, and its keys |◂ ◂◂ ▶ ▸▸ ⏏ and
  NOTE HERE);
- **the take on tape,** under it: the trace on oxide, with each note a
  numbered grease mark;
- **the sketchbook,** open across the foot.

| In the sketchbook | Is | Route |
|---|---|---|
| **A note** | A take flag with words: `{frame, label}` | `POST`, `PATCH`, `DELETE /api/take/flags` · exists |
| **NOTE HERE** | A new flag at what you hear now, with the cursor in its words | The same |
| **The title** | The take's label | `PATCH /api/take` |
| **A sticker** | The take's tag. A take has one tag (`Meta.Tag`), so it has one sticker, plus a gold star when starred | `PATCH /api/take` |
| **To the studio** (each note) | Puts the note's span in the Studio's buffer and opens the Studio with it | `POST /api/clipboard` `{take, from, to}` · exists |

- **A note's span** runs from its mark to the next note, or eight bars at the
  take's tempo (16 s with none), whichever is sooner. The buffer trims it.
- **Today's take page tools stay,** folded under **TOOLS** in the chair:
  - IN, OUT and Cut;
  - tempo and downbeat;
  - the MIDI lanes;
  - Send to, and More.

  Nothing the take page does is lost; it's just not what comes first.
- **A tape in the chair** shows its sections as read-only notes. Notes on
  tapes are not in P5.

### Cut a record

**CUT A RECORD**, in the chair and on a spine's sheet, makes a record from
the thing on the deck:

| From | How | Exists |
|---|---|---|
| A tape | A mixdown: the tape played once and saved as a take (`POST /api/tapes/mixdown`), which takes as long as the tape | yes |
| A take | The take, or its IN–OUT span as a cut (`POST /api/cut`) | yes |

- **What makes it a record:** `Meta.Record {cut, side, cover}` on the take,
  set by `PATCH /api/take` (new field). `cover` is the colour of the source's
  stripe or tag, and is the sleeve's.
- **Progress:**
  - a mixdown already reports it (`live.mixdown`). P5 shows it as a plain bar
    on the turntable; brief R7 turns it into the lathe's cutting head;
  - a cut is quick.
- **A failure** leaves nothing on the Records shelf, and says why.
- **The file:** a record's sleeve offers today's downloads: WAV
  (`/api/download?dl=1`), MP3 (`/api/render`) and the DAW bundle.

### Look and materials

- **The room is drawn in materials.** Walnut, the wall's dusk, the lamp's
  glow, paper, cardboard and vinyl are the same in both schemes, as the pad
  controller's are: a room is a place, not chrome.
  - These tokens go in `objects.css`; `materials.test.js` already guards that
    file.
  - The header and tabs follow the scheme, as everywhere.
- **The room is drawn from a description** (2026-10-16): the furniture,
  the lights and the cameras as data in `lib/room/space.js`, each object
  drawn by its own function in `lib/room/art/`, and lit from where the lamp
  and the window are (the scene contract's *Listening Room as data*). Wide
  enough (700 px and up) the room is drawn; a phone keeps the rows.
- **Text on the room passes contrast** in its own right: cream on a dark
  wall, dark ink on paper. A label sits on its own plate or card, never on
  the drawing.
- **The sketchbook's hand is Caveat** (OFL), bundled as `woff2` under
  `web/static/fonts/` with its licence, and listed in `SHELL`. Fonts never
  come from a CDN (`styles.css`). Permanent Marker stays for names on tape
  and labels.
- **Phone** (the canvas's *Listening Room · phone*):
  - the deck card on top, with SIT DOWN;
  - the sketchbook strip;
  - the shelves as horizontal rows, swiped;
  - the two tabs.

### Accessible as drawn

- **Every place is a button,** and every shelf a list of buttons, in reading
  order: tapes, takes, the archive, records, then the deck. A screen reader
  gets the rack, not a picture.
- **The doorway view degrades to the rack.** If the scene can't draw (no
  space, reduced data), the shelves still render as rows.

## Decisions (recommended picks)

1. **The doorway is `takes.html` and the chair is `wave.html`.** No new pages:
   both already host the right half, and their URLs keep working.
2. **Notes are flags with words.** The model and API exist, and the labels
   already travel in the WAV's cue chunk, so a note made here shows up in a
   DAW.
3. **One sticker, from the take's one tag.** Several tags per take would be a
   change to the model for its own spec.
4. **Records are takes with a mark,** not a new store: everything a take can
   do (download, share, trash), a record can do.
5. **Playing a tape in the room loads it on the Pi,** and asks before taking
   it from the Studio.
6. **The room is materials** and the same in both schemes. The chrome around
   it follows the scheme.

## Not in this

- **Doodles in the sketchbook.** The canvas draws one; drawing needs a store
  for strokes. Later.
- **Notes on tapes.** Tapes have sections today.
- **The 2.5D scene, the camera move between doorway and chair, the
  shelf-to-deck flight, and the lathe.** These are briefs R2, R3 and R7.
- **FLAC.** WAV and MP3 are what exist.

## Checks

- **A take's whole trip:** shelf → deck → NOTE HERE → *to the studio* → the
  buffer holds its span, and the Studio is open.
- **Every rack capability is reachable from a spine's sheet:**
  star, tag, rename, family, trash, Play all, download.
- **Cut a record:**
  - from a tape: a mixdown, marked, on the Records shelf;
  - from a take: the same;
  - a failed mixdown marks nothing.
- **A tape on the deck while the Studio records it** asks first.
- `materials.test.js` passes with the room's tokens in `objects.css`.
  `paths.test.js` finds Caveat in `SHELL`.
- **In a browser:**
  - doorway, chair and phone, in both schemes, with the rooms flag on and
    off;
  - a screen reader walks the shelves in order;
  - contrast holds on every label.
