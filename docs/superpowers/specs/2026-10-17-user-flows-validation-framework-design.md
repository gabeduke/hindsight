# User Flows Validation Framework Design

**Date:** 2026-10-17 · **Status:** proposed · **Repo:** `hindsight`  
**Author:** Gabe Duke & AI Pair  
**Builds on:** [2026-10-15 Walkthrough](../2026-10-15-walkthrough.md), [2026-10-16 Shell Player Spec](2026-10-16-shell-player-and-cue-lane-design.md), and [2026-10-17 Handoff](../2026-10-17-handoff.md).

---

## 1. Why

During recent refactors (the Shell and Unified Media Player), the codebase suffered from "one-shotting" implementations:
- Isolated commits fixed specific unit tests or narrow prompts while introducing cross-view regressions (unclosed `<main>` tags, broken template dependencies, reversed arguments, audio cutouts on navigation).
- `node --test` passed 1,700+ tests because the test suite primarily exercises pure algorithmic math (waveform binning, geometry clamping, MIDI note math), while view lifecycles and real user interactions had zero end-to-end integration coverage.
- PRs were merged having never been rendered in a real browser.

To solve this permanently, we establish a **User Flows Validation Framework**:
A suite of human-readable, executable user journeys that run headless against the demo server (`cmd/hindsight --demo`). Every agent working on frontend refactors or features will be required to run this framework and report the results before submitting a PR.

---

## 2. Core User Flows to Validate

These flows represent the primary interaction paths of Hindsight across the two rooms and the shell:

### Flow 1: Capture, GRAB & Shelf Discovery (The Ingest Loop)
1. **Start:** User opens Hindsight at `/` (Capture / Studio with tape on).
2. **Gesture:** User selects a 15-second span on the live feed ribbon (`.viz-wrap`).
3. **Action:** User taps **Save as take** (`.rb-sel-save`) or **GRAB** (`.buffer-grab`).
4. **Verification:**
   - Toast notification appears confirming the take was saved.
   - User navigates to the Listening Room (`/takes.html`) via the tab navigation (`a[data-tab="room"]`).
   - The newly created take is visible at the top of the shelf with fresh styling.
   - Zero console errors or unhandled promise rejections.

### Flow 2: Gapless Persistent Playback Across Rooms (The Unified Player)
1. **Start:** User is in the Listening Room (`/takes.html`).
2. **Action:** User taps a cassette/take to play it in the now-playing bar (`#np`).
3. **Verification (Pre-switch):**
   - Media player `#np` is visible; `#np-play` displays `❚❚` (pause).
   - Time counter `#np-time` increments smoothly.
4. **Action:** User clicks the **Studio** tab (`a[data-tab="studio"]` / `/tape.html`).
5. **Verification (Post-switch):**
   - Navigation completes via SPA pushState (`router.go`) without page reload.
   - `#np` stays mounted; audio continues playing without interruption.
   - `#np-play` remains `❚❚`; time continues advancing.
   - Switch back to **Listening Room**: audio continues playing uninterrupted.

### Flow 3: Studio Tape Transport, Zoom & Collapsible Deck
1. **Start:** User is in the Studio (`/tape.html`).
2. **Action:** User starts tape playback via `#np-play` or Spacebar.
3. **Verification:**
   - Transport begins running; playhead on tape ruler (`#tape-ruler`) advances at 60fps.
4. **Action:** User toggles the transport bar collapse button (`#np-fold-btn`) and lane fold (`#tracks-fold-btn`).
5. **Verification:**
   - Decks fold/unfold cleanly without throwing errors or breaking playhead tracking.
   - Fold states persist in `sessionStorage` (`hindsight.npFold`, `hindsight.tracksFold`).

### Flow 4: Inline Sketchbook & Non-Destructive Curation
1. **Start:** A take is playing in the bar.
2. **Action:** User taps the annotate button (`#np-note` / `✎`).
3. **Verification:**
   - Inline sketchbook / note drawer opens directly within the current room without navigating to a separate page or stopping playback.
4. **Action:** User toggles Star (`★`) and adds a tag.
5. **Verification:**
   - Shelf row immediately reflects the new star and tag metadata.

### Flow 5: Global Modals & System Tools (The Scoping Check)
1. **Action:** User opens **Settings** (`#appbar-settings-btn`) from the Listening Room, then from the Studio.
2. **Verification:**
   - `#settings-sheet` opens cleanly in both rooms without requiring template scavenging or throwing null references.
   - Settings form fields populate correctly; Cancel/Close dismisses the dialog.
3. **Action:** User opens **Releases** (`#appbar-releases-btn`) and **Phone Recorder** (`#phone-sheet`).
4. **Verification:**
   - Both sheets open, initialize their listeners and meters without errors, and close cleanly.

---

## 3. Implementation Design

### File Location
- **Runner Script:** `scripts/smoke-flows.mjs`
- **Flow Definitions:** `scripts/flows/`
  - `flow-1-ingest.mjs`
  - `flow-2-persistent-player.mjs`
  - `flow-3-studio-transport.mjs`
  - `flow-4-curation.mjs`
  - `flow-5-global-modals.mjs`
- **Shared Helpers:** `scripts/flows/harness.mjs`

### Execution Modes
1. **Against an existing server (CI / local dev):**
   ```sh
   HINDSIGHT_URL=http://127.0.0.1:5173 node scripts/smoke-flows.mjs
   ```
2. **Self-booting demo:**
   If `HINDSIGHT_URL` is omitted, the script automatically boots:
   ```sh
   RING_SECONDS=120 CGO_ENABLED=0 go run ./cmd/hindsight --demo
   ```
   on a free ephemeral port, runs the flows, and shuts down the process cleanly on exit.

### Viewport & Platform Matrix
Each flow executes against two standard profiles:
- **Tablet / Touch:** 1024×768 (Android tablet / iPad touch viewport)
- **Desktop:** 1440×900 (Laptop mouse/keyboard viewport)

### Reporting Output
The runner outputs a clean markdown/terminal summary table:
```
┌────────────────────────────────────────┬─────────┬────────┬──────────┐
│ Flow                                   │ Profile │ Result │ Duration │
├────────────────────────────────────────┼─────────┼────────┼──────────┤
│ 1. Ingest (Feed -> Grab -> Shelf)      │ Tablet  │ PASS   │ 2.4s     │
│ 2. Persistent Gapless Playback         │ Laptop  │ PASS   │ 3.1s     │
│ 3. Studio Tape Transport & Collapse    │ Laptop  │ PASS   │ 1.8s     │
│ 4. Inline Sketchbook & Curation        │ Tablet  │ PASS   │ 1.2s     │
│ 5. Global Modals & System Tools        │ Both    │ PASS   │ 0.9s     │
└────────────────────────────────────────┴─────────┴────────┴──────────┘
Summary: 5/5 flows passed (0 failures).
```

---

## 4. Requirement in `AGENTS.md`

We will add a rule to [`AGENTS.md`](file:///Users/gabeduke/repos/hindsight/AGENTS.md):
> **UI changes must validate against the User Flows suite before submitting:**
> Run `node scripts/smoke-flows.mjs` against the demo server. The PR description must include the flow validation report.
