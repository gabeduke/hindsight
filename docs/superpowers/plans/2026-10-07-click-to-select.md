# Click to select — implementation plan

**Goal:** A click on a clip selects it and nothing pops up; a bar and the
keyboard act on what's selected.

**Spec:** `docs/superpowers/specs/2026-10-07-click-to-select-design.md`

## Global Constraints

- One tap selects. The sheet is Details…, a double-click or Enter.
- Every action on the bar is one undo, as it was from the sheet.
- On a phone the bar is on screen, above the player.
- `sw.js` goes to `v52`.

---

- [x] **Model:** `lib/tape/selection.js` with `selection.test.js`;
  `keyStep` in `geometry.js`, tested.
- [x] **Page (`page.js`):**
  - `setSel`, `picks`, `letGo`, `toggleClip`, `selectAll` and
    `renderClipBar` replace `startMulti`, `endMulti`, `toggleMulti` and
    `renderMulti`;
  - `laneTap` selects; a `dblclick` opens the sheet;
  - Escape, Enter, ← →, ⌘A;
  - the bar's keys;
  - `revealPicked` for a phone.
- [x] **Markup and style:**
  - `tape.html`: the clip bar as a toolbar with its keys, and no Select
    more in the sheet;
  - `styles.css`: the bar's keys wrap, or on a narrow screen scroll;
  - on a phone the bar floats over the player, and is one row on its side.
- [x] **Docs:**
  - guide §8.2 *Selecting clips* and its [demo] checks;
  - `TIPS` and §9 rows for the bar's keys.
- [x] **Smoke** (`smoke-tape.mjs`): the clip block reworked; phone
  placement; ⌘A.
- [x] `sw.js` v52 with `selection.js`.
