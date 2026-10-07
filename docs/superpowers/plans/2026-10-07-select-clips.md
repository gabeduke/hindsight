# Select several clips (A4) — implementation plan

**Goal:** Pick several clips and move, copy, duplicate, reverse or remove them
as one.

**Spec:** `docs/superpowers/specs/2026-10-07-select-clips-design.md`

## Global Constraints

- Every edit on several clips is one undo step and refused whole.
- The one-clip flows (sheet, grips, Align) are unchanged when nothing
  several is picked.
- `sw.js` → `v41`; `TIPS` and guide §9 match.

---

- [x] **Go:** `EditRequest.Clips`, `DT`, `DTrack`; `internal/tape/clips.go`
  (`State.clip`, `pick`, `span`, `moveClips`, `removeClips`,
  `duplicateClips`, `Engine.copyClips`); `reverseClips` and `reversal` in
  `edit.go`. Tests in `clips_test.go` and `api/tape_test.go`.
- [x] **Node:** `groupMove` in `geometry.js`, tested.
- [x] **Page:** `state.multi`; `picks`, `startMulti`, `endMulti`,
  `toggleMulti`, `renderMulti`, `keyed`; `moveClips`, `removeClips`,
  `copyClips`, `duplicateClips`, `reverseClips`, `moveHere`; the group in
  `state.slide` with `groupMove`, each landing box and outlined lane; the
  picked outline; `laneTap` toggles with several or Shift; keys.
- [x] **HTML/CSS:** `#multi-bar` in the dock, *Select more* in the sheet.
- [x] **Docs:** `api.md` (copy with clips, move, remove, duplicate, reverse
  with clips); guide §8.2 keys, §8.5 *Several clips at once* and checks;
  `TIPS` and §9.
- [x] **Smoke:** the several-clips run.
- [x] `sw.js` v41.
