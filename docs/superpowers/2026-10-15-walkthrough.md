# Walkthrough: ten user stories through the rooms

**Date:** 2026-10-15 · **Walked:** `rooms/all` at `b185dc0` (the build on Gabe's
rig) · **Status:** observations only. Nothing here changes the app; where a line
says *Suggests*, it is one line on what to look at, not a design.

Gabe's words that started this:

> the user flow is a little bit off and there are some bugs even… we have
> takes, clips, tapes, and records which is confusing. There are also multiple
> pages of diving into an audio file which is kind of odd; we should just be
> able to listen to a file and if need then we can dive in to make notes or
> otherwise.

Both halves are confirmed. A person who only wants to *listen* needs three taps
from the Studio (four on a phone), and that part works. A person who then wants
to *write one word* needs three more, a second page, and a third surface under
it. The words are worse than the pages: the screens use one noun for different
things and different nouns for the same thing, often on a single screen.

## How it was walked

- The demo (`--demo`, a 120 s ring, the tape on) built from `rooms/all` at
  `b185dc0`, with `hindsight.rooms` and `hindsight.play` on, as on the rig.
- **Two screens, every story:** a phone (390×844, touch) and a laptop
  (1440×900). Light scheme. Headless Chromium through Playwright, never the
  in-app browser.
- **As a person would:** each control was found by its label on screen and
  tapped; the code was read afterwards, for the nouns. Taps are counted as
  gestures: a tap, a click, a drag, a held pad. A failed attempt is counted and
  said so.
- **Seeded first:** the ring was left to fill; two takes and a tape were made;
  then ten older takes were added with dates (yesterday evening, last week,
  September, August), so "yesterday" and "last month" mean something. The
  stories ran in order on one demo, so state carried over (armed tracks, clips,
  takes); each story says where it began.
- **Caveats.**
  - The demo has no Sidekick, no ears and no iPhone. What was checked is state,
    layout and wiring, not sound. The demo's CH1 and CH2 are silent, so
    anything about those inputs says little about a real one.
  - Touch is Chromium's emulation. A finding that depends on touch physics says
    so.
  - Not looked at: the dark scheme, the pages with the rooms off (except where
    named), a real iPhone, and sound.
- **Errors.** No JavaScript exception was thrown anywhere in the walk. The
  console had one repeated line (see the end) and one 400 that was the walker's
  own typing mistake.

### Taps and pages, at a glance

| # | Story | Phone | Laptop | Pages |
|---|---|---|---|---|
| 1 | Keep it, find it again | 5 | 5 | 2 (+ the take's sheet) |
| 2 | Build a loop | 7 (+ a ~10 s wait) | 3 clicks, 2 keys | 1 |
| 3 | Lift a moment | 6 | 4 (+ a scroll) | 1 |
| 4 | Perform and keep | 11 (+ 2 failed swipes) | 2 clicks, 6 keys | 1 |
| 5 | Listen back, jot a note | 10 + typing | 8 + typing | 3 |
| 6 | Reuse a bit | 13 | 8 clicks, 1 key | 2 on a phone, 3 on a laptop |
| 7 | Finish it | 5 (+ a 14 s wait) | 5 | 2 |
| 8 | Tidy up, find last month | 15 + typing | 8 + typing | 1 |
| 9 | Wire up | 11 | 6 | 2 |
| 10 | Change a setting | 6 + a manual reload | 5 + a manual reload | 1 |

## The worst problems, ranked

Ranked by how much each costs Gabe's two complaints (a flow that is off, and
too many places to dive in), then by how often a person meets it.

1. **One take, three surfaces, and the deepest holds the notes.** A take opens
   as a sheet on the shelf, then as the chair (`wave.html`), then as **TOOLS**
   under the chair, which is the old take page: a second and third waveform of
   the same take, MIDI lanes, and the only **Download** and **Send to**. A note
   needs the chair, and **SIT DOWN** throws away the playhead, so the good bit
   has to be found again. Listening is 3 taps; listening then noting is 6 taps
   plus typing, on a third page. *Suggests: a note should be one tap from
   wherever a take is already playing.* (Stories 5, 7; "Every way into an audio
   file".)
2. **The nouns.** *Buffer* is two things (the Studio's grab, and the ring in
   Settings and the guide), *record* four, *keep* seven, *cut* three, *note* two,
   *tap* three, *bus* two, *play* four. The ring is called the buffer, the ring,
   the feed and the ribbon. One selected span has four verbs on one bar:
   **Grab**, **Copy**, **Keep as clip**, **Save as take**. The guide's *Words*
   table has no entry for Studio, Listening Room, feed, grab, keep, crate,
   record, deck or note. *Suggests: one word per thing, then the guide.* ("The
   nouns".)
3. **DROP has dead ends that its own message sends you into.** *NO ROOM ON TRACK
   2 · drag it to a lane* appears whenever the first armed track is full or the
   span is longer than the loop, and the way out it names, a lane, is often not
   on screen: on a phone in PLAY mode there are no lanes; on a laptop with the
   instrument unfolded there are none either. Drag-drop ignores the block and,
   in the one run it was tried, silently trimmed a clip. (Stories 3, 6.)
4. **The Studio cannot hold feed + buffer + lanes + strip.** At 1440×900 with
   the instrument unfolded and the buffer open, no lane is visible and
   **UNFOLD** changes nothing you can see. Folded lanes stack their headers on
   top of each other, on both screens. On a phone the buffer sheet covers
   **EDIT | PLAY** and the mini player, and pulling the sheet down *closes* it
   instead of shrinking it. (Stories 3, 6.)
5. **Arming adds, it never moves.** **Arm track 2 as well** leaves track 1
   armed, so the next Catch lands on both, track 1 included.
   Arming one track means taking the others off, which on a phone is tiny
   targets under folded lanes. Arming belongs to the tape, so every device sees
   it, and the labels on Catch, Rec and DROP follow it (*Rec from aux + aux*).
   (Stories 2, 3, 6.)
6. **Bouncing has two doors with different results.** **Mix down** (Studio ⋯)
   leaves a plain take; **Cut a record** (the room) leaves a record on the
   Records shelf. They fold into one spine, *mixes 2*. The only pointer to the
   Studio's result is a toast. (Story 7.)
7. **TO THE STUDIO loads the whole take.** From a take's sheet it copies the
   entire file (47.8 bars) into the buffer; from a note it copies at most 8
   bars. Neither fits a 4-bar loop, and trimming by steps gives fractions of a
   bar (3.63), so a drop needs the span cut to under four bars first. (Story 6.)
8. **Catch is greyed with no reason, and is not "the last 4 bars".** It is
   disabled until the tape has played one whole pass; it catches a pass, and the
   1, 2 or 4 bars live in a track's sheet. The feed's 1 / 2 / 4 / 8 picker looks
   like Catch's and is Grab's. (Story 2.)
9. **Settings and previews.** *Reload the page for this to take effect* has no
   reload button and sits above the Pi's **Restart** when a setting is waiting.
   The Rig draws what Settings still shows as text (`Sources`, `Clock`,
   `Clock to`, `Plays the tape`, `Inputs to keep`). A new tag is saved but not
   applied to the take you made it from. (Stories 8, 9, 10.)
10. **Small breakages.** The ⋯ tape menu is clipped at a phone's left edge (−37 px
    with the rooms on, −137 px off, so not new); *swipe for tape mods* does
    nothing by touch; the selected **CLEAN** preset is 1.2 : 1 on its
    background; every page logs a 404 for `GET /api/update`; Settings' error
    names `RING_SECONDS`, not "Buffer length"; **Name it** opens the take but not
    its name. (Stories 1, 4, 7, 8, 10.)

---

## Story 1: Keep it

*Mid-jam, keep the last couple of minutes; then find it again.*

**Pages:** `/` (replaces itself with the Studio, `/tape.html`) → `/takes.html`.
The take's sheet is an overlay, not a page.

| # | Phone | Laptop |
|---|---|---|
| 1 | tap **2m** (a chip in the feed: 30s · 2m · Full 2m) | click it |
| 2 | tap **KEEP** → toast *Kept jam_2026-10-15_124347.wav: it's on the Listening Room's shelf* · **Name it** · **Undo** | same |
| 3 | tap **Listening Room** (tab) | click |
| 4 | tap the spine *12:43:47 · today 12:43 · 1:59 · new* | click the spine |
| 5 | tap **PUT IT ON**: plays on the phone | same |

**5 taps, 2 pages.** Same on both screens.

**Nouns the screen showed:** feed, KEEP, the last 30 seconds, 30s / 2m / Full 2m,
take, `jam_…wav`, Name it, Undo, Listening Room, shelf, TAKES · OCTOBER, TAPES,
ARCHIVE, RECORDS, spine, NEW, deck (*On the deck*), tape, turntable, sketchbook,
PUT IT ON, TO THE STUDIO, Play all from here, Cut a record, MP3, DAW bundle, Sit
down with it.

<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s1-3-just-kept-phone.png" width="230" alt="phone: the keep toast"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s1-4-listening-room-phone.png" width="230" alt="phone: the Listening Room"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s1-5-spine-tapped-phone.png" width="230" alt="phone: the take's sheet"></td>
</tr></table>
<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s1-4-listening-room-laptop.png" width="400" alt="laptop: the Listening Room"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s1-5-spine-tapped-laptop.png" width="400" alt="laptop: the take's sheet"></td>
</tr></table>

**Where it was unclear**

- **How long KEEP keeps.** It has no length of its own: the chips must be set
  first, and stay set. The phone's key says only **KEEP**; the laptop's adds
  *the last 30 seconds*. With the instrument open there is no length on screen
  (story 4).
- **The take has four names.** `jam_2026-10-15_124347.wav` (the toast),
  `12:43:47` (spine, deck), `2026-10-15_124347` (the sheet's title), and
  `Wed 14 Oct 21:10` where the buffer shows it as a source. A spine shows a time
  of day and no date; today's and yesterday's spines differ only in a hidden
  label (laptop) or a grey line (phone).
- **The deck is already loaded.** Before anything was picked, the room said *On
  the deck: Oct 15 12:42, tape*: an empty tape, the Studio's own. The room's deck
  and the Studio's tape are the same object (by design), which a person cannot
  know.
- **A 2 minute take is 1:59.** Honest, but the chip said 2m.
- **Three ways to say play:** **PUT IT ON**, the deck's ▶, the dock's ▶. For a
  *tape*, PUT IT ON loads it on the Pi and plays it through the jam room, not on
  the phone (row 10 of "Every way into an audio file").

**Dead ends:** none. **Bugs:** none beyond the console line at the end.

---

## Story 2: Build a loop

*Play a part, catch the last 4 bars onto a lane, layer a second part over it.*

**Pages:** `/tape.html` only. The phone started in the Listening Room (where
story 1 ended); the laptop started in the Studio with a new, empty tape loaded.

| # | Phone | Laptop |
|---|---|---|
| 1 | **Studio** tab | **Set** (BPM 96, Bars 4) on the empty tape's card |
| 2 | **Set**: the empty tape asks for a first loop, a take, or a tempo | **Play** (mini player) |
| 3 | **Play** (mini player) | *wait ~10 s: **Catch** is greyed* |
| – | *wait ~10 s: **Catch** is greyed* | **Catch** → *Caught the last pass → 1* |
| 4 | **Catch** → *Caught the last pass → 1* | key **2** (arms only track 2) |
| 5 | **Arm track 2 as well** | key **C** → *Caught the last pass → 2* |
| 6 | **Track 1 is armed: take it off what's armed** | |
| 7 | **Catch** → *Caught the last pass → 2* | |

**Phone 7 taps; laptop 3 clicks and 2 keys.**

**Nouns:** tape, loop, tempo, BPM, Bars, tap (*Tap where the loop starts*),
Sections, Snap, lock the loop, track, armed, input chip (*aux*), M / S, Catch,
pass (*last pass*), Rec, Loop, Click, Crate, GRAB, INSTRUMENT, EDIT | PLAY, Passes,
Layer / Replace, bus.

<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s2-1-studio-empty-tape-phone.png" width="230" alt="phone: the empty tape"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s2-5-playing-11s-phone.png" width="230" alt="phone: Catch has lit"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s2-8-track2-armed-phone.png" width="230" alt="phone: two tracks armed"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s2-9-second-caught-phone.png" width="230" alt="phone: the second catch under its toast"></td>
</tr></table>
<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s2-1-studio-empty-tape-laptop.png" width="400" alt="laptop: the empty tape"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s2-7-second-caught-laptop.png" width="400" alt="laptop: two parts caught"></td>
</tr></table>

**Where it was unclear**

- **Catch is greyed and says nothing.** It lights after one whole pass of the
  loop (about 10 s at 96 BPM, 4 bars). The laptop's tooltip describes the key,
  not the wait; the phone has no tooltip.
- **"Catch the last 4 bars" is not on the Catch key.** The key catches *the last
  pass*; 1 / 2 / 4 bars are in a track's sheet (tap the track's name twice). The
  feed's picker (1 / 2 / 4 / 8) sits one row above and is Grab's.
- **Arming.** On a phone the second part took three taps (arm 2, take 1 off,
  Catch), and Catch's label changes as you go (*onto tracks 1, 2*). If the step
  is skipped, the catch also goes onto track 1. On the laptop key **2** arms
  just that track; a person who clicks gets the phone's behaviour.
- **Every track says `aux`.** A new device's input defaults to `aux`
  (`readPref('tape.source', 'aux')`). The rig spec says a Sidekick's AUX sits at
  digital zero when idle, so a first catch there would be silent; the demo's AUX
  carries signal, so this could not be seen.
- **The empty tape offers three ways to start** (tap a loop in, send a take, set
  a tempo) before any of them is explained.
- **The phone has room for about 1.8 lanes.** The feed takes the top 330 px and
  the EDIT | PLAY bar, mini player and tabs the bottom 160, which leaves about
  175 px of lanes; the toast then covers the lane you just caught onto.
- **Laptop, empty tape:** lane 1 is cut off by the *Input channels* line (the
  tape's own scroll box ends at y 672 with the lanes under it).

**Dead ends:** none. **Bugs:** none functional.

---

## Story 3: Lift a moment

*Grab a bit of the feed, trim it, drop it on the tape.*

**Pages:** `/tape.html` only. Starting state: the tape from story 2 with its
4-bar loop on, tracks 1 and 2 holding 4-bar clips, track 2 armed.

| # | Phone | Laptop |
|---|---|---|
| 1 | **GRAB 4 BARS** → a sheet: *BUFFER · 4 bars · 10.00 s*, with a red line *the last 4 bars of time at the tape's tempo: the tape isn't playing* | **GRAB**; a bench opens between feed and lanes |
| 2 | **IN ▸** a step | drag the **IN** mark right |
| 3 | **OUT ◂** a step. DROP reads *NO ROOM ON TRACK 2 · drag it to a lane*, disabled | **UNFOLD ▾** |
| 4 | **Arm track 3 as well** (a 13 px strip under the sheet): still *track 2*, since 2 stays armed | scroll the page to bring lanes up |
| 5 | drag the grip up: the *sheet* moves and covers the lanes | drag the grip (**DRAG TO A LANE**) onto track 3 |
| 6 | hold the grip, then drag onto a lane: a ghost appears; released → *Dropped on track 2 · bars 4–5* | → *Dropped on track 3 · bars 2–4* |

**Phone 6 gestures; laptop 4 and a scroll.** (The laptop's armed tracks were 2
and 3 from the phone's tap, and its drop went where it was aimed.)

**Nouns:** GRAB, buffer, last N bars, IN / OUT, snap (*Bar*), AUDITION, UNFOLD /
FOLD, KEEP AS TAKE, TOSS, DROP ON TRACK N, NO ROOM, DRAG TO A LANE, before / after
(the handles), Normalize, Reverse, Fades (*equal power*), gain, *BUFFER ▴* (a
chip beside GRAB), *crate's first slot*, clipboard (at the page's foot, still
empty).

<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s3-2-grabbed-phone.png" width="230" alt="phone: the buffer sheet"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s3-3-trimmed-phone.png" width="230" alt="phone: trimmed, folded lanes behind"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s3-5b-dragging-after-hold-phone.png" width="230" alt="phone: the ghost over track 2"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s3-6b-after-drag-phone.png" width="230" alt="phone: dropped, track 2 trimmed"></td>
</tr></table>
<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s3-2-grabbed-laptop.png" width="400" alt="laptop: the bench open, folded lanes"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s3-4-unfolded-laptop.png" width="400" alt="laptop: UNFOLD leaves a sliver"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s3-6-dragging-laptop.png" width="400" alt="laptop: the ghost over track 3"></td>
</tr></table>

**Where it was unclear**

- **"No room".** The first armed track is DROP's target. Track 2 held a 4-bar
  clip in a 4-bar loop, so there is "no room" on a 1200 s tape. The message's one
  piece of advice, *drag it to a lane*, leaves the other armed track out of it.
- **The grip does two jobs.** A quick drag resizes the sheet and covers the
  lanes; a held drag carries the buffer. The label says *hold it*, but only once
  the sheet is up.
- **The red caveat** (*the tape isn't playing*) reads as an error and offers
  nothing to do about it. Playing the tape first would have avoided it.

**Bugs**

- **Dropping over a clip trims it, quietly.** *Repro:* phone, track 2 holding a
  4-bar clip, grab 4 bars, trim to 2, hold-drag onto track 2's lane. Result: clips
  `[0, 3 bars]` and `[bar 4, 2 bars]`: the part's last bar is gone. One Undo
  restores it.
- **Folded lanes overlap.** *Repro:* any GRAB on a phone: the four track headers
  (24 px) sit on a 15 px pitch and cover each other, with their arm buttons.
  Laptop: only lanes 1 and 2 show; 3 and 4 are below the lane list's own clip
  line.
- **Laptop UNFOLD** leaves 15 px of lane 1 under the bench until the page is
  scrolled.

---

## Story 4: Perform

*Play tricks and FX over the loop from the screen, and keep the jam.*

**Pages:** `/tape.html` only.

| # | Phone | Laptop |
|---|---|---|
| 1 | **Play** | **Play** |
| 2 | **PLAY** (the EDIT \| PLAY toggle): the lanes are replaced by the instrument | **INSTRUMENT ▴** |
| 3–4 | hold **BREAK**, hold **REV** (both light) | hold keys **Q**, **W** |
| 5 | hold **ROLL**: nothing lit; the pad is half under the toggle bar | **T** (ROLL) |
| – | scroll the panel (704 px of instrument in a 578 px window) | **Y** (FILTER), **Q + Y** together |
| 6–8 | **ROLL**, **FILTER** (slide up: *540 Hz*), **ECHO** | |
| 9 | **Show the tape mods** (the pager) | |
| – | swipe back for the pads, twice: nothing | |
| 10 | tap the pager | |
| 11 | **KEEP** pad → *Kept jam_….wav* (32 s) | key **K** → kept, 32 s |

**Phone 11 taps, 2 failed swipes and a scroll; laptop 2 clicks and 6 keys.**

**Nouns:** INSTRUMENT, KEYS, PLAYING FROM (Touch, Computer keys, ＋ MIDI here), the
grid (off / 16 / 8 / beat / bar), *lead 125 ms*, MIDI LEARN, TRACKS · HOLD TO DROP
OUT, TRICKS · HELD, ON THE GRID (BREAK, REV, CHOP, STOP, ½×, 2×), ALSO ON THE BUS
(CATCH, GRAB, DROP, KEEP), PUNCH-IN FX (ROLL, FILTER, ECHO, CRUSH), BEND, TAPE MODS
· LATCHED (CLEAN, CHROME, FERRIC, WORN; WOW, FLUTTER, DRIVE, AGE), *saved with it,
undone with ↶*.

<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s4-1-play-mode-phone.png" width="230" alt="phone: the instrument replaces the lanes"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s4-7-filter-held-phone.png" width="230" alt="phone: FILTER held"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s4-9-tape-mods-phone.png" width="230" alt="phone: the tape mods page"></td>
</tr></table>
<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s4-1-instrument-open-laptop.png" width="400" alt="laptop: the strip unfolded"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s4-4-two-held-laptop.png" width="400" alt="laptop: BREAK and FILTER held"></td>
</tr></table>

**Where it was unclear**

- **What KEEP keeps while playing.** The pad keeps the feed's last chosen length
  (30 s, so a 32 s take). Neither the length nor its chips are on the phone's
  instrument page; the laptop's feed row still shows them.
- **Three layers, one panel:** *tricks* (held on the grid), *punch-in FX* (held,
  with an amount) and *tape mods* (latched, saved with the tape, undone with ↶).
  Nothing says only the third touches undo.
- **The phone hides what you are playing over.** The instrument replaces the
  lanes, so the loop's clips are not on screen; only the reel shows position.
- **"Play" four ways:** the transport's ▶, the **PLAY** half of the toggle, the
  *Play mode* preview, *Play all*.

**Bugs**

- **Swipe for tape mods does not work by touch.** *Repro:* phone, PLAY, tap the
  pager (page 2), swipe right from a blank spot at y 615. The strip's own
  `pointerdown` / `pointerup` swipe handler never sees `pointerup`: Chromium sends
  `pointercancel` after the first move, because the section is
  `touch-action: auto` and scrolls vertically. The pager tap works. Seen in
  Chromium's touch emulation; an iPhone may differ.
- **The selected tape type is unreadable.** **CLEAN**'s label is `rgb(20,37,43)`
  on `rgb(11,12,13)`: about 1.2 : 1. The unselected three are about 14 : 1.
- **The FX row is half under the EDIT | PLAY bar** until the panel is scrolled; a
  press on its visible half did not light ROLL.

---

## Story 5: Listen back

*Next morning, play what was kept yesterday, skip around, jot a note at the good
bit.*

**Pages:** `/tape.html` → `/takes.html` → `/wave.html?file=…`.

| # | Phone | Laptop |
|---|---|---|
| 1 | **Listening Room** (tab) | tab |
| 2 | **☰ List** (the shelf row scrolls sideways; 3 of 10 takes show) | click the spine *21:10:05 · Wed 14 Oct* |
| 3 | tap the row *21:10:05* (a sheet) | **PUT IT ON** |
| 4 | **PUT IT ON** (plays) | click the dock's scrubber (skips) |
| 5 | **Open the player** | **SIT DOWN** |
| 6 | tap the scrubber (skips to 1:00) | **Play** (the chair starts at 0:00, stopped) |
| 7 | **SIT DOWN** (the chair opens at 0:00, stopped) | click the strip (skip) |
| 8 | **Play** | **NOTE HERE** |
| 9 | tap the strip (skip) | type, **Enter** |
| 10 | **NOTE HERE**; type; **Enter** | |

**Phone 10 taps and typing; laptop 8 and typing; 3 pages.** The note is stored
(`{frame, label}`) and shows on the other screen at once.

**Nouns:** Listening Room, shelf, List, row, deck, player, scrubber, SIT DOWN,
Stand up, NOTE HERE, note, sketchbook, sticker, star, notes (the ♪ header button,
which is MIDI notes), TOOLS, flag (the sheet lists *⚑ great fill into the chorus
1:00*), Play from…, *to the studio*. (*Chair* and *dock* are spec words; the
screen says *SIT DOWN* and *player*.)

<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s5-1-room-phone.png" width="230" alt="phone: the room"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s5-2-list-phone.png" width="230" alt="phone: the list"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s5-5-player-open-phone.png" width="230" alt="phone: the open player"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s5-7-chair-phone.png" width="230" alt="phone: the chair"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s5-10-note-here-phone.png" width="230" alt="phone: a note made"></td>
</tr></table>
<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s5-1-room-laptop.png" width="400" alt="laptop: the room"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s5-4-chair-laptop.png" width="400" alt="laptop: the chair"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s5-5-note-made-laptop.png" width="400" alt="laptop: two notes"></td>
</tr></table>

**Where it was unclear**

- **Yesterday is a hunt.** The spines say a time of day. On a phone the shelf is a
  sideways row; the List shows *YESTERDAY · WED 14 OCT* and is the only place
  that says so in words.
- **Skipping around** is on the dock (or the opened player); **noting** is only in
  the chair. The same take has three *SIT DOWN*s (deck, dock, the sheet's *Sit
  down with it ›*).
- **Two fields for one note.** **NOTE HERE** drops a numbered mark and puts the
  cursor in the *bottom* field (*A NOTE AT 1:00*); the note's own line above has a
  second field (*Note 1, at 1:00: its words*). The deck keeps playing while you
  type, and the bottom field's label follows the live playhead.
- **Notes and flags.** The chair calls them notes, the sheet calls them flags (⚑),
  TOOLS has *Previous flag / Next flag*, the Studio's **Flag now** makes one on
  the ring. The ♪ **Notes** button in the chair's header is the MIDI piano roll.
- **Notes on a tape** say they are not here: *A tape's sections read as notes here.
  Notes of your own go on takes.*

**Bug:** **SIT DOWN loses the playhead and the play state.** *Repro:* play a take
on the deck, scrub to 1:00, tap **SIT DOWN**: the chair opens at 0:00.0, stopped.
(Phone and laptop.)

---

## Story 6: Reuse a bit

*Turn a good bit of an old take into a part on the tape.*

**Pages:** phone `/takes.html` → `/tape.html`; laptop `/takes.html` → `/wave.html`
→ `/tape.html`. Two routes, both walked. Starting state: the tape from story 3
(tracks 1–3 holding clips, 2 and 3 armed, a 4-bar loop).

**Phone, from the take's sheet (13 gestures)**

| # | |
|---|---|
| 1–3 | **List**, the row *21:10:05*, **TO THE STUDIO** → the buffer holds the **whole take**: *47.79 bars · 119.47 s* |
| 4–5 | drag **IN** to bar 24 and **OUT** to bar 28 (snapped: 4 bars) |
| 6 | pull the sheet down, to reach EDIT → the buffer *closes* (the clipboard keeps it) |
| 7 | tap the **DROP** pad in the instrument (the Studio is still in PLAY) → *No room on track 2: drag it to a lane*, with no lane on screen |
| 8–9 | **EDIT**, **Buffer ▴** |
| 10–12 | take track 2 off, take track 3 off, arm track 4 |
| 13 | **DROP ON TRACK 4** → *Dropped on track 4 · bars 1–4* |

**Laptop, from a note (8 clicks and a key)**

| # | |
|---|---|
| 1–3 | the spine, **Sit down with it ›**, the note's **to the studio** → 8 bars (the note at 1:00 to the next at 1:28, capped at 8) |
| – | DROP reads *NO ROOM ON TRACK 4*: 8 bars into a 4-bar loop |
| 4–8 | **OUT ◂** ×5: 8 → 4.63 → 3.63 bars (IN is the note, off the grid; OUT steps to bar lines) |
| key | **↵** → *Dropped on track 4 · bars 1–4* |

**Nouns:** TO THE STUDIO, buffer, take, source chip (*WED 14 OCT 21:10*: a take's
date, used as a source), *from a take: its sound is the take's own, so its sources
can't change*, DROP (the key, the pad and the button), clipboard, crate, *Buffer
▴*, loop, EDIT | PLAY, armed.

<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s6-2-to-the-studio-phone.png" width="230" alt="phone: the whole take in the buffer"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s6-3-trimmed-phone.png" width="230" alt="phone: trimmed to 4 bars"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s6-5-drop-pad-phone.png" width="230" alt="phone: the DROP pad's dead end"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s6-8-dropped-phone.png" width="230" alt="phone: dropped on track 4"></td>
</tr></table>
<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s6-3-buffer-from-note-laptop.png" width="400" alt="laptop: from a note, no lane on screen"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s6-5-trimmed-3-63-bars-laptop.png" width="400" alt="laptop: 3.63 bars"></td>
</tr></table>

**Where it was unclear**

- **Two routes, different spans.** *TO THE STUDIO* on the sheet is the whole take;
  on a note it is the note's span. Both say the same two words. The sheet's route
  puts a 2-minute file into the clipboard first.
- **8 bars does not fit a 4-bar loop**, and stepping gets 3.63 bars, not 4: a
  person who wants a 4-bar part has to drag, or lose a bar.
- **A tape's sheet also says TO THE STUDIO** (for a tape it loads the tape).
- **The Studio you arrive at is whatever you left:** in PLAY mode on a phone, or
  with the strip unfolded on a laptop. Neither shows a lane.

**Bugs**

- **No lane to drag to, in states the app itself produces.** *Repro (laptop):*
  unfold INSTRUMENT, then open any take's note → **to the studio** (or press
  **GRAB**). The Studio shows the feed, the buffer, the ruler and the strip; no
  lane is on screen. **UNFOLD** then reads **FOLD** and nothing moves.

  <table><tr>
  <td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s12-1-grab-strip-open-laptop.png" width="400" alt="laptop: GRAB with the strip unfolded"></td>
  <td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s12-2-unfold-strip-open-laptop.png" width="400" alt="laptop: after UNFOLD, still no lane"></td>
  </tr></table>
- **Pulling the phone sheet down closes the buffer** rather than shrinking it.
  *Repro (phone):* open the buffer, drag its grip down. It closes (the grab
  survives; *Buffer ▴* brings it back); the DROP pad then answers *drag it to a
  lane*.
- **The sheet hides EDIT | PLAY and the mini player** while it is up, so a phone in
  PLAY mode has no way to see lanes without closing the buffer.

---

## Story 7: Finish it

*Bounce a tape to something you can download or send.*

**Pages:** phone `/tape.html` → `/takes.html`; laptop `/tape.html` → `/wave.html`.

| # | Phone | Laptop |
|---|---|---|
| 1 | **⋯** (More for this tape): the menu runs off the left edge | same |
| 2 | **Mix down the whole tape** → *Mixing down 0:10.0: the tape plays it once, then it's saved as a take* · **Cancel** | same |
| – | *wait 14 s* (a 10 s tape plus a 2 s tail) → *Mixed down as a take* · **Open it** | wait |
| 3 | (the toast was gone ~20 s later) **Listening Room** | **Open it** → the chair |
| 4 | the new spine *Second take loop · today 13:01 · 0:12* | **TOOLS** |
| 5 | **MP3** (a download, *Second take loop.mp3*) | scroll, **Download** (*Second take loop.mp3*) |

**5 each.** The other door, from the room: **SIT DOWN** with the tape → **CUT A
RECORD** → *Cutting · 14 %* on the deck → *Second take loop is on the Records
shelf* · **Stand up**.

**Nouns:** More, mix down (the loop, the whole tape), mixing down, take, Open it,
Cancel, Listening Room, MP3, Download, DAW bundle, Send to, TOOLS, Cut a record,
Cutting, Records shelf, side A, Stand up, export stems, mixes (the spine's *2*).

<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s7-1-more-phone.png" width="230" alt="phone: the More menu, clipped"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s7-5-room-phone.png" width="230" alt="phone: the bounce on the shelf"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s7-8-tape-chair-phone.png" width="230" alt="phone: the tape in the chair"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s7-9-cutting-phone.png" width="230" alt="phone: cutting a record"></td>
</tr></table>
<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s7-6-tools-open-fullpage-laptop.png" width="420" alt="laptop: the whole take page under TOOLS"></td>
</tr></table>

**Where it was unclear**

- **Two doors.** **Mix down** is a tape verb in the Studio and ends as a plain
  take; **Cut a record** is the room's and ends as a record. The shelf folds both
  into one spine (*Second take loop*, *mixes 2*), so after both there is a
  take-looking thing, a record, and a tape, all called *Second take loop*.
- **After a mix-down the Studio says one thing, once:** a toast. The Studio has no
  "last bounce".
- **Download is the deepest control on the take's page.** On the laptop it is
  under **TOOLS**, 1500 px down, below the MIDI lanes (*Save as take · Send to ▾ ·
  Download · More*). **Send** is on the same row; neither is on the chair itself.
  The phone's sheet has MP3, DAW bundle, Download WAV and MIDI, and no *Send*.
- **The tape chair** shows the tape as a 20:00 timeline for 10 s of music, and a
  *Load it in the Studio* button for the tape that is already loaded.

**Bug:** **the ⋯ menu is clipped at the phone's left edge.** *Repro:* phone, any
tape, tap **⋯**. The items span x −37…149 with the rooms on and −137…49 with them
off (they are right-aligned to the button): *Rename this tape…* reads *ame this
tape…*. Not new.

---

## Story 8: Tidy up

*Name, star, tag and delete takes; find something from last month.*

**Pages:** `/takes.html` only (sheets and dialogs are overlays).

| # | Phone | Laptop |
|---|---|---|
| 1–2 | **List**, the row *21:42:30* | the spine |
| 3 | tap the name, type *Funk groove*, **Enter** | the name, *Late night jam*, **Enter** |
| 4 | **Star this take** | star |
| 5–9 | **+ New tag** → **+ Add a tag** → the name field (type *Funk*) → **Color 3** → **Save**: the take is *not* tagged | the **Funk** chip (the tag exists now) |
| 10 | tap the **Funk** chip (now it is) | |
| 11–13 | **Back on the shelf**, the row *12:54:43*, **Delete** → *Deleted 2026-10-15_125443* · **Undo** | **Back**, the spine, **Delete** |
| 14–15 | **‹ The room**, **SEP · 4** (an archive box) → *SEPTEMBER: 4 TAKES* | **SEP · 4** |

**Phone 15 taps and typing; laptop 8 and typing.** *Search the shelves* (2 taps and
typing) also answers *funk*: filters ★ Starred, MIDI, Phone, Tape; sorts Newest,
Longest, By tag; tag counts (*Funk 0*, *Untagged 17*).

**Nouns:** take, name, star, tag (*A tag is a color…*), sticker (in the chair),
stripe, *Edit tags*, Delete, Undo, *Recently deleted*, Restore, Delete forever,
Empty, archive, box, SEP · 4, shelf, list, search, filter, sort, family (*mixes 2*),
spine.

<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s8-2-sheet-phone.png" width="230" alt="phone: a take's sheet"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s8-5-tag-ui-phone.png" width="230" alt="phone: the Tags dialog"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s8-7-after-save-tag-phone.png" width="230" alt="phone: the tag exists, not applied"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s8-10-sep-open-phone.png" width="230" alt="phone: September"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s8-12-search-funk-phone.png" width="230" alt="phone: search and filters"></td>
</tr></table>
<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s8-2-sheet-before-tag-laptop.png" width="400" alt="laptop: the sheet over the room"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s8-4-sep-laptop.png" width="400" alt="laptop: September as a list"></td>
</tr></table>

**Where it was unclear**

- **Saving a tag does not apply it** (it makes the tag; you then tap the chip).
  *Funk 0* in the filters is the tell. The first tag takes five taps and a keyboard
  before it does anything to a take.
- **A tag is a colour, a sticker, a stripe.** The sheet says *tag*, the chair says
  *sticker*, the dialog says *a tag is a color*, the spine's stripe is the tag.
- **Delete is one tap, no confirm, with Undo.** *Recently deleted* sits at the foot
  of the same page, with **Delete forever** and **Empty** a scroll from the shelf.
- **Last month is a box, not a list.** A month box opens the same list view; a
  person looking for "that groove in September" has times and durations only. A
  take cannot be heard from the list without opening its sheet.
- On a laptop the sheet's last row (*Download WAV · Download MIDI · Delete*) slides
  under the dock at 1440×900.
- **Rows are real controls** (`role=button`, in the tab order); the inner name
  buttons are decorative. Checked, as it looked suspicious.

**Bugs:** none new. (The *Name it* link from a Keep toast opens the take's sheet and
leaves focus on *Back on the shelf*, not on the name.)

---

## Story 9: Wire up

*Open the rig, see what's coming in, set two tracks to record two inputs at once.*

**Pages:** `/tape.html` → `/rig.html` (→ back).

| # | Phone | Laptop |
|---|---|---|
| 1 | the **Sidekick · 8 in · 4 out** chip in the header → the rig | same |
| 2 | **CH1 tap · USB 3/4** (a socket) → a sheet: *level now silent*, *Nothing plugged in*, *PLUG IT INTO → Track 1…4, → KEEP (on restart)* | drag CH1 tap to track 1's input |
| 3 | **→ Track 1** | drag CH2 tap to track 2's input |
| 4–6 | **Done**, **CH2 tap**, **→ Track 2** | **Arm track 1** |
| 7–10 | **Done**, **Arm track 1**, **Arm track 2**, take track 4 off | **Arm track 2** |
| 11 | **‹ Studio**: *Catch the last pass onto tracks 1, 2*, *Rec from ch1 + ch2* | take track 4 off |

**Phone 11, laptop 6.** A cable does not arm (a build decision); the arming is
separate taps.

**Nouns:** the rig, device, socket, jack, tap (*CH1 tap*), USB, track input, bus A /
B, OUT, KEEP, CLOCK OUT / IN, MIDI IN, CONTROLS, cable, *a setting, at once*, *waits
for a restart (hollow)*, level, *the tape is in a tap*, arm, plug, unplug.

<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s9-1-rig-phone.png" width="230" alt="phone: the rig"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s9-2b-inspector-phone.png" width="230" alt="phone: a socket's sheet"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s9-5-armed-phone.png" width="230" alt="phone: two tracks armed"></td>
</tr></table>
<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s9-1-rig-laptop.png" width="420" alt="laptop: the rig"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s9-4-armed-laptop.png" width="420" alt="laptop: patched and armed"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s11-4-rig-warning-laptop.png" width="300" alt="laptop: the loop warning"></td>
</tr></table>

**Where it was unclear**

- **"What's coming in"** is per socket: the **level now** line appears only after
  choosing one. The Studio shows only the main L/R meters; the old *Input
  channels* list is the only all-inputs view, folded at the page's foot.
- **The same wiring lives in two places.** Settings still has text fields for
  `Sources` (`main=1,2:AB ch1=3,4:A ch2=5,6:B aux=7,8`), `Clock`, `Clock to`, `Plays
  the tape`, `Only these`, `Ignore` and `Inputs to keep`.
- **The warning is clear** (*THE TAPE IS IN CH1: tracks 1, 2 and 3 play on bus A,
  which CH1 hears…*) but on the header it is an amber dot, and the chip's label says
  *the tape is in a tap* only to a screen reader, until the rig is opened.
- **A phone gets a long page** (two screens of cables); a socket's sheet hides the
  cables it is about.

**Dead ends:** none. **Bugs:** none.

---

## Story 10: Change a setting

*The ring length; turn a preview on or off.*

**Pages:** `/tape.html` (Settings is a sheet).

| # | Phone | Laptop |
|---|---|---|
| 1 | scroll the Studio past four lanes, tap **Settings** (a small link in the line *Hindsight dev · Settings · the guide*) | tap **Settings** (the same line, between lanes and strip) |
| 2 | **Buffer length** (the sheet opens scrolled to the changed group) | same |
| 3–4 | typed `300120` by mistake (select-all did not select): a red *RING_SECONDS must be 10 to 3600* at the top; fixed, **Save** | typed `600`, **Save** |
| – | *Saved. Hindsight restarts to use it, so the ring starts empty: keep anything you want from it first.* **Restart** | same |
| 5 | **THIS DEVICE** (the last, collapsed group) | same |
| 6 | **Play mode** → *Reload the page for this to take effect.* | same |

**Phone 6 taps and a manual reload; laptop 5 and a manual reload.** Turning **Two
rooms** off took 3 more taps and a reload; the three old tabs (Capture, Takes,
Tape) came back and `/tape.html` stayed put.

**Nouns:** Settings, Buffer length, ring (*the ring starts empty*), Restart, Reset,
*running: 120*, *set here*, THIS DEVICE, Play mode, Two rooms, preview, *Reload the
page*, Save, Close.

<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s10-1-found-settings-phone.png" width="230" alt="phone: the foot of the Studio"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s10-5-saved-300-phone.png" width="230" alt="phone: saved, restart offered"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s10-8-play-off-phone.png" width="230" alt="phone: Play mode switched off"></td>
</tr></table>
<table><tr>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s10-2-settings-laptop.png" width="420" alt="laptop: Settings"></td>
<td><img src="https://raw.githubusercontent.com/gabeduke/hindsight/rooms-screenshots/walkthrough/s10-5-play-off-note-laptop.png" width="420" alt="laptop: Play mode off"></td>
</tr></table>

**Where it was unclear**

- **Settings is one small link** after the lanes, on both screens (by spec: the
  only route). On a phone it is a scroll of about 1000 px and a 48×29 target.
- **The ring is called "Buffer length".** The warning about losing it says *the
  ring*; the error says `RING_SECONDS`.
- **A preview toggle ends in a sentence** (*Reload the page…*), with no button, and
  an installed PWA has no reload. A pending **Restart** (the Pi's, which empties the
  ring) sits in the same sheet, above it.
- **THIS DEVICE** does not say it holds the previews.
- **Everything the Rig draws is still here as text** (story 9).

**Bugs:** the error banner uses the setting's key, not its label.

---

## The nouns

What the screens call things, what each is in the system, and where they collide.
The system meanings were read from the code and specs after the walk. (The words
*dock*, *chair* and *doorway* are spec words; the screen says *player*, *SIT DOWN*
and *the room*.)

### Things

| The UI says | It is | Seen in | Collides with |
|---|---|---|---|
| **take**, **jam** (`jam_….wav`), **cassette**, **spine** | One WAV plus sidecars (`.meta.json`, `.manifest.json`, peaks, `.mid`), made by KEEP, Save as take, a phone, a mix-down or a cut. *Jam* is its file prefix and API (`/api/jams`); a cassette is its tag-coloured picture; a spine is its place on a shelf | toasts (*Kept jam_….wav*), shelf, list, sheet, chair | *jam* is also *Jam room*, the Pi's speaker; a take is a *record* when marked |
| **record** | A take with `Meta.Record {cut, side, cover}`. The word is also *Rec* (a track recording), **REC** (the feed's lamp), *records from aux* (an input), *CUT A RECORD* (the verb), *Stop the record* | Records shelf, turntable, Rec, the ribbon, track chips | four meanings, one screen: the Studio's transport has ● Rec, the feed says REC, the track chip says *records from* |
| **tape**, **reel** | The four-track project (`tape.Tape`: tracks, clips, loop, grid). A reel is the picture | Studio header, TAPES shelf, *On the deck…tape*, the chair's tape view | the guide's *the last 15 minutes on tape* (the ring); *the tape isn't playing* is about the transport |
| **track**, **lane** | One of the tape's four rows; *lane* is the strip drawn on it | Studio, DROP (*drag it to a lane*) | none |
| **clip** | (a) audio on a track (`tape.Clip`); (b) an item in the crate (*Keep as clip*, *Find a clip*) | lanes, crate, ribbon selection | take (a clip made from a take is not one) |
| **ring** | The last N seconds in memory | *the ring starts empty*, `RING_SECONDS`, the guide's *Words* | **buffer**, **feed**, **ribbon**; also the instrument's *ring around the reel* (the loop) |
| **feed** | The Studio's live panel: ribbon, meters, GRAB, KEEP | Studio | ring, ribbon |
| **ribbon** | The ring drawn | clip names (*The ribbon (main)*), the guide | ring, feed |
| **buffer** | (a) The Studio's grab: a view of the clipboard; (b) Settings' *Buffer length*, the status line's `buffered` and the guide's *buffer ribbon*, *recording buffer* (the ring) | Studio sheet, *Buffer ▴*, Settings | the ring (b) and the clipboard (a) |
| **clipboard** | `clipboard.json`: what Copy / Cut / Grab last put there. The buffer is its view; it is also the crate's first slot | Studio's foot, crate drawer | buffer (the same store, two names, on one screen) |
| **crate** | Kept clips (`/api/crate`), deleted for a week | Crate drawer, *Close the buffer; it waits in the crate's first slot* | clip, clipboard |
| **section** | A named span of bars on a tape | SECTIONS lane; the chair reads a tape's as notes | note |
| **flag** | A mark with an optional label: on the live ring (*Flag now*) or on a take (`/api/take/flags`) | Flag now, the sheet's ⚑ list, TOOLS | **note** is a flag with words |
| **note** | A take flag with words (the sketchbook) | chair, sketchbook count | the ♪ *Notes* button (MIDI notes), *notes* in the piano roll |
| **tag**, **sticker**, **stripe**, **colour** | A take's one tag (`Meta.Tag`): a colour with a name | sheet (*+ New tag*), chair (*Add a sticker*), spine stripe | each other |
| **family**, **mixes** | Takes folded onto a spine: a take with its cuts and mix-downs | *mixes 2*, list order | record |
| **pass** | One trip round the loop | *last pass*, *Passes −6…−1* | punch-in |
| **loop** | The tape's loop bracket; the ⟲ **Loop** toggle; a take's region loop; the *free loop* taps; the reel's ring | Studio, chair, TOOLS | many |
| **source**, **input**, **tap**, **channel**, **interface** | Which capture channels feed a track. *Source*: the buffer's chips (MAIN, CH1…). *Input*: the track's chip. *Tap*: the rig's name (*CH1 tap · USB 3/4*) and the loop-start tap. *Channel*: *Input channels*. *Interface*: the device | Studio, rig, Settings | five words, one thing |
| **bus** | The Sidekick's A and B returns | track sheet (*Plays through Bus A*), rig | the instrument's *ALSO ON THE BUS* (the control bus) |
| **deck**, **player**, **turntable** | The room's playback objects. *Deck*: tapes and takes. *Turntable*: records. The bar at every page's foot is *the player* (the code calls it the dock) | room, Studio, chair | the Studio's bar is also a deck |
| **Studio**, **Listening Room**, **Rig**, **room** | The three places. *Room* alone: back from the list to the scene (*‹ The room*) | tabs, header | *Jam room* (output) |
| **output**, **OUT**, **jam room**, **this device** | Where playback goes | header chip, the player | jam |
| **phone** | (a) ● **Phone**: record from this phone's mic; (b) *A PHONE on the Wi-Fi* (the rig); (c) a *Phone* filter on the shelf; (d) *this phone hears the tape late* | Studio, rig, shelf | |

### Verbs

| The UI says | From → to |
|---|---|
| **KEEP** | the feed's last N seconds → a take. Also the instrument's KEEP pad, the key **K**, **KEEP AS TAKE** (the buffer → a take), **Keep** on the clipboard (→ the crate), the rig's **KEEP** socket (what a take is made of), Settings' *Keep free* and *Keep every input* |
| **Capture** | what KEEP was; still the guide's word, the old tab and `POST /api/trigger` |
| **Save as take** | a ribbon selection, or a tape selection → a take |
| **Keep as clip** | a ribbon selection → the crate |
| **Copy** | a ribbon selection → the clipboard (the same store as Grab) |
| **GRAB** | the last N bars, or a span of the feed → the buffer (= the clipboard) |
| **CATCH** | the last pass (or 1 / 2 / 4 bars, in a track's sheet) → the armed track(s) |
| **DROP**, **Paste**, **Insert** | the buffer or clipboard → the armed track, at the playhead, or inserting time |
| **TO THE STUDIO** | a take's whole file, or a note's span → the buffer; a tape → loaded in the Studio |
| **PUT IT ON** | a take → this device's deck; a tape → loaded on the Pi and played; a record → the turntable |
| **SIT DOWN**, **Sit down with it ›** | → the chair |
| **Cut**, **Cut a record** | (a) a tape range → the clipboard (the OP-1's *lift*); (b) a take's span → a new take; (c) a tape or take → a record |
| **Mix down** | the tape played once → a take (not a record) |
| **Send to** | a take → a tape, the crate… (under TOOLS) |
| **Play**, **PLAY**, **Play mode**, **Play all** | transport; the instrument half of EDIT \| PLAY; the preview; a sequence of takes |
| **Flag now** | the ring's newest moment → a flag, carried into the next kept take |

---

## Every way into an audio file

Every route by which a person can play, open or inspect a take or a tape, with
what it shows and what it costs. Counts are from the Studio, where the app opens,
and count the Listening Room tab as one tap. Phone numbers; the laptop's are the
same or one fewer.

| # | Route | Surface | What it shows | To just **listen** | To make a **note** |
|---|---|---|---|---|---|
| 1 | **A spine on the shelf** | `takes.html`, a sheet over it | The take's name, tempo, length, size; a cassette with a waveform; PUT IT ON, TO THE STUDIO, Play all from here, Cut a record, MP3, DAW bundle, star, tag, Download, Delete, and its flags as *Play from…* buttons | 3 (tab, spine, PUT IT ON); 2 from the room | not here: a flag list, read-only |
| 2 | **A list row** | `takes.html` list view | The same sheet, under a dated list (*TODAY · YESTERDAY · MON 12 OCT*); **Select**, **Play all** | 4 (+ List) | same as 1 |
| 3 | **An archive box** | `takes.html` list view, one month | The same | 4 (tab, box, row, PUT IT ON) | same |
| 4 | **Search the shelves** | `takes.html` | Name, time, tempo and tag search; Starred, MIDI, Phone, Tape; sort; tag counts | 4 + typing | same |
| 5 | **The deck** | the room's scene; a card at the top on a phone | What is on it; ▶ plays it. A tape plays on the Pi, a take on this device | 1 if it is already there | no |
| 6 | **The player** (the dock) | foot of every page; **Open the player** on a phone | Reels, LCD, ⏮ ↺5 s ▶ ⟲ Loop, a scrubber, OUT (*This device*), ⏏ | scrub: +1 (+2 on a phone for **Open the player**) | no |
| 7 | **The turntable** | the room, below Records | Plays a record on this device; *Stop the record* is under the fold on a phone | records only | no |
| 8 | **The chair** | `wave.html?file=` (**SIT DOWN**, **Sit down with it ›**, **Open it**, ◂ ▸ between takes, a note's ⚑) | A bigger deck, a 64 px trace with note marks, the sketchbook, title, sticker, star, **NOTE HERE** | +2 (SIT DOWN, Play): it opens stopped at 0:00 | **6 taps and typing** (tab, spine, PUT IT ON, SIT DOWN, Play, NOTE HERE; +1 to seek); 3 pages |
| 9 | **TOOLS** | the same page, under the chair | The old take page: *Three things worth knowing*, an overview strip, the big waveform with bar numbers, MIDI lanes, a piano roll; In / Out, Loop, Downbeat, **Save as take**, **Send to**, **Download**, **More**, flags, ½× 1× 2×, Level | +1 (open it) | flags again (prev / next / list) |
| 10 | **A tape on the shelf** | a sheet over `takes.html` | The tape's name, length, tempo, clips; PUT IT ON (loads it on the Pi and plays it), TO THE STUDIO, Cut a record | 3 | no |
| 11 | **A tape in the chair** | `wave.html?tape=` | A 20-minute timeline, *Load it in the Studio*, **CUT A RECORD**; sections as notes | | no: *notes of your own go on takes* |
| 12 | **The Studio's player** | the Studio's bar | The same reels and LCD; plays the *tape* through the Pi, or on this phone (*0.8 s behind*, *Rec and Catch are off*) | 1 | no |
| 13 | **The Studio's lanes** | `tape.html` | The tape's clips; no audition of a single clip except by soloing a track | | no |
| 14 | **AUDITION, the clipboard's ▶, a crate row's ▶** | the Studio | The buffer or a kept clip, on this device, never through the Pi | 1 (after a grab) | no |
| 15 | **The feed** | the Studio | The ring: a ribbon, meters. A selection offers Grab, Copy, Keep as clip, Save as take; **no listen**. With the instrument unfolded on a laptop the ribbon is hidden | cannot: grab or save first, then 1–2 more | **Flag now** (a mark, no words) |
| 16 | **The rig** | `rig.html` | Per-socket *level now*, never audio | no | no |
| 17 | **Toasts** | any page | *Open it* (a mix-down → the chair); *Name it* (a keep → the sheet, the name not focused); *Undo* | | |
| 18 | **A download link** | the sheet, TOOLS | MP3 / WAV / MIDI / DAW bundle: the browser's own player | 1 | no |

### What it costs

- **To listen to something kept yesterday:** 3 taps from the Studio (tab, spine,
  PUT IT ON), 4 on a phone where the shelf scrolls sideways and the List is the way
  to yesterday; 2 pages (the sheet is an overlay).
- **To skip around in it:** 1 more tap on a laptop; 2 on a phone (the scrubber is
  hidden until **Open the player**).
- **To write down what you heard:** 3 more taps (SIT DOWN, Play, NOTE HERE) and
  some typing, on a third page, restarting from 0:00; add a seek to find the spot.
  The phone chair's first screen is a deck; the notebook is below it.
- **To get the file out:** the sheet (MP3, WAV, DAW bundle) or, for **Send to** and
  **Download**, a scroll 1500 px down the take page under TOOLS.
- **What "a full take page" still is:** TOOLS is the Takes page's old take page,
  still whole (three waveforms of the same take in a 1790 px scroll), with the
  chair's deck above it repeating its transport.
- **Which ways in are redundant:** rows 1 to 4 are the same sheet; 5 and 6 are the
  same player; 8 and 9 are one page; 12 is a second player for a different object.

## Errors seen in the console

| Count | Where | Line |
|---|---|---|
| 29 (every page load) | all pages | `GET /api/update` → 404, logged as a red `Failed to load resource`. The endpoint answers 404 when no update has run; the page polls it anyway. Probably also on the Pi until an update has written its status file |
| 1 | Settings | `PUT /api/settings` → 400 from the walker's typing mistake (*RING_SECONDS must be 10 to 3600*) |

No uncaught exception and no failed request otherwise.

## Not checked

The dark scheme; sound (the demo has none to hear, and its CH1 and CH2 are silent);
a real iPhone (touch, and the PWA's start URL); the Pi's behaviour when the Studio's
tape is busy (the room's *Swap it?* question did not appear in the states walked);
the rooms with the flags off beyond the three-tab fallback; the hub.
