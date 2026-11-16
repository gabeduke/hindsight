package tape

import (
	"errors"
	"os"
	"testing"
	"time"
)

// F3 of the flow spec: the crate leaves the screen, so the safety net for a
// buffer replaced before anyone used it is an Undo, and the Pi keeps exactly
// one replaced buffer for it -- not a growing crate. Since GRAB went to the
// cue lane, what fills the clipboard is a copy: a range's Cut or Copy, or a
// copy off the ribbon or a take.

// copySpan copies ring frames [from, to) of AUX onto the clipboard, as the
// ribbon's Copy does.
func copySpan(t *testing.T, e *Engine, from, to int64) *Clipboard {
	t.Helper()
	c, _, err := e.CopyRing(from, to, "aux")
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func ageFiles(t *testing.T, e *Engine, c *Clipboard) {
	t.Helper()
	old := time.Now().Add(-time.Hour)
	for _, tr := range c.Tracks {
		for _, cl := range tr {
			if err := osChtimes(e.store.AudioPath(cl.File), old); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestOneReplacedBufferIsKeptAndLetGoAtTheNext(t *testing.T) {
	e, _, _ := barLoop(t)
	a := copySpan(t, e, 100000, 148000)
	if s, _ := e.store.loadReplaced(); s != nil {
		t.Fatalf("the first copy replaced %+v", s)
	}
	// A second copy, the first never dropped: the first is kept.
	b := copySpan(t, e, 110000, 158000)
	if s, _ := e.store.loadReplaced(); s == nil || !s.Board.Created.Equal(a.Created) {
		t.Fatalf("the second copy replaced %+v, want the first", s)
	}
	if list, _ := e.CrateList("", ""); len(list) != 0 {
		t.Fatalf("the crate has %d: nothing should grow it", len(list))
	}
	// And a third: the second is kept, and the first is let go.
	c := copySpan(t, e, 120000, 168000)
	slot, err := e.store.loadReplaced()
	if err != nil || slot == nil || !slot.Board.Created.Equal(b.Created) || !slot.By.Equal(c.Created) {
		t.Fatalf("the slot holds %+v (%v): want the second copy, replaced by the third", slot, err)
	}
	// The clean-up keeps the kept one's audio and takes the let-go one's.
	ageFiles(t, e, a)
	ageFiles(t, e, b)
	ageFiles(t, e, c)
	if _, _, err := e.store.Cleanup(nil); err != nil {
		t.Fatal(err)
	}
	pool := poolNames(t, e)
	if !pool[b.Tracks[0][0].File] {
		t.Fatal("a clean-up took the replaced buffer's audio: Undo would have nothing to bring back")
	}
	if pool[a.Tracks[0][0].File] {
		t.Fatal("the buffer before it was kept too: only one is ever kept")
	}
	if !pool[c.Tracks[0][0].File] {
		t.Fatal("a clean-up took the clipboard's own audio")
	}
}

func TestOnlyAnUnusedBufferIsKept(t *testing.T) {
	e, _, tp := barLoop(t)
	copySpan(t, e, 100000, 148000)
	// Dropped, it is used: replacing it loses nothing.
	if _, err := e.DropClipboard(tp.ID, 3, false); err != nil {
		t.Fatal(err)
	}
	copySpan(t, e, 110000, 158000)
	if s, _ := e.store.loadReplaced(); s != nil {
		t.Fatalf("a dropped buffer was written to the slot: %+v", s)
	}
}

func TestAReplacedBufferComesBackAndTheSlotIsEmpty(t *testing.T) {
	e, _, _ := barLoop(t)
	a := copySpan(t, e, 100000, 148000)
	copySpan(t, e, 110000, 158000)
	got, err := e.RestoreReplaced(time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if !got.Created.Equal(a.Created) || got.Tracks[0][0].File != a.Tracks[0][0].File {
		t.Fatalf("restored %+v, want the first copy", got)
	}
	if cur, _ := e.Clipboard(); cur == nil || !cur.Created.Equal(a.Created) {
		t.Fatalf("the clipboard holds %+v", cur)
	}
	// The copy that was undone is gone from the clipboard, and there is
	// nothing left to put back: a second Undo has nothing to do.
	if _, err := e.RestoreReplaced(time.Time{}); !errors.Is(err, ErrNothingToDo) {
		t.Fatalf("a second restore: %v", err)
	}
	if _, err := os.Stat(e.store.replacedPath()); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the slot file stayed: %v", err)
	}
	// Undone, the buffer is the first copy again, unused and replaceable:
	// the next copy keeps *it*.
	copySpan(t, e, 120000, 168000)
	if s, _ := e.store.loadReplaced(); s == nil || !s.Board.Created.Equal(a.Created) {
		t.Fatalf("after Undo the next copy replaced %+v", s)
	}
}

func TestUndoRefusesOnceTheBufferHasMovedOn(t *testing.T) {
	// Nothing to put back when the buffer is no longer the one that
	// replaced it: cleared.
	e, _, _ := barLoop(t)
	copySpan(t, e, 100000, 148000)
	copySpan(t, e, 110000, 158000)
	if err := e.ClearClipboard(); err != nil {
		t.Fatal(err)
	}
	if _, err := e.RestoreReplaced(time.Time{}); !errors.Is(err, ErrNothingToDo) {
		t.Fatalf("restore after the buffer moved on: %v", err)
	}
	if after, _ := e.Clipboard(); after != nil {
		t.Fatal("a refused Undo changed the clipboard")
	}
}

func TestAnOlderUndoCannotBringBackTheWrongBuffer(t *testing.T) {
	// A toast from the second copy, tapped after a third: the Undo names the
	// copy it was offered for, and the Pi only acts for the latest.
	e, _, _ := barLoop(t)
	copySpan(t, e, 100000, 148000)
	b := copySpan(t, e, 110000, 158000)
	c := copySpan(t, e, 120000, 168000)
	if _, err := e.RestoreReplaced(b.Created); !errors.Is(err, ErrNothingToDo) {
		t.Fatalf("the second copy's Undo, after the third: %v", err)
	}
	if cur, _ := e.Clipboard(); !cur.Created.Equal(c.Created) {
		t.Fatal("a refused Undo changed the clipboard")
	}
	got, err := e.RestoreReplaced(c.Created)
	if err != nil || !got.Created.Equal(b.Created) {
		t.Fatalf("the third copy's Undo brought back %+v (%v), want the second", got, err)
	}
}

func TestATakesCopyKeepsTheOneItReplacesToo(t *testing.T) {
	e, _, _ := barLoop(t)
	a := copySpan(t, e, 100000, 148000)
	take := tempoTake(t, 1200000, 120)
	c, err := e.CopyTake(take, "jam_take.wav", 300000, 492000, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	if s, _ := e.store.loadReplaced(); s == nil || !s.Board.Created.Equal(a.Created) || !s.By.Equal(c.Created) {
		t.Fatalf("the slot = %+v, want the ribbon's copy replaced by the take's", s)
	}
	if list, _ := e.CrateList("", ""); len(list) != 0 {
		t.Fatalf("the crate has %d", len(list))
	}
}
