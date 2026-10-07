# Split here on a take (B2) — implementation plan

**Goal:** A take's More menu splits it at the playhead into two clips on the
crate, leaving the take as it is.

**Spec:** `docs/superpowers/specs/2026-10-07-split-here-design.md`

## Global Constraints

- The take's file is never written. Both clips go on the crate in one change.
- `sw.js` → `v43`; `TIPS` and guide §9 match.

---

- [x] **Go:** `takeClip` out of `KeepTake`; `SplitTake`; tests in
  `crate_test.go`.
- [x] **API:** `POST /api/crate/split`; test in `api/tape_test.go`.
- [x] **Take page:** `#split-here` in `#more-menu`, shown with the tape on;
  the toast; the ◫ chip refreshed.
- [x] **Docs:** `api.md`; guide §4 and §8.11 checks; `TIPS` and §9.
- [x] **Smoke:** the split from the take page.
- [x] `sw.js` v43.
