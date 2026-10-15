package tape

import (
	"errors"
	"os"
	"testing"
	"time"
)

// F3 of the flow spec: the crate leaves the screen, so GRAB's safety net is
// an Undo, and the Pi keeps exactly one replaced grab for it -- not a growing
// crate. The flag-off crate behaviour is TestAReplacedUnusedBufferIsInTheCrate.

func grabSpan(t *testing.T, e *Engine, from, to int64, opts GrabRequest) Grabbed {
	t.Helper()
	opts.RingFrom, opts.RingTo = &from, &to
	if opts.Sources == nil {
		opts.Sources = []string{"aux"}
	}
	g, err := e.Grab(opts)
	if err != nil {
		t.Fatal(err)
	}
	return g
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

func TestOneReplacedGrabIsKeptAndLetGoAtTheNext(t *testing.T) {
	e, _, _ := barLoop(t)
	a := grabSpan(t, e, 100000, 148000, GrabRequest{NoCrate: true})
	if a.Replaced != nil {
		t.Fatalf("the first grab replaced %+v", a.Replaced)
	}
	// A second grab, the first never dropped or kept: the first is kept.
	b := grabSpan(t, e, 110000, 158000, GrabRequest{NoCrate: true})
	if b.Replaced == nil || !b.Replaced.Created.Equal(a.Board.Created) {
		t.Fatalf("the second grab replaced %+v, want the first", b.Replaced)
	}
	if len(b.Crated) != 0 {
		t.Fatalf("a rooms grab crated %+v", b.Crated)
	}
	if list, _ := e.CrateList("", ""); len(list) != 0 {
		t.Fatalf("the crate has %d: nothing should grow it", len(list))
	}
	// And a third: the second is kept, and the first is let go.
	c := grabSpan(t, e, 120000, 168000, GrabRequest{NoCrate: true})
	if c.Replaced == nil || !c.Replaced.Created.Equal(b.Board.Created) {
		t.Fatalf("the third grab replaced %+v, want the second", c.Replaced)
	}
	slot, err := e.store.loadReplaced()
	if err != nil || slot == nil || !slot.Board.Created.Equal(b.Board.Created) || !slot.By.Equal(c.Board.Created) {
		t.Fatalf("the slot holds %+v (%v): want the second grab, replaced by the third", slot, err)
	}
	// The clean-up keeps the kept one's audio and takes the let-go one's.
	ageFiles(t, e, a.Board)
	ageFiles(t, e, b.Board)
	ageFiles(t, e, c.Board)
	if _, _, err := e.store.Cleanup(nil); err != nil {
		t.Fatal(err)
	}
	pool := poolNames(t, e)
	if !pool[b.Board.Tracks[0][0].File] {
		t.Fatal("a clean-up took the replaced grab's audio: Undo would have nothing to bring back")
	}
	if pool[a.Board.Tracks[0][0].File] {
		t.Fatal("the grab before it was kept too: only one is ever kept")
	}
}

func TestOnlyAnUnusedGrabIsKept(t *testing.T) {
	e, _, tp := barLoop(t)
	grabSpan(t, e, 100000, 148000, GrabRequest{NoCrate: true})
	// Dropped, it is used: replacing it loses nothing.
	if _, err := e.DropClipboard(tp.ID, 3, false); err != nil {
		t.Fatal(err)
	}
	g := grabSpan(t, e, 110000, 158000, GrabRequest{NoCrate: true})
	if g.Replaced != nil {
		t.Fatalf("a dropped buffer was kept: %+v", g.Replaced)
	}
	if s, _ := e.store.loadReplaced(); s != nil {
		t.Fatalf("a dropped buffer was written to the slot: %+v", s)
	}
	// The same buffer with other lanes is not a replacement.
	again, err := e.Grab(GrabRequest{Again: true, Sources: []string{"ch1", "aux"}, NoCrate: true})
	if err != nil || again.Replaced != nil {
		t.Fatalf("again replaced %+v (%v)", again.Replaced, err)
	}
	// Nor is a copy, which is no grab.
	if _, _, err := e.CopyRing(100000, 148000, "aux"); err != nil {
		t.Fatal(err)
	}
	g = grabSpan(t, e, 110000, 158000, GrabRequest{NoCrate: true})
	if g.Replaced != nil {
		t.Fatalf("a copy was kept: %+v", g.Replaced)
	}
}

func TestTheSlotIsAdditiveToTheCrate(t *testing.T) {
	// Without the option the old behaviour holds, a kept clip a lane, and
	// the slot is written as well.
	e, _, _ := barLoop(t)
	a := grabSpan(t, e, 100000, 148000, GrabRequest{Sources: []string{"ch1", "aux"}})
	b := grabSpan(t, e, 110000, 158000, GrabRequest{})
	if len(b.Crated) != 2 {
		t.Fatalf("crated %+v: the crate's behaviour must not change", b.Crated)
	}
	if b.Replaced == nil || !b.Replaced.Created.Equal(a.Board.Created) {
		t.Fatalf("replaced = %+v", b.Replaced)
	}
}

func TestAReplacedGrabComesBackAndTheSlotIsEmpty(t *testing.T) {
	e, _, _ := barLoop(t)
	a := grabSpan(t, e, 100000, 148000, GrabRequest{NoCrate: true})
	b := grabSpan(t, e, 110000, 158000, GrabRequest{NoCrate: true})
	got, err := e.RestoreReplaced(time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if !got.Created.Equal(a.Board.Created) || got.Tracks[0][0].File != a.Board.Tracks[0][0].File {
		t.Fatalf("restored %+v, want the first grab", got)
	}
	if cur, _ := e.Clipboard(); cur == nil || !cur.Created.Equal(a.Board.Created) {
		t.Fatalf("the clipboard holds %+v", cur)
	}
	// The grab that was undone is gone from the clipboard, and there is
	// nothing left to put back: a second Undo has nothing to do.
	if _, err := e.RestoreReplaced(time.Time{}); !errors.Is(err, ErrNothingToDo) {
		t.Fatalf("a second restore: %v", err)
	}
	if _, err := os.Stat(e.store.replacedPath()); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the slot file stayed: %v", err)
	}
	// Undone, the buffer is the first grab again, unused and replaceable: the
	// next grab keeps *it*.
	c := grabSpan(t, e, 120000, 168000, GrabRequest{NoCrate: true})
	if c.Replaced == nil || !c.Replaced.Created.Equal(a.Board.Created) {
		t.Fatalf("after Undo the next grab replaced %+v", c.Replaced)
	}
	_ = b
}

func TestUndoRefusesOnceTheBufferHasMovedOn(t *testing.T) {
	// Nothing to put back when the buffer is no longer the one that
	// replaced it: tossed or cleared.
	for name, move := range map[string]func(*testing.T, *Engine){
		"tossed":  func(t *testing.T, e *Engine) { _ = e.TossClipboard() },
		"cleared": func(t *testing.T, e *Engine) { _ = e.ClearClipboard() },
	} {
		t.Run(name, func(t *testing.T) {
			e, _, _ := barLoop(t)
			grabSpan(t, e, 100000, 148000, GrabRequest{NoCrate: true})
			grabSpan(t, e, 110000, 158000, GrabRequest{NoCrate: true})
			move(t, e)
			before, _ := e.Clipboard()
			if _, err := e.RestoreReplaced(time.Time{}); !errors.Is(err, ErrNothingToDo) {
				t.Fatalf("restore after the buffer moved on: %v", err)
			}
			if after, _ := e.Clipboard(); (before == nil) != (after == nil) {
				t.Fatal("a refused Undo changed the clipboard")
			}
		})
	}
}

func TestAnOlderUndoCannotBringBackTheWrongGrab(t *testing.T) {
	// A toast from the second grab, tapped after a third: the Undo names the
	// grab it was offered for, and the Pi only acts for the latest.
	e, _, _ := barLoop(t)
	grabSpan(t, e, 100000, 148000, GrabRequest{NoCrate: true})
	b := grabSpan(t, e, 110000, 158000, GrabRequest{NoCrate: true})
	c := grabSpan(t, e, 120000, 168000, GrabRequest{NoCrate: true})
	if _, err := e.RestoreReplaced(b.Board.Created); !errors.Is(err, ErrNothingToDo) {
		t.Fatalf("the second grab's Undo, after the third: %v", err)
	}
	if cur, _ := e.Clipboard(); !cur.Created.Equal(c.Board.Created) {
		t.Fatal("a refused Undo changed the clipboard")
	}
	got, err := e.RestoreReplaced(c.Board.Created)
	if err != nil || !got.Created.Equal(b.Board.Created) {
		t.Fatalf("the third grab's Undo brought back %+v (%v), want the second", got, err)
	}
}

func TestATakesGrabKeepsTheOneItReplacesToo(t *testing.T) {
	e, _, _ := barLoop(t)
	a := grabSpan(t, e, 100000, 148000, GrabRequest{NoCrate: true})
	take := tempoTake(t, 1200000, 120)
	g, err := e.GrabTakeOpt(take, "jam_take.wav", "Tuesday jam", 300000, 492000, []int{0, 1}, GrabOpts{NoCrate: true})
	if err != nil {
		t.Fatal(err)
	}
	if g.Replaced == nil || !g.Replaced.Created.Equal(a.Board.Created) || len(g.Crated) != 0 {
		t.Fatalf("replaced %+v crated %+v", g.Replaced, g.Crated)
	}
	if list, _ := e.CrateList("", ""); len(list) != 0 {
		t.Fatalf("the crate has %d", len(list))
	}
}
