# Reaching back: Catch and Keep as one move

Not agreed yet: the decisions, for Gabe. From the walkthrough of
2026-10-30 ([`walkthrough.md`](walkthrough.md), *Reaching back*), his
words:

- Catch: *"I don't really know what I'm catching. Does it mean some kind
  of loop?"* He catches two ways: a whole jam he has been noodling on for
  5 or 10 minutes (a backing track, or to chop up later), and the last
  pass of a loop of a few bars, played over with an overdub.
- Keep: *"Save should add a slider to the screen and we should just save
  the clip we want rather than a static length. I found that I always need
  more tape captured than I have audio and I have to prune as the first
  step."*

Mockups: [`reach-back/`](reach-back/), drawn on the demo (*Mockups*, below).

## The move

1. **Open the recent past**: the feed, drawn as its waveform, newest at
   the right, at NOW.
2. **Drag its two ends, IN and OUT,** to the part you want. They snap to
   the loop's passes when a loop is set, to bars when the tape played
   over it, and otherwise to the attacks.
3. **Send it**: CATCH onto the armed track (the tape), GRAB onto the cue
   lane (a pad), or KEEP onto the shelf (a take).

Catching the last pass is this move with IN and OUT already on it, so a
tap on Catch while the loop plays still catches without opening anything.

## Every way in today, and what each becomes

From the code at `620404d6` and PR #224 (one verb set), which puts every
surface's KEEP, CATCH, GRAB and DROP through `Verbs`
(`internal/api/verbs.go`).

| Where | Today | Becomes |
|---|---|---|
| The bar: Catch (`#catch-pass`) | The last pass onto every armed track; until a pass is done it waits (*after one pass*) | A tap takes the default span (D2): the last pass while the loop plays, as now; otherwise *since you started*, where today it waits. It still waits for the alignment (SYNC amber) |
| The bar: Catch's ▾ (`#catch-menu`) | The last pass, or the last 1, 2 or 4 bars | Still a menu ([0047](../decisions/0047-the-bars-keys-live-in-its-zones.md)): the passes, then *Choose IN and OUT…*, which opens the reach-back. The bars go |
| The feed: KEEP (`#studio-keep`) and its ▾ (`#studio-keep-more`, the lengths `#dur-seg`) | The last 30 s, 2 m, 7 m or all; the pick kept in `localStorage` | A tap keeps the default span. The ▾'s lengths and the kept pick give way to *Choose IN and OUT…* |
| The feed: GRAB (`buffer-grab-tpl`) and its ▾ | The last 1, 2, 4 or 8 bars, and the input | A tap grabs the default span. The ▾'s bars give way to *Choose IN and OUT…*; its inputs stay |
| The ribbon: hold and drag (`#rb-sel`) | A span on the log axis: GRAB or Keep, *"select generously and trim on the take page"* | The hold opens the reach-back with IN where you held; the selection bar goes |
| A note on the ribbon: its sheet | *Save from here to now*, Delete | *Save from here* goes: notes are marks in the reach-back, and a tap on one puts IN there. Delete stays |
| The record track's inspector | *Catch the last 1, 2, 4 bars* (`#catch-bars`), the passes (`#passes`) | Both go: the passes are in Catch's menu and the reach-back. Input, Layer / Replace and Overdub stay |
| The bar with the feed in it: GRAB (`#np-feed-grab`) | The last bars onto the cue lane, then the Studio | A tap: the default span; the Studio opens on the reach-back |
| A cue clip's drawer: KEEP (`#buffer-keep`); its input chips | The clip, as a take; a chip GRABs the clip's span again from that input (`again`) | Unchanged: they act on a clip, not the feed |
| The computer's keys | C catches the last pass, G grabs, K keeps the feed (the cue clip's, while its drawer is open) | The same keys on the default span, or on the reach-back's while it is open; [ ] and ⇧[ ⇧] step IN and OUT, as in a cue clip's drawer; B opens it (free in the Studio; Open uses B, so step 7 picks another there) |
| The phone: the mini player's Catch and ▾ | As the bar's | As the bar's; the reach-back is a sheet (D8) |
| The phone: the feed's KEEP and GRAB | As the tablet's | As the tablet's |
| Capture, the tape off (`#capture-btn`, `#capture-dur-seg`, `#capture-rb-sel`) | Capture with 30 s, 2 m, 7 m or all; the ribbon's span | KEEP and the reach-back, with the shelf its only send; the lengths go |
| The SMK-37: CAT and GRB on the FX page (notes 50, 51), and REC (KEEP) | CATCH the last pass, GRAB 4 bars (`grabBars`), KEEP 30 s (`keepSeconds`) | The same pads on the default span; the banner names it (D7) |
| A controller on the Pi: notes 50–53 (CATCH, GRAB, DROP, KEEP) | As the SMK-37's, and DROP the newest cue clip | CATCH, GRAB and KEEP as the SMK-37's; DROP unchanged |
| A controller in the browser (Web MIDI) | The page's keys (`hindsight:verb`) | As the computer's keys |
| Play mode's strip: CATCH, GRAB, DROP, KEEP | As the keys | Its flag is being retired in its own session; if the strip stays, its pads are the keys' |
| An empty tape: *Tap where the loop starts* | Two taps on the downbeats make the first loop | Stays, a gesture in time (Q4) |
| Open, a take's page: a selection's KEEP and GRAB; the notes drawer's GRAB | A take's span. GRAB takes the selection, or the last N bars, N the feed's pick ([0014](../decisions/0014-a-takes-grab-is-the-feeds-grab.md)) | 0014 holds: N is the loop's bars, where the feed's pick started, and the shared pick (`lib/rooms/grab.js`) goes. The editor given a take is step 7 |

## The decisions

My recommendation first in each.

**D1. One span, three sends.** What merges: KEEP's four lengths,
Catch's bars, GRAB's bars, the inspector's bars and passes, the ribbon's
selection and Capture's lengths are all one span with two ends, IN and
OUT. What stays: the three verbs, each now a place the span goes. CATCH
onto the armed track, GRAB onto the cue lane, KEEP onto the shelf. The
keys, the computer's letters and the controllers' pads keep their words
and where they are; what changes is that they all take the same span.

- `the-ecosystem.md` proposed GRAB standing for Catch. Recommended against
  here: catching a pass is one press while the loop plays, and the cue
  lane in between would make it two.
- The alternative is two sends, the tape and the shelf, with GRAB folded
  away. Not yet: the pads and GRAB onto them are two days old
  ([0061](../decisions/0061-grab-lands-on-the-cue-lane.md)), and Gabe
  hasn't played with them. Q1.

**D2. The default span, one rule for every bare press.**

- The loop playing, and played through once since it started: **the last
  pass.**
- Otherwise (the loop off, or the tape stopped): **since you started**:
  from where the sound began after the last 10 s of quiet (or the oldest
  audio in the feed) to now. Quiet is the envelope under its signal gate
  (`signalByte`, −46 dBFS, `internal/audio/envelope.go`).

The rule lives on the Pi (`Verbs.Span`), so the bar's keys, the
ribbon's lit stretch, the keyboard's banner and every pad say the same
thing and take the same thing. The ribbon lights it, as it lights KEEP's
length today. This is the answer to *"always more tape than audio"*: a
bare KEEP keeps the jam, not a length.

**D3. The reach-back's window.**

- A linear window of the feed, the newest at its right edge, NOW, with
  the record head. The ribbon above stays the map of the whole feed (its
  log axis), with the span marked on it as a cue clip's is.
- It opens fitted to the span, with room either side. Zoom: *Fit*,
  *1 min*, *5 min*, *All*, and a pinch.
- While OUT is on NOW it follows now, so the span grows while you play.
  Dragged off NOW, the span stays with its audio, as the ribbon's
  selection does today.
- On it: the bar lines and their numbers where the tape played over it,
  the passes (−1 the newest), and the notes as marks.
- IN and OUT are a cue clip's grease-pencil marks, dragged as they are
  there, a finger wide. The drawer's line says the length.
- They snap to the passes when a loop is set, then to bars, then to the
  strongest attack near the mark (as a free loop's tap snaps). ⌥, or the
  snap's menu set to Off, frees them.
- ▶ Audition loops the span on this device, as a cue clip's drawer does;
  never through the Pi.
- Drag it by its grip onto a lane, as a cue clip is dragged, and it lands
  where you let go.

**D4. How it opens, where, and what it's built from.**

- It opens from *Choose IN and OUT…* in Catch's, KEEP's and GRAB's ▾
  (each stays a menu: 0047), from the ribbon's hold, and from B.
- On the tablet and the laptop it docks above the bar, where a cue
  clip's drawer opens (0061). The lanes fold to strips, so the track a
  catch lands on stays in sight, outlined where it will land. One drawer
  at a time: opening one closes the other.
- It is one component, a span editor taken out of the cue clip's drawer:
  the window, IN and OUT, the snap and the keys, given a source (a cue
  clip, the feed, later a take). The interface comes first
  ([0020](../decisions/0020-build-the-interface-first.md)).

As a component, in `components.md`'s terms (#230, open), it `needs:
['feed', 'transport', 'tape', 'takes']`:

- `feed` gives it the window's levels (the linear read, step 1), the notes
  and the default span;
- `transport` gives it the passes and the alignment that put the tape's
  bars on the feed, and plays the audition on this device, as the bar
  plays a take or the feed (a component makes no audio of its own);
- `tape` takes the sends `catch(span)` and `grab(span)`, and gives it the
  armed tracks, their inputs and Layer / Replace;
- `takes` takes `keep(span)`.

The span is the component's own state, unless Q5 makes it the Pi's.

**D5. The words on screen.**

- The keys keep their words: **Catch**, **GRAB**, **KEEP**, and their
  letters, C, G and K. Each says the one span: *Catch · the last pass →
  2*, *GRAB · the last pass*, *KEEP 6:12 · since you started*.
- The ▾'s row that opens it: *Choose IN and OUT…*.
- The drawer is **Feed**, as the guide calls the ring. Its line says the
  span and the input: *the last pass · 4 bars · 10.0 s*, *since you
  started · 6:12 · from main*.
- The ends are **IN** and **OUT**, as on a cue clip and a take's page.
- The sends: **Catch onto track 2** (*bars 1–4 · layered*), where a cue
  clip's drawer has DROP, then **GRAB** and **KEEP**. The drawer's line
  says how much, so they don't.
- Gone: *Save as take*, *Save from here to now*, *Catch the last 1 / 2 /
  4 bars*, KEEP's *30s / 2m / 7m / all* and Capture's.
- What answers *"I don't know what I'm catching"* is the picture, not a
  word: the span is lit on the ribbon before you press, and outlined on
  the armed track's lane while the reach-back is open.

**D6. Where a CATCH lands.** Where it was played, as today: the span's
tape time, from the transport's log.

- A span of a pass or less: on its bars, layered or replacing as the
  track's Layer / Replace says. Unchanged.
- A span longer than a pass: one part, from where its first pass began,
  running on past the loop's end, as DROP lays a part longer than the
  loop; the key says *runs past the loop*. Q3.
- A span the tape didn't play over (it was stopped): at the playhead's
  bar, as DROP lands, and the key says where.
- On the Pi: `tape.CatchRequest` takes a ring span, `ring_from` and
  `ring_to`, as GRAB's request does. KEEP (`/api/trigger?from=&to=`) and
  GRAB (`ring_from`, `ring_to`) already take one.

**D7. The keyboard and the controllers.** No ends on the keyboard: its
pads and REC press the default span (D2), so `keepSeconds` and `grabBars`
go and `Verbs.Span` takes their place. The banner names what it took:
*CAUGHT PASS → 2*, *KEPT 6:12*, *GRABBED 4 BARS*. REC is KEEP today;
K3 (`docs/flows.md`) plans it as a punch-in, and if it becomes one it
leaves this list. The encoders moving IN and OUT wait for the
instrument's shape (`the-ecosystem.md`, *To settle*). Q5 asks whether a
pad should press the span the tablet set.

**D8. The phone against the tablet.** The same move, the same span and
the same three sends.

- The phone draws it as a sheet from the foot, on `createSheet`. A cue
  clip's drawer is a sheet there today but drags its own grip
  (`lib/buffer/buffer.js` `wireSheet`), so step 2 moves it onto
  `createSheet` with the span editor.
- The window full width; the sends straight under it, in the thumb's
  reach at the sheet's half height; then IN's and OUT's steps and the
  passes.
- The zoom takes the input chips' row; the input is in the drawer's line.
- While the tape plays on the phone (not the jam room), CATCH and GRAB
  are off and say why, as Catch is today; KEEP always works.
- The laptop is the tablet's layout, with the keys.

## Questions for Gabe

1. Three sends (the tape, a pad, the shelf), or two (the tape and the
   shelf), with the cue lane filled from the tape?
2. A bare KEEP, from K, the feed's key or the SMK-37's REC: *since you
   started* (recommended), or a length? Is 10 s of quiet the right gap?
   With a hum in the room above the −46 dBFS gate, *since you started*
   becomes the whole feed: should the gate follow the room's floor?
3. A catch longer than a pass: one long part past the loop (recommended),
   each pass layered on the loop, or refused?
4. A DROP onto an empty tape with no tempo already becomes the first loop
   (`internal/tape/engine.go`, `SendFirstLoop`; `tempo.md`). Should a
   CATCH from the reach-back do the same, its length setting the tempo?
   And then does *Tap where the loop starts* go?
5. Should the span be the Pi's while the reach-back is open, as the
   armed track is, so the keyboard's CATCH sends what the tablet set?
   (Recommended later, not first: it is shared state with a push.)
6. With nothing to snap to, should the ends go to the attacks
   (recommended) or to the sample?

## Build order

Each step its own PR, with its flows; `docs/guide.md` changes with the
steps that change the app (it ships with the binary).

1. **The Pi's span** (on #224's `Verbs`): `Verbs.Span`, the default (D2),
   on `/api/status` as `span` (`from`, `to`, null for now, and `why`:
   `pass` or `since`) for the `feed` model; `CatchRequest` takes
   `ring_from` and `ring_to` (D6); a linear read of the feed,
   `/api/envelope?from=&to=&buckets=`, with its passes, bar lines and
   notes as ring frames. Go tests; no UI. Releases.
2. **The span editor, taken out of the cue clip's drawer** (D4), and the
   drawer's phone sheet moved onto `createSheet` (D8). Nothing a person
   would notice changes; C1 and J1.6 pass as they are.
3. **The reach-back on the tablet**: the feed as the editor's second
   source, docked above the bar; *Choose IN and OUT…* in the three ▾, the
   ribbon's hold and B open it; the inspector's bars and passes go. J1.1,
   J1.3, J1.4 and J1.6 lose their pickers, so their stories in
   `docs/flows.md` change; a new flow: drag IN back to where the jam
   began and KEEP it, and catch the pass before the last onto track 2.
   The phone's menus lose their lengths too, but offer *Choose IN and
   OUT…* only from step 5; J4.4 still opens Catch's menu and closes it
   with Back.
4. **The bare presses take the default span**: the bar's keys, C G K,
   the controllers' pads and the SMK-37's REC, with the ribbon lit and
   the banner's words. A K flow for KEEP on a pad.
5. **The phone**: the sheet (D8); J4.4 grows.
6. **Capture**, the tape off: KEEP with the reach-back; its lengths go.
   J2.11.
7. **Later, its own spec**: the editor given a take (Open's selection,
   its KEEP and GRAB, the notes drawer's GRAB), and the keyboard's
   encoders on the ends, if the instrument wants them.

Interfaces it will touch (0022), each in its step's pull request:

- the Pi: `internal/api` `Verbs` (`Span`), `controls.go` (`keepSeconds`,
  `grabBars`), `banner.go` (the words), `/api/status` (`span`),
  `/api/envelope` (`from`, `to`), `tape.CatchRequest`;
- the editor: `lib/buffer/` (the drawer becomes the span editor, and
  `wireSheet` goes), `lib/buffer/keys.js` and `lib/play/controls.js`
  (B);
- Catch: `lib/tape/page.js` (`mountCatchMenu`, `#catch-bars`,
  `#passes`), `lib/tape/catch.js` (`catchState`);
- KEEP and GRAB: `lib/rooms/studio.js` (KEEP's ▾), `lib/rooms/grab.js`
  (the shared pick), `lib/bar/take-keys.js` and `lib/bar/feed-source.js`
  (`#np-feed-grab`), the `hindsight:keeps` event;
- the ribbon, `lib/objects/ribbon.js` (its selection), and Capture,
  `app.js`.

This spec changes none of them.

## Mockups

In [`reach-back/`](reach-back/), drawn by `reach-back/mockups.mjs` on the
demo's Studio, with the demo's feed and a cue clip's drawer re-dressed
as the reach-back: the app's own stylesheets and its own `drawWindow`.

- `tablet-pass.png`, `tablet-pass-dark.png`: 1280 × 800, a 4-bar loop at
  96 BPM, the last pass, Catch onto track 2.
- `tablet-jam.png`: the tape stopped, since you started, 6:12, KEEP.
- `phone-pass.png`, `phone-jam.png`: 390 wide, the sheet.

Three things in them are the mockup's, not the design:

- The jam's quiet start is drawn in, because the demo never stops playing.
- The pad on the cue lane is the GRAB that opened the drawer they
  re-dress.
- The phone's sheet stands as tall as what it holds.
