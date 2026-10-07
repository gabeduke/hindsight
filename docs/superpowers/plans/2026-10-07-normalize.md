# Normalize on share (C5) — implementation plan

**Goal:** Share a take, or a part of one, as loud as it can go without
clipping, and hear it that loud first.

**Spec:** `docs/superpowers/specs/2026-10-07-normalize-design.md`

## Global Constraints

- The peak comes from the peaks pyramid. No audio is read when the pyramid
  is there.
- −1 dBFS, at most +24 dB.
- What's heard with Level on is what's shared.
- `sw.js` goes to `v51`.

---

- [x] **Go:**
  - `level.go`: `LevelOf`, `levelFor`, `NormalizePeakDB` and
    `MaxNormalizeGainDB`;
  - `RenderArgs` and `RenderMP3` take `gainDB`;
  - `/api/render` takes `normalize`, and there's a new `GET /api/level`.
  - Tests: `level_test.go`, `api_test.go`.
- [x] **Clock:** `setGain`, routing through a GainNode on first use; the
  slice engine goes through it too.
- [x] **Take page:**
  - `#level`, with `fetchLevel` (following the selection), `renderLevel`
    and the `wave.level` pref;
  - Share sends `normalize=1` and toasts the gain;
  - `gainText`, tested.
- [x] **Docs:** guide §4 with a check; a `TIPS` and §9 row; api.md.
- [x] **Smoke** (`smoke-takes.mjs`): Level on, playing, Share, off.
- [x] `sw.js` v51.
