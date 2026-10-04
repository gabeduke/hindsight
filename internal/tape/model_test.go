package tape

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBarLinesRoundTheSameWayHoweverTheyreCounted(t *testing.T) {
	// 84 BPM, 4 bars at 48 kHz: a bar is 137,142.857 frames.
	g := GridFor(84, 4, 48000)
	if g.Frames != 548571 {
		t.Fatalf("frames = %d", g.Frames)
	}
	if bpm := g.BPM(48000); bpm < 83.99 || bpm > 84.01 {
		t.Fatalf("bpm = %v", bpm)
	}
	for _, c := range []struct{ n, want int64 }{{0, 0}, {1, 137143}, {2, 274286}, {3, 411428}, {4, 548571}} {
		if got := g.BarStart(c.n); got != c.want {
			t.Errorf("bar %d starts at %d, want %d", c.n, got, c.want)
		}
	}
	if g.NextBar(137143) != 137143 || g.NextBar(137144) != 274286 || g.NextBar(1) != 137143 {
		t.Error("NextBar")
	}
	if g.BarAt(137142) != 0 || g.BarAt(137143) != 1 {
		t.Error("BarAt")
	}
	if g.NextBeat(1) != g.BeatStart(1) || g.BeatStart(4) != g.BarStart(1) {
		t.Error("beats")
	}
}

func TestEveryChangeRoundTripsThroughUndo(t *testing.T) {
	tp := NewTape("2026-10-04_t", "t", 48000, 48000*360, 4, time.Now())
	t0 := time.Now()
	clip := Clip{File: "audio/a.wav", Frames: 1000, At: 500}
	if err := tp.Change("drop", t0, func(s *State) error { _, err := s.Place(1, clip, true); return err }); err != nil {
		t.Fatal(err)
	}
	if err := tp.Change("gain:1", t0.Add(5*time.Second), func(s *State) error { s.Tracks[0].GainDB = -3; return nil }); err != nil {
		t.Fatal(err)
	}
	// A gain dragged: many changes, one step.
	for i := 0; i < 10; i++ {
		tp.Change("gain:1", t0.Add(5*time.Second+time.Duration(i)*100*time.Millisecond), func(s *State) error {
			s.Tracks[0].GainDB = float64(-3 - i)
			return nil
		})
	}
	if len(tp.History) != 2 {
		t.Fatalf("history = %d steps, want 2 (the drop, the gain drag)", len(tp.History))
	}
	tp.Undo()
	if tp.Tracks[0].GainDB != DefaultTrackGainDB || len(tp.Tracks[0].Clips) != 1 {
		t.Fatalf("after one undo: %+v", tp.Tracks[0])
	}
	tp.Undo()
	if len(tp.Tracks[0].Clips) != 0 {
		t.Fatal("the drop should be undone")
	}
	if err := tp.Undo(); !errors.Is(err, ErrNothingToDo) {
		t.Fatal(err)
	}
	tp.Redo()
	tp.Redo()
	if tp.Tracks[0].GainDB != -12 || len(tp.Tracks[0].Clips) != 1 {
		t.Fatalf("after redo: %+v", tp.Tracks[0])
	}
	// A failed change changes nothing.
	err := tp.Change("bad", t0, func(s *State) error { s.Tracks[0].Bus = "C"; return nil })
	if err == nil || tp.Tracks[0].Bus != BusA {
		t.Fatalf("bad bus: %v %q", err, tp.Tracks[0].Bus)
	}
	// Nothing runs past the end of the tape.
	err = tp.Change("drop", t0, func(s *State) error {
		_, err := s.Place(2, Clip{File: "audio/a.wav", Frames: 10, At: tp.Length - 5}, true)
		return err
	})
	if !errors.Is(err, ErrPastTheEnd) {
		t.Fatalf("past the end: %v", err)
	}
}

func TestPlacingLayersOrReplaces(t *testing.T) {
	var s State
	s.Tracks = []Track{{N: 1, Bus: BusA}}
	a, _ := s.Place(1, Clip{File: "audio/a.wav", Src: 0, Frames: 1000, At: 0}, true)
	// Overdub: a catch over audio goes on a layer above.
	b, _ := s.Place(1, Clip{File: "audio/b.wav", Frames: 400, At: 200}, false)
	if a.Layer != 0 || b.Layer != 1 {
		t.Fatalf("layers %d, %d", a.Layer, b.Layer)
	}
	// Replace over the middle splits the base clip in two.
	s.Place(1, Clip{File: "audio/c.wav", Src: 50, Frames: 100, At: 300}, true)
	var base []Clip
	for _, c := range s.Tracks[0].Clips {
		if c.Layer == 0 {
			base = append(base, c)
		}
	}
	if len(base) != 3 {
		t.Fatalf("base layer = %+v", base)
	}
	byAt := map[int64]Clip{}
	for _, c := range base {
		byAt[c.At] = c
	}
	if h := byAt[0]; h.File != "audio/a.wav" || h.Frames != 300 {
		t.Errorf("head = %+v", h)
	}
	if m := byAt[300]; m.File != "audio/c.wav" || m.Frames != 100 {
		t.Errorf("middle = %+v", m)
	}
	if tl := byAt[400]; tl.File != "audio/a.wav" || tl.Src != 400 || tl.Frames != 600 || tl.ID == a.ID {
		t.Errorf("tail = %+v", tl)
	}
}

func TestTheStoreCreatesListsClonesAndCleansUp(t *testing.T) {
	dir := t.TempDir()
	s, err := OpenStore(dir, 48000, 4, 360)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 4, 21, 0, 0, 0, time.Local)
	tp, err := s.Create("Bedtime Orchid!", 84, 4, now)
	if err != nil {
		t.Fatal(err)
	}
	if tp.ID != "2026-10-04_bedtime-orchid" || tp.Grid == nil || !tp.Loop.On || len(tp.Tracks) != 4 {
		t.Fatalf("created %+v", tp)
	}
	rel, path, err := s.NewPoolFile("catch", now)
	if err != nil || rel != "audio/catch_2026-10-04_210000.wav" {
		t.Fatalf("pool file %q %v", rel, err)
	}
	os.WriteFile(path, []byte("RIFF"), 0o644)
	rel2, _, _ := s.NewPoolFile("catch", now)
	if rel2 != "audio/catch_2026-10-04_210000_2.wav" {
		t.Fatalf("second in the same second: %q", rel2)
	}
	tp.Change("drop", now, func(st *State) error {
		_, err := st.Place(1, Clip{File: rel, Frames: 100}, true)
		return err
	})
	if err := s.Save(tp); err != nil {
		t.Fatal(err)
	}
	back, err := s.Load(tp.ID)
	if err != nil || len(back.Tracks[0].Clips) != 1 || len(back.History) != 1 {
		t.Fatalf("loaded %+v %v", back, err)
	}
	cl, err := s.Clone(tp.ID, "", now)
	if err != nil || cl.Name != "Bedtime Orchid! copy" || len(cl.Tracks[0].Clips) != 1 || len(cl.History) != 0 {
		t.Fatalf("clone %+v %v", cl, err)
	}
	list, _ := s.List()
	if len(list) != 2 || list[0].BPM != 84 {
		t.Fatalf("list %+v", list)
	}
	// Deleting the original keeps the audio its clone uses.
	if err := s.Delete(tp.ID); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Hour)
	os.Chtimes(path, old, old)
	os.Chtimes(filepath.Join(dir, "audio", "catch_2026-10-04_210000_2.wav"), old, old)
	n, _, err := s.Cleanup(nil)
	if err != nil || n != 1 {
		t.Fatalf("cleanup removed %d (%v), want only the unused file", n, err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("the clone's audio was removed")
	}
	if _, err := s.Load("../../etc"); !errors.Is(err, ErrNoSuchTape) {
		t.Fatal("a crafted id must not load")
	}
	if s.AudioPath("../x.wav") != "" || s.AudioPath("audio/../../x.wav") != "" {
		t.Fatal("a crafted pool path must not resolve")
	}
}

func TestSourcesParse(t *testing.T) {
	got, err := ParseSources("main=1,2:AB ch1=3,4:A aux=7,8", 8)
	if err != nil || len(got) != 3 || got[0].Pair != [2]int{0, 1} || len(got[0].Leaks) != 2 || got[2].Pair != [2]int{6, 7} || len(got[2].Leaks) != 0 {
		t.Fatalf("%+v %v", got, err)
	}
	for _, bad := range []string{"", "main", "main=1", "main=0,1", "main=1,9", "main=1,2:C"} {
		if _, err := ParseSources(bad, 8); err == nil {
			t.Errorf("%q should be refused", bad)
		}
	}
}

func TestATrackWithNoClipsIsAnEmptyListNotNull(t *testing.T) {
	tp := NewTape("2026-10-04_t", "t", 48000, 48000*60, 2, time.Now())
	tp.Change("drop", time.Now(), func(s *State) error { _, err := s.Place(1, Clip{File: "audio/a.wav", Frames: 10}, true); return err })
	tp.Change("rm", time.Now(), func(s *State) error { s.Tracks[0].Clips = s.Tracks[0].Clips[:0]; return nil })
	tp.Change("cut", time.Now(), func(s *State) error { s.Tracks[1].Clips = cutRange(s.Tracks[1].Clips, 0, 0, 5); return nil })
	for _, st := range append([]State{tp.State}, tp.History...) {
		for _, tr := range st.Tracks {
			if tr.Clips == nil {
				t.Fatal("a nil clip list marshals as null, which the page can't read")
			}
		}
	}
}

func TestAPassBegunUnderAnotherLoopIsNotLogged(t *testing.T) {
	tr := newTransport()
	m1 := &Mix{loop: Loop{In: 0, Out: 1000, On: true}, length: 100000, end: 100000}
	m2 := &Mix{loop: Loop{In: 500, Out: 1500, On: true}, length: 100000, end: 100000}
	e := &Engine{tr: tr, actions: make(chan Action, 4), pool: nil}
	e.mix.Store(m1)
	tr.apply(Action{Kind: "play"}, 0, m1, m1.length)
	e.advance(nil, 0, 1000) // one whole pass of [0, 1000)
	e.advance(nil, 1000, 600)
	// The loop moves mid-pass: [500, 1500). The pass that began at In 0
	// isn't a pass of this loop.
	e.mix.Store(m2)
	e.advance(nil, 1600, 900) // reaches 1500, wraps to 500
	e.advance(nil, 2500, 1000)
	cyc := tr.Cycles()
	if len(cyc) != 2 || cyc[0] != (Cycle{Out: 0, In: 0, Len: 1000}) || cyc[1] != (Cycle{Out: 2500, In: 500, Len: 1000}) {
		t.Fatalf("cycles = %+v", cyc)
	}
}

func TestATapeCantStartWithALoopLongerThanATrack(t *testing.T) {
	s := newTestStore(t) // 60 s tracks
	if _, err := s.Create("long", 20, 40, time.Now()); err == nil {
		t.Fatal("a 480 s loop on a 60 s tape should be refused")
	}
	if l, _ := s.List(); len(l) != 0 {
		t.Fatalf("a refused tape left %d behind", len(l))
	}
}

func TestCleanupIgnoresAFolderWithNoTape(t *testing.T) {
	s := newTestStore(t)
	if err := os.MkdirAll(filepath.Join(s.Dir(), "tapes", "2026-10-04_half-made"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Cleanup(nil); err != nil {
		t.Fatalf("a folder with no tape.json blocked clean-up: %v", err)
	}
}
