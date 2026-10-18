# Phase 2: The Cue Lane Design

- **Date:** 2026-10-17
- **Status:** Proposed
- **Author:** Antigravity
- **Builds on:** [2026-10-16-shell-player-and-cue-lane-design.md](2026-10-16-shell-player-and-cue-lane-design.md) §2

## Context & Purpose

The Cue Lane sits directly above tracks 1–4 in the Studio multitrack view. It provides a non-destructive staging ground for audio material:
1. Material can be "thrown" onto the Cue Lane from the Shelf (a take), the Buffer sheet (a grabbed span from the feed), or lifted from a tape track.
2. The user can audition and loop the material in synchronization with the tape clock before committing it to a track.
3. The **Cue** solo button allows listening to the cue lane exclusively without tape track playback.
4. The user can drag staged clips down from the cue lane directly onto any tape track (tracks 1–4). Dropping copies the clip onto the tape timeline; the staged cue clip remains on the Cue Lane until dismissed.

## Architecture & Data Model

### 1. Backend Persistence (`internal/tape/` & `internal/api/`)

The cue lane belongs to the active tape session and persists across reloads via `/api/tapes/state`.

In `internal/tape/model.go`:
```go
type State struct {
    Grid     *Grid     `json:"grid"`
    Loop     Loop      `json:"loop"`
    Tracks   []Track   `json:"tracks"`
    Cue      *CueLane  `json:"cue,omitempty"`
    Sections []Section `json:"sections,omitempty"`
    Style    *Style    `json:"style,omitempty"`
}

type CueLane struct {
    Solo   bool      `json:"solo,omitempty"`
    GainDB float64   `json:"gain_db,omitempty"`
    Clips  []CueClip `json:"clips"`
}

type CueClip struct {
    ID      string  `json:"id"`
    File    string  `json:"file"`
    Name    string  `json:"name,omitempty"`
    Src     int64   `json:"src"`
    Frames  int64   `json:"frames"`
    Loop    bool    `json:"loop"`
    GainDB  float64 `json:"gain_db,omitempty"`
    Source  string  `json:"source,omitempty"`
    FadeIn  int64   `json:"fade_in,omitempty"`
    FadeOut int64   `json:"fade_out,omitempty"`
}
```

### 2. Cue Operations (`internal/tape/cue.go` & `EditRequest`)

Extend `EditRequest` with cue ops:
- `cue-add`: adds a clip to the cue lane (`File`, `Frames`, `Src`, `Loop`, `GainDB`, `Name`).
- `cue-remove`: removes a clip from the cue lane by `Clip` ID.
- `cue-set`: updates clip parameters (e.g. `Loop`, `GainDB`, `FadeIn`, `FadeOut`).
- `cue-solo`: toggles or sets `Solo` on the cue lane.
- `cue-to-track`: copies a cue clip to `Track` at `At` tape frame.

### 3. Studio UI Layout (`web/static/` & `web/static/lib/tape/`)

- **Alignment:** Sits immediately above track 1.
- **Lane Head (`.cue-head`):**
  - Width: `var(--lane-head)` (160px or 200px at 1400px+), exactly matching `.tt-head` and `.studio-feed` VU meters.
  - Controls: `CUE` label, **Cue** solo toggle button (lit cyan/blue when active), and optional level trim.
- **Lane Track (`.cue-lane`):**
  - Grid column 2 (`1fr`), column gap `6px`.
  - Renders cue chips/cards with title, length, loop toggle badge (`⟲`), play trigger, and drag handle.
- **Drag-to-Tape Gesture:**
  - Pointer down on a cue clip initiates drag mode.
  - Dragging down targets tracks 1–4 with drop ghosts and target track highlight.
  - On pointer release, issues `cue-to-track` edit to place the clip onto the tape track at the target timeline frame.
