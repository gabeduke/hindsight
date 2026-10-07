# Drag to repeat (A3) — implementation plan

**Goal:** Drag a picked clip's ⟳ corner to lay copies end to end.

**Spec:** `docs/superpowers/specs/2026-10-07-drag-repeat-design.md`

## Global Constraints

- One `repeat` per drag; one undo for all its copies.
- Copies are unlinked clips of the same audio, on the lowest free layer.
- `tile` unchanged. `sw.js` → `v40`; `TIPS` and guide §9 match.

---

- [x] **Go:** `EditRequest.Count`, `MaxRepeat`, `State.repeat`; the `repeat`
  op. Tests in `edit_test.go` and `api/tape_test.go`.
- [x] **Node:** `repeatRoom`, `repeatCount`, `MAX_REPEAT` in `geometry.js`,
  tested.
- [x] **Page:** `gripsOf` adds `repeat`; `state.repeat`; `gripHeld()` for
  the pan, pinch, follow and touchmove; `repeatClip`; `drawRepeats` (ghosts,
  ×N) and the ⟳ in `drawGrips`, the pills below it.
- [x] **Docs:** `api.md` repeat row; guide §8.5 Repeat row and checks; *A
  lane* tip.
- [x] **Smoke:** the corner lays a copy; ↶.
- [x] `sw.js` v40.
