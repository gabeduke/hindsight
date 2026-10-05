# Cuts and mixdowns fold into their take

**Date:** 2026-10-05 · **Status:** the owner chose the three behaviours below on
2026-10-05; this spec is waiting for their review · **Repo:** `hindsight`

## Why

Two actions add takes to the shelf, and both are used often:

- every *Save as take* on the take page;
- every tape mixdown.

A session of cutting riffs out of a jam, plus mixing the tape down a few times,
leaves a shelf of near-duplicates. The owner asked two things:

- can these takes nest under the original take?
- or should the app keep exporting, and just make sure the clip is relabelled
  when it's exported?

Exporting doesn't add takes:

- **Share** and the **DAW bundle** stream a file and save nothing.
- Each file is already named from the take's label plus the span
  (`internal/api/api.go:921`).
- The selection on the take page already works as a trim. It's saved to the
  sidecar as `trim` as you drag. The list shows it ("0:28 of 2:00"), and Share
  and the bundle use it.

So the extra takes come from cuts and mixdowns. Relabelling them wouldn't make
the shelf any shorter.

What the app records already:

- **A cut** records its lineage: the sidecar's `source` is
  `{name, start_frame, end_frame}` (`internal/audio/cut.go:98`).
  - Its label defaults to "*source label* · 0:42–1:10".
  - Its take page links back with "from …".
  - The list and the shelf ignore `source`.
- **A mixdown** gets the tape's name as its label and `origin: "tape"`, and
  nothing else (`internal/tape/mixdown.go:286`). Nothing ties two mixdowns of
  the same tape together.

## The owner's choices (2026-10-05)

1. **Cuts fold into their original.**
   - The original's spine wears a **✂3** sticker.
   - The cuts leave the shelf.
   - Picking the original lists them in the cassette panel.
2. **Mixdowns of one tape: the newest stands in.**
   - The newest mixdown is the tape's one spine, with a **MIX ×4** sticker.
   - The earlier mixes are listed in its cassette panel.
3. **A family sits on its spine's day.**
   - A riff cut today from last Tuesday's jam stays under last Tuesday.
   - Nothing jumps around. The toast after *Save as take* links straight to the
     new cut.

## Words

- **Cut:** a take whose sidecar has `source`.
- **Mix:** a take whose sidecar has `origin: "tape"`.
- **Family:** a take on the shelf (its **spine**) and the takes folded into it
  (its **members**).

## What the owner sees

### On the takes page

- **The shelf shows spines only.**
  - A cut folds into the first take up its line that's in the list. A cut of a
    cut goes under the original jam: one level, never a tree.
  - A cut whose original isn't in the list stands on its own. This happens
    when the original was deleted, pruned or filtered out. The cut keeps its
    name, "Tuesday jam · 0:42–1:10", which says where it came from.
  - Mixes group by tape, and the newest one is the spine. A cut of any mix in
    the group folds into that spine.
- **Stickers.**
  - The sticker is printed on the spine's J-card beside the length: **✂3**,
    **MIX ×4**, or both.
  - The spine's accessible name adds "3 cuts" and "4 mixes".
- **Filters and search see every take. Folding happens after them.**
  - The Starred filter shows a starred riff even when its jam isn't starred.
  - A search for "riff" finds the riff.
  - The Tape filter shows each tape's newest mix, with its earlier mixes
    folded in.
- **The day, Longest and Tag sorts place a family by its spine.** That
  includes a cut tagged differently from its jam: in the Tag sort it stays
  folded under the jam. Filtering by its tag shows it alone.
- **NEW sticker.** Unchanged. Only a capture on the main page wears it, and
  a capture never folds.
- **Counts.** The shelf's count is the number of spines. "N takes · x GB"
  still counts every take.

### In the cassette panel (and the phone's sheet, which is the same panel)

- **Cuts.** Under the flags: one line per cut, oldest first. Each line has
  "✂", the cut's name, its span in the original and its length.
- **Earlier mixes.** One line per earlier mix, newest first: "mix 3 · 20:55"
  and its length. The number counts mixes in the list, oldest = 1. A mix the
  owner renamed shows its name instead.
- **Pressing a line** puts that take in the panel, like any picked take:
  - rename, star, tag, Play, downloads, Delete and *Open the take ›* all work
    on it;
  - a **‹ Tuesday jam** key above its name goes back to the spine;
  - the spine stays lit on the shelf.
- **Lineage.**
  - A cut shows "Cut from **Tuesday jam** ›". It picks the original when the
    original is in the list, and opens its take page otherwise.
  - A mix shows "Mix 3 of 4 · Night tape".

### Deleting

- **Deleting an original keeps its cuts.**
  - The cuts come back onto the shelf as spines.
  - The toast says "Deleted Tuesday jam · its 3 cuts are back on the shelf",
    with Undo. Undo folds them in again.
  - The owner's common case is "keep the riffs, drop the 15-minute jam".
- **Deleting the mix that stands in:** the next newest mix stands in.
- **`MAX_SAVES` pruning doesn't change.** It's per take, oldest first, into the
  trash. A pruned original lets its cuts out onto the shelf. A pruned folded
  take leaves its spine's count one lower.

### On the main page

- The shelf is the newest spines.
  - A cut made today from last week's jam doesn't appear there.
  - A new capture always does.
- The stickers are the same, and a press plays the spine's take.
- ◂ ▸ still step through every take (`stepOrder: 'all'`).

### On the take page

- **◂ ▸** step through the takes page's order, in which each family's members
  come right after its spine. So ▸ from a jam visits its cuts.
- **Save as take** asks for a name first (PR 2):
  - The field is pre-filled with what the server would call the take
    ("Tuesday jam · 0:42–1:10") and selected, so typing replaces it.
  - Enter or **Save** saves; Escape cancels.
  - The name goes in the body's `label`, which `/api/cut` already accepts.
  - The toast reads "Saved riff · in Tuesday jam on the shelf", with a link
    to the new take.

## How it works

- **Grouping lives in the browser, and it's pure.**
  - `fold(takes)` in `lib/shelf.js` returns:
    - `shelf`: the spines, in the input's order;
    - `cuts` and `mixes`: `Map`s keyed by spine name;
    - `under`: a `Map` from each member to its spine.
  - It's tested with `node --test`.
  - Nothing on disk changes. Deleting, restoring and pruning keep working,
    because the grouping is worked out again on every poll.
- **Mixdowns record their tape.**
  - The sidecar gains `tape_id`. It's optional and additive, with no
    `MetaVersion` bump.
  - `runMixdown` sets it from the tape it's mixing.
  - `/api/jams` and `/api/take` return it.
  - A mixdown made before this has no `tape_id` and groups by its label among
    `origin: "tape"` takes. One of those the owner renamed groups on its own.
- **Folded takes still get rows in the list, hidden.**
  - The panel plays through a row's player, and deletes through a row's Undo
    (`TakesList.player`, `deleteByName`).
  - So a folded take gets a row in `TakesList`, placed right after its spine,
    with `hidden` set.
  - Its waveform loads only when it's played, since the intersection observer
    never fires for a hidden row.
  - Select mode and Select all only reach the spines.
- **Loops in the lineage leave a take on the shelf.** No real list has one,
  because a cut's source is always older than the cut. `fold` guards against
  one anyway.

## Build order

1. **PR 1, families:** `tape_id` on mixdowns, `fold`, the shelf and the main
   page, the panel's lists, deleting, the guide and tips, the smoke checks.
   - Go changes, so the deploy is a full `make deploy`, which restarts the Pi
     and clears the ring. Check `make pi-status` for an idle rig first.
2. **PR 2, name it when you save:**
   - the take page's *Save as take* name field, with a JS port of `spanLabel`
     and `cutLabelBase` tested on the Go tests' cases;
   - the toast.

   Static only: `make deploy-static`.

Each PR is fast-forwarded into local `main` and deployed after its review.
There's no GitHub PR (memory: restyle-merge-deploy-each).

The transport bar's PRs 3 and 4 also touch the take page, the takes page and
the main page. Whichever lands second rebases. The overlap is small: the
`save-take` handler, and the `shape` option on the two lists.

## Not in scope

- Nesting deeper than one level, or showing the lineage as a tree.
- Grouping phone recordings, or ribbon saves (*Save as take* on the ribbon is
  a capture, not a cut).
- Mixes nesting under the take that started the tape.
- Changing a take's lineage by hand (moving a cut to another original).
- Sonos or other outputs.

## Done when

- On the demo:
  - cut a take twice and mix a tape down three times;
  - the shelf shows one spine with ✂2, and one with MIX ×3;
  - their panels list the two cuts and the two earlier mixes;
  - pressing a line puts that take in the panel, and ‹ goes back.
- Deleting the original puts both cuts on the shelf, and Undo folds them in
  again.
- The Starred filter on a starred cut, under an unstarred original, shows the
  cut alone.
- `node --test` (including the new `fold` and `shelve` cases), `go test -race
  ./...` and `scripts/smoke-takes.mjs` pass.
- The guide's §3.1 and §8.6 describe it, with `[demo]` checks.
