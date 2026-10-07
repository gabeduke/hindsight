# Clip fades (A5) — implementation plan

**Goal:** A clip fades in and out over a chosen length, equal-power.

**Spec:** `docs/superpowers/specs/2026-10-07-clip-fades-design.md`

## Global Constraints

- Fades are lengths from a clip's ends; every edit that makes a new end
  drops the fade there.
- The declick and crossfade still apply underneath.
- `sw.js` → `v44`; `TIPS` and guide §9 match.

---

- [x] **Go:** `Clip.FadeIn/FadeOut`, `fades`, `fadeGain` (`model.go`); the
  mix (`render.go`); `cutRange`, `window`, `split`, `join`, reverse,
  `placeWrapped`; `ClipWAV`. Tests in `fades_test.go`.
- [x] **API:** `patchFades` for `PATCH /api/tapes {clip: {fade_in,
  fade_out}}`; test.
- [x] **Node:** `fadeOptions`, `fadeOption`, `clipFades`, tested.
- [x] **Page:** the sheet's fade rows (`renderFades`, `setFade`); `drawFades`.
- [x] **Docs:** `api.md`; guide §8.5 and checks; `TIPS` and §9.
- [x] **Smoke:** a beat's fade in, and off.
- [x] `sw.js` v44.
