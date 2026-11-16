package tape

import (
	"errors"
	"math"
	"os"
	"strings"
	"testing"
	"time"
)

// The review of F3: the one replaced buffer holds ANY unused buffer (a
// range's Cut or Copy, or a copy off the ribbon or a take), filling the
// clipboard leaves the crate alone, the slot is let go of when what it would
// undo is gone or used, and a write that fails keeps the Undo that was there.

// rangeCopy is the range bar's Copy over the loop, the way the rooms send it.
func rangeCopy(t *testing.T, e *Engine, tp *Tape, op string, noCrate bool) EditResult {
	t.Helper()
	res, err := e.EditOp(tp.ID, EditRequest{Op: op, Track: 1, NoCrate: noCrate})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func crateLen(t *testing.T, e *Engine) int {
	t.Helper()
	l, err := e.CrateList("", "")
	if err != nil {
		t.Fatal(err)
	}
	return len(l)
}

func TestARangeCopyOrCutOverAnUnusedCopyHoldsItAndLeavesTheCrateAlone(t *testing.T) {
	for _, op := range []string{"copy", "lift"} {
		t.Run(op, func(t *testing.T) {
			e, _, tp := barLoop(t)
			a := copySpan(t, e, 100000, 148000)
			res := rangeCopy(t, e, tp, op, true)
			if res.Replaced == nil || !res.Replaced.Created.Equal(a.Created) {
				t.Fatalf("%s replaced %+v, want the ribbon's copy", op, res.Replaced)
			}
			if n := crateLen(t, e); n != 0 {
				t.Fatalf("the crate grew to %d", n)
			}
			slot, _ := e.store.loadReplaced()
			if slot == nil || !slot.By.Equal(res.Board.Created) {
				t.Fatalf("the slot = %+v, want the copy replaced by this %s", slot, op)
			}
			if got, err := e.RestoreReplaced(res.Board.Created); err != nil || !got.Created.Equal(a.Created) {
				t.Fatalf("Undo brought back %+v (%v)", got, err)
			}
		})
	}
}

func TestARibbonCopyOverARangeCopyKeepsItAndUndoBringsItBack(t *testing.T) {
	e, _, tp := barLoop(t)
	cp := rangeCopy(t, e, tp, "copy", true)
	g := copySpan(t, e, 100000, 148000)
	if s, _ := e.store.loadReplaced(); s == nil || !s.Board.Created.Equal(cp.Board.Created) {
		t.Fatalf("the ribbon's copy replaced %+v, want the range's", s)
	}
	if n := crateLen(t, e); n != 0 {
		t.Fatalf("the crate has %d", n)
	}
	got, err := e.RestoreReplaced(g.Created)
	if err != nil || !got.Created.Equal(cp.Board.Created) || got.Grab != nil {
		t.Fatalf("Undo brought back %+v (%v), want the range's copy", got, err)
	}
}

func TestAnUnusedCopyOverAnUnusedCopyIsHeldToo(t *testing.T) {
	e, _, tp := barLoop(t)
	a := rangeCopy(t, e, tp, "copy", true)
	b := rangeCopy(t, e, tp, "copy", true)
	if b.Replaced == nil || !b.Replaced.Created.Equal(a.Board.Created) {
		t.Fatalf("replaced %+v", b.Replaced)
	}
}

func TestACopyThatWasPastedIsUsedAndNotHeld(t *testing.T) {
	e, _, tp := barLoop(t)
	rangeCopy(t, e, tp, "copy", true)
	if _, err := e.DropClipboard(tp.ID, 2, false); err != nil {
		t.Fatal(err)
	}
	copySpan(t, e, 100000, 148000)
	if s, _ := e.store.loadReplaced(); s != nil {
		t.Fatalf("a pasted copy was held: %+v", s)
	}
}

func TestTheSlotIsLetGoWhenWhatItWouldUndoLeavesTheClipboard(t *testing.T) {
	two := func(t *testing.T) (*Engine, *Tape, *Clipboard, *Clipboard) {
		e, _, tp := barLoop(t)
		a := copySpan(t, e, 100000, 148000)
		b := copySpan(t, e, 110000, 158000)
		return e, tp, a, b
	}
	freed := func(t *testing.T, e *Engine, c ...*Clipboard) {
		t.Helper()
		for _, x := range c {
			ageFiles(t, e, x)
		}
		if _, _, err := e.store.Cleanup(nil); err != nil {
			t.Fatal(err)
		}
	}
	t.Run("cleared", func(t *testing.T) {
		e, _, a, b := two(t)
		if err := e.ClearClipboard(); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(e.store.replacedPath()); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("Clear left the slot: %v", err)
		}
		d := copySpan(t, e, 120000, 168000)
		freed(t, e, a, b, d)
		if poolNames(t, e)[a.Tracks[0][0].File] {
			t.Fatal("copy A's audio is rooted for ever by a slot nothing can undo")
		}
	})
	t.Run("dropped", func(t *testing.T) {
		e, tp, a, b := two(t)
		if _, err := e.DropClipboard(tp.ID, 3, false); err != nil {
			t.Fatal(err)
		}
		freed(t, e, a, b)
		if poolNames(t, e)[a.Tracks[0][0].File] {
			t.Fatal("a dropped buffer left the slot's audio rooted: nothing can undo that copy now")
		}
		if !poolNames(t, e)[b.Tracks[0][0].File] {
			t.Fatal("the dropped buffer's own audio, on the tape, was taken")
		}
	})
	t.Run("a slot for a buffer that is not the clipboard is stale", func(t *testing.T) {
		e, _, a, _ := two(t)
		// Another device replaced the buffer behind the slot's back.
		copySpan(t, e, 130000, 178000)
		if err := e.store.saveReplaced(a, time.Now().Add(-time.Hour)); err != nil {
			t.Fatal(err)
		}
		freed(t, e, a)
		if poolNames(t, e)[a.Tracks[0][0].File] {
			t.Fatal("a slot whose `by` is not the clipboard roots audio")
		}
	})
}

func TestUndoAfterADropRefusesInPlainWords(t *testing.T) {
	e, _, tp := barLoop(t)
	copySpan(t, e, 100000, 148000)
	b := copySpan(t, e, 110000, 158000)
	if _, err := e.DropClipboard(tp.ID, 3, false); err != nil {
		t.Fatal(err)
	}
	_, err := e.RestoreReplaced(b.Created)
	if !errors.Is(err, ErrNothingToDo) || !strings.Contains(err.Error(), "Already dropped or kept") {
		t.Fatalf("Undo after a DROP: %v", err)
	}
	if cur, _ := e.Clipboard(); !cur.Created.Equal(b.Created) {
		t.Fatal("a refused Undo swapped the buffer under a drop that stays")
	}
}

func TestAnOlderUndoSaysItsCopyWasAlreadyReplaced(t *testing.T) {
	e, _, _ := barLoop(t)
	copySpan(t, e, 100000, 148000)
	b := copySpan(t, e, 110000, 158000)
	copySpan(t, e, 120000, 168000)
	_, err := e.RestoreReplaced(b.Created)
	if !errors.Is(err, ErrNothingToDo) || !strings.Contains(err.Error(), "already replaced") {
		t.Fatalf("an older copy's Undo: %v", err)
	}
}

func TestAFailedReplacementKeepsTheUndoThatWasThere(t *testing.T) {
	e, _, _ := barLoop(t)
	a := copySpan(t, e, 100000, 148000)
	b := copySpan(t, e, 110000, 158000) // slot: a, by b
	// The new buffer can't be written (a tempo JSON can't hold): the
	// replacement fails after the slot was written, and must put the slot
	// back.
	bad := &Clipboard{Tracks: b.Tracks, Frames: b.Frames, BPM: math.NaN(), Created: time.Now()}
	if _, err := e.setBoardOpt(bad, GrabOpts{NoCrate: true}); err == nil {
		t.Fatal("the replacement should have failed: its clipboard can't be written")
	}
	slot, err := e.store.loadReplaced()
	if err != nil || slot == nil || !slot.Board.Created.Equal(a.Created) || !slot.By.Equal(b.Created) {
		t.Fatalf("the slot is %+v (%v): the Undo that was there was destroyed", slot, err)
	}
	if cur, _ := e.Clipboard(); !cur.Created.Equal(b.Created) {
		t.Fatal("the failed replacement changed the clipboard")
	}
	if got, err := e.RestoreReplaced(b.Created); err != nil || !got.Created.Equal(a.Created) {
		t.Fatalf("the Undo that was there no longer works: %+v %v", got, err)
	}
}
