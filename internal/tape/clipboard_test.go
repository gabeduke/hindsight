package tape

import (
	"os"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

func TestDropDropDropLaysCopiesEndToEnd(t *testing.T) {
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.25 })
	c, err := e.CopyTake(take, "jam_take.wav", 10000, 106000, []int{0, 1})
	if err != nil || c.Frames != 96000 || c.Tracks[0][0].Src != 480 {
		t.Fatalf("copy = %+v %v", c, err)
	}
	// The first drop on an empty tape is its first loop, and sets the tempo.
	d, err := e.DropClipboard(tp.ID, 1)
	if err != nil || d.Clip.At != 0 || d.End != 96000 {
		t.Fatalf("first drop = %+v %v", d, err)
	}
	if g := e.Loaded().Grid; g == nil || g.Frames != 96000 {
		t.Fatalf("grid = %+v", g)
	}
	// Stopped, the playhead moves to the drop's end: the next lands after it.
	e.Start()
	settle := func(pos int64) {
		t.Helper()
		waitFor(t, func() bool { sink.play(t, 512); return e.tr.Status().Pos == pos })
	}
	settle(96000)
	d, err = e.DropClipboard(tp.ID, 1)
	if err != nil || d.Clip.At != 96000 || d.End != 192000 {
		t.Fatalf("second drop = %+v %v", d, err)
	}
	settle(192000)
	if d, err = e.DropClipboard(tp.ID, 1); err != nil || d.Clip.At != 192000 {
		t.Fatalf("third drop = %+v %v", d, err)
	}
	if n := len(e.Loaded().Tracks[0].Clips); n != 3 {
		t.Fatalf("%d clips, want three end to end", n)
	}
	// It replaces what's under it, rather than layering.
	e.Do(Action{Kind: "locate", Pos: 48000})
	settle(48000)
	e.DropClipboard(tp.ID, 1)
	for _, cl := range e.Loaded().Tracks[0].Clips {
		if cl.Layer != 0 {
			t.Fatalf("a drop layered: %+v", cl)
		}
	}
}

func TestTheClipboardSurvivesAndIsKeptByCleanup(t *testing.T) {
	e, _, _ := newEngine(t)
	take := takeWAV(t, 100000, func(i int) float64 { return 0.25 })
	c, err := e.CopyTake(take, "jam_take.wav", 0, 48000, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	// A fresh engine on the same store sees it.
	e2 := NewEngine(Options{Store: e.store})
	if got := e2.Clipboard(); got.Empty() || got.Tracks[0][0].File != c.Tracks[0][0].File {
		t.Fatalf("after a restart the clipboard = %+v", got)
	}
	// Clean-up keeps its audio, even with no tape using it (and old enough).
	path := e.store.AudioPath(c.Tracks[0][0].File)
	old := time.Now().Add(-time.Hour)
	if err := osChtimes(path, old); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.store.Cleanup(nil); err != nil {
		t.Fatal(err)
	}
	if _, err := audio.ReadWAVInfo(path); err != nil {
		t.Fatalf("clean-up took the clipboard's audio: %v", err)
	}
	// Audition: its frames, summed.
	var n int
	frames, err := e.ClipboardAudio(func(b []float32) error { n += len(b) / 2; return nil })
	if err != nil || frames != 48000 || n != 48000 {
		t.Fatalf("audition = %d frames (%d emitted), %v", frames, n, err)
	}
	if err := e.ClearClipboard(); err != nil || !e.Clipboard().Empty() {
		t.Fatalf("clear: %v", err)
	}
	if _, err := e.DropClipboard(e.LoadedID(), 1); err != ErrEmptyClipboard {
		t.Fatalf("dropping nothing = %v", err)
	}
}

func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func osChtimes(path string, t time.Time) error { return os.Chtimes(path, t, t) }

func TestPlayAfterADropAtTheLoopsEndPlaysTheLoop(t *testing.T) {
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.25 })
	e.CopyTake(take, "jam_take.wav", 0, 96000, []int{0, 1})
	e.DropClipboard(tp.ID, 1) // the first loop; the playhead goes to its end
	e.Start()
	e.Do(Action{Kind: "play"})
	sink.play(t, 96000*2+1000)
	if l := e.Live(); !l.Playing || len(l.Cycles) == 0 {
		t.Fatalf("after ▶ at the loop's end: %+v, want the loop going round", l.Status)
	}
}
