# Insert and delete time (A7) — implementation plan

**Goal:** Insert pushes the tape on to make room for the clipboard, Delete
time cuts bars out and closes the gap, and Duplicate section plays a section
twice in a row. Each acts on every track, the sections and the loop, is
previewed before it happens, and is one undo step.

**Spec:** `docs/superpowers/specs/2026-10-07-insert-delete-time-design.md`

## Global Constraints

- All three act on every track, the sections and the loop together.
- Each is one undo step, and none pushes anything past `TAPE_LENGTH_S`.
- `sw.js` goes to `v46`, and `SHELL` gains `/lib/tape/timeedit.js`.
- `TIPS` and guide §9 match.

---

- [x] **Go:**
  - `timeedit.go`: `cutAt`, `shiftFrom`, `lastFrame`, `roomToPush`,
    `insertTime`, `deleteTime`, `duplicateSection`, and `Engine.timeEdit`
    (the clipboard or a kept clip; the playhead, or what's heard while
    playing; a locate after, when stopped).
  - `EditRequest.Crate` and `EditResult.At`.
  - Tests in `timeedit_test.go` and `api/tape_test.go`.
- [x] **Node:** `lib/tape/timeedit.js` (`insertPreview`, `deletePreview`,
  `spanWords`, `barOf`), tested.
- [x] **Page:**
  - Keys: `#insert` beside Drop and `#ed-delete` beside Lift, each with
    *all tracks* under it.
  - Previews: `previewOf`, `showPreview`, `wirePreview`, with `shownTape`,
    `drawGhost` and `drawPreview` drawing them on the lanes and the ruler.
  - Asking first on a touch screen: `confirmFirst`, and `#ask-first`
    (`tape.ask`).
  - `insertHere` and `deleteTime` toast with Undo.
  - Section sheet *Duplicate*; crate row *Insert*.
- [x] **Docs:**
  - `api.md`: the three ops and their refusals.
  - Guide §8.5: *Replace, insert or close the gap*, with strips and
    [demo] checks.
  - `TIPS` and §9 rows.
- [x] **Smoke:**
  - the hover preview;
  - Insert, then ↶;
  - Delete time;
  - Duplicate section;
  - on a phone, two taps, then ↶.
- [x] `sw.js` v46.
