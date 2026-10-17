# User Flows Validation Framework Implementation Plan

**Date:** 2026-10-17 · **Status:** proposed · **Spec:** [2026-10-17 User Flows Spec](../specs/2026-10-17-user-flows-validation-framework-design.md)

---

## 1. Overview

Build an automated end-to-end user-flow validation harness in `scripts/smoke-flows.mjs` using Playwright against the local demo server.

---

## 2. Steps to Build

### Step 1: Framework Harness (`scripts/flows/harness.mjs`)
- Helper functions to manage the browser context and test assertions:
  - `launchBrowser(options)`: Launches Chromium with touch/tablet emulation and sound-friendly autoplay args.
  - `bootDemoServer()`: Automatically spins up `cmd/hindsight --demo` if no `HINDSIGHT_URL` is set, or attaches to existing.
  - `check(name, passed, detail)`: Records pass/fail, error stacks, and timing for reporting.
  - `formatReport(results)`: Formats output table for terminal/markdown.

### Step 2: Implement Core Flows
- **`flow-1-ingest.mjs`**: Capture 15s selection from live feed ribbon, save as take, navigate to shelf, verify new take appears.
- **`flow-2-persistent-player.mjs`**: Start take in Listening Room, switch to Studio via router, verify continuous audio and matching playhead, switch back.
- **`flow-3-studio-transport.mjs`**: Start tape playback in Studio, verify 60fps playhead tick, toggle transport collapse (`#np-fold-btn`) and lanes collapse (`#tracks-fold-btn`).
- **`flow-4-curation.mjs`**: Open inline sketchbook (`✎`) during playback, star take, add tag, verify shelf row updates instantly without audio interruption.
- **`flow-5-global-modals.mjs`**: Open Settings sheet from both rooms, open Phone recording sheet from Capture, verify clean setup and tear down.

### Step 3: Master Runner (`scripts/smoke-flows.mjs`)
- Single command entry point:
  ```sh
  node scripts/smoke-flows.mjs [flow-name]
  ```
- Exits code 0 on all passes, code 1 on any failure.

### Step 4: AGENTS.md Guardrail
- Add workflow instruction to `AGENTS.md` requiring agents to run and include flow results in reports.
