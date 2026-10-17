# Phase 2: The Cue Lane Implementation Plan

- **Goal:** Implement the Cue Lane backend store, tape edits, and Studio UI integration.
- **Spec:** `docs/superpowers/specs/2026-10-17-cue-lane-design.md`

## Proposed Changes

### Step 1: Go Backend Data Model & Operations
1. **`internal/tape/model.go`**
   - Add `CueLane` and `CueClip` structs.
   - Add `Cue *CueLane` field to `State`.
   - Update `State.clone()` to deep-copy `Cue`.
2. **`internal/tape/cue.go`**
   - Implement `AddCueClip`, `RemoveCueClip`, `SetCueClip`, `SetCueSolo`, and `CueToTrack`.
3. **`internal/tape/edit.go`**
   - Route `cue-add`, `cue-remove`, `cue-set`, `cue-solo`, and `cue-to-track` operations through `EditRequest`.
4. **`internal/tape/cue_test.go`**
   - Write tests for cue operations, undo/redo preservation, and persistence across serialization.

### Step 2: Go API Endpoint Integration
1. **`internal/api/tape.go`**
   - Ensure `/api/tapes/state` includes `cue` in the JSON response.
   - Verify `POST /api/tapes/edits` accepts cue edit requests.
2. **`internal/api/tape_test.go`**
   - Add integration tests for cue operations through the HTTP API.

### Step 3: Frontend CSS & Markup
1. **`web/static/styles.css`**
   - Add `.cue-row`, `.cue-head`, `.cue-lane`, and `.cue-clip` classes with identical column dimensions (`var(--lane-head) 1fr`, gap `6px`) to `.tape-track`.
2. **`web/static/sw.js`**
   - Bump `CACHE` from `v143` to `v144`.

### Step 4: Verification
1. Run `go test -race ./internal/tape/... ./internal/api/...`.
2. Run `node --test 'web/static/lib/*.test.js' ...`.
