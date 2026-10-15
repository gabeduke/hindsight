# Two nouns and one way to listen

**Date:** 2026-10-15 · **Status:** decisions A–C are Gabe's, made on
2026-10-15 after [the walkthrough](../2026-10-15-walkthrough.md); the rest are
recommended picks, and his answers to its three questions are under
*Answered by Gabe* · **Repo:** `hindsight` ·
Changes [Two rooms and a rig](2026-10-15-rooms-design.md),
[the Studio's buffer](2026-10-15-studio-buffer-design.md),
[the Listening Room](2026-10-15-listening-room-design.md), and R2 and R7 of
[the scene contract](2026-10-15-scene-contract-design.md)

## Why

Gabe, 2026-10-15:

> the user flow is a little bit off … we have takes, clips, tapes, and records
> which is confusing. There are also multiple pages of diving into an audio
> file which is kind of odd; we should just be able to listen to a file and if
> need then we can dive in to make notes or otherwise.

The walkthrough took ten stories through the build on his rig, on a phone and a
laptop, and confirmed both halves:

| A person wanted to | It took | Walkthrough (# is its ranking) |
|---|---|---|
| Hear yesterday's take | 3 taps from the Studio, 4 on a phone, through a sheet | story 5 |
| …then write one word about it | 3 more taps, on a third page that opens at 0:00, stopped | #1 |
| Bounce a tape | two doors with two results, a take and a *record*, both called *Second take loop* | #6, story 7 |
| Put a bit of an old take on the tape | 13 taps on a phone; the buffer got the whole 47.8-bar take | #7, story 6 |
| Know what a word means | *keep* meant 7 things, *record* 4, *cut* 3, *buffer* 2; the ring had 4 names; one selection had 4 verbs | #2 |

One cause sits under every row. The app grew a noun for each way of holding
audio (take, clip, crate, clipboard, buffer, record) and a surface for each
way of looking at it (sheet, chair, TOOLS, deck, turntable). This note takes
most of them away.

## The decisions this starts from

Gabe's, 2026-10-15:

- **A. Two nouns: takes and tapes.** A take is anything you kept; a tape is
  what you build on. Clips become parts on a lane and stop being a thing you
  manage. A record is a take you bounced, a mark at most. *Mix down* and *Cut
  a record* become one verb.
- **B. A tap plays; one page to dig in.** Tapping a take anywhere plays it in
  the bar, and it keeps playing as you move around. One page holds the
  waveform, the notes and every tool, and keeps the playhead.
- **C. Bugs are fixed on `rooms/fixes`.** This note is flow, words and
  structure. *Not in this* lists what it leaves to that branch.

All of it is behind `hindsight.rooms`, as the rooms are. With the flag off,
nothing changes.

## Two nouns

**A person owns two kinds of thing: takes and tapes.** Everything else on
screen is one of these:

- **a place:** the Studio, the Listening Room, the Rig;
- **a part of a screen:** the feed, the buffer, the tracks, the bar, the
  instrument;
- **something inside a take or a tape:** a note, a tag or a star on a take; a
  part, a section or the loop on a tape.

### The verbs, one line each

| Verb | Does | From |
|---|---|---|
| **KEEP** | makes a take. Always, and nothing else | the feed (its last 2m, or a selection), the buffer, a take's selection |
| **BOUNCE** | makes a take from a tape, by playing it once through the mixer | the Studio's ⋯ |
| **GRAB** | fills the buffer | the feed (the last N bars, or a selection); a take (the last N bars before the playhead, a note, or a selection) |
| **DROP** | empties the buffer onto a track | the buffer, ↵, a range's action bar |
| **CATCH** | puts the last pass on the armed track | the Studio |
| **Cut · Copy** | a range of the tape into the buffer | a range's action bar |
| **● Rec** | records onto the armed track | the Studio |

Every key names its object: *KEEP 2m*, *KEEP 4 BARS*, *GRAB 4 BARS*, *DROP
ON TRACK 2 · bars 1–4*, *CATCH LAST PASS*.

### Every word on screen today, and what it becomes

Things (the walkthrough's nouns table, row by row):

| The UI says | Becomes | How |
|---|---|---|
| take, jam (`jam_….wav`), cassette, spine | **take**. Toasts name it as its spine does (*12:43 · 1:59*), not by file. *Jam* stays in file names and *Jam room* | kept; renamed in toasts |
| tape, reel | **tape** | kept |
| record, Records shelf, turntable, sleeve, side | a take bounced from a tape, on that tape's spine | removed |
| clip (audio on a track) | **part** | renamed |
| clip (in the crate), crate, *Find a clip*, ◫ | — | removed from the screen (decision 9) |
| clipboard | **buffer**: the one slot that GRAB, Cut and Copy fill and DROP empties | merged |
| buffer (the Studio's grab) | **buffer** | kept |
| ring, ribbon, feed, *Buffer length*, `buffered` | **feed**: what is always recording. Settings says *Feed length* | merged |
| track, lane | **track**. A lane is its drawing, never a word: *drag it to a track* | merged |
| flag, ⚑, note | **note**: a moment in a take, with or without words | merged |
| ♪ Notes (the piano roll) | **MIDI** | renamed |
| tag, sticker, stripe, colour | **tag** | merged |
| family, *mixes 2*, ✂ *cuts* | a spine's **+2**; Open lists them under *From this take* or *Earlier bounces* | hidden |
| section | **section**, a named span of a tape's bars | kept |
| pass | **pass** | kept |
| loop | the tape's **loop**. The bar's ⟲ becomes **Repeat** | kept; renamed (⟲) |
| source, input, channel, interface, the rig's *CH1 tap* | **input**: MAIN, CH1, CH2, AUX. The device by its name, *Sidekick* | merged |
| bus | **bus A, bus B** (the Sidekick's returns). The instrument's *ALSO ON THE BUS* heading goes | kept; removed (heading) |
| deck, player, dock | **the bar**. The room's deck is a picture of it | merged |
| shelf, archive, box, *SEP · 4* | headings: *This month*, *Earlier*, *September · 4* | kept as pictures |
| Studio, Listening Room, Rig, room | places | kept |
| output, OUT, Jam room, This device | where the bar plays | kept |
| punch (recording onto a track), *Punch-in FX* | **Rec**; **FX** | renamed |
| phone | each of its four uses is a phone | kept |

Verbs:

| The UI says | Becomes | How |
|---|---|---|
| KEEP (the feed's key, the pad, K) | **KEEP**, its length on the key on every screen | kept |
| KEEP AS TAKE, Save as take (the feed's selection, a take's) | **KEEP** | merged |
| Keep (the clipboard into the crate), a part's Keep | — | removed |
| the rig's KEEP socket, *Inputs to keep*, *Keep every input* | **TAKES**: what takes are made of | renamed |
| *Keep free* (Settings) | *Leave free* | renamed |
| Capture | **KEEP** (the guide, tips; `POST /api/trigger` stays) | merged |
| Copy (the feed's selection) | **GRAB**: it was the same request | merged |
| Cut, Copy (a range of the tape) | into the buffer | kept |
| cut (a take's span into a new take) | **KEEP** the selection | merged |
| Cut a record, Mix down the loop, Mix down the whole tape | **BOUNCE** the loop, the whole tape | merged |
| GRAB | **GRAB** | kept |
| TO THE STUDIO, Send to ▾ → Tape, → Clipboard (a take) | **GRAB** | merged |
| Send to ▾ → Crate, Split here | — | removed |
| TO THE STUDIO, Load it in the Studio (a tape) | **Open in the Studio** | renamed |
| DROP, Paste | **DROP** | merged |
| Insert | DROP that pushes the rest along | kept |
| CATCH | *CATCH LAST PASS*; *CATCH · after one pass* while it waits | kept |
| PUT IT ON, the deck's ▶, *Play from…* | a tap on the take; ▶ on the bar | removed |
| SIT DOWN, *Sit down with it ›*, *Open it*, Stand up | **Open**; **‹** to go back | merged |
| NOTE HERE, Flag now | **✎ Note**: on the bar, on Open, on the feed | merged |
| AUDITION, a crate row's ▶ | the buffer's **▶** | merged |
| ▶ Play, EDIT \| PLAY, *Play mode*, Play all | ▶ Play; **EDIT \| INSTRUMENT**; the setting *Instrument*; Play all | kept; renamed (toggle, setting) |
| REC (the feed's lamp), ● Rec, *records from aux* | **LIVE**; ● Rec; *in: aux* | renamed; kept; renamed |
| Name it, TOSS, Delete, Undo | the same | kept |

## One way to listen

### A tap plays

- **Tapping a take plays it in the bar,** where you are: a spine, a row of
  the list, a month's row, a search result, a line under *From this take*, the
  ▶ in a KEEP or BOUNCE toast. Tapping it again pauses it. Nothing opens.
- **Holding** a spine or a row selects, as the list's Select does today: ★,
  Delete, Export, and now **Tag**.
- **The bar is the only transport,** on every page. With a take in it, it
  shows ▶, the take as a strip to tap or drag, its name (a tap opens it), and
  **✎**. A phone's mini player holds the strip too, so skipping is one tap and
  there's no *Open the player* for a take.
- **In the Studio** the bar holds the tape. A take played there has the bar
  until it ends or ⏏, as Capture's bar did (guide §3).

### It keeps playing as you move around

- **The bar carries its take across pages.** Leaving a page, it writes down
  the take, the frame and whether it was playing (`sessionStorage`, on
  `pagehide`). The next page's bar reads that before it draws and picks up at
  the same spot, plus the time away if it was playing.
- **Into the Studio, only by its tab.** GRAB and *Open in the Studio* arrive
  with the tape in the bar: you went there for the tape.
- **The honest limit.** A new page can't always start sound by itself. Chrome
  on a laptop generally plays on after a tap on the same site. Safari on an
  iPhone won't: there the bar arrives at the same spot with ▶ lit, one tap
  from carrying on. Either way the gap is one page load. *Answer 1* settles
  whether that's good enough.

### Open: one page to dig in

`wave.html?file=…`, reached from the bar's name, a toast's *Open*, or ✎. It
opens where the bar is, and the bar keeps playing it. Top to bottom on a
phone; on a laptop the notes sit beside the take:

1. **‹**, the take's **name** (tap to rename), ★, its tag, **Download ▾**
   (WAV · MP3 · MIDI · DAW bundle), **Share** on a phone, **⋯** (Delete, reset
   the downbeat).
2. **The take,** one waveform: bar numbers when it has a tempo, notes as
   numbered grease marks, IN and OUT by holding and dragging, a pinch or
   ⌘-scroll to zoom. The overview strip shows only while zoomed.
3. **One row of tools:** ✎ Note · **KEEP** (the selection) · **GRAB** · ½× 1×
   2× · Level · ♩ tempo and downbeat. Repeat is the bar's.
4. **Notes,** one line each: number, time, words (the only field), with ▶
   from here, GRAB from here, ✕.
5. **From this take** or **Earlier bounces:** the spine's +N, each a line that
   plays on a tap.
6. **MIDI,** folded, when the take has any: the lanes and the piano roll.

**✎ on the bar** opens this page with a new note at the frame you were
hearing, its words ready for typing. The frame is taken before the page
changes, so the gap doesn't move it.

### What happens to today's surfaces

| Today | After |
|---|---|
| A spine's sheet (`shelf-detail.js`, with the rooms on) | Goes. Playing is a tap; its controls are on Open, or in a selection |
| The sheet's PUT IT ON, TO THE STUDIO, Play all from here, Cut a record | A tap; GRAB on Open; Play all in the list's header; BOUNCE in the Studio |
| The doorway (`takes.html`) | Stays as the Listening Room: shelves of takes, the list, search. Loses the Records shelf, the turntable and the sketchbook as a place. Tapes: off the shelf (answer 2) |
| The room's deck | A picture of the bar: what it holds and how far it has got. Its keys go; tapping it is Open. The phone's deck card goes |
| The chair (`chair.js`), SIT DOWN, Stand up | Goes. Open is the take's one page |
| TOOLS (the old take page, under the chair) | Goes. Its tools are Open's row and menus. Its second and third waveforms, *Three things worth knowing* (it becomes tips) and Send to go |
| The rack (`takes.js`) | Stays: the room's list, and what draws when the scene can't. A row's tap plays |
| A tape's sheet; a tape in the chair (`wave.html?tape=`) | Go. A tape opens in the Studio |
| The take page with the rooms off | Unchanged |

## The Studio: one selection, two verbs

| On a selection of the feed | Before | After |
|---|---|---|
| into the buffer, to trim and drop | GRAB, and Copy (the same request) | **GRAB** |
| onto the shelf | Save as take | **KEEP** |
| into the crate | Keep as clip | — |

The selection now offers what the feed's own keys do. Around it:

- **KEEP says what it keeps,** on every screen and on the instrument's pad:
  *KEEP 2m*. The buffer's says *KEEP 4 BARS*.
- **GRAB starts at the loop's length.** The 1 / 2 / 4 / 8 picker starts at the
  tape's loop in bars, so a grab fits the loop it's for. A take's GRAB uses
  the same number. (Story 6 got 47.8 bars, then 8, then 3.63.)
- **DROP never says *no room*.** It lands on the armed track at the next bar
  line inside the loop, over what's there, and its key says so first: *DROP
  ON TRACK 2 · bars 1–4 · replaces*. One undo takes it back. A part longer
  than the loop starts at the loop's start and runs past it, and the toast
  says so. A drag still lands exactly where it's let go.
- **● arms one track; holding ● adds one.** A tap moves the arm, as keys 1–4
  already do; hold it (or ⇧-click) to arm another as well. Multi-arm stays; it
  just isn't what a tap does.
- **CATCH says what it catches, and why it waits:** *CATCH LAST PASS → 2*,
  *CATCH · after one pass*.
- **BOUNCE** is in the ⋯ menu: *Bounce the loop*, *Bounce the whole tape*. Its
  toast has ▶ and Open, and the tape menu keeps *Last bounce* for when the
  toast has gone.
- **The crate drawer and the clipboard line go.** The buffer is the only view
  of what GRAB, Cut and Copy hold. A GRAB over a buffer nobody dropped or kept
  says so, with **Undo** to put the old one back.

## The ten stories, after

Counted as the walkthrough counted (gestures, the same starting state), with
`rooms/fixes` landed; a story that leans on a fix says so.

| # | Story | Phone | Laptop | Pages |
|---|---|---|---|---|
| 1 | Keep it, find it again | 5 → 4 | 5 → 4 | 2 + a sheet → 2 |
| 2 | Build a loop | 7 → 6 | 3 + 2 keys → same | 1 |
| 3 | Lift a moment | 6 → 5 | 4 + a scroll → 3 | 1 |
| 4 | Perform and keep | 11 + 2 failed → 10 | 2 + 6 keys → same | 1 |
| 5 | Listen back, jot a note | 10 → 5 | 8 → 4 | 3 → 2 |
| 6 | Reuse a bit | 13 → 7 | 8 + 1 key → 3 + 1 key | 2 (laptop 3) → 3 |
| 7 | Finish it | 5 → 5 | 5 → 5 | 2 |
| 8 | Tidy up | 15 → 13 | 8 → 9 | 1 → 2 |
| 9 | Wire up | 11 → 10 | 6 → 5 | 2 |
| 10 | Change a setting | 6 → 6 | 5 → 5 | 1 |

Typing isn't counted, as before. An iPhone adds one ▶ wherever the bar
crosses a page while playing (stories 5 and 6).

1. **Keep it.** 2m · **KEEP 2m** (toast: *Kept 12:43 · 1:59* · ▶ · Name it ·
   Undo) · Listening Room · the NEW spine: it plays. From the toast's ▶ it's
   3, on one page. *Gone: PUT IT ON, the sheet.*
2. **Build a loop.** Phone: Studio · Set · Play · Catch (it said *after one
   pass* while it waited) · ● 2 · Catch. *Gone: taking track 1 off.*
3. **Lift a moment.** Phone: GRAB 4 BARS · IN ▸ · OUT ◂ · ● 3 · DROP ON TRACK
   3. Laptop: GRAB · drag IN · drag the grip onto track 3 (lanes in view: a
   fix). *Gone: NO ROOM.*
4. **Perform.** The same, less the failed gestures (fixes). Words change:
   *EDIT | INSTRUMENT*, FX, and *KEEP 30s* on the pad.
5. **Listen back, jot a note.** Phone: Listening Room · List · the row *Wed
   21:10*: it plays · the strip at 1:00 · **✎**: Open, a note at 1:00, the
   cursor in it · type, Enter. Laptop: the same, less List. *Gone: PUT IT ON,
   Open the player, SIT DOWN, the restart at 0:00, a page.*
6. **Reuse a bit.** Phone, by ear: List · the row: it plays · the strip, past
   the bit · Open · **GRAB 4 BARS** (the 4 bars before the playhead; the
   Studio opens with them in the buffer) · ● 4 · DROP ON TRACK 4. Laptop, from a
   note: the spine · Open · the note's GRAB · ↵. *Gone: the whole take in the
   buffer, the trim to fit, three arming taps. A page more on a phone.*
7. **Finish it.** ⋯ · **Bounce the whole tape** (a wait as long as the tape) ·
   Open (the toast, or the tape menu's *Last bounce*) · Download ▾ · MP3. *The
   same count: one door, one result, and Download at the top, not 1500 px
   down.*
8. **Tidy up.** Phone: List · the row: it plays · Open · the name · ★ · + New
   tag, a colour, Save (applied: a fix) · ‹ · hold the row *12:54* · Delete ·
   ‹ The room · September. Laptop: the spine · Open · name · ★ · Funk · ‹ ·
   hold *12:54* · Delete · *SEP · 4*. *One more on a laptop: the sheet was
   the cheaper place to tidy one take. Holding makes several cheaper.*
9. **Wire up.** Phone: the device chip · CH1 · → Track 1 · Done · CH2 · →
   Track 2 · Done · ● 1 (track 4 lets go) · hold ● 2 · ‹ Studio. Laptop: the
   chip · drag · drag · ● 1 · ⇧-click ● 2.
10. **Change a setting.** The same taps; the words *Feed length*, *This
    device · previews*, *Instrument*. The reload is a fix.

## What changes, page by page

| Page | Goes | Changes |
|---|---|---|
| **Studio** (`tape.html`) | the crate drawer, the clipboard line, Copy and Keep as clip on the feed, *Mix down* ×2, a part's Keep, the empty tape's *Send to → Tape* | The feed: KEEP 2m, GRAB 4 BARS, ✎ Note, LIVE. The buffer: ▶, KEEP 4 BARS, DROP … · replaces, TOSS, *from* its take. Tracks: parts; Cut · Copy · DROP · Insert · Delete time; ● arms one. ⋯: Bounce, *Last bounce*. The empty tape: *GRAB a bit of a take* |
| **Listening Room** (`takes.html`) | as *What happens to today's surfaces* | A tap plays; holding selects, with Tag; the deck is the bar, drawn; a spine says a day for anything older than today |
| **Open** (`wave.html?file=`) | the chair, TOOLS and all they doubled | One page, as above |
| **The bar** (every page) | *Open the player* for a take | The hand-off; the strip on a phone; name → Open; ✎; Repeat |
| **The instrument** | *ALSO ON THE BUS*, *PUNCH-IN FX* | EDIT \| INSTRUMENT; FX; *KEEP 30s* |
| **Rig** (`rig.html`) | — | *CH1 tap* → *CH1*; the KEEP socket → TAKES |
| **Settings** | — | *Feed length*; *This device · previews*; *Instrument*; with the rooms on, *Inputs and clock: on the Rig ›* |
| Every page, rooms off | — | nothing |

## The guide's *Words*, planned

§2 *Words* describes the app with the flag off, which still has Capture, clips
and the crate. So the guide changes in two steps:

- **Now** (F9 below): a *Words in the two rooms* table heads the rooms'
  preview sections (beside §8.12 and §8.13), and each section a step touches
  changes in that step's PR.
- **When the rooms become the default:** §2 becomes that table, and the
  flag-off words leave with the old pages.

The table, against today's §2:

| Today's row | Change | Says |
|---|---|---|
| Ring | → **Feed** | Everything coming in, always recording; the last 15 minutes are kept in memory. The Studio draws it at the top |
| Take | reworded | Anything you kept: KEEP, a bounce, a phone recording, or a selection of another take |
| Flag | → **Note** | A moment in a take, with words or without |
| Selection, Track, Catch, Pass, Layer, Range, Bus A and B, Lead and follow | kept | as now (Track adds *drawn as a lane*) |
| Loop | narrowed | The tape's loop bracket. The bar's ⟲ is **Repeat** |
| Tape | reworded | Four tracks of parts: what you build on |
| Clip | → **Part** | A piece of audio on a track |
| Clipboard | → **Buffer** | The one slot GRAB, Cut and Copy fill and DROP empties. The Studio shows it between the feed and the tracks |
| Cut | narrowed | A range of the tape into the buffer, leaving silence (the OP-1's *lift*) |
| Paste | → **Drop** | The buffer onto a track (the OP-1's *drop*) |
| Mixdown | → **Bounce** | Play a tape once and keep what came out of the mixer, as a take |
| — | new | **Keep**, **Grab**, **Studio**, **Listening Room**, **Rig**, **the bar**, **Open**, **Input**, **Tag**, **Section**, **Rec**, **Instrument**, **FX**: one line each |

## Decisions (recommended picks)

1. **Part, for audio on a track.** It is already the guide's word and the
   empty tape's (*play until a part sounds right*), and it says what the audio
   is for, not what it was cut from. *Clip* had two meanings; *block* and
   *region* are a programmer's word and a DAW's. The risk is *the B part* of a
   song, which the screen calls a *section*.
2. **BOUNCE, for a tape into a take.** It is the studio's word for exactly
   this, and unused here. *Mix down* is the old door, *cut* and *record* are
   taken, and *export* sounds like a file when the result is a take. A take
   doesn't bounce: keeping its selection is KEEP.
3. **Feed for the ring, buffer for the clipboard:** Gabe's own words for P2,
   *from the live feed into a buffer*. *Ring* stays in the code and
   `RING_SECONDS`, never on screen.
4. **Note, for flags:** one mark, words optional.
5. **Records aren't written any more.** A bounce is a take from a tape, which
   its family already says. `Meta.Record` on existing takes is ignored, not
   migrated. Reverses P5 decision 4.
6. **A tap plays, Open is one page, the bar is the only transport.** Reverses
   P5 decision 1's chair; the doorway stays.
7. **The bar hands its take over between pages** now; *question 1* decides
   whether Open also joins the room's page.
8. **Tapes live in the Studio** (*question 2*). Reverses P5 decision 5, and
   its *Swap it?* goes too.
9. **The crate leaves the screen, not the Pi** (*question 3*). GRAB's Undo is
   the safety net instead, which reverses P2 decision 4; the Pi keeps one
   replaced grab for it, not a growing crate.
10. **DROP lands over what's there, inside the loop, and says so first.**
    Reverses P2's *next free span*, which found room only outside a full
    loop.
11. **● arms one; holding adds.** Touch does what the keys do. Changes P6's
    *● toggles*, not multi-arm.
12. **A take's GRAB is the feed's GRAB,** with N starting at the loop's
    length.
13. **R2 starts the sound at the tap,** not at SEAT; the flight runs alongside
    it. **R7, the lathe, is dropped:** it animated a record.

## Answered by Gabe (2026-10-15)

The three open questions, all answered with the recommended pick:

1. **Open is its own page** (`wave.html`, size M). An iPhone needs one ▶
   after the page change; the bigger build, Open inside the Listening Room's
   page, waits until that tap is tried on his iPhone and grates. This fixes
   the shape of F6.
2. **Tapes live in the Studio only.** They come off the Listening Room's
   shelf; their bounces stand on it as takes.
3. **The crate's clips stay on the Pi, out of sight.** The crate stops being
   shown; nothing is converted or deleted.

## Not in this

- **Bugs.** `rooms/fixes` has them: the ⋯ menu off a phone's edge, the
  swipe for tape mods, CLEAN's contrast, the `/api/update` 404, Settings
  naming `RING_SECONDS`, *Name it*'s focus, a new tag not applied, folded
  lanes overlapping, UNFOLD's sliver, the buffer sheet closing when pulled
  down, the preview's missing reload button. Two of them meet this note:
  - SIT DOWN's lost playhead goes with SIT DOWN; the hand-off keeps it;
  - a drop that trims a part quietly should be made *visible* by the fix, not
    prevented, since decision 10 replaces on purpose.
- **One page for the whole app,** unless question 1 asks for the room's half.
- **Notes on tapes, doodles, several tags per take,** as P5.
- **Crate pads** (Play mode's phase 2, keys 5–0): parked. A pad that plays a
  saved bit would play a take's span, in its own spec.
- **Settings' wiring fields:** they stay, under a line pointing to the Rig,
  until the rooms are the default.
- **The rooms by default,** and the old pages.
- **The server:** no new routes. The one Go change is keeping one replaced
  grab (decision 9).

## Checks

- **JS,** each new test failing first against today's code (`AGENTS.md`):
  - `lib/rooms/words.test.js`: no retired word in a rooms page's labels or
    the tips it shows: *Keep as clip, Save as take, Cut a record, Mix down,
    the Records shelf, crate, clipboard, sticker, PUT IT ON, SIT DOWN, Stand
    up, TO THE STUDIO, Send to, punch, flag*. It lands with F8, when the last
    of them goes;
  - the hand-off: the same take resumes at its frame plus the time away when
    it was playing, and at its frame when paused; a stale or different take's
    record is ignored; ✎'s note lands on the frame taken before leaving;
  - a take's GRAB: N bars before the playhead at its tempo, seconds without
    one, clamped at 0; a note's from the note; N starts at the loop's bars;
  - DROP's place: the next bar line inside the loop, wrapping; never refused;
    a part longer than the loop starts at its start; the key says *replaces*
    exactly when it will;
  - arming: a tap leaves one track armed, a hold adds one;
  - with the rooms on, a spine's or a row's tap reaches the bar and loads no
    sheet; with them off, the sheet opens as today.
- **Go:** one replaced grab is kept, and let go at the next; `go test -race`
  on a machine that can run it.
- `paths.test.js`, `SHELL`, and a `CACHE` bump in every PR.
- **In a browser,** as `AGENTS.md` says (phone and laptop, both schemes, the
  rooms on and off, against the demo): walk the ten stories again and record
  the counts against the table above. A story over its *after* is a finding.
- **On Gabe's iPhone:** Room → Open → Studio while playing, and what ▶ needs
  at each step.

## Build order

Small PRs. Nothing in the rooms is on `main` yet, so what this drops is better
dropped from its step's code before that merges than removed afterwards. Each
PR names the step whose code it changes, and is based on `rooms/all` once
`rooms/fixes` is in.

| PR | Branch | What | Changes the code of | Size |
|---|---|---|---|---|
| F1 | `rooms/f1-two-verbs` | A selection's GRAB · KEEP; every KEEP names what it keeps; a take's TO THE STUDIO and Send to become GRAB, starting at the loop's length | P2 (buffer, ribbon), P5 (`notes.js`) | S |
| F2 | `rooms/f2-bounce` | BOUNCE in the Studio's ⋯, with *Last bounce*; Cut a record, Records, the turntable and `record.js` go | P5, `p5-scene` (the `record` kind) | S |
| F3 | `rooms/f3-buffer-only` | The crate and the clipboard line leave the rooms; GRAB's Undo; Split here and Send to → Crate go; one replaced grab kept | P2, the tape page (under the flag), Go | M |
| F4 | `rooms/f4-carry` | The bar's hand-off between pages | `lib/bar`, P1 | S |
| F5 | `rooms/f5-tap-plays` | A tap plays; holding selects, with Tag; the sheet goes; the bar's strip on a phone, name → Open, ✎; the deck drawn from the bar; tapes per question 2; R2's sound at the tap | P5, `p5-scene`, R2 (#116) | M |
| F6 | `rooms/f6-open` | Open as one page; the chair and TOOLS go; ✎ arrives with its note; `?tape=` goes to the Studio | P5 (`chair.js`), `wave/page.js` | M, or L per question 1 |
| F7 | `rooms/f7-arm-drop` | ● arms one, holding adds; DROP never refuses; CATCH says what and why | P6 (`arm.js`), P2 | S |
| F8 | `rooms/f8-words` | Every rename left; toasts that name takes; tips; `words.test.js` | strings across all of them | M |
| F9 | `rooms/f9-guide` | *Words in the two rooms* and the stories' checks | `docs/guide.md` (it ships, so it releases) | S |

- **F1–F3 first:** they remove the most nouns, so F8 renames only what
  survives.
- **F4 before F5 and F6,** which lean on it. **F6 waits for question 1.**
- **F7** any time. **F9** last.

**What can be dropped:**

- **R7, the lathe** (unfinished, never pushed): its record is gone.
- From **P5:** the Records shelf, the turntable, `record.js`, the sheet's room
  buttons, the chair (`chair.js`), the sketchbook as a place, and `swap.js` if
  tapes leave the room.
- From **the scene contract:** the `record` kind.
- From **P2:** the crate as GRAB's safety net, and `KeepClipboard`'s
  many-track case.
- From **Play mode's phase 2:** the crate pads. Keys 5–0 stay free.
- **Kept, but changed:** R2 (the sound at the tap), and R3 (a room with fewer
  things in it).
