# Listening back

> Its steps are now steps 4, 9 and 10 of `the-studio-space.md`, which
> changes one thing here: the Listening Room becomes a shelf wall, with
> the drawn room as the way in and ambient light, so the deck as the
> room's centrepiece goes.

Agreed with Gabe on 2026-10-23, after he tried the Listening Room on the
rig: getting from a take into its page was awkward, the page's keys were
awkward once there, and writing notes meant choosing between several
pencils. It takes in step 6 of `the-studio-on-one-screen.md` (Open's pass)
and pulls the roadmap's bookmark drawer forward (`shell-roadmap.md`, step 5).

What a walk through it on the demo found, at 1024×768 (the flows' tablet),
1280×800 (a Pixel Tablet's own size, landscape) and a phone:

- **The take's way in is off the screen.** The bar's take name, which opens
  the take, and ✎ sit at the bar's right end. At 1024 both are past the
  screen's edge and the page scrolls sideways to reach them; at 1280 the
  name is the last thing in the corner and ✎ is cut (1257 to 1309 px).
- **There are four ways in and none reads as one:** that name, the deck's
  caption (*In the bar: …*, a button that looks like a label), the
  Sketchbook's *Open waveform ›*, and the toast's *Open* while a take
  encodes. A second tap on a take pauses it, so the shelf has none.
- **Open on the tablet has 43 controls, and the notes start below the
  fold.** Above it: a header in two rows, *Three things worth knowing*
  (160 px), the waveform, a row for the downbeat, and KEEP · GRAB ·
  Download · More cut in half. Download is the orange key. The MIDI piano
  roll has the right half.
- **Five ✎ controls on Open:** ◂✎ and ✎▸ (jump), ✎ 1 (a list of the notes,
  above the list of the notes), ✎ Note by the list's heading, and ✎ in the
  bar. On the waveform a note is a ⚑, and Undo says *adding a flag*.
- **Two notes editors.** The room's Sketchbook takes the words first, then
  Add note; Open adds an empty note, then puts the cursor in it.
- **Three pairs of ◂ ▸**, meaning the previous take, the downbeat earlier,
  and the previous note. **"Notes" means two things:** yours, and the MIDI
  (♪ *Notes* on a phone, *60 notes* on a lane). The ⟲ says *Loop* on Open
  and *Repeat* in the bar, for the same take.
- **A phone's Open** has two rows of icons above the take's name, and
  *Three things* fills most of the first screen.

Gabe's words when the two nouns were agreed (2026-10-15) are the test: *"we
should just be able to listen to a file and if need then we can dive in to
make notes."*

## Decisions

| | |
|---|---|
| The way in | **Open ›** on the bar, in a place of its own at the bar's right end, beside ✎, laid out before anything else on the bar so nothing pushes it off. It shows whenever a take is in the bar, in either room. The take's name is already on the counter. **A double tap on a spine opens it** too, as a double tap opens a part in the Studio (J1.11); one tap still plays and pauses. |
| One notes drawer | The bookmark drawer, built now: one module, the same in both rooms and on Open. It holds the take's name, ★ and tag; *✎ at 0:09* with the words (Enter adds); then the notes, each its number, time (a tap goes there), words (edited in place), ▶, GRAB and ✕. ✎ on the bar opens it at the frame being heard; the take plays on and the URL stays. **✎ is the only pencil, and it means a note here, now.** **The Sketchbook leaves the room**: the object, its dialog, its caption, and a phone's *Sketchbook* band. |
| Open, on a tablet and wider | One-row header: ‹ Takes, the name, ★, tag, then ↶ and ⋯ (the previous and next take and Delete go into ⋯). **The notes drawer is docked beside the waveform**, open, without its own name, ★ and tag (the header has them). Under the waveform: **GRAB 4 BARS** as the primary key, KEEP, and More (Download goes in it); then **Fine tune ▸** (the downbeat, snap, speed and level); then **MIDI ▸**, only when the take has MIDI, holding the lanes and the piano roll. |
| Open, on a phone | The same order in one column, the header in one row. ✎ opens the drawer as a sheet; the list sits under the keys. |
| Marks and words | A note on the waveform is a **numbered pin** that matches its row. A dropout keeps its ⚠ mark, and is a row of its own in the list that can't be edited. The MIDI's button and section say **MIDI**, so *notes* only ever means yours. The ⟲ says **Repeat** for a take on Open as in the bar (*Vocabulary*, `docs/architecture.md`). Undo says *adding a note*. *Three things worth knowing* moves into help mode. |
| What goes from Open | ◂✎ and ✎▸ (a note's time does it), the ✎ 1 list (the drawer is beside it), and ✎ Note by the heading. The downbeat's row goes into Fine tune. |

What stays: a tap plays and pauses anywhere; holding selects; Open is its
own page (`wave.html`), for now.

### To settle while building it

My recommendation comes first in each.

- **A double tap plays as well as opens.** The first tap has already started
  the take, and Open picks up where the bar is, so the take plays on into
  its page. The alternative, holding the first tap until a second can't
  come, makes every single tap late.
- **The deck's caption says where it goes:** *▶ name · Open ›*. It already
  opens the take; only its words change.
- **With the tape in the bar, ✎ stays hidden,** as now. Notes on tapes are in
  `backlog.md`, and the cue clip's drawer (`the-studio-on-one-screen.md`,
  step 5) is a separate one that can share the drawer's frame.

## Build order

Each step is its own PR, with its flows updated in `docs/flows.md` and
`scripts/flows/`, looked at in a browser at phone, tablet and desktop size in
both schemes. All three are static, and each merge releases.

1. ~~**The way in.** Open › and ✎ in their place at the bar's right end, the
   bar fitted at 1024 and 1280 (the bar overrun in `STATE.md`, *Known
   bugs*), the double tap on a spine, and the deck's caption. J2.5 opens by
   Open › and by a double tap, and J2.4 and J2.5 also run at 1280×800.~~
   Landed with `the-studio-space.md`'s step 4 (the bar).
2. **The notes drawer.** The module, mounted by the shell and by Open; ✎
   opens it in either room; the Sketchbook goes (`lib/room/space.js`,
   `art/corner.js`, the `--room-book-*` tokens, `openSketchbook` in
   `lib/room/doorway.js`). J2.4 becomes the drawer, and U3 is written and
   made core.
3. **Open.** The header, the docked drawer, the keys and their order, Fine
   tune, MIDI, the pins, the words, *Three things* into help mode. Updates
   J2.5 and J3.1, and adds J2.9: write notes on a take as it plays (✎,
   words, its pin on the waveform, a tap on its time goes there, ✕, and
   Undo brings it back).

When it lands, fold the lasting parts into `docs/architecture.md` (*The
take page*, *Vocabulary*), and delete this spec and step 6 of
`the-studio-on-one-screen.md`.
