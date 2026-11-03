# The bar

The bar (`#np`, `css/bar.css`, `lib/bar/`) is the one transport, the same
object in both rooms and the same shape on Open (`wave.html`), so **▶ never
moves**: not between rooms, nor between the tape, a take and the feed
(J1.13 measures it at 800, 1024 and 1280 and fails past 2 px, or on a
sideways scroll).

- **Five zones in a row, and the strip under them**, each a named slot in
  the markup (`data-slot`; `lib/bar/slots.js` `SLOTS`): the **deck** (the
  reels and the display), the **transport** (|◀ ▶ ●, with ↺ 5 s in ●'s
  place for a take, the feed, or the tape away from the Studio), the
  **verb** (Catch and its ▾ for the tape in the Studio; GRAB for the feed),
  the **modes** (⟲ Loop or Repeat, the metronome) and the **end** (⏏,
  Open ›, ✎ for a take), laid out first so nothing pushes it off. Every key
  is in the markup, in its slot; a script that adds to the bar puts it in
  a slot by name (`putIn`), never after whatever was appended last.
- **What shows is said positively.** Each key lists in `data-for` the
  sources it is for (`tape`, `studio` = the tape in the Studio, `away` = the
  tape anywhere else, `take`, `feed`) and in `data-mini` those it stays for
  in the phone's mini player; one rule in `css/bar.css` shows each source's
  keys, and a key's `display` is set nowhere else. Which room it is in is
  the bar's own root's, `#np[data-room]` (`studio`, `room`, `capture`: the
  router's `shown()`, set as the shell switches rooms, in the same step as the body classes), never the page's body class. No `:not()` lists and no
  `!important` (`shape.test.js`). A key a script hides by `hidden` (⏏ with
  no tape) stays hidden.
- **Every id inside the shell's `#np` is `np-<name>`**, as `cx.id(name)`
  will name the Transport's (`components.md` 1.3): `#np-position` (the
  display's big line, `bar.js`'s, and what `lib/room/deck.js` `readBar`
  reads), `#np-rec`, `#np-catch-pass`, `#np-catch-more` and `#np-click`
  (`lib/bar/tape-keys.js`), `#np-clock-out` and `#np-out-strip` with its
  `-led`, `-text`, `-right` and `-resume` (`bar.js`, from
  `lib/bar/tape-status.js`). Guardrail 20
  fails on one that isn't. Open's own `#np` (`wave.html`) keeps its ids
  until Open's pass: its `#position` is `lib/wave/page.js`'s. The
  overview, `#np-tape-overview`, is not in `#np`'s markup at all: it is
  the Studio's (*The Studio's part of the bar*, below).
- **Its widths are its own**: a container query on its first row
  (`.np-row-1`, never `.np` or the dock, whose fixed descendants a container
  would hold). The deck's width hangs on the row's width alone
  (`--deck-w`, from `100cqi`), so ▶ stands at one x whatever the bar
  holds: from 600 px the zones are one row (the reels go under 960), from
  960 the deck is 352 at 1024 and grows to 768, and from 1180 the display
  says everything in full. Under 600 (the phone's player pulled up) the
  zones stack. The phone's mini player is `data-size="mini"`: its window,
  |◀ ▶ ● ▾, and a tail one width for every source. Under 480 px its window
  is the display alone, without its reels.
- **A key of the mini player alone** says only `data-mini`: the phone's ●
  (`#np-phone-rec`, for a take, the feed and the tape away from the Studio)
  and its ▾ (`#np-phone-more`, for every source). In the Studio with the
  tape, the mini player's ● is the tape's own (`#np-rec`, `data-mini="studio"`):
  a tap records the jam room, a hold (`ARM_PRESS`, as a track's ●) offers
  this phone on the ▾ (`phoneKey`'s `offer()`), and with the tape playing
  on this phone a tap records here (the recorder's `quick()`). While this
  phone records, wherever it was started, that ● is pressed, says so, and
  a tap stops it (*The Studio's keys*, below). The ▾'s menu
  (`lib/bar/phone-key.js`, `#np-phone-menu`, over the mini player) says what
  ● does now, lists the phone's inputs and opens the recorder's sheet with
  its meter. Both are the page's one recorder's (`shell.md`, *Recording
  from this phone*).
- **The foot** (`data-slot="foot"`, `#np-out-foot`) is where it plays, at the
  foot of the phone's player pulled up, under the thumb; the display's OUT
  is hidden there. Both open the output sheet (`wireOutput`'s keys), and
  `paintDisplay` writes both.
- **Its height is measured** (`measureBar`, on `lib/ui/measure.js`'s
  `measureInto`: one `ResizeObserver` writing `--np-h` on the root), never
  written into the CSS; every reader has its `0px` fallback.
- **The display says what plays** (`lib/bar/display.js`): where it is, then
  three keys on the LCD, each a value over its legend: the tempo (in the
  Studio, with the tape, the tempo's panel, `renderTempo`: a dialog with
  the tempo to type, −1 and +1, TAP (`tappedBpm`, `SLOWEST_BEAT_MS` in
  `lib/tape/geometry.js`) and the grid's bars counted half or twice;
  elsewhere a readout), the source
  (TAPE, FEED or the take's name; `source-menu.js`: the tape, the live
  feed, the last few takes, Go to the shelf) and where it plays (JAM ROOM,
  PHONE, BOTH for the tape; THIS TABLET, THIS PHONE or THIS COMPUTER for a
  take or the feed; the output sheet). Each value has a short form and a
  long one, for the widest bar.
- **A take's counter** (`lib/models/take-source.js` `takeBar`, drawn by
  `lib/objects/lcd.js` `takeCounter`) is BAR and beat by the take's own
  tempo, counted from its own downbeat; with no tempo, and before the
  downbeat, it is the take's time. Before the downbeat it once counted up
  from below zero (*BAR -1.4*, on a take whose downbeat was set a few
  seconds in).
- **In the Studio, the tape** (`lib/models/engine.js` `tapeUnlessPlaying`):
  in the Studio the bar gives a take or the feed back to the tape when it
  isn't playing, so ▶ there plays the tape. That is checked as the Studio
  is shown (`lib/shell/views/studio.js` `show`, every visit), as the
  hand-off from the last page settles, and as ▶ stops what the bar holds
  (`NowPlaying`'s ▶, through the engine's `tapeUnlessPlaying`). A take still playing when you change rooms
  stays, and plays on (J2.2). A take that stops by itself in the Studio
  (its end, its selection's Out, Play all moving on to the next) is left be
  until the Studio is shown again, so Play all carries on there. Gabe's ▶
  on his Mac once played a take left in the bar from the Listening Room,
  and the tape, never moving, had no playhead (J1.17). **Decided on Gabe's
  behalf on 2026-10-30, while he was away; his to overrule** (the other
  way: a take stays in the Studio's bar until ⏏, as before, with ▶
  playing it).
- **It folds by its grabber** (`lib/bar/fold.js`), a pill on a lip above its
  top edge: a tap toggles, a drag down folds, a drag up unfolds, and it
  slides by a FLIP on the lid spring (a transform, never a height a frame).
  Folded it is one row of 44 px keys, `body.np-fold`, kept for the visit. On
  a phone the grabber is the player's, and puts it away. ▾ only ever opens
  a menu. The fold and the player up are the page's bar layout
  (`lib/bar/layout.js` `barLayout(doc)`: `folded`, `open`, `set()`,
  `snapshot()`, `onChange(fn)`, `fn(after, before)`), the one place that writes `body.np-fold`
  and `body.player-open`; the shell makes it and hands it to the bar and to
  every view (`ctx.barLayout`), where the Studio hears a fold to draw its
  lanes again. The router keeps `np-fold` with its room, so the body is
  where it is kept.
- **The page around the bar is the page's.** What a page does about the bar
  is `styles.css`'s, not `css/bar.css`'s: `--dock-b` and the padding and
  toasts that keep clear of the bar on a phone, the player pulled up
  holding the page still and covering the tabs, select mode hiding the
  bar, and the Studio's `#np-dock`. `css/bar.css` draws the bar, though
  some of its rules inside the bar still key on `body.np-fold` and
  `body.player-open` until the bar is a component (1d, step 5).
- **✎ is the page's** (`lib/bar/take-keys.js`, `engine.setOnNote`): the
  shell's notes drawer (`rooms.md`, *The notes drawer*) takes the frame
  being heard (`frameNow`); a page without one opens the take on its own
  page (`noteHere`, `lib/models/engine.js`). The drawer sends the bar to a note's time with the
  engine's `seekTake(name, frame, {play})`, which loads the take if the bar
  holds another and puts it back in the bar over the feed or the tape;
  false when it can't be loaded (still saving).
- **On a phone the player is a sheet you drag** (`lib/bar/player.js` on
  `lib/ui/sheet.js`; `shell.md`, *Sheets*): a tap on the mini player's
  window, or a drag up from it, pulls it up from where the mini player
  stood, so the mini player grows into the full one; a swipe down on its
  grabber or its art (the reels and the display), a tap on the grabber,
  Back or Escape puts it away, back down to the mini player. Held upright
  (under 700 px) it is laid out on the bar itself (`.np-row-1` and
  `.np-zones` are `display: contents` there): the reels and the display as
  its art at the top, the strip, a space, then the transport, the verb and
  the modes in the thumb's reach, and the foot. On its side it keeps the
  stacked zones. The bar's menus (Catch's, the tempo's, the source's) open
  over it (`css/bar.css`): the source's once opened under it, where no tap
  reached it.
- **The flows hold the phone's bar to its shape** (`scripts/flows/layout.mjs`,
  `bar-*`; `docs/flows.md`, *Layout checks*), on every screen where it
  shows: the mini player one row, its full width, no key over another, a
  window a finger wide, ▶ at one x for every source; the player pulled up
  with every key on the screen and |◀ ▶ ● on one row.

## The Studio's keys

●, Catch and its ▾, and the click are the bar's keys for the tape in the
Studio (`lib/bar/tape-keys.js` `tapeKeys`, made by `NowPlaying` with the
page's tape model, `tape`, and shared with every view as `ctx.tapeKeys`).
They are drawn from the tape's `snapshot()` (`{tape, live}`: what records,
the count-in, the alignment, a mixdown, the click, where it plays, the
passes) and the phone recorder's (`{mode, seconds}`), as either changes and
as the Studio asks, and a press is one of the tape's verbs: `record(body)`,
`punchOut()`, `catch(body)`, `setClick(on)` (`tape.md`, *The tape model*),
then `refresh()`. `faces({snap, phone, armed, inputOf, catchTip})` is what
they say, pure: ●'s label, pressed, armed, counting, disabled and dim;
Catch's waits, jam-only, second line, the mini player's shorter one, tip and
label; the click's pressed and disabled.

What is the Studio's own reaches them only as the hands it lends, the one
interface between them (`lib/tape/page.js` `studioHands`, lent as it wires
up, taken back on destroy):

| `tapeKeys` answers | |
|---|---|
| `lend(hands)` → off | the Studio's hands, until `off()`; the keys are drawn and pressed only while some are lent |
| `draw()` | the keys again: the armed tracks or their inputs changed (the Studio's render) |
| `press(name)` | `'rec'`, `'catch'` or `'click'`, as a tap (R, C, M); nothing while it is disabled |
| `catch(what)` | Catch `{pass}`, `{bars}` or `{out}`: its ▾'s, and the Studio's passes and last-bars keys |
| `closeMenu()` | Catch's ▾ shut (the Studio's `closeMenus`) |

| `hands` | |
|---|---|
| `layers` | the scope Catch's ▾ opens on (the Studio's, so a switch of rooms closes it) |
| `armed()`, `inputOf(n)` | the armed tracks as the Studio shows them, and what each records from |
| `playsHere()` | the tape plays on this phone: ● records from this phone |
| `body(what)` | a record's or a catch's body (`recordBody`, replace or overdub), or null when the Studio refused it and said why (the jam-only sheet, *arm a track*) |
| `said(verb, answer, {before, what, body})` | the words for `record`'s, `punchOut`'s or `catch`'s answer, with the Studio's Undo or Cancel |
| `hover(on)` | Catch pointed at: its outline on the record track's lane |
| `ghost()` | a locate the Studio sent that this phone has not heard yet (`{pos, until}`), or null: the output strip says where it is moving to (`tapeKeys.ghost()` answers it, null with no hands lent) |

The bar says the rest itself: why Catch waits (with *Last 4 bars*), why an
item of its ▾ can't go, and *Could not record* or *Could not catch*.
Guardrail 19 fails on `lib/tape/page.js` or `lib/rooms/studio.js` looking
up `#np-rec`, `#np-catch-pass`, `#np-catch-more`, `#catch-menu` or
`#np-click` by the usual spellings (`$('np-rec')`, `getElementById`, a
`querySelector` on `#np-rec`): a guard against the old wiring coming back,
not a proof; an id held in a variable, or another module of the Studio's,
gets past it.

## The Studio's part of the bar

The overview (`#np-tape-overview`, the whole tape: tap to move the
playhead, drag its box to move what the lanes show) is the Studio's
drawing, not the bar's. Its markup is the Studio's, at the end of
`#view-studio` in `shell.html`; the Studio's view
(`lib/shell/views/studio.js`) puts it at the start of the bar's strip
through its slot, `ctx.barSlot.add(overview, { place: 'strip' })`, and
hands it to its page, `mountTapePage(ctx, { overview })`, which holds it
for its render, its keys and its size observer. The strip
(`[data-slot="strip"]`, `.np-row-2`) is a place the shell names in the bar
slot (`lib/shell/boot.js`, `slots.bar.places`): the bar's markup keeps it,
with the bar's own scrubber (`#np-scrub`) in it, and the overview is in it
only while the Studio is shown, so a look-up by its id answers null in
another room. It still shows only for the tape in the Studio
(`data-for="studio"`). Guardrail 21 fails on `#np`'s markup carrying it, on
`lib/tape/page.js` looking it up, or on the Studio putting it anywhere but
the strip.

## The lamp and the output strip

The clock-out lamp (`#np-clock-out`, who follows the tape's clock with
`TAPE_CLOCK=lead`) and the output strip across the bar's top
(`#np-out-strip…`, while the tape plays on this phone) are the bar's, in
every room, not the Studio's: `NowPlaying.paintTape()` draws them from the
models as the tape answers (`tape.onChange`), as the transport changes (the
stream's state among it) and as the engine's bar does. Their words are
`lib/bar/tape-status.js`'s, pure:

| `tape-status.js` | |
|---|---|
| `outStrip({stream, live, tape, ghost, now})` | `{hidden: true}` unless the tape plays on this device (`engine.stream` active, `live.output_mode` not `jam`), else `{hidden: false, resume, led, text, right}`: how it is going (starting, lost and where, locked, moving to a bar, playing, ready), how far behind, and whether its *Tap to play here* shows |
| `clockLamp(clock, tape)` | `{hidden: true}` with no `live.clock`, else `{hidden: false, text, none}`: who follows it, ● while it runs, the tempo it hears; `none` with no device plugged in |

`live` and `tape` are the page's tape model's `snapshot()`, `stream` the
engine's, and `ghost` the Studio's, through the hands it lends the bar
(`ghost()`, *The Studio's keys*), so only a locate sent while the Studio
is shown says *Moving to bar …*. The strip's *Tap to play here* is
`engine.stream.resume()`. The Studio keeps its own banner (another device
has the tape) and the output sheet's state (`lib/tape/output-ui.js`
`initOutput`). They move into the Transport with the rest of the bar
(`docs/plan/transport-extraction.md`, step 5).

## The engine

What the bar holds and plays is the page's engine
(`lib/models/engine.js` `createEngine`), made once by the shell
(`lib/shell/boot.js`, `ctx.engine`; `shell.md`, *The engine*). It holds the
sources, `lib/models/tape-source.js` (the transport drawn, and this
phone's stream), `feed-source.js` (the live ring) and `take-source.js` (a
take, played by its list row's player), which one is in the bar, the take's
Audio (the engine makes and adopts it: no view constructs the bar's audio),
⏏, where the tape plays (`output.setMode`) and the take carried across
pages (`carry.js`, `handoff.js`). Its `bar` is what a page drives it with:
`snapshot(here)`, what the bar draws, and `onChange(fn)`, which calls fn()
as what the bar holds changes and every frame while it plays, on the shared
ticker, where the source's playhead steps (`tick()`); `paintStrip(ctx, w,
h, colors, dpr)`, the strip's picture of what it holds (the tape's
overview, a take's trace, the feed's ring); `src`, the source itself, for
the tests and the hand-off; and the verbs
`setSource(kind)` (`tape`, `feed` or `take`), `loadTake(t, player)`,
`loadTakeByName(name)`, `seekTake(name, frame, {play})`, `eject()` (⏏,
by hand: the tape stays until a take is picked by hand), `backToTape()`,
`tapeUnlessPlaying()`, `pickSource(id)` (the source menu's), `note()` (✎),
`grabFeed()` (the feed's GRAB) and `touch()` (a use of the bar's keys,
counted in `touches`). The bar's own keys are verbs too: `playPause()` (▶:
the source's own say first, the tape's sound waiting for a tap; a stop by
▶ is `tapeUnlessPlaying()`), `toStart()` (|◂), `back5()` (↺ 5 s and J, of
what this device hears), `setLoop(on)` (⟲), each a touch, and the strip's
`seekFraction(f)` (a tap, a drag, Home), `toEnd()` (End) and `step(n)`
(← →), which are not (the bar counts the strip's touch itself).

| `snapshot(here)` | frozen, cached on `v`: a cache key bumped on every emit and every kick, not only when something it carries changes |
|---|---|
| `id` | which source: a new number each time the bar holds another |
| `kind`, `title`, `href` | `tape`, `feed` or `take` (null with nothing), its name, its own page (Open ›) |
| `playing`, `waiting` | it plays; it plays on the Pi but isn't heard here yet (▶ is the tap) |
| `frame`, `length`, `sampleRate`, `frac` | where it is, in frames |
| `pos`, `lcd` | the display's big line, and the LCD (`{big, small, note, status, unit}`) |
| `display` | the display's keys for `here`, this device's word (`slots.js` `hereWord`); null with no `here` |
| `loop`, `canPlay`, `canLoop`, `canStart`, `canEject` | ⟲ on, and whether ▶, ⟲, \|◂ and ⏏ have something to do |
| `startLabel` | what \|◂ goes back to |
| `levels` | the reels' levels (`{colors, at(frame)}`), or null |

`NowPlaying` (`lib/bar/bar.js`) is the bar drawn: made by the shell beside
the engine (`new NowPlaying({engine, onToast, layout, room, tape})`: `layout` the
shell's `barLayout`, `room()` the room the router shows, so the tempo opens
its menu in the Studio; the shell kicks the bar as it switches; `tape` the
page's tape model, for the Studio's keys, `np.tapeKeys`, the lamp and the
output strip), it draws the engine's `snapshot()` on `#np` from its
`onChange` (and the strip through `paintStrip`, on a canvas sized by
`lib/ui/canvas.js` `sizeCanvas`), sets `#np[data-source]`,
`#np[data-room]` and ⏏'s `hidden` (`canEject`), and hands each press to
the engine's verbs. It holds no source. The source menu, ● on the phone's mini
player, the output sheet and the Studio's keys are wired there too; the extraction moves them,
with `NowPlaying`, into the Transport component. Guardrail 18 fails on a
module other than the engine that makes a source, on audio made for the bar
under `lib/bar/`, `lib/room/`, `lib/shell/` or `lib/components/`, and on a
`NowPlaying` made anywhere but the shell's boot.

## The transport

What the bar shows of the tape, and what its keys send, is the page's
transport (`lib/models/transport.js`), one per page, made by the engine
(`engine.transport`, `shell.md`) over the page's protocol client
(`components.md`) and loaded with the Pi's tape. It has no DOM and names
no route: the tape and its `live` state as the tape's read last answered,
`snapshot()` of them (`{v, id, tape, live, pending}`, frozen, the same
object until one moves; what a component draws from, `components.md`),
`playing()` (through a count-in and a mixdown's tail, a press held
`HOLD_MS` over answers already on their way, nothing on an answer
`STALE_MS` old), `pos()` (run on at its rate, round the loop at its Out),
`sampleRate()`, `looping()`, |◂'s `start()`, a bar's `step()` and
`tempo()` (`{bpm, bars, barFrames}` from the grid, or null). Its verbs,
each answering the Pi's answer or throwing a `Refusal` to whoever pressed:
`play()`, `stop()`, `locate(frame)`, `setLoop(on)`, `setOutput(mode)`
(the output sheet's choice, through `switchOutput`, and the rig's),
`setTempo(bpm)` and `setBars(n)` (the tempo's panel, a re-grid: decision
0062), and `tapLoop(body)` and `tapCancel()` (a free loop's tap). The bar's
tape source catches a refusal of its own keys and says it (*The tape: …*);
the Studio's keys say it in theirs. It reads the tape from the page's
tape (`lib/models/tape.js`, *The tape model* in `tape.md`), the page's one
poller, which it asks every 500 ms in the bar and every 5 s with a take in
it, at once on the changes socket's nudge (`push.md`) and shortly after
each verb, never two at once. That socket is the page's one, held from
`load` to `destroy` whatever room is shown. Each verb is a change of the
tape's (`change`), so a poll it overtakes is dropped. While shown, the
Studio asks the tape every 200 ms, feeds the transport what it shows
(`ingest`: the place this phone hears) and lends it the hands each verb is
sent inside (`delegate({around})`), which say what a stop's punch kept,
whoever pressed. Guardrail 16 fails on a module other than the
protocol client naming the transport's routes.

The bar's tape source (`lib/models/tape-source.js`) draws it: the LCD, the
display, the overview and the levels, and this phone's stream (where it is
is what this phone hears, and ▶ is the tap its sound waits for). A new
reader of the tape's ▶, place, loop or tempo reads the transport, never the
bar's source or the DOM.
