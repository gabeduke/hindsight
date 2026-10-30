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
  keys, and a key's `display` is set nowhere else. No `:not()` lists and no
  `!important` (`shape.test.js`). A key a script hides by `hidden` (⏏ with
  no tape) stays hidden.
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
  tape, the mini player's ● is the tape's own (`#rec`, `data-mini="studio"`):
  a tap records the jam room, a hold (`ARM_PRESS`, as a track's ●) offers
  this phone on the ▾ (`hindsight:phone-offer`), and with the tape playing
  on this phone a tap records here (`hindsight:phone-record`). While this
  phone records, wherever it was started, that ● is pressed, says so, and
  a tap stops it (`page.js` `paintRec`). The ▾'s menu
  (`lib/bar/phone-key.js`, `#np-phone-menu`, over the mini player) says what
  ● does now, lists the phone's inputs and opens the recorder's sheet with
  its meter. Both are the page's one recorder's (`shell.md`, *Recording
  from this phone*).
- **The foot** (`data-slot="foot"`, `#np-out-foot`) is where it plays, at the
  foot of the phone's player pulled up, under the thumb; the display's OUT
  is hidden there. Both open the output sheet (`wireOutput`'s keys), and
  `paintDisplay` writes both.
- **Its height is measured** (`measureBar`: one `ResizeObserver` writing
  `--np-h` on the root), never written into the CSS; every reader has its
  `0px` fallback.
- **The display says what plays** (`lib/bar/display.js`): where it is, then
  three keys on the LCD, each a value over its legend: the tempo (in the
  Studio, with the tape, the tempo menu; elsewhere a readout), the source
  (TAPE, FEED or the take's name; `source-menu.js`: the tape, the live
  feed, the last few takes, Go to the shelf) and where it plays (JAM ROOM,
  PHONE, BOTH for the tape; THIS TABLET, THIS PHONE or THIS COMPUTER for a
  take or the feed; the output sheet). Each value has a short form and a
  long one, for the widest bar.
- **It folds by its grabber** (`lib/bar/fold.js`), a pill on a lip above its
  top edge: a tap toggles, a drag down folds, a drag up unfolds, and it
  slides by a FLIP on the lid spring (a transform, never a height a frame).
  Folded it is one row of 44 px keys, `body.np-fold`, kept for the visit. On
  a phone the grabber is the player's, and puts it away. ▾ only ever opens
  a menu.
- **✎ is the page's** (`lib/bar/take-keys.js`, `engine.setOnNote`): the
  shell's notes drawer (`rooms.md`, *The notes drawer*) takes the frame
  being heard (`frameNow`); a page without one opens the take on its own
  page (`noteHere`). The drawer sends the bar to a note's time with the
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
  stacked zones.

## The transport

What the bar shows of the tape, and what its keys send, is the page's
transport (`lib/models/transport.js`), one per page, made by the engine
(`engine.transport`, `shell.md`) and loaded with the Pi's tape. It has no
DOM: the tape and its `live` state as `/api/tapes/state` last answered,
`playing()` (through a count-in and a mixdown's tail, a press held
`HOLD_MS` over answers already on their way, nothing on an answer
`STALE_MS` old), `pos()` (run on at its rate, round the loop at its Out),
the loop, |◂'s `start()`, a bar's `step()` and `tempo()` (`{bpm, bars,
barFrames}` from the grid, or null), and the commands `play()`, `stop()`,
`locate(frame)` and `setLoop(on)`. It asks every 500 ms in the bar, one
tick in ten with a take in it, at once on the changes socket's nudge
(`push.md`), and never two at once; that socket is the page's one, held
from `load` to `destroy` whatever room is shown. The Studio lends it its
own poll, keys and nudge while shown (`delegate`, `ingest`).

The bar's tape source (`lib/bar/tape-source.js`) draws it: the LCD, the
display, the overview and the levels, and this phone's stream (where it is
is what this phone hears, and ▶ is the tap its sound waits for). A new
reader of the tape's ▶, place, loop or tempo reads the transport, never the
bar's source or the DOM.
