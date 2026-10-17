# Build Plan: Feed Source Selector & Persistent Buffer Toggle

**Date:** 2026-10-17  
**Branch:** `feed-source-picker` (in worktree `.claude/worktrees/buffer-feed`)  
**Spec:** `docs/superpowers/specs/2026-10-17-feed-source-and-buffer-toggle-design.md`  

## Steps

### Step 1: Persistent Buffer Expand/Collapse Toggle
1. In `web/static/shell.html` (and `index.html` template if present):
   - Update `.buffer-reopen` attributes: ensure `aria-expanded` and clear initial state.
2. In `web/static/lib/buffer/buffer.js`:
   - Keep `el.reopen.hidden = false` whenever `st.board` / grab exists (or allow toggling even with empty buffer if preferred; if no grab exists, keep hidden until there is a board to display, or show empty buffer).
   - In `render()`:
     - When `st.open` is true: update label to `Buffer ▾`, `aria-expanded="true"`, `aria-pressed="true"`, remove `hidden`.
     - When `st.open` is false: update label to `Buffer ▴`, `aria-expanded="false"`, `aria-pressed="false"`.
   - Update click handler on `el.reopen`:
     - If `st.open` is true: call `close()` (collapses drawer).
     - If `st.open` is false: set `st.open = true; st.dropped = ''; render(); forward();` (expands drawer).
3. Test in `web/static/lib/buffer/`:
   - Add unit tests verifying toggle behavior on `el.reopen`.

### Step 2: Feed Input Source Selector
1. In `web/static/lib/device-prefs.js`:
   - Add per-device preference: `feedSource` (default `'main'` or first available).
2. In `web/static/shell.html`:
   - Add `.buffer-feed-sources` container to `buffer-grab-tpl` (between unit and Grab button, or neatly alongside bars).
3. In `web/static/lib/buffer/buffer.js`:
   - Render the feed source chips (`main`, `ch1`, `ch2`, `aux`) in `el.feedSources`.
   - Wire click handler to switch active source and persist to `device-prefs`.
   - `sources()` reads `st.chosen || [readPref('feedSource')] || [armed]`.
   - When Grab is pressed, it captures with the explicitly chosen source.
4. Test:
   - Add unit tests for source selection, persistence, and Grab payload.

### Step 3: Service Worker Cache & Full Test Suite
1. Bump `CACHE` in `web/static/sw.js`.
2. Run full test suite:
   ```sh
   node --test ...
   gofmt -l . && go vet ./... && go test ./...
   ```
3. Commit and PR to main.
