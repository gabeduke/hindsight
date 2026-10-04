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
	d, err := e.DropClipboard(tp.ID, 1, false)
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
	d, err = e.DropClipboard(tp.ID, 1, false)
	if err != nil || d.Clip.At != 96000 || d.End != 192000 {
		t.Fatalf("second drop = %+v %v", d, err)
	}
	settle(192000)
	if d, err = e.DropClipboard(tp.ID, 1, false); err != nil || d.Clip.At != 192000 {
		t.Fatalf("third drop = %+v %v", d, err)
	}
	if n := len(e.Loaded().Tracks[0].Clips); n != 3 {
		t.Fatalf("%d clips, want three end to end", n)
	}
	// It replaces what's under it, rather than layering.
	e.Do(Action{Kind: "locate", Pos: 48000})
	settle(48000)
	e.DropClipboard(tp.ID, 1, false)
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
	if got, _ := e2.Clipboard(); got.Empty() || got.Tracks[0][0].File != c.Tracks[0][0].File {
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
	pcm, err := e.ClipboardAudio()
	if err != nil || len(pcm) != 2*48000 || pcm[2*1000] < 0.24 || pcm[2*1000] > 0.26 {
		t.Fatalf("audition = %d samples, %v", len(pcm), err)
	}
	if err := e.ClearClipboard(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if got, _ := e.Clipboard(); !got.Empty() {
		t.Fatal("cleared, but not empty")
	}
	if _, err := e.DropClipboard(e.LoadedID(), 1, false); err != ErrEmptyClipboard {
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
	e.DropClipboard(tp.ID, 1, false) // the first loop; the playhead goes to its end
	e.Start()
	e.Do(Action{Kind: "play"})
	sink.play(t, 96000*2+1000)
	if l := e.Live(); !l.Playing || len(l.Cycles) == 0 {
		t.Fatalf("after ▶ at the loop's end: %+v, want the loop going round", l.Status)
	}
}

func TestACorruptClipboardKeepsItsCopiesAndCanBeCleared(t *testing.T) {
	e, _, _ := newEngine(t)
	take := takeWAV(t, 100000, func(i int) float64 { return 0.25 })
	c, _ := e.CopyTake(take, "jam_take.wav", 0, 48000, []int{0, 1})
	path := e.store.AudioPath(c.Tracks[0][0].File)
	osChtimes(path, time.Now().Add(-time.Hour))
	if err := os.WriteFile(e.store.clipboardPath(), []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Clipboard(); err == nil {
		t.Fatal("a corrupt clipboard should say so")
	}
	if _, _, err := e.store.Cleanup(nil); err != nil {
		t.Fatalf("clean-up = %v, want it to carry on", err)
	}
	if _, err := audio.ReadWAVInfo(path); err != nil {
		t.Fatal("clean-up took a copy a corrupt clipboard might hold")
	}
	if err := e.ClearClipboard(); err != nil {
		t.Fatal(err)
	}
	if got, err := e.Clipboard(); err != nil || !got.Empty() {
		t.Fatalf("after clearing: %v %v", got, err)
	}
}

func TestACopyLongerThanATrackIsRefused(t *testing.T) {
	e, _, _ := newEngine(t) // 60 s tracks
	take := takeWAV(t, 48000*61, func(i int) float64 { return 0 })
	if _, err := e.CopyTake(take, "jam_long.wav", 0, 48000*61, []int{0, 1}); err == nil {
		t.Fatal("a 61 s copy onto 60 s tracks should be refused")
	}
}
