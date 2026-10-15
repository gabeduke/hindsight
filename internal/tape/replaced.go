package tape

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// The one replaced grab (docs/superpowers/specs/2026-10-15-flow-design.md,
// decision 9). With the crate off the rooms' screens, GRAB's safety net is an
// Undo: a grab that replaces a buffer nobody dropped or kept holds that
// buffer aside, a single slot, and Undo puts it back. A second replacement
// overwrites the slot, so only one is ever kept and each lets go of the last
// (its audio is the clean-up's, no root refers to it); it is not a growing
// crate. The crate itself is untouched: the slot is written next to whatever a
// replacement did before, and only a request that says NoCrate skips the crate.

// Replaced is the slot: the buffer that was replaced, and By, the Created of
// the buffer that replaced it, so that Undo only acts while that buffer is
// still the clipboard.
type Replaced struct {
	Board *Clipboard `json:"board"`
	By    time.Time  `json:"by"`
}

func (s *Store) replacedPath() string { return filepath.Join(s.dir, "clipboard-replaced.json") }

// loadReplaced reads the slot, or nil when it is empty.
func (s *Store) loadReplaced() (*Replaced, error) {
	b, err := os.ReadFile(s.replacedPath())
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var r Replaced
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, fmt.Errorf("the replaced buffer: %w", err)
	}
	if r.Board.Empty() {
		return nil, nil
	}
	return &r, nil
}

// saveReplaced puts old in the slot, whatever was there let go, as the buffer
// that the one created at `by` replaced. The stale-ring flag is worked out as
// it's read and never kept.
func (s *Store) saveReplaced(old *Clipboard, by time.Time) error {
	cp := *old
	if cp.Grab != nil && cp.Grab.Stale {
		g := *cp.Grab
		g.Stale = false
		cp.Grab = &g
	}
	b, err := json.MarshalIndent(Replaced{Board: &cp, By: by}, "", "  ")
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeSynced(s.replacedPath(), b)
}

func (s *Store) clearReplaced() {
	s.mu.Lock()
	defer s.mu.Unlock()
	os.Remove(s.replacedPath())
}

// RestoreReplaced is GRAB's Undo: the buffer the last grab replaced goes back
// on the clipboard, and the grab it undoes is dropped. It empties the slot, so
// a second Undo has nothing to do; and it refuses (ErrNothingToDo) when the
// clipboard is no longer the buffer that replaced it -- tossed, cleared or
// replaced again -- since there is then nothing for an Undo to be of. by is the
// Created of the grab whose toast offered the Undo; the zero time takes
// whichever grab is the latest, and one that isn't the latest is refused, so a
// toast from the grab before cannot bring back the wrong buffer.
func (e *Engine) RestoreReplaced(by time.Time) (*Clipboard, error) {
	e.boardMu.Lock()
	defer e.boardMu.Unlock()
	r, err := e.store.loadReplaced()
	if err != nil {
		return nil, err
	}
	if r == nil {
		return nil, fmt.Errorf("%w: no grab was replaced to bring back", ErrNothingToDo)
	}
	cur, err := e.store.LoadClipboard()
	if err != nil {
		return nil, err
	}
	if cur.Empty() || !cur.Created.Equal(r.By) || (!by.IsZero() && !by.Equal(r.By)) {
		return nil, fmt.Errorf("%w: the buffer has moved on since that grab", ErrNothingToDo)
	}
	if err := e.store.SaveClipboard(r.Board); err != nil {
		return nil, err
	}
	e.store.clearReplaced()
	return e.markStale(r.Board), nil
}
