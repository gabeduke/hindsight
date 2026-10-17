# Studio Feed Ribbon Alignment Implementation Plan

- **Goal:** Unify `.studio-feed` grid layout with `.tape-track` and `.tape-ruler-row` to ensure pixel-perfect visual alignment.
- **Spec:** `docs/superpowers/specs/2026-10-17-studio-feed-ribbon-alignment-design.md`

## Proposed Changes

1. **`web/static/styles.css`**
   - Replace 3-column `grid-template-columns: var(--lane-head) minmax(0, 1fr) auto;` with 2-column `grid-template-columns: var(--lane-head) 1fr;`.
   - Update grid-template-areas for 700px and 1100px media queries.
   - Right-align `.studio-keys` at 1100px+ to anchor keys over the active end of the ribbon.
2. **`web/static/sw.js`**
   - Bump `CACHE` from `hindsight-shell-v141` to `hindsight-shell-v142`.
3. **Verification**
   - Run `node --test 'web/static/lib/styles.test.js' 'web/static/lib/paths.test.js'`.
   - Run full node test suite.
