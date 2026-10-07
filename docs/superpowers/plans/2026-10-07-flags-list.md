# A flags list, and ↺ 5 s (C3) — implementation plan

**Goal:** Find and play from a take's flags by name, and hear a bit again
with one key.

**Spec:** `docs/superpowers/specs/2026-10-07-flags-list-design.md`

## Global Constraints

- No new API.
- The flags list reuses `flagChips` and the pane's chip look.
- `sw.js` goes to `v49`. `TIPS` and guide §9 match.

---

- [x] **Take page:**
  - `#flags-list` (⚑ N) and the `#flags-sheet` dialog;
  - `openFlags` builds the list from `flagChips`;
  - the count is kept in `redraw`;
  - `#back5` in the transport, and `back5()` with J.
- [x] **Bar** (`lib/bar/bar.js`): `#np-back5` on Capture and Takes, and J,
  for whatever source the bar holds.
- [x] **Tape page:** J locates five seconds back.
- [x] **Styles:** the list, one flag to a line, scrolling.
- [x] **Docs:** guide §3, §4 and §8.2, with checks; two `TIPS` and §9 rows.
- [x] **Smoke** (`smoke-takes.mjs`):
  - the count;
  - the list;
  - a tap plays;
  - J;
  - the takes bar's ↺ 5 s.

  `smoke-tape.mjs` checks J.
- [x] `sw.js` v49.
