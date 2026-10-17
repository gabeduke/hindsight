# Build Plan: Collapsible Media Player Transport Bar

**Date:** 2026-10-17  
**Branch:** `studio-player-layout`  
**Spec:** `docs/superpowers/specs/2026-10-17-collapsible-transport-bar-design.md`  

## Steps

### Step 1: Markup in `web/static/shell.html`
- Inside `#np .np-own` (next to `#catch-pass` and `#np-eject`):
  Add `#np-fold-btn`:
  ```html
  <button id="np-fold-btn" class="icon-btn np-fold-btn" type="button" aria-expanded="true" aria-controls="np" aria-label="Collapse transport" data-tip="np-fold"><span class="np-fold-glyph" aria-hidden="true">▾</span></button>
  ```

### Step 2: Controller & Persistence in `web/static/lib/bar/`
- In `web/static/lib/bar/player.js` (or `web/static/lib/bar/bar.js`):
  - Add `initTransportFold(doc = document, storage = sessionStorage)`:
    - Target `#np-fold-btn`.
    - Apply saved state from `storage.getItem('hindsight.npFold')`.
    - Handle click event:
      - Toggle `body.np-fold`.
      - Update `aria-expanded` and `aria-label`.
      - Update glyph (`▾` vs `▴`).
      - Persist state to `storage`.
  - Wire `initTransportFold` during `NowPlaying` initialization in `web/static/lib/bar/bar.js`.

### Step 3: CSS in `web/static/styles.css`
- Add desktop styles for `#np-fold-btn` and `body.np-fold`:
  - On mobile (`max-width: 699.98px`): `#np-fold-btn { display: none; }`.
  - On desktop (`min-width: 700px`):
    - `.np-fold-btn`: styled cleanly matching `.icon-btn`, sized 36px–40px.
    - `body.np-fold`:
      - `--np-h: 46px;`
      - `#np`: reduced padding and gap.
      - `#np .np-row-2`: `display: none;`
      - `#np .np-row-1`: reduced height to ~38px.
      - `#np .np-window`: compact reels and LCD.
      - `#np .np-keys .icon-btn`: compact 36px buttons.
      - `#np .np-catch`: compact single-line or compact button.
      - `#np-dock`: height automatically shrinks, letting `main.tape-main` expand.

### Step 4: Unit & Architecture Tests
- Create unit test in `web/static/lib/bar/fold.test.js`:
  - Verifies toggle behavior, aria attributes, glyphs, and sessionStorage persistence.
- Update `architecture.test.js` or `paths.test.js` if necessary.

### Step 5: Service Worker Cache & Full Test Suite
- Bump `CACHE` in `web/static/sw.js`.
- Run:
  - `node --test 'web/static/lib/*.test.js' 'web/static/lib/bar/*.test.js' ...`
  - `gofmt -l . && go vet ./... && go test -race ./...`
- Verify against demo.
