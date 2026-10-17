# Design Spec: Feed Source Selector & Persistent Buffer Toggle

**Date:** 2026-10-17  
**Author:** Gabe & Antigravity  
**Status:** In Progress  

## Context & Motivation

In a live jam space with multi-channel USB audio interfaces (such as the Teenage Engineering EP-136 KO Sidekick), live instruments are plugged into specific hardware channel strips (e.g. `ch1` on jack 1, `ch2` on jack 2).

Hindsight's primary strength is the retroactive workflow:
1. Jam freely in the room.
2. Tap **GRAB** to copy the last $N$ bars into the clipboard buffer.
3. Shape / trim the buffer.
4. **DROP** the buffer onto a tape lane.

### The Problems

1. **Hidden Source Picker / Default to `main`:**
   - Before hitting GRAB, the user cannot see or choose which source (`main`, `ch1`, `ch2`, `aux`) will be captured.
   - When no track is armed on the tape, `sources()` in `buffer.js` defaults to `main`.
   - `main` is a digital sum of all channel strips PLUS the USB playback returns from the tape lanes. Capturing `main` captures unwanted tape bleed along with the instrument.
   - The source chips (`main`, `ch1`, `ch2`, `aux`) only appear inside the buffer panel *after* a grab has already been executed.

2. **Jumping / Disappearing Buffer Reopen Button:**
   - When the buffer panel is closed, a button `.buffer-reopen` (`Buffer ▴`) sits in the Grab row.
   - Tapping it opens the buffer drawer, but `.buffer-reopen` is immediately set to `hidden = true` (disappears).
   - Closing the buffer requires locating a separate `✕` button (`#buffer-close`) in the expanded panel's header.
   - This prevents intuitive muscle memory: the button you tapped to open the drawer vanishes instead of letting you tap the exact same spot to collapse it.

---

## Design

### 1. Persistent Buffer Expand/Collapse Toggle (`Buffer ▴` / `Buffer ▾`)

- **Anchor:** The toggle button stays anchored in the grab toolbar (`.buffer-grab`) at all times.
- **States:**
  - When the buffer drawer is **closed**: Label is `Buffer ▴`, `aria-expanded="false"`, `aria-pressed="false"`.
  - When the buffer drawer is **open**: Label is `Buffer ▾`, `aria-expanded="true"`, `aria-pressed="true"`, styled with active state (`.on` or `aria-pressed`).
- **Action:** Clicking it when closed opens the drawer; clicking it when open closes the drawer.
- **Preserved Controls:** The `✕` (`#buffer-close`) button inside `.buffer-head` remains for mobile drawer dismissal, but the toolbar button never hides or shifts position.

### 2. Feed Input Source Picker on the Studio Header

- **Placement:** Positioned in the Feed / Grab bar (alongside `Last [ 1 | 2 | 4 | 8 ] bars` and `Grab`).
- **Markup:** A compact segment or pill group displaying the available capture sources: `[main | ch1 | ch2 | aux]`.
- **Behavior:**
  - Active source is highlighted with aria-pressed and signal LED (using live levels from `SOURCES`).
  - Clicking a source sets `st.chosen = [name]` immediately and persists the preference in device storage (`device-prefs.js` / `localStorage`).
  - When the user presses **GRAB**, the grab request (`POST /api/grab`) explicitly passes `{ sources: st.chosen }`.
  - If the buffer drawer is currently open with an active grab, toggling the source continues to re-grab that span from the selected source (preserving existing `toggleSource` behavior).

---

## Verification & Guardrails

- `web/static/lib/buffer/keys.test.js` & `web/static/lib/buffer/buffer.js` unit tests:
  - Verify clicking `Buffer ▴` toggles open; clicking `Buffer ▾` in the same element toggles closed.
  - Verify selecting a feed source updates `sources()` before any grab is made.
  - Verify storage persistence of the chosen feed source across reloads.
- Architectural Guardrails (`architecture.test.js`):
  - No DOM scraping or synthetic clicks.
  - No new package dependencies.
  - Service worker cache bump (`CACHE = 'hindsight-shell-vNNN'`).
