# One-tap trash and *Undo last save* (C1) — implementation plan

**Goal:** Cull takes one tap at a time from the take page, and take back a
capture you didn't mean, with Undo for both.

**Spec:** `docs/superpowers/specs/2026-10-07-one-tap-trash-design.md`

## Global Constraints

- No new API: `DELETE /api/delete` and `POST /api/trash/restore` already do
  the work.
- `sw.js` goes to `v47`. `TIPS` and guide §9 match.

---

- [x] **Toasts:** `toast(…, { actions })`, so one toast can have two
  actions.
- [x] **Take page:**
  - `#take-trash` in the header;
  - `trashTake` (also *Delete take* in More), `hopTo`, and `untrash`;
  - `neighbours()` now returns the order, and the queued toast is read on
    load.
- [x] **`lib/trash.js`:** `stepPast` and `putBack`, tested.
- [x] **Capture:** `savedToast` and `undoSave` in `app.js`; `Ribbon`'s
  `onSavedToast`.
- [x] **Styles:**
  - the trash key;
  - a paired toast action;
  - the phone header: ‹ without its text, keys 4 px apart.
- [x] **Docs:** guide §3, §5 and checks; a `TIPS` and §9 row.
- [x] **Smoke:** `smoke-takes.mjs` (🗑, Undo, the last take) and
  `smoke-capture.mjs` (Undo, Restore).
- [x] `sw.js` v47.
