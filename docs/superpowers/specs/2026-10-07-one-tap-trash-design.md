# One-tap trash and *Undo last save* (C1)

**Date:** 2026-10-07 · **Status:** step C1 of the
[DAW-style editing plan](2026-10-07-daw-editing-plan.md), approved by Gabe on
2026-10-07 · **Repo:** `hindsight`

## Why

A recorder like the Zoom R20 culls takes with one button: delete, and the
next take is up. On Hindsight, the take page's *Delete take* is under
**More** and goes back to the list, so culling a run of takes means
open, More, Delete, open the next, again and again.

Capture has a matching gap. A capture you didn't mean (the wrong length, a
double tap) stays on the shelf until you find it in the list and delete it.

The trash already makes both safe. `DELETE /api/delete` moves a take there
for a week, and `POST /api/trash/restore` brings it back. So neither action
needs to ask first. Each just needs an Undo.

## What

### The take page

- **🗑 in the header**, beside ↶:
  - One tap moves the take to the trash. It doesn't ask.
  - The next take in the list's order opens. From the last take, the one
    before it opens. If no take is left to go to, it's back to the list,
    which says *Deleted … · Undo* there as before.
  - It steps only through the list's own order. A take that isn't in it (a
    cut opened from its *Saved* toast, say) goes back to the list, as
    before, and the stored order is left alone.
  - The key is disabled until it's wired, so a tap while the take loads
    isn't lost silently.
  - **The phone's notes pane** pushes a history entry. With it open, 🗑
    first goes back off that entry (`offNotes`), so Back afterwards
    doesn't land on the deleted take. The take is fetched with
    `cache: 'no-store'`, so Back or Forward onto a deleted take says it's
    gone, not what the cache remembers.
  - *Delete take* under **More** does the same, so there's one way it works.
- **The next take says so:** *Deleted … · Undo*.
  - Undo restores the deleted take and opens it again.
  - It comes back starred, as any restore does, so the next prune doesn't
    take it straight back.
- **The list's order** (`hindsight.order`, which ◂ ▸ step through) loses the
  deleted take, so ◂ from the next take doesn't open a take that's gone.
  Undo puts it back where it was.
- **Pure helpers** in `lib/trash.js`, tested:
  - `stepPast(order, name)`: the take to go to next, and the order without
    the deleted one.
  - `putBack(order, name, at)`.
- **The queued toast:** the take page now reads `toastNext`'s toast, as the
  two list pages already do.
- **Phones:** under 440 px, the header's ‹ drops its *Takes* text (it stays
  32 px wide, a fair target) and the keys sit 4 px apart. That keeps ◂ ▸ 🗑 ↶ ⋯ ? on one row. A take with notes
  adds ♪, and then ⋯ wraps onto a second row, as it already does on `main`.

### Capture

- **Every save's toast** has **Name it** and **Undo**. That includes
  Capture and a span saved from the ribbon (`Ribbon` takes an
  `onSavedToast`).
- **Undo** moves the new take to the trash and refreshes the shelf. Its
  toast, *Took back …: it's in Recently deleted*, has **Restore**. The
  status line's *last saved* no longer names a take taken back.

### The Pi: a take trashed while it encodes

Capture's Undo comes within seconds of a save, while its preview is still
encoding and its tempo still measuring. This race was already there for a
quick delete, but the toast makes it routine.

- **`MakePreview`** puts the finished preview in place under the take's lock
  and the trash's, as a delete or a restore does:
  - with the take gone to the trash, the preview goes into its slot;
  - with the trash already emptied, the preview is dropped;
  - it never lands in the takes folder without its WAV.
- **A restore** (`audio.AfterRestore`, from `POST /api/trash/restore`)
  encodes a preview that's missing, unless one is on its way. It also
  measures a tempo that's only the clock's, or none. A take trashed before
  its encode began comes back playable, with its measured tempo.
- **Toasts with two actions:** a toast can now take `actions: [...]`
  (`opts.action` still works). Once either is tapped, both are disabled.

## Not in this step

- Deleting from the take page with a key. Delete or Backspace is easy to hit
  while editing a flag's name, and 🗑 is one tap already.
- A one-tap restore that doesn't star. The restore API stars on purpose,
  for pruning.

## Tests

- **Go** (`preview_trash_test.go`):
  - a preview finished after a trash follows the take into its slot, and
    comes back with it;
  - a restore encodes the preview and measures the tempo the trash cut
    short.
- **Node:** `trash.test.js` covers `stepPast` (the next take, the one
  before, the last one, not in the order) and `putBack`.
- **Smoke**, `smoke-takes.mjs`:
  1. 🗑 opens the next take.
  2. That take says *Deleted … · Undo*.
  3. The order no longer has the deleted take.
  4. Undo opens it again, starred, and puts it back in the order.
  5. 🗑 on the last take opens the one before it.
  6. 🗑 on a take the list's order doesn't have goes back to the list.
  7. On a phone with the notes pane open, 🗑 opens the next take, and Back
     goes to the list.
- **Smoke**, `smoke-capture.mjs`:
  1. A save's toast has *Name it* and *Undo*.
  2. Undo moves the take to the trash.
  3. Restore brings it back, starred.
- **Guide:**
  - §3: Capture's toast.
  - §5: the trash paragraph, and the take page's [demo] checks rewritten for
    🗑.
  - §9: a 🗑 row matching `TIPS`.
  - `sw.js` goes to v47.
