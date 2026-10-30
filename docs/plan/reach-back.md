# Reaching back: Catch and Keep as one move

Not agreed yet: the decisions, for Gabe. From the walkthrough of
2026-10-30 (`walkthrough.md`, *Reaching back*), his words:

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

From the code at `620404d6` and PR #224 (one verb set, open), which puts
every surface's KEEP, CATCH, GRAB and DROP through `Verbs`
(`internal/api/verbs.go`).

| Where | Today | Becomes |
|---|---|---|
| The bar: Catch (`#catch-pass`) | The last pass onto every armed track | Unchanged on a tap; its second line names the span (D2) |
| The bar: Catch's ▾ (`#catch-menu`) | The last pass, or the last 1, 2 or 4 bars | Opens the reach-back on the last pass; the menu goes |
| The feed: KEEP (`#studio-keep`) and ▾ (`#dur-seg`) | The last 30 s, 2 m, 7 m or all; the pick kept in `localStorage` | A tap keeps the default span; ▾ opens the reach-back. The four lengths and the kept pick go |
| The feed: GRAB (`buffer-grab-tpl`) and ▾ | The last 1, 2, 4 or 8 bars, and the input | A tap grabs the default span; ▾ opens the reach-back, where the input chips move |
| The ribbon: hold and drag (`#rb-sel`) | A span on the log axis: GRAB or Keep, *"select generously and trim on the take page"* | A hold opens the reach-back with IN where you held; the selection bar goes |
| A note on the ribbon: its sheet | *Save from here to now*, Delete | *Save from here* goes: notes are marks in the reach-back, and a tap on one puts IN there. Delete stays |
| The record track's inspector | *Catch the last 1, 2, 4 bars* (`#catch-bars`), the passes (`#passes`) | Both go: the passes are chips in the reach-back. Input, Layer / Replace and Overdub stay |
| The bar with the feed in it: GRAB (`#np-feed-grab`) | The last bars onto the cue lane, then the Studio | A tap: the default span, as now; the Studio opens on the reach-back |
| A cue clip's drawer: KEEP (`#buffer-keep`) | The clip, as a take | Unchanged: it keeps a clip, not the feed |
| The computer's keys | C catches the last pass, G grabs, K keeps the feed (the cue clip's, while its drawer is open) | The same keys on the default span, or on the reach-back's while it's open; [ ] and ⇧[ ⇧] step IN and OUT, as in a cue clip's drawer; B opens it |
| The phone: the mini player's Catch and ▾ | As the bar's | As the bar's; the reach-back is a sheet (D8) |
| The phone: the feed's KEEP and GRAB | As the tablet's | As the tablet's |
| Capture, the tape off (`#capture-btn`, `#capture-dur-seg`, `#capture-rb-sel`) | Capture with 30 s, 2 m, 7 m or all; the ribbon's span | KEEP and the reach-back, with the shelf its only send; the lengths go |
| The SMK-37: CATCH, GRAB, DROP, KEEP (notes 50–53, the FX page), and REC (KEEP) | KEEP 30 s (`keepSeconds`), GRAB 4 bars (`grabBars`), CATCH the last pass | The same pads on the default span; the banner names it (D7) |
| Any controller: notes 50–53 | As the SMK-37's | As the SMK-37's |
| Play mode's strip: CATCH, GRAB, DROP, KEEP | As the keys | Go with Play mode (retired, in its own session) |
| An empty tape: *Tap where the loop starts* | Two taps on the downbeats make the first loop | Stays, a gesture in time; the reach-back can also start a first loop (Q4) |
| Open, a take's page: a selection's KEEP and GRAB; the notes drawer's GRAB | A take's span | Unchanged now; the same editor, given a take, later (build step 7) |

## The decisions

My recommendation first in each.

**D1. One span, three sends.** What merges: KEEP's four lengths,
Catch's menu, GRAB's bars, the inspector's bars and passes, the ribbon's
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

- A loop set, and played through at least once: **the last pass.**
- Otherwise: **since you started**: from where the sound began after the
  last silence of 10 s or more (or the oldest audio in the feed) to now.
  "Silence" is the envelope's peak under the feed's floor, which it
  already keeps.

The rule lives on the Pi (`Verbs.Span`), so the bar's keys, the
ribbon's lit stretch, the keyboard's banner and every pad say the same
thing and take the same thing. The ribbon lights it, as it lights KEEP's
length today. This is the answer to *"always more tape than audio"*: a
bare KEEP keeps the jam, not a length.

**D3. The reach-back's window.**

- A linear window of the feed, the newest at its right edge, NOW, with
  the record head. The ribbon above stays the map of the whole feed (its
  log axis), with the window and the span outlined on it.
- It opens fitted to the span, with room either side. Zoom: *Fit*,
  *1 min*, *5 min*, *All*, and a pinch.
- While OUT is on NOW it follows now, so the span grows while you play.
  Dragged off NOW, the span stays with its audio, as the ribbon's
  selection does today.
- On it: the bar lines and their numbers where the tape played over it,
  the passes as bands (−1 the newest), and the notes as marks.
- IN and OUT are the cue drawer's grease-pencil marks, with grips a
  finger wide, 44 px. Between them: the length and how long ago.
- They snap to the passes when a loop is set, then to bars, then to the
  strongest attack near the grip (as a free loop's tap snaps). ⌥, or the
  snap's menu set to Off, frees them.
- ▶ Audition loops the span on this device, as a cue clip's drawer does;
  never through the Pi.
- Drag it by its grip onto a lane, as a cue clip is dragged, and it lands
  where you let go.

**D4. Where it opens, and what it's built from.** On the tablet and the
laptop, docked above the bar where a cue clip's drawer opens (0061): the
lanes fold to strips, so the track a catch lands on stays in sight, and
the lane outlines where it will land. One drawer at a time: opening one
closes the other. It is built as one component, a span editor taken out
of the cue clip's drawer: the window, IN and OUT, the snap, the keys,
given a source (a cue clip, the feed, later a take). The interface comes
first ([0020](../decisions/0020-build-the-interface-first.md)).

**D5. The words on screen.**

- The keys keep their words: **Catch**, **GRAB**, **KEEP**, and their
  letters, C, G and K. Each says the one span: *Catch · the last pass →
  2*, *GRAB · the last pass*, *KEEP 6:12 · since you started*.
- The drawer is **Feed**, as the guide calls the ring. Its line says the
  span: *the last pass · 4 bars · 10.0 s*, or *since you started · 6:12*.
- The ends are **IN** and **OUT**, as on a cue clip and a take's page.
- The sends: **Catch onto track 2** (*bars 1–4 · layered*), where a cue
  clip's drawer has DROP, then **GRAB** and **KEEP**. The drawer's line
  says how much, so they don't.
- Gone: *Save as take*, *Save from here to now*, *Catch the last 1 / 2 /
  4 bars*, KEEP's *30s / 2m / 7m / all* and Capture's.
- What answers *"I don't know what I'm catching"* is the picture, not a
  word: the span is lit on the ribbon before you press, and outlined on
  the armed track's lane while the reach-back is open or Catch is held.

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
*CAUGHT PASS → 2*, *KEPT 6:12*, *GRABBED 4 BARS*. The encoders moving IN
and OUT wait for the instrument's shape (`the-ecosystem.md`, *To
settle*). Q5 asks whether a pad should press the span the tablet set.

**D8. The phone against the tablet.** The same move, the same span and
the same three sends.

- The phone draws it as a sheet from the foot (`createSheet`), as a cue
  clip's drawer is there: the window full width, its grips at its foot
  so a thumb doesn't cover the audio it trims; the sends straight under
  it, in the thumb's reach; then IN's and OUT's steps and the passes.
- The zoom takes the input chips' row; the input is in the drawer's line.
- While the tape plays on the phone (not the jam room), CATCH and GRAB
  are off and say why, as Catch is today; KEEP always works.
- The laptop is the tablet's layout, with the keys.

## Questions for Gabe

1. Three sends (the tape, a pad, the shelf), or two (the tape and the
   shelf), with the cue lane filled from the tape?
2. A bare KEEP, from K, the feed's key, the SMK-37's REC or its KEEP pad:
   *since you started* (recommended), or a length? Is 10 s of quiet the
   right gap?
3. A catch longer than a pass: one long part past the loop (recommended),
   each pass layered on the loop, or refused?
4. On an empty tape, should sending a span start the first loop, its
   length setting the tempo as the two taps do? And then does *Tap where
   the loop starts* go?
5. Should the span be the Pi's while the reach-back is open, as the
   armed track is, so the keyboard's CATCH sends what the tablet set?
   (Recommended later, not first: it is shared state with a push.)
6. With nothing to snap to, should the ends go to the attacks
   (recommended) or to the sample?

## Build order

Each step its own PR, with its flows; `docs/guide.md` changes with the
steps that change the app (it ships with the binary).

1. **The Pi's span** (after #224): `Verbs.Span`, the default (D2);
   `CatchRequest` takes `ring_from` and `ring_to` (D6); a linear read of
   the feed for a span, `/api/envelope?from=&to=&buckets=`, with its
   passes, bar lines and notes as ring frames. Go tests; no UI. Releases.
2. **The span editor, taken out of the cue clip's drawer** (D4): nothing
   on screen changes; C1 and J1.6 pass as they are.
3. **The reach-back on the tablet**: the feed as the editor's second
   source, docked above the bar; Catch's, KEEP's and GRAB's ▾ and the
   ribbon's hold open it; the inspector's bars and passes move in. J1.1,
   J1.3, J1.4 and J1.6 lose their pickers, so their stories in
   `docs/flows.md` change; a new flow: drag IN back to where the jam
   began and KEEP it, and catch the pass before the last onto track 2.
4. **The bare presses take the default span**: the bar's keys, C G K,
   the controllers' pads and the SMK-37's REC, with the ribbon lit and
   the banner's words. A K flow for KEEP on a pad.
5. **The phone**: the sheet (D8); J4.4 grows.
6. **Capture**, the tape off: KEEP with the reach-back; its lengths go.
   J2.11.
7. **Later, its own spec**: the editor given a take (Open's selection,
   its KEEP and GRAB, the notes drawer's GRAB), and the keyboard's
   encoders on the ends, if the instrument wants them.

Interfaces it will touch (0022): `internal/api` `Verbs` (`Span`),
`tape.CatchRequest`, `/api/envelope`, `lib/buffer/` (the drawer becomes
the span editor), `lib/rooms/studio.js` (KEEP's ▾), `lib/play/controls.js`
(B), `lib/objects/ribbon.js` (its selection). This spec changes none.

## Mockups

In [`reach-back/`](reach-back/), drawn by `reach-back/mockups.mjs` on the
demo's Studio, with the demo's feed and a cue clip's drawer re-dressed
as the reach-back: the app's own stylesheets and its own `drawWindow`.

- `tablet-pass.png`, `tablet-pass-dark.png`: 1280 × 800, a 4-bar loop at
  96 BPM, the last pass, Catch onto track 2.
- `tablet-jam.png`: the tape stopped, since you started, 6:12, KEEP.
- `phone-pass.png`, `phone-jam.png`: 390 wide, the sheet.

Two things in them are the mockup's, not the design: the jam's quiet
start is drawn in, because the demo never stops playing; and the pad on
the cue lane is the GRAB that opened the drawer they re-dress. The phone's
sheet stands as tall as what it holds.
