package tape

import (
	"errors"
	"testing"
	"time"
)

func TestAKnobOnAControllerCommitsOnceItIsStill(t *testing.T) {
	e, _, tp := newEngine(t)
	undo0, _ := e.UndoDepth()
	k := NewModKnobs(e)
	k.Quiet = 30 * time.Millisecond
	t.Cleanup(k.Stop)
	for i := 0; i <= 10; i++ {
		// Still turning: nothing is saved yet. (Each turn is 5 ms after the
		// last, a sixth of the quiet: a turn that didn't stop the last one's
		// commit would have saved by the seventh.)
		if s := e.Loaded().Style; s != nil {
			t.Fatalf("saved mid-turn, at turn %d: %+v", i, s)
		}
		if err := k.Turn(tp.ID, "mod.flutter", float64(i)/20); err != nil {
			t.Fatal(err)
		}
		time.Sleep(5 * time.Millisecond)
	}
	deadline := time.Now().Add(2 * time.Second)
	for e.Loaded().Style == nil {
		if time.Now().After(deadline) {
			t.Fatal("the knob was never committed")
		}
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(60 * time.Millisecond)
	if s := e.Loaded().Style; s.Flutter != 0.5 || s.Formula != FormulaCustom {
		t.Fatalf("committed %+v, want flutter .5", s)
	}
	if u, _ := e.UndoDepth(); u != undo0+1 {
		t.Fatalf("a turn of the knob made %d undo steps, want 1", u-undo0)
	}
	if err := k.Turn(tp.ID, "wobble", 1); !errors.Is(err, ErrNoSuchPad) {
		t.Fatalf("a made-up mod: %v", err)
	}
}

func TestAKnobTurnedAsItsCommitFiresCommitsOnlyItsNewest(t *testing.T) {
	// A turn's commit fires just as the knob moves again: its callback runs
	// after the next turn has armed its own. It must neither save the old
	// value nor forget the newer turn's commit, which the turn after that
	// then can't stop -- an orphan that later saves a stale value and ends
	// the live preview.
	e, _, tp := newEngine(t)
	k := NewModKnobs(e)
	k.Quiet = 40 * time.Millisecond
	t.Cleanup(k.Stop)
	_ = k.Turn(tp.ID, "mod.wow", 0.2)
	k.mu.Lock()
	first := k.gen["mod.wow"]
	k.mu.Unlock()
	_ = k.Turn(tp.ID, "mod.wow", 0.5)
	k.fire(tp.ID, "mod.wow", 0.2, first) // the first turn's commit, late
	if s := e.Loaded().Style; s != nil {
		t.Fatalf("a turn already moved on from was saved: %+v", s)
	}
	_ = k.Turn(tp.ID, "mod.wow", 0.8)
	deadline := time.Now().Add(2 * time.Second)
	for e.Loaded().Style == nil {
		if time.Now().After(deadline) {
			t.Fatal("the last turn was never committed")
		}
		time.Sleep(2 * time.Millisecond)
	}
	time.Sleep(4 * k.Quiet)
	if s := e.Loaded().Style; s.Wow != 0.8 {
		t.Fatalf("wow saved as %v, want the last turn's .8", s.Wow)
	}
}

func TestAModsPreviewIsLetGoOnlyByWhoeverSetItLast(t *testing.T) {
	// A page previewed WOW; a controller's knob turned it since. The page
	// going must leave the knob's preview playing.
	r := newRig(t, Loop{})
	r.playFrom(10000)
	_ = r.e.PreviewMod("mod.wow", 0.3, "page:1")
	r.run(1)
	k := NewModKnobs(r.e)
	k.Quiet = time.Hour // no commit in this test
	t.Cleanup(k.Stop)
	_ = k.Turn("", "mod.wow", 0.7)
	r.run(1)
	_ = r.e.EndPreview("mod.wow", "page:1") // the page goes
	r.run(1)
	if p := r.e.perf.preview[modWow]; !p.on || p.v != 0.7 {
		t.Fatalf("after the page went, the knob's preview is %+v, want .7 still on", p)
	}
	_ = r.e.EndPreview("mod.wow", k.Owner)
	r.run(1)
	if p := r.e.perf.preview[modWow]; p.on {
		t.Fatalf("the knob let go, and its preview is still on: %+v", p)
	}
}
