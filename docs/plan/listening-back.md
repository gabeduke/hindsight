# Listening back

> Its open step is step 10 of `the-studio-space.md`. Step 1, the way in
> (Open › and ✎ at the bar's end, a double tap on a spine, the deck's
> caption), landed with that spec's step 4: `docs/architecture/bar.md`;
> step 2, the notes drawer, with its step 9: `docs/architecture/rooms.md`,
> *The notes drawer*.

Agreed with Gabe on 2026-10-23, after he tried the Listening Room on the
rig: getting from a take into its page was awkward, the page's keys were
awkward once there, and writing notes meant choosing between several
pencils. It takes in step 6 of `the-studio-on-one-screen.md` (Open's pass)
and the bookmark drawer the shell's roadmap had planned.

What a walk through Open on the demo found, at 1024×768 (the flows'
tablet), 1280×800 (a Pixel Tablet's own size, landscape) and a phone:

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
| The way in | Landed (above). |
| One notes drawer | Landed (step 2). The bookmark drawer, built now: one module, the same in both rooms and on Open. It holds the take's name, ★ and tag; *✎ at 0:09* with the words (Enter adds); then the notes, each its number, time (a tap goes there), words (edited in place), ▶, GRAB and ✕. ✎ on the bar opens it at the frame being heard; the take plays on and the URL stays. **✎ is the only pencil, and it means a note here, now.** **The Sketchbook leaves the room**: the object, its dialog, its caption, and a phone's *Sketchbook* band. |
| Open, on a tablet and wider | One-row header: ‹ Takes, the name, ★, tag, then ↶ (the previous and next take and Delete are in the take name's menu, landed with the frame). **The notes drawer is docked beside the waveform**, open, without its own name, ★ and tag (the header has them). Under the waveform: **GRAB 4 BARS** as the primary key, KEEP, and More (Download goes in it); then **Fine tune ▸** (the downbeat, snap, speed and level); then **MIDI ▸**, only when the take has MIDI, holding the lanes and the piano roll. |
| Open, on a phone | The same order in one column, the header in one row. ✎ opens the drawer as a sheet; the list sits under the keys. |
| Marks and words | A note on the waveform is a **numbered pin** that matches its row. A dropout keeps its ⚠ mark, and is a row of its own in the list that can't be edited. The MIDI's button and section say **MIDI**, so *notes* only ever means yours. The ⟲ says **Repeat** for a take on Open as in the bar (*Vocabulary*, `docs/architecture/rooms.md`). Undo says *adding a note*. *Three things worth knowing* moves into help mode. |
| What goes from Open | ◂✎ and ✎▸ (a note's time does it), the ✎ 1 list (the drawer is beside it), and ✎ Note by the heading. The downbeat's row goes into Fine tune. |

What stays: a tap plays and pauses anywhere; holding selects; Open is its
own page (`wave.html`), for now.

### Settled while building it

- **With the tape in the bar, ✎ stays hidden,** as before (step 2 took the
  recommendation). Notes on tapes are in `backlog.md`, and the cue clip's
  drawer (`the-studio-on-one-screen.md`, step 5) is a separate one that can
  share the drawer's frame. (The double tap that plays as well as opens,
  and the deck's caption, were settled with step 1.)

## Build order

Each step is its own PR, with its flows updated in `docs/flows.md` and
`scripts/flows/`, looked at in a browser at phone, tablet and desktop size in
both schemes. All three are static, and each merge releases.

1. ~~The way in.~~ Landed with `the-studio-space.md`'s step 4 (the bar).
2. ~~The notes drawer.~~ Landed: `docs/architecture/rooms.md`, *The notes
   drawer*; J2.4 and U3.
3. **Open.** The header, the docked drawer, the keys and their order, Fine
   tune, MIDI, the pins, the words, *Three things* into help mode. Updates
   J2.5 and J3.1, and adds J2.9: write notes on a take as it plays (✎,
   words, its pin on the waveform, a tap on its time goes there, ✕, and
   Undo brings it back).

When it lands, fold the lasting parts into `docs/architecture/`
(`take-page.md`, `rooms.md`), and delete this spec and step 6 of
`the-studio-on-one-screen.md`.
