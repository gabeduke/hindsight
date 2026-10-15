package tape

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The review of F3: the one replaced grab holds ANY unused buffer (a range's
// Cut or Copy too), every way of filling the clipboard can leave the crate
// alone, the slot is let go of when what it would undo is gone or used, and a
// write that fails keeps the Undo that was there.

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

func TestARangeCopyOrCutOverAnUnusedGrabHoldsItAndLeavesTheCrateAlone(t *testing.T) {
	for _, op := range []string{"copy", "lift"} {
		t.Run(op, func(t *testing.T) {
			e, _, tp := barLoop(t)
			a := grabSpan(t, e, 100000, 148000, GrabRequest{NoCrate: true})
			res := rangeCopy(t, e, tp, op, true)
			if res.Replaced == nil || !res.Replaced.Created.Equal(a.Board.Created) {
				t.Fatalf("%s replaced %+v, want the grab", op, res.Replaced)
			}
			if n := crateLen(t, e); n != 0 {
				t.Fatalf("the crate grew to %d", n)
			}
			slot, _ := e.store.loadReplaced()
			if slot == nil || !slot.By.Equal(res.Board.Created) {
				t.Fatalf("the slot = %+v, want the grab replaced by this %s", slot, op)
			}
			if got, err := e.RestoreReplaced(res.Board.Created); err != nil || !got.Created.Equal(a.Board.Created) {
				t.Fatalf("Undo brought back %+v (%v)", got, err)
			}
		})
	}
}

func TestARangeCopyWithoutTheOptionCratesAsItAlwaysDid(t *testing.T) {
	e, _, tp := barLoop(t)
	grabSpan(t, e, 100000, 148000, GrabRequest{})
	res := rangeCopy(t, e, tp, "copy", false)
	if n := crateLen(t, e); n != 1 {
		t.Fatalf("the crate has %d: flag-off behaviour must not change", n)
	}
	if res.Replaced == nil {
		t.Fatal("it says nothing was replaced")
	}
}

func TestAGrabOverACopyKeepsTheCopyAndUndoBringsItBack(t *testing.T) {
	e, _, tp := barLoop(t)
	cp := rangeCopy(t, e, tp, "copy", true)
	g := grabSpan(t, e, 100000, 148000, GrabRequest{NoCrate: true})
	if g.Replaced == nil || !g.Replaced.Created.Equal(cp.Board.Created) {
		t.Fatalf("the grab replaced %+v, want the copy", g.Replaced)
	}
	if n := crateLen(t, e); n != 0 {
		t.Fatalf("the crate has %d", n)
	}
	got, err := e.RestoreReplaced(g.Board.Created)
	if err != nil || !got.Created.Equal(cp.Board.Created) || got.Grab != nil {
		t.Fatalf("Undo brought back %+v (%v), want the copy", got, err)
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
	g := grabSpan(t, e, 100000, 148000, GrabRequest{NoCrate: true})
	if g.Replaced != nil {
		t.Fatalf("a pasted copy was held: %+v", g.Replaced)
	}
}

func TestUndoTossBringsTheTossedOneBackHoldingWhatItReplaced(t *testing.T) {
	e, _, _ := barLoop(t)
	a := grabSpan(t, e, 100000, 148000, GrabRequest{NoCrate: true})
	if err := e.TossClipboard(); err != nil {
		t.Fatal(err)
	}
	b := grabSpan(t, e, 110000, 158000, GrabRequest{NoCrate: true})
	c, _, rep, err := e.RestoreClipboardOpt(GrabOpts{NoCrate: true})
	if err != nil || !c.Created.Equal(a.Board.Created) {
		t.Fatalf("restored %+v (%v)", c, err)
	}
	if rep == nil || !rep.Created.Equal(b.Board.Created) {
		t.Fatalf("replaced %+v, want the grab made after the toss", rep)
	}
	if n := crateLen(t, e); n != 0 {
		t.Fatalf("the crate has %d", n)
	}
	if got, err := e.RestoreReplaced(a.Board.Created); err != nil || !got.Created.Equal(b.Board.Created) {
		t.Fatalf("Undo of the toss's undo brought back %+v (%v)", got, err)
	}
}

func TestTheSlotIsLetGoWhenWhatItWouldUndoLeavesTheClipboard(t *testing.T) {
	two := func(t *testing.T) (*Engine, *Tape, Grabbed, Grabbed) {
		e, _, tp := barLoop(t)
		a := grabSpan(t, e, 100000, 148000, GrabRequest{NoCrate: true})
		b := grabSpan(t, e, 110000, 158000, GrabRequest{NoCrate: true})
		return e, tp, a, b
	}
	freed := func(t *testing.T, e *Engine, g ...Grabbed) {
		t.Helper()
		for _, x := range g {
			ageFiles(t, e, x.Board)
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
		d := grabSpan(t, e, 120000, 168000, GrabRequest{NoCrate: true})
		freed(t, e, a, b, d)
		if poolNames(t, e)[a.Board.Tracks[0][0].File] {
			t.Fatal("grab A's audio is rooted for ever by a slot nothing can undo")
		}
	})
	t.Run("tossed", func(t *testing.T) {
		e, _, a, _ := two(t)
		if err := e.TossClipboard(); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(e.store.replacedPath()); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("Toss left the slot: %v", err)
		}
		freed(t, e, a)
		if poolNames(t, e)[a.Board.Tracks[0][0].File] {
			t.Fatal("a toss left the slot's audio rooted")
		}
	})
	t.Run("dropped", func(t *testing.T) {
		e, tp, a, b := two(t)
		if _, err := e.DropClipboard(tp.ID, 3, false); err != nil {
			t.Fatal(err)
		}
		freed(t, e, a, b)
		if poolNames(t, e)[a.Board.Tracks[0][0].File] {
			t.Fatal("a dropped buffer left the slot's audio rooted: nothing can undo that grab now")
		}
		if !poolNames(t, e)[b.Board.Tracks[0][0].File] {
			t.Fatal("the dropped buffer's own audio, on the tape, was taken")
		}
	})
	t.Run("kept as a take", func(t *testing.T) {
		e, _, a, b := two(t)
		if _, err := e.KeepClipboardTake(t.TempDir(), time.Now()); err != nil {
			t.Fatal(err)
		}
		freed(t, e, a, b)
		if poolNames(t, e)[a.Board.Tracks[0][0].File] {
			t.Fatal("a kept buffer left the slot's audio rooted")
		}
	})
	t.Run("a slot for a buffer that is not the clipboard is stale", func(t *testing.T) {
		e, _, a, _ := two(t)
		// Another device replaced the buffer behind the slot's back.
		c := grabSpan(t, e, 130000, 178000, GrabRequest{NoCrate: true})
		_ = c
		if err := e.store.saveReplaced(a.Board, time.Now().Add(-time.Hour)); err != nil {
			t.Fatal(err)
		}
		freed(t, e, a)
		if poolNames(t, e)[a.Board.Tracks[0][0].File] {
			t.Fatal("a slot whose `by` is not the clipboard roots audio")
		}
	})
}

func TestUndoAfterADropRefusesInPlainWords(t *testing.T) {
	e, _, tp := barLoop(t)
	grabSpan(t, e, 100000, 148000, GrabRequest{NoCrate: true})
	b := grabSpan(t, e, 110000, 158000, GrabRequest{NoCrate: true})
	if _, err := e.DropClipboard(tp.ID, 3, false); err != nil {
		t.Fatal(err)
	}
	_, err := e.RestoreReplaced(b.Board.Created)
	if !errors.Is(err, ErrNothingToDo) || !strings.Contains(err.Error(), "Already dropped or kept") {
		t.Fatalf("Undo after a DROP: %v", err)
	}
	if cur, _ := e.Clipboard(); !cur.Created.Equal(b.Board.Created) {
		t.Fatal("a refused Undo swapped the buffer under a drop that stays")
	}
}

func TestAnOlderUndoSaysItsGrabWasAlreadyReplaced(t *testing.T) {
	e, _, _ := barLoop(t)
	grabSpan(t, e, 100000, 148000, GrabRequest{NoCrate: true})
	b := grabSpan(t, e, 110000, 158000, GrabRequest{NoCrate: true})
	grabSpan(t, e, 120000, 168000, GrabRequest{NoCrate: true})
	_, err := e.RestoreReplaced(b.Board.Created)
	if !errors.Is(err, ErrNothingToDo) || !strings.Contains(err.Error(), "already replaced") {
		t.Fatalf("an older grab's Undo: %v", err)
	}
}

func TestAFailedReplacementKeepsTheUndoThatWasThere(t *testing.T) {
	e, _, _ := barLoop(t)
	a := grabSpan(t, e, 100000, 148000, GrabRequest{NoCrate: true})
	b := grabSpan(t, e, 110000, 158000, GrabRequest{NoCrate: true}) // slot: a, by b
	// The crate can't be written: a grab that would keep b in it fails after
	// the slot was written, and must put the slot back.
	crate := filepath.Join(e.store.Dir(), "crate.json")
	os.Remove(crate)
	if err := os.Mkdir(crate, 0o755); err != nil {
		t.Fatal(err)
	}
	from, to := int64(120000), int64(168000)
	if _, err := e.Grab(GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"aux"}}); err == nil {
		t.Fatal("the grab should have failed: its crate can't be written")
	}
	slot, err := e.store.loadReplaced()
	if err != nil || slot == nil || !slot.Board.Created.Equal(a.Board.Created) || !slot.By.Equal(b.Board.Created) {
		t.Fatalf("the slot is %+v (%v): the Undo that was there was destroyed", slot, err)
	}
	if cur, _ := e.Clipboard(); !cur.Created.Equal(b.Board.Created) {
		t.Fatal("the failed grab changed the clipboard")
	}
	if got, err := e.RestoreReplaced(b.Board.Created); err != nil || !got.Created.Equal(a.Board.Created) {
		t.Fatalf("the Undo that was there no longer works: %+v %v", got, err)
	}
}
