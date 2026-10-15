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
	k.quiet = 30 * time.Millisecond
	t.Cleanup(k.Stop)
	for i := 0; i <= 10; i++ {
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
