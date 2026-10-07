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
- **Phones:** under 440 px, the header's ‹ drops its *Takes* text and the
  keys sit 4 px apart. That keeps ◂ ▸ 🗑 ↶ ⋯ ? on one row. A take with notes
  adds ♪, and then ⋯ wraps onto a second row, as it already does on `main`.

### Capture

- **Every save's toast** has **Name it** and **Undo**. That includes
  Capture and a span saved from the ribbon (`Ribbon` takes an
  `onSavedToast`).
- **Undo** moves the new take to the trash and refreshes the shelf. Its
  toast, *Took back …: it's in Recently deleted*, has **Restore**.
- **Toasts with two actions:** a toast can now take `actions: [...]`
  (`opts.action` still works). Once either is tapped, both are disabled.

## Not in this step

- Deleting from the take page with a key. Delete or Backspace is easy to hit
  while editing a flag's name, and 🗑 is one tap already.
- A one-tap restore that doesn't star. The restore API stars on purpose,
  for pruning.

## Tests

- **Node:** `trash.test.js` covers `stepPast` (the next take, the one
  before, the last one, not in the order) and `putBack`.
- **Smoke**, `smoke-takes.mjs`:
  1. 🗑 opens the next take.
  2. That take says *Deleted … · Undo*.
  3. The order no longer has the deleted take.
  4. Undo opens it again, starred, and puts it back in the order.
  5. 🗑 on the last take opens the one before it.
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
