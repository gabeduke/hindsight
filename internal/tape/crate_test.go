package tape

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

func poolNames(t *testing.T, e *Engine) map[string]bool {
	t.Helper()
	es, err := os.ReadDir(filepath.Join(e.store.Dir(), "audio"))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	for _, f := range es {
		if filepath.Ext(f.Name()) == ".wav" {
			out["audio/"+f.Name()] = true
		}
	}
	return out
}

func TestKeepingASpanOfATake(t *testing.T) {
	e, _, _ := newEngine(t)
	e.handleS = 1
	take := takeWAV(t, 400000, func(i int) float64 { return float64(i) / 1e6 })
	takes := filepath.Dir(take)
	before, _ := os.ReadDir(takes)
	k, err := e.KeepTake(take, "jam_take.wav", "Tuesday jam", 96000, 192000, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	if k.ID == "" || k.Frames != 96000 || k.Src != 48000 || k.Name != "Tuesday jam · 0:02" {
		t.Fatalf("kept = %+v", k)
	}
	if k.Source.Kind != "take" || k.Source.Take != "jam_take.wav" || k.Source.From != 96000 || k.Source.To != 192000 || k.Source.What != "Tuesday jam, 0:02–0:04" {
		t.Fatalf("source = %+v", k.Source)
	}
	if !poolNames(t, e)[k.File] {
		t.Fatalf("its audio %s isn't in the pool", k.File)
	}
	// The takes list is as it was.
	if after, _ := os.ReadDir(takes); len(after) != len(before) {
		t.Fatalf("%d files in the takes' folder, were %d", len(after), len(before))
	}
	// It's on the crate, and after a restart too.
	e2 := NewEngine(Options{Store: e.store})
	if l, err := e2.CrateList("", ""); err != nil || len(l) != 1 || l[0].ID != k.ID {
		t.Fatalf("the crate after a restart = %+v %v", l, err)
	}
}

func TestAKeptClipOutlivesItsTake(t *testing.T) {
	e, _, tp := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.25 })
	k, err := e.KeepTake(take, "jam_take.wav", "jam", 0, 96000, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(take); err != nil {
		t.Fatal(err)
	}
	w, err := e.CrateWAV(k.ID)
	if err != nil || w.Frames != 96000 {
		t.Fatalf("its WAV with the take gone = %+v %v", w, err)
	}
	var b bytes.Buffer
	if _, err := w.WriteTo(&b); err != nil || int64(b.Len()) != w.Bytes() {
		t.Fatalf("wrote %d of %d: %v", b.Len(), w.Bytes(), err)
	}
	if _, err := e.DropCrate(tp.ID, k.ID, 1); err != nil {
		t.Fatalf("dropped with the take gone: %v", err)
	}
	if cl := track(e, 1); len(cl) != 1 || cl[0].File != k.File || cl[0].Src != k.Src || cl[0].Frames != k.Frames {
		t.Fatalf("on the tape: %+v", cl)
	}
}

func TestDropFromTheCrateThreeTimesEndToEnd(t *testing.T) {
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 400000, func(i int) float64 { return 0.25 })
	// A tape with a tempo, so the drops go at the playhead.
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error {
		g := GridFor(120, 4, 48000)
		s.Grid = &g
		s.Loop = Loop{In: 0, Out: g.Frames, On: true}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	k, _ := e.KeepTake(take, "jam_take.wav", "jam", 0, 96000, []int{0, 1})
	// Stopped, the playhead moves to each drop's end: the next lands after it.
	e.Start()
	for i := 0; i < 3; i++ {
		d, err := e.DropCrate(tp.ID, k.ID, 2)
		if err != nil {
			t.Fatal(err)
		}
		waitFor(t, func() bool { sink.play(t, 512); return e.tr.Status().Pos == d.End })
	}
	cl := track(e, 2)
	if len(cl) != 3 || cl[0].At != 0 || cl[1].At != 96000 || cl[2].At != 192000 {
		t.Fatalf("three drops = %+v", cl)
	}
	for i := 0; i < 3; i++ {
		e.Undo(tp.ID, false)
	}
	if n := len(track(e, 2)); n != 0 {
		t.Fatalf("three undos leave %d clips", n)
	}
}

func TestKeepingATapeClipOrTheClipboardCopiesNothing(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	pool := len(poolNames(t, e))
	k, err := e.KeepTapeClip(tp.ID, orig.ID)
	if err != nil {
		t.Fatal(err)
	}
	if k.File != orig.File || k.Src != orig.Src || k.Frames != orig.Frames || k.Source.Kind != "tape" || k.Source.Tape != tp.ID {
		t.Fatalf("kept from the tape = %+v", k)
	}
	b, err := e.KeepClipboard()
	if err != nil {
		t.Fatal(err)
	}
	if b.Source.Kind != "clipboard" || b.Frames != 96000 {
		t.Fatalf("kept from the clipboard = %+v", b)
	}
	if n := len(poolNames(t, e)); n != pool {
		t.Fatalf("%d pool files, were %d", n, pool)
	}
	if _, err := e.KeepTapeClip("other", orig.ID); !errors.Is(err, ErrWrongTape) {
		t.Fatalf("another tape's clip = %v", err)
	}
	// A clipboard of more than one clip isn't one clip to keep.
	setLoop(t, e, 0, 96000)
	pos := int64(48000)
	e.EditOp(tp.ID, EditRequest{Op: "split", Track: 1, Pos: &pos})
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "copy", Track: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.KeepClipboard(); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("a two-clip clipboard = %v", err)
	}
}

func TestDeletingAKeptClipAndBringingItBack(t *testing.T) {
	e, _, _ := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.25 })
	a, _ := e.KeepTake(take, "jam_take.wav", "jam", 0, 48000, []int{0, 1})
	b, _ := e.KeepTake(take, "jam_take.wav", "jam", 48000, 96000, []int{0, 1})
	if _, err := e.DeleteCrateClip(a.ID); err != nil {
		t.Fatal(err)
	}
	if l, _ := e.CrateList("", ""); len(l) != 1 || l[0].ID != b.ID {
		t.Fatalf("after deleting one: %+v", l)
	}
	if _, err := e.RestoreCrateClip(a.ID); err != nil {
		t.Fatal(err)
	}
	if l, _ := e.CrateList("", ""); len(l) != 2 || l[0].ID != b.ID {
		t.Fatalf("after bringing it back (newest first): %+v", l)
	}
	if _, err := e.DeleteCrateClip("nope"); !errors.Is(err, ErrNoSuchCrateClip) {
		t.Fatalf("delete no clip = %v", err)
	}
}

func TestCleanupKeepsTheCrateUntilItsTrashEmpties(t *testing.T) {
	e, _, _ := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.25 })
	k, _ := e.KeepTake(take, "jam_take.wav", "jam", 0, 48000, []int{0, 1})
	path := e.store.AudioPath(k.File)
	old := time.Now().Add(-time.Hour)
	if err := osChtimes(path, old); err != nil {
		t.Fatal(err)
	}
	clean := func() {
		t.Helper()
		if _, _, err := e.store.Cleanup(nil); err != nil {
			t.Fatal(err)
		}
	}
	clean()
	if _, err := audio.ReadWAVInfo(path); err != nil {
		t.Fatalf("clean-up took a kept clip's audio: %v", err)
	}
	// Deleted, it's still kept while it can be brought back.
	e.DeleteCrateClip(k.ID)
	clean()
	if _, err := audio.ReadWAVInfo(path); err != nil {
		t.Fatalf("clean-up took a deleted clip's audio within the week: %v", err)
	}
	// After the week, the list lets go of it and clean-up frees the audio.
	e.changeCrate(func(c *Crate) error {
		long := time.Now().Add(-(CrateTrashDays*24 + 1) * time.Hour)
		c.Clips[0].Deleted = &long
		return nil
	})
	if l, _ := e.CrateList("", ""); len(l) != 0 {
		t.Fatalf("the list = %+v", l)
	}
	if _, err := e.CrateClip(k.ID); !errors.Is(err, ErrNoSuchCrateClip) {
		t.Fatalf("a clip deleted a week ago is still there: %v", err)
	}
	clean()
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("its audio is still there: %v", err)
	}
	// A crate that can't be read stops clean-up altogether.
	os.WriteFile(e.store.cratePath(), []byte("{"), 0o644)
	if _, _, err := e.store.Cleanup(nil); err == nil {
		t.Fatal("clean-up ran with an unreadable crate")
	}
}

func TestTheCrateListFindsByNameAndTake(t *testing.T) {
	e, _, _ := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.25 })
	a, _ := e.KeepTake(take, "jam_a.wav", "Verse", 0, 48000, []int{0, 1})
	time.Sleep(2 * time.Millisecond)
	b, _ := e.KeepTake(take, "jam_b.wav", "Chorus", 0, 48000, []int{0, 1})
	if l, _ := e.CrateList("", ""); len(l) != 2 || l[0].ID != b.ID {
		t.Fatalf("newest first: %+v", l)
	}
	if l, _ := e.CrateList("vERSE", ""); len(l) != 1 || l[0].ID != a.ID {
		t.Fatalf("by name: %+v", l)
	}
	if l, _ := e.CrateList("", "jam_b.wav"); len(l) != 1 || l[0].ID != b.ID {
		t.Fatalf("by take: %+v", l)
	}
	if _, err := e.RenameCrateClip(a.ID, "  The verse  "); err != nil {
		t.Fatal(err)
	}
	if k, _ := e.CrateClip(a.ID); k.Name != "The verse" {
		t.Fatalf("renamed = %q", k.Name)
	}
	if _, err := e.RenameCrateClip(a.ID, "   "); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("a blank name = %v", err)
	}
}

func TestKeepingASpanOfTheRing(t *testing.T) {
	e, sink, _ := newEngine(t)
	sink.ring.WriteFrames(make([]int32, 48000*3*8)) // three seconds of the capture
	k, clamped, err := e.KeepRing(48000, 96000, "aux")
	if err != nil {
		t.Fatal(err)
	}
	if clamped || k.Frames != 48000 || k.Source.Kind != "ring" || !poolNames(t, e)[k.File] {
		t.Fatalf("kept from the ring = %+v (clamped %v)", k, clamped)
	}
}
