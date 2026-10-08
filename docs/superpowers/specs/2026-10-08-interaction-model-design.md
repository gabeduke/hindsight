# The interaction model

**Date:** 2026-10-08 · **Status:** asked for by Gabe on 2026-10-08, after a
night on the tape; the proposal and its sketches are the artifact *Hindsight
Interaction Model* (https://claude.ai/artifact/KwreNYVjPb8Kt3RMgrAbPr). Gabe
took every recommended answer the same day. · **Repo:** `hindsight`

## Why

Gabe's notes (six on the tape page, four on Takes) came down to one thing:
the controls for what you're working on aren't next to it, and pages that
do the same job do it in different ways. The worst of it on the tape page:

| Where | What it acts on | What tells you |
|---|---|---|
| Edit drawer | The loop's bars, on the red-outlined track or all four | The ruler's shaded loop, and *Track N / All* |
| Clipboard row | The playhead, from the red-outlined track down | Nothing on the lanes until you point at a key |
| Clip bar | The clips you tapped | Their grips |
| Clip sheet | One clip, as a dialog over the tape | The dialog's title |
| Record drawer | The red-outlined track | The red outline, if you know to look |
| **A** on a track | Its Sidekick bus | Only the help tip; it reads like "arm" |

The red outline carries four meanings at once (where a catch lands, where a
punch lands, where Drop pastes, what *Track N* means), and the Edit drawer's
range isn't drawn. The drawers act on things you have to remember.

He asked for the app's parts to be grouped into standard objects, after a
look at how DAWs, music apps and the platform guidelines do it, instead of a
one-off interface per page.

## The model: seven parts, one place each

Every page is built from the same parts. A part's place doesn't change from
page to page; only what it holds does.

- **App bar** (top, every page): the page switch, the **output button**,
  undo and redo, help, ⋯.
- **Deck** (bottom, every page; the mini deck on a phone): what's loaded (the
  tape on reels, or a take as a cassette), its LCD and the transport, in one
  housing. The same keys in the same order everywhere, |◂ ↺ ▶ ⟲ ● ♩; a key
  that doesn't apply is dimmed, never moved. The right end holds the loaded
  item's own keys: Catch for the tape; In, Out, ⚑ and ⏏ for a take.
- **Workspace** (the middle): the loaded item, large. Each track header
  carries its record setup: input, arm and level.
- **Selection** (drawn on the workspace): clips, or a range of bars across
  one or more tracks. Drag across lanes to add tracks, or the ruler for all
  four. Replaces *Track N / All*.
- **Action bar** (above the deck, while something is selected): names the
  selection, then its verbs in a fixed order (Cut, Copy, Paste, Insert,
  Delete time, Split, Duplicate, Send to, Details). Replaces the Edit drawer,
  the clipboard row and the clip bar.
- **Inspector** (a right-hand panel on wide screens; a sheet with three
  heights on a phone): the selection's settings, never a dialog. Replaces the
  clip, track and section sheets.
- **Library** (a left-hand panel on wide screens; its own screen on a
  phone): the shelf of takes, the crate, and the clipboard as the crate's
  first slot.

And one menu, **Send to**, the same on every selection: Tape, Clipboard,
Crate, New take, Share.

## Decisions (Gabe, 2026-10-08: "I'll go with your default picks")

1. **The loop follows a range selection**, as on the OP-1, with a lock on
   the ruler for editing elsewhere while the loop plays on.
2. **The clipboard becomes the crate's first slot.** Copy puts things on
   top; Paste uses the top one unless you pick another.
3. **The take page folds into Takes on tablets and laptops**, keeping its
   own address for phones and old links.
4. **One armed track at a time**, for now: a catch takes one source.
5. **The action bar says Cut and Paste**, with Lift and Drop kept in the
   help tips and the guide.

## Build order

Each step ships on its own. Steps 6 and 7 get canvas boards first, from the
generators in `~/programming/hindsight-design`.

1. **Quick wins** — below.
2. **The inspector** — the clip, track and section dialogs become one
   non-modal panel or sheet that follows the selection.
3. **Fade handles** — fades on a clip's top corners, free lengths, and
   Equal power, Linear, S-curve and Exponential curves (the sketch's *Fast*:
   "exponential" is the name a DAW gives it), chosen in the inspector; the
   repeat handle moves to the bottom-right corner. The sketch's curve dot,
   to bend a fade on the clip, was left out when it was built: a fourth
   target on a small clip, for what the inspector's four curves already do.
4. **Record on the track** — input and arm on each header, the landing bar on
   the armed lane, Catch names its track and previews the pass; the Record
   drawer goes.
5. **Selection and the action bar** — ranges across tracks, one action bar;
   the Edit drawer, clipboard row and clip bar go; the clipboard joins the
   crate.
6. **The deck** — one housing on every page; ↺ steps back a bar on the tape
   and 5 s on a take; the cassette's own Play goes.
7. **Takes as list-detail** — the shelf fills the page until a take is
   loaded, then shelf left and take right; ⏏ unloads.
8. **Tape stop and granular fades** — new processing in the tape's renderer,
   checked for CPU on the Pi.

## Step 1: quick wins

### The output button

- One button in the header's top row, beside **?**, on **Tape, Takes and
  Capture**: the pages that can play the tape. Its picture is the place
  (a speaker for the jam room, headphones for a phone, both for both), and
  from 1000 px its name is beside it. It opens the Output sheet, as the OUT
  pill did.
- `lib/tape/out-switch.js` holds what the pages share: the icons, the
  sheet (made by script, so there is one copy of its markup), and the switch
  a choice makes (the sound starts inside the tap; a phone that never starts
  doesn't leave the jam room silent), moved out of `output-ui.js`.
- On Takes and Capture, choosing This phone or Both puts the tape back in the
  bar, so what you hear is what the bar holds. The bar's OUT label is shown
  only while it holds a take (*This device*); the header says where the tape
  is.
- On the tape page the header's pill goes, and so does the bar's OUT, except
  in a phone's open player, which covers the header.
- The take page keeps its *OUT · This device* label: it doesn't host the tape
  (2026-10-05-transport-bar-design.md, decision 5). It joins Takes in step 7.

### Downbeat

The take page's *Bar 1* row reads **Downbeat**, as do its keys' labels, the
editor's readout, its tips, the Send to hint (*its downbeat on a tape bar
line*) and the guide. Bar 1 still means the first bar wherever it's a place.

### Send to, on the take page

*Send to tape* and *Keep as clip* (buttons) and *Copy* (under More) become
one **Send to ▾**, a menu of **Tape** (with the line saying what it will do
under it), **Clipboard** and **Crate**. The items keep their ids and
handlers. More keeps the DAW bundle, the downloads, Split here and delete.
The Capture ribbon's Keep as clip waits for step 5.

### bus A

A track's **A**/**B** key shows *bus* in small letters over the letter, and
its label says *Bus A*: it's the Sidekick channel the track plays through,
and with an arm key coming in step 4 it mustn't read as one.

## Step 5: selection and the action bar

What was built (branch `ui/5-selection`, stacked on the step 4 fixes):

- **A range** is bars across one or more tracks, `{from, to, t0, t1}`
  (`lib/tape/range.js`). There are four ways to make one:
  - Hold an empty part of a lane, then drag across bars and lanes.
  - Hold the ruler and drag, for every track.
  - Tap a section, for its bars on every track.
  - Select clips and tap **Bars**, for the bars they cover. This is the way
    into a lane full of clips, where a hold slides a clip instead.

  A range snaps to **⌗** (bar, beat, eighth or off). It's shaded on its lanes,
  with a tab on each edge that drags at once to resize it. A range and
  selected clips are never both: making either lets go of the other. Esc,
  Done, or a tap on an empty part of a lane lets go of it.
- **The loop follows the range** (decision 1): a range moves the loop to its
  bars, turned on. The **padlock** beside the ruler (a per-device pref)
  locks the loop; while it's locked, the ruler shows the range apart from
  the loop.
- **One action bar** (`#multi-bar`):
  - For clips: Cut, Copy, Bars, Split, Duplicate, Reverse, Keep, Move here,
    Details…, Select more, Remove, Done.
  - For a range: Cut, Copy, Paste, Insert, Delete time, ×2 (only while the
    range is the loop) and Done. The range's name ("Tracks 2–3 · bars 5–8")
    stands in for the clip count.
  - Insert and Delete time keep their previews and asking first.
  - Keys: ⌘X cuts, ⌘C copies, ⌘V pastes (on the range, else at the playhead).
- **Server:**
  - EditRequest gains `tracks` and `span: {from, to}`, so lift, copy and
    delete-time take a range instead of the loop and Track N / All.
  - A clipboard drop takes `at`. That's Paste on a range, and it leaves the
    playhead where it is.
- **What went:**
  - The Edit drawer and its key went, and with them Track N / All.
  - The clipboard row moved to the top of the crate's drawer (decision 2).
  - *Slide snaps to* became the ⌗ key beside the ruler.
  - *Ask before Insert and Delete time* moved under ⋯.
  - Drop and Lift are called **Paste** and **Cut** (decision 5). The guide's
    glossary still gives the OP-1's names.

Left for later:
- The one **Send to** menu on the tape's selections.
- Split and Duplicate on a range. Split at the playhead is still S.
- Moving a range's tracks by dragging. For now, draw it again.
- The Capture ribbon's *Keep as clip* still waits to fold into Send to.
