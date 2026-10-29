# The rooms: their words and the library

## Vocabulary

Gabe, 2026-10-15: *"we have takes, clips, tapes, and records which is
confusing … we should just be able to listen to a file and if need then we
can dive in to make notes."* So: **two nouns, takes and tapes.** A take is
anything you kept; a tape is what you build on. Everything else on screen is
a place (the Studio, the Listening Room, the Rig), a part of a screen (the
feed, the cue lane, the tracks, the bar, the instrument), or something inside a
take or a tape (a note, a tag, a star; a part, a section, the loop).

| Verb | Does | From |
|---|---|---|
| **KEEP** | makes a take, always, and nothing else | the feed (its last N, or a selection), a cue part's drawer, a take's selection |
| **BOUNCE** | makes a take from a tape, by playing it through the mixer | the tape's name's menu |
| **Share the mix** | sends a tape as an MP3, rendered on the Pi without the mixer (no Sidekick, no take, the interface may be off): `listen?all=1&format=mp3` | the tape's name's menu; Bounce's refusal |
| **GRAB** | puts a part on the cue lane, with a lane per input and its handles | the feed (last N bars, or a selection); a take (bars before the playhead, a note, a selection) |
| **DROP** | lays a cue part on a track (it stays on the lane) | a cue part's drawer, ↵, a drag; a range's Paste |
| **CATCH** | puts the last pass on the armed track | the Studio |
| **Cut · Copy** | a range of the tape onto the clipboard, unseen, for Paste | a range's bar |
| **●** (Record) | records onto the armed track | the bar, in the Studio, beside ▶ |

Every key names its object: *KEEP 2m*, *GRAB 4 BARS*, *Drop on track 2 ·
bars 1–4*, *CATCH LAST PASS*. Words that mean these things are retired:
audio on a track is a **part** (not a clip); the clipboard is
unseen, a range's Cut, Copy and Paste's alone (what GRAB fills is the **cue
lane**); the ring is the **feed** (*Feed length* in Settings); a flag is a
**note**; a bounced *record* is just a take; Capture, Save as take and Cut
are **KEEP**; Copy from the feed is **GRAB**; Paste is **DROP**; Mix down and
Cut a record are **BOUNCE**; the bar's ⟲ is **Repeat**; the crate is not on
screen. `lib/rooms/words.test.js` enforces the retired list.

A tap on a take plays it in the bar, wherever you are; holding selects; the
bar is the only transport; **Open** (`wave.html`) is the one page to dig in,
and the bar's **Open ›** is its way in. The bar's display says what plays:
its **source** (the tape, the live feed or a take), and where it plays.

**A take is called one way** wherever a person reads it: its own name, or
the time it was caught, which is what its spine prints (`takeTitle`,
`lib/rooms/takename.js`). The bar, a search, Recently deleted, a toast and
a screen reader all say that; where nothing around it says the day (a
toast, Recently deleted) the day goes before the time (`{ day: true }`).
Never the file (`jam_….wav`) or its date stamp. A cue part's drawer names a
take's grab the same way (`grabTitle`, `lib/buffer/model.js`), from the grab's
`take` and `take_label` (the take's name when it was grabbed), not from its
`sources`, which the Pi writes for its own lines. Open's own page still
titles a take by its date stamp (`lib/wave/page.js` `stampOf`), until
Open's pass.

## The library

The Listening Room is a library (`lib/shell/views/room.js`, with the wall
in `lib/room/doorway.js`):

- **The shelf wall**, on a tablet and wider, fills the room from under the
  header to the bar: a shelf per month, newest first, then ★, then a shelf
  per tag (`lib/room/shelves.js` `wallShelves`); a take stands on each
  shelf it belongs to. Short shelves share a row and a long one scrolls
  sideways, its spines spaced so that it ends on half a spine at the case's
  upright, which says it goes on (`fitRows`, measured all at once). The
  perspective is drawn -- the shadow under each board, each cubby's sides,
  the lamp's light from the upper left -- and nothing that scrolls is
  turned in 3D: a tilted case (`rotateX` under the wall's `perspective`)
  was one big layer to scroll, and on a tablet a drag that started on a
  spine moved nothing (`styles.test.js`, J2.7). Nothing on it animates by
  its scroll; the playing spine's green ring breathes by its opacity, on a
  layer of its own (`.room-cassette-glow`). A shelf's **All ›** opens the
  List to it (`shelfNames`).
- **The List** is `#takes` (`lib/takes.js`, the rack): by month and then by
  day (`lib/shelf.js` `shelve`), each row a case with its **›** to Open,
  NEW for a day, the playing row ringed; *Recently deleted (n) ›* is its
  last row. A phone's library is the List.
- **Shelf | List** is how this device sees the room, remembered in this
  browser (`lib/room/library.js`, a line in `lib/device-prefs.js`); a
  phone starts on the List, wider on the wall. **Sort ▾** (`menu.js`):
  newest, oldest, longest, name, for both. The chips: ★, the tags, *This
  week*, MIDI.
- **The search** is `#shelf-q`, found by its id wherever the page puts it.
  Used, it opens the List with the field pinned and the results right under
  it; *Cancel*, or Back, empties it. It matches what a person sees
  (`searchText`): the spine's title, the day in words, the tag, the tempo,
  the notes' words, every word typed.
- On a tablet and wider the room (and its toolbar) is pinned to the
  window where the page's own box for it is (`--room-top`, `--room-h`,
  measured from `main` by a ResizeObserver), so a page pushed sideways by a
  bar too wide for the screen moves the header and the bar, never the
  shelves.
- A shelf opened by All ›, and the search, are each on the page's stack
  (`ctx.layers`, kind `drawer`), so Back and Escape put them away.
- **The drawn room is the backdrop** (`lib/room/stage.js` `backdropRoom`:
  the room without the bookcase and the deck, whose faces were page
  markup): at `--room-ambient` behind the wall, in full only while
  `html[data-arriving="room"]` is set — the router's, while a switch into
  the room plays — then fading back over four of the room's moves. The deck
  and the Sketchbook's place are gone from the room; ✎ on the bar opens the
  Sketchbook's notes until the notes drawer replaces it.
