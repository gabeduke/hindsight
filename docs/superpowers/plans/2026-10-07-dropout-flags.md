# Dropout flags (C4) — implementation plan

**Goal:** A take says where the capture lost audio in it.

**Spec:** `docs/superpowers/specs/2026-10-07-dropout-flags-design.md`

## Global Constraints

- The delivery path stays lock-free and allocation-free.
- Dropouts aren't flags: their own field, never edited, never counted.
- `sw.js` goes to `v50`.

---

- [x] **Go: capture** (`capture.go`):
  - `dropouts` ring, `dropN`, `lastDrop` and `overflows`;
  - `markDropout` at both drop sites, and on a rise in `InputOverflows`;
  - `Dropouts(start, end)`.
- [x] **Go: sidecar and take:** `Meta.Dropouts`, `Take.Dropouts`.
- [x] **Go: saving:**
  - `stampDropouts` in `Save` and `SaveRange`;
  - `Cut` keeps the ones inside it.
- [x] **Go: demo:**
  - `demoSource.Overflows` and `Overflow`;
  - `overflowOnSignal` (SIGUSR1, unix only) in `cmd/hindsight`.
- [x] **Go tests:** `dropout_test.go`.
- [x] **Pages:**
  - the take page's ruler marks (`view.js`), its header line, and the
    flags list;
  - the cassette sticker and the pane's line;
  - `dropoutsText`.
- [x] **Docs:** guide §4 with a [demo] and a [rig] check, §10, and
  api.md.
- [x] **Smoke** (`smoke-takes.mjs`) with `HINDSIGHT_PID`.
- [x] `sw.js` v50.
