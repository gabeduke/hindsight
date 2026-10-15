package tape

import (
	"errors"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// tapeJSON is the loaded tape's tape.json.
func tapeJSON(t *testing.T, e *Engine, id string) string {
	t.Helper()
	dir, err := e.store.tapeDir(id)
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Join(dir, "tape.json")
}

func mtime(t *testing.T, path string) time.Time {
	t.Helper()
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return st.ModTime()
}

func TestModsWriteOncePerGestureAndUndoRestoresThem(t *testing.T) {
	e, _, tp := newEngine(t)
	path := tapeJSON(t, e, tp.ID)
	undo0, _ := e.UndoDepth()
	before := mtime(t, path)
	time.Sleep(20 * time.Millisecond)

	// A drag previews over the socket as it goes: nothing written, no undo.
	for v := 0.0; v <= 0.6; v += 0.01 {
		if err := e.Set("mod.wow", v); err != nil {
			t.Fatal(err)
		}
	}
	if u, _ := e.UndoDepth(); u != undo0 || !mtime(t, path).Equal(before) || e.Loaded().Style != nil {
		t.Fatalf("a preview saved something: undo %d (was %d), style %+v", u, undo0, e.Loaded().Style)
	}
	// The finger lifts: one commit, one step.
	if err := e.SetStyle(tp.ID, StyleChange{Wow: ptr(0.6)}); err != nil {
		t.Fatal(err)
	}
	if u, _ := e.UndoDepth(); u != undo0+1 || mtime(t, path).Equal(before) {
		t.Fatalf("a commit: undo %d (was %d)", u, undo0)
	}
	// Another gesture, on another mod, is another step.
	if err := e.SetStyle(tp.ID, StyleChange{Drive: ptr(0.3)}); err != nil {
		t.Fatal(err)
	}
	if u, _ := e.UndoDepth(); u != undo0+2 {
		t.Fatalf("two gestures: undo %d, want %d", u, undo0+2)
	}
	if err := e.Undo(tp.ID, false); err != nil {
		t.Fatal(err)
	}
	if s := e.Loaded().Style; s == nil || s.Wow != 0.6 || s.Drive != 0 {
		t.Fatalf("undone once: %+v, want wow .6 and no drive", s)
	}
	if err := e.Undo(tp.ID, false); err != nil {
		t.Fatal(err)
	}
	if s := e.Loaded().Style; s != nil {
		t.Fatalf("undone twice: %+v, want none", s)
	}
}

func TestAPreviewIsHeardUntilTheTapeHasItsOwn(t *testing.T) {
	r := newRig(t, Loop{})
	r.playFrom(10000)
	r.run(1)
	if err := r.e.Set("mod.drive", 0.8); err != nil {
		t.Fatal(err)
	}
	r.run(1)
	if got := r.e.perf.bus.drive.to; got != 0.8 {
		t.Fatalf("a preview of drive aims it at %v, want .8", got)
	}
	// Committed: the tape's mix carries it, and the preview is done.
	m := *r.e.mix.Load()
	m.style[modDrive] = 0.8
	r.e.mix.Store(&m)
	r.run(1)
	if r.e.perf.preview[modDrive].on || r.e.perf.bus.drive.to != 0.8 {
		t.Fatalf("after the commit: preview %+v, drive to %v", r.e.perf.preview[modDrive], r.e.perf.bus.drive.to)
	}
	// A preview let go goes back to the tape's own.
	_ = r.e.Set("mod.age", 0.5)
	r.run(1)
	_ = r.e.Release("mod.age")
	r.run(1)
	if r.e.perf.preview[modAge].on || r.e.perf.bus.age.to != 0 {
		t.Fatalf("a preview let go: %+v, age to %v", r.e.perf.preview[modAge], r.e.perf.bus.age.to)
	}
}

func TestSetRefusesWhatHasNoAmount(t *testing.T) {
	r := newRig(t, Loop{})
	for pad, want := range map[string]error{"stop": ErrNoAmount, "track1": ErrNoAmount, "loud": ErrNoSuchPad, "mod.hiss": ErrNoSuchPad} {
		if err := r.e.Set(pad, 0.5); !errors.Is(err, want) {
			t.Fatalf("set %s: %v, want %v", pad, err, want)
		}
	}
	if err := r.e.Set(PadFilter, math.Inf(1)); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("an infinite amount: %v", err)
	}
	if err := r.e.PressAmount(PadFilter, QuantumNow, math.NaN()); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("a press of no amount: %v", err)
	}
	if err := r.e.Press("mod.wow", QuantumNow); !errors.Is(err, ErrNoSuchPad) {
		t.Fatalf("a mod is set, not held: %v", err)
	}
}

func TestAFloodOfSetsStaysBounded(t *testing.T) {
	r := newRig(t, Loop{})
	_ = r.e.Press(PadFilter, QuantumNow)
	for i := 0; i < 10000; i++ {
		_ = r.e.Set(PadFilter, float64(i%100)/100)
		_ = r.e.Set("mod.wow", float64(i%100)/100)
	}
	_ = r.e.Release(PadFilter)
	r.e.tricks.mu.Lock()
	n := len(r.e.tricks.msgs)
	r.e.tricks.mu.Unlock()
	if n != 4 {
		t.Fatalf("the inbox holds %d messages after 20000 sets, want 4: a press, a set each, a release", n)
	}
	r.run(1)
	if r.e.perf.amount[iFilter] != 0.99 {
		t.Fatalf("filter's amount %v, want the last set, .99", r.e.perf.amount[iFilter])
	}
}
