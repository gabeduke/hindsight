# Slide onto another track (A2) — implementation plan

**Goal:** A held clip can be dragged onto another track.

**Spec:** `docs/superpowers/specs/2026-10-07-slide-tracks-design.md`

## Global Constraints

- `track` in an edit stays the selected track; the destination is `to`.
- Half a lane before the track changes; one undo per slide.
- `sw.js` → `v39`; `TIPS` and guide §9 match.

---

- [x] **Go:** `EditRequest.To`; `State.slide(id, at, to, length)` places on
  `to` (0: its own); `ErrNoSuchTrack` past the tracks. Tests in
  `edit_test.go` and `api/tape_test.go`.
- [x] **Module:** the `slide` effect gains `dy`; `laneShift`, `targetTrack`,
  tested.
- [x] **Page:** `state.slide.to`; `lanePitch`, `markTarget`; the ghost on the
  target lane; `slide(clip, at, from, to)` selects the new track and toasts
  it; `.drop-target` outline in `styles.css`.
- [x] **Docs:** `api.md` slide row; guide §8.5 Slide row and checks; *A
  lane* tip.
- [x] **Smoke:** a lane down, outlined, lands; ↶.
- [x] `sw.js` v39.
