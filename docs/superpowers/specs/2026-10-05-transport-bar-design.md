# One transport: a now-playing bar on every page, and drawers for the tape's tools

**Date:** 2026-10-05 · **Status:** direction A ("Main window") picked by the
owner on the canvas, 2026-10-05; this spec awaits review · **Repo:** `hindsight` ·
**Canvas:** https://claude.ai/artifact/Px2DTatuTRFMZwfPmVx8mw (page "A · Main
window"; B and C, not taken, are on the second page)

## Why

On 2026-10-05 the owner was using the Tape page on a tablet and asked for
three things:

- **Less room for the right-hand column.** From 1000 px wide, the Tape page
  gives a 400 px panel to its controls:
  - Play, Loop, Rec and the click;
  - the position;
  - Record from, Catch with its bars and Layer/Replace;
  - the Clipboard;
  - Lift, Copy, Split and ×2;
  - Snap and Passes.

  On a 1024 tablet the lanes keep what's left.
- **One player, the same on every page.** Each page plays in its own way
  today:
  - the tape's transport row (a dock on a phone);
  - the take page's transport row and overview;
  - the Takes page's cassette with its own Play key;
  - the shelf spines on Capture, which play when pressed and show nothing
    more.

  The owner had "a flashback of Winamp", which had a tape-deck skin.
- **A home for the overview scrubber** that PR #38 added to the Tape page.

## What the owner sees

The canvas has every screen; this section is the contract. Where it and the
canvas differ, this section wins (the differences are listed under
*Corrections to the canvas*).

### The bar

The bar is docked at the bottom of every page and runs the full width, in two
rows, 120 px tall on a tablet or laptop.

**Row 1**, left to right:

- **The reel window**: two small reels either side of an amber LCD, on the
  deck's brushed metal.
  - **The reels** turn with the playhead. The packs move from left to right
    over the tape or take, and the reels wind or rewind to a jump (the
    deck's `ReelMotion`, as now).
  - **The LCD, top line:**
    - a status glyph: ▶ playing; ■ stopped (❚❚ paused, on a take);
      ● recording, red and blinking; ● armed, red and steady;
    - **the position, large**: bar.beat on the tape (`BAR 6.2`), m:ss.s on a
      take;
    - beside it, small: the time on the tape (`0:13.1`), the length on a take
      (`/ 0:58`);
    - **level bars**, one per track in the track colours (the tape), or two
      in amber for left and right (a take). They show only while playing.
  - **The LCD, second line:** what is loaded, scrolling, for example
    `TAPE 1 · 96 BPM · 4/4 · LOOP BARS 5–8 · IN THE JAM ROOM · TRACK 4 ARMED`
    or `2026-10-04_201512 · 96 BPM · IN 0:12.4 · OUT 0:20.8 · ON THIS DEVICE`.
    With reduced motion it stands still and ends in an ellipsis.
  - **Messages in place of the position.** These take over the large position
    exactly as they take over `#position` today: count-in, mixing down,
    letting it ring out, saving the mixdown, and no output.
- **The keys**, with LEDs as now:
  - **|◂** goes back to the loop's start (the tape's In when Loop is on,
    otherwise 0). On a take it goes back to In.
  - **▶ / ■** plays and stops the tape, as now (its "■ cancels" messages
    depend on it). On a take the key is **▶ / ❚❚**.
  - **⟲ Loop**.
  - On the tape only: **● Rec** and **♩** (the click).
- **The page's own keys**, at the right (see the next section).

**Row 2:**

- **The scrubber**, the full width: the whole tape or take.
- **The OUT pill**, at its right end.

### On each page

| Page | What the bar holds | The page's own keys (right of row 1) |
|---|---|---|
| **Tape** | The loaded tape | **Record ▴** and **Edit ▴** (the drawers), then **Catch** (orange) |
| **A take** | That take | **IN**, **OUT**, **⚑** (flag here) |
| **Takes** | The take you picked. If the tape is playing when you arrive, the tape, until you pick a take | **Open the take ›**, or **Open Tape 1 ›** |
| **Capture** | The tape. A shelf spine you press, until it ends or you press ⏏ | **Open Tape 1 ›**, or **⏏** while a take is in the bar |

- **Tape.**
  - The deck at the top of the page goes. Its reels are now the bar's, and its
    meter bridge becomes the LCD's level bars.
  - The overview moves into the bar. The lanes start under the header, and
    (once the drawers land) they take the full width.
- **A take.**
  - The take page's overview becomes the bar's scrubber.
  - Its transport row (▶, Loop, In, Out, ⚑, ◂⚑, ⚑▸) goes:
    - ▶ and Loop become the bar's keys;
    - In, Out and ⚑ become the bar's own keys;
    - ◂⚑ and ⚑▸ join the edit strip beside the In and Out nudges.
  - Speed and everything else stay where they are.
- **Takes.** The cassette's Play key goes, and the cassette's hubs turn with
  the bar. Tapping a spine picks the take and loads it into the bar; it
  doesn't start playing by itself.
- **Capture.** Pressing a shelf spine loads that take into the bar and plays
  it, as a press plays it today. When it ends, or you press ⏏, the bar goes
  back to the tape.
- **With the tape off** (`TAPE` unset), the bar on Capture shows only while a
  take is in it.

### The scrubber

- **Everywhere**, as the tape's overview works today:
  - a tap moves the playhead (on the tape, to the nearest bar);
  - dragging the window moves what the page shows;
  - a double-tap goes back to the loop on the tape, or fits the whole take on
    a take page.
- **On Takes and Capture** nothing on the page follows the bar, so the
  scrubber has no window: a tap or a drag moves the playhead.
- **What it draws** (the canvas):
  - for the tape: a strip per track of its clips' bars, the loop in grease
    yellow, the window, and the orange playhead, with the part already played
    brighter;
  - for a take: the trace on tape with grease In and Out.
- **Keyboard:** it is a `role="slider"`. With it focused, ← and → move the
  playhead by a bar (the tape) or a second (a take).
- **A change on the take page:** its overview, which today only moves the view,
  now also moves the playhead on a tap. The development checklist already
  says "tap to jump".

### The drawers (the Tape page)

The bar's **Record ▴** and **Edit ▴** keys open two drawers that replace the
right-hand column.

- **Record · Catch:**
  - **Record from:** the four source chips with their meters, ● clean and
    ○ the tape is in it.
  - **Catch the last:** **1 bar**, **2 bars** and **4 bars**. Each catches
    straight away, as today.
  - **Onto audio already there:** Layer or Replace.
  - **Passes:** −6 … −1.
  - **Overdub on this device.**
  - When OUT is *This phone*, the drawer shows the jam-only note and
    Overdub on this device, and nothing else.
- **Clipboard · Edit:**
  - **Clipboard:** ▶ what's on it, Drop, Merge, and ×.
  - **Edit the loop's bars:** Track N or All tracks, then Lift, Copy, Split
    and ×2.
  - **Slide snaps to:** Bar, Beat, ⅛ or Off.
- **How a drawer behaves:**
  - Only one is open at a time.
  - It docks above the bar like a window, with a title strip of grip lines
    and a ✕.
  - It **pushes the lanes up**: the lanes shrink, down to 56 px each, and then
    the page scrolls. It never covers a track.
  - Its key, or the ✕, closes it.
  - The open drawer is remembered on this device (`tape.drawer`).
  - The key's LED is lit while its drawer is open, and the key carries
    `aria-expanded`.
- **The clip editor** (Align) opens in the same place, as a third window. The
  open drawer closes while it's there and comes back after Done.
- **The OUT strip** ("Playing on this phone · 0.8 s behind") becomes a thin
  line across the top of the bar.

### The bench (1024 × 600) and a laptop (1470)

- **The bench.**
  - The header's two rows fold into one: the brand, the tape's name pill, the
    page switch in the middle, the tempo pill, ↶ and ⋯. ↷ and Help move into ⋯.
  - With a drawer open, the four lanes are about 50 px each.
- **A laptop** looks the same as the tablet, wider. From 1400 px the track
  heads are 200 px, as now.

### The phone (narrower than 700 px, or on its side and under 440 px tall)

- **The mini player** sits above the tabs and shows:
  - small reels;
  - the name and the output ("Tape 1 · Jam room");
  - the bar and time;
  - ▶;
  - Catch, on the tape only.

  A hairline along its top edge is the progress.
- **Tap it** and **the player** pulls up over the page, full height. From the
  top it shows:
  - ▾ (fold);
  - NOW PLAYING and the name;
  - OUT;
  - the reel window, large;
  - the scrubber;
  - |◂ ▶ ⟲ ● ♩;
  - Catch, full width (`Catch · the last pass → track 4`);
  - a switch, **Record · Catch | Clipboard · Edit**, over the drawers'
    contents.

  ▾, Back, or a swipe down folds it.
- **On a take**, the mini player has ▶, and the player has IN, OUT and ⚑.
- This replaces the Tape page's phone dock, which fixes Play, Loop, Rec, the
  click and Catch above the tabs.
- Catch stays one tap away anywhere on the Tape page.
- On its side (844 × 390), only the mini player docks, so ▶ and Catch are
  always on screen. That fixes the sideways phone, where the take's Play and
  the tape's Catch sat below the fold.

## Decisions

1. **What the bar holds on Capture and Takes** (agreed 2026-10-05): the
   tape, unless you pick or press a take; see the table. On a wide Takes page
   a take is always picked (the first, by default), so there the bar shows the
   tape only while it was already playing when you arrived.
2. **A take plays on this device only.** Its OUT pill reads
   `OUT · This device` and is a label, not a button. Playing takes in the jam
   room, or on Sonos, is later work.
3. **The deck and its meter bridge leave the Tape page.** The LCD's level
   bars use the same `levelAt` and the same −10 dBFS reference. The VU
   recalibration offered on 2026-10-05 would apply to them.
4. **Drawers push and never cover.** A covered lane hides the track being
   recorded.
5. **The tape on a phone, across pages.**
   - Pages are separate documents, so a page change drops the tape's stream.
     The Pi stops the tape after 2 s with no listener
     (`internal/tape/output.go`).
   - The bar therefore hosts the stream player on every page. When OUT is
     *This phone* or *Both* and this device was the listener, the new page
     reconnects at once, and the LCD says `Reconnecting…` until it plays.
   - The Pi's grace goes from 2 s to 6 s, so a page change doesn't stop the
     tape.
6. **Changing page stops a take.** The tape plays on in the jam room. Making
   the app a single page, so a take could survive navigation, is not in
   scope.
7. **Ids are kept.** These keep their ids and `data-tip`s, so `page.js`'s
   wiring, the tips table and the smoke tests carry over:
   - `#play`, `#loop`, `#rec`, `#click`, `#catch-pass`, `#tape-overview`,
     `#tape-out`, `#out-strip`;
   - every control inside the drawers.

   `#position` keeps its id as the LCD's large position.

## Corrections to the canvas

- **Catch** on the tape catches *the last pass* (`{pass: 1}`), as
  `#catch-pass` does today. Its small line reads "the last pass" (the canvas
  said "last 2 bars").
- **The bars in the Record drawer** are three keys that each catch, not a
  setting.
- **The OUT pill** on a take or a cassette reads "This device" (the canvas
  said "This tablet").

## How it works

### Page

- **Markup.**
  - The bar is static markup in each page, like the header: a
    `<section id="np" class="np" aria-label="Now playing">`, placed after
    `<main>`.
  - Its new elements:
    - `#np-reels` (the reels' SVG);
    - the LCD: `#np-status`, `#position`, `#np-time`, `#np-levels`,
      `#np-marquee`;
    - `#to-start`;
    - `#np-drawer-rec` and `#np-drawer-edit` (the drawer keys);
    - `#np-eject`.
  - On a page, `#np` and its drawers sit at the bottom of a full-height flex
    column (`body` is `100svh`, `main` is `flex: 1; min-height: 0` and
    scrolls), so a drawer opening shrinks `main`, not the window.
- **`lib/bar/reel-window.js`** (new) draws the two reels with their packs and
  the tape between them, and the level bars. It runs on
  `lib/tape/reels.js`'s `ReelMotion`.
  - It takes over from `lib/tape/machine.js`, which is deleted along with its
    CSS.
  - API: `new ReelWindow(root)`, then
    `poll({heard, playing, length, sampleRate})`, `setLevels(colours, fn)`,
    `start()` and `stop()`.
- **`lib/bar/lcd.js`** (new, pure, tested) holds:
  - `tapeCounter(...)`, which gives `{big, small, status}`, including the
    count-in and mixdown messages that `render()` builds inline today;
  - `takeCounter(...)`;
  - `tapeMarquee(...)` and `takeMarquee(...)`.
- **Sources.** The Tape page drives the bar from its own poll, as it drives
  the deck now. The take page drives it from its `Clock`. Takes and Capture
  get two new modules:
  - `lib/bar/tape-source.js` finds the loaded tape (the `/api/tapes` answer
    `initNav` already fetches), then polls `/api/tapes/state?id=` every 500 ms
    while the page is visible. It sends play, stop and locate
    (`POST /api/tapes/transport`) and Loop (`PATCH /api/tapes`). Rec and Catch
    stay on the Tape page.
  - `lib/bar/take-source.js` wraps the row's `Audio` that the Takes list
    already shares with the cassette.
- **`lib/bar/player.js`** (the phone PR) folds the bar into the mini player
  and pulls up the player. It uses the same nodes, rearranged by CSS under
  `body.player-open`. Nothing is duplicated except the header's second OUT
  pill (below).
- **OUT pills.** On a phone, the header's OUT pill stays until the player
  arrives. `output-ui.js` renders and wires every `.tape-out`, so the header
  pill and the bar's pill are one control in two places.
- **The service worker** gets the new `lib/bar/*.js` files in `SHELL`, loses
  `lib/tape/machine.js`, and its `CACHE` is bumped in each PR.

### Server

- **The phone PR:** the no-listener grace in `internal/tape/output.go`
  goes from 2 s to 6 s, and its test moves with it.
- Nothing else. `/api/tapes/state` is already polled every 200 ms by the Tape
  page, so 500 ms from one other page costs the Pi nothing new.

## Build order

There are five PRs. After its review, each one is fast-forwarded into local
`main` and deployed, as the restyle was.

1. **The bar on the Tape page**:
   - the reel window, the LCD, the keys, Catch, the scrubber and OUT;
   - the deck goes;
   - on a phone, the bar is today's dock plus the scrubber;
   - the right-hand column keeps the rest for now.
2. **The drawers**:
   - Record and Edit replace the right-hand column;
   - the clip editor docks above the bar;
   - the lanes take the full width;
   - the bench's one-row header.
3. **A take**: the bar on the take page, with the overview as its scrubber,
   and In, Out and ⚑.
4. **Takes and Capture**:
   - the bar holds the tape (`tape-source.js`) or a take (`take-source.js`);
   - the cassette's Play key goes;
   - the shelf spines on Capture load into the bar;
   - ⏏.
5. **The phone**:
   - the mini player and the player on all four pages;
   - the stream player on every page, and the Pi's grace at 6 s;
   - the old phone dock goes.

## Not in scope

- Playing takes in the jam room or on Sonos.
- A single-page app, so a take could play across page changes.
- The VU recalibration (its own change).
- Drawers on Capture or a take.

## Done when

- **At 1024 × 768**, with the drawers closed, the Tape page's four lanes take
  the full width and are at least 100 px tall each.
- **At 1024 × 600**, with a drawer open, every lane is at least 48 px tall,
  and the bar and the drawer are on screen.
- **The bar shows the same left half on all four pages**: reels, LCD, |◂ ▶ ⟲,
  the scrubber and OUT.
- **On a phone**, upright and on its side, ▶ and (on the tape) Catch are on
  screen on every page.
- **The smoke tests pass** at 390 × 844, 844 × 390, 1024 × 600, 1024 × 768
  and 1470 × 900: `smoke-tape`, `smoke-takes` and `smoke-capture`, updated.
- **Every new `data-tip`** has its row in `tips.js` and in `docs/guide.md`
  §9, and §8.2, §4 and §3 describe the bar.
- **The tests pass:** `go vet ./...`, `go test -race ./...` and the node suite.
