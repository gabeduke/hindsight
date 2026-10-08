package tape

import (
	"errors"
	"testing"
)

// arranged is a state of four 1-bar-is-96000 tracks: A on track 1 at 0–96000,
// B on track 2 at 96000–192000, C on track 3 across the bar line,
// 48000–144000 (faded in and out), sections Verse 0–96000 and Chorus
// 96000–192000, and the loop on the chorus.
func arranged() State {
	g := Grid{Frames: 96000, Bars: 1}
	s := State{Grid: &g, Loop: Loop{In: 96000, Out: 192000, On: true}}
	for n := 1; n <= 4; n++ {
		s.Tracks = append(s.Tracks, Track{N: n, Bus: BusA, Clips: []Clip{}})
	}
	s.Tracks[0].Clips = []Clip{{ID: "A", File: "audio/a.wav", Frames: 96000, At: 0}}
	s.Tracks[1].Clips = []Clip{{ID: "B", File: "audio/b.wav", Frames: 96000, At: 96000}}
	s.Tracks[2].Clips = []Clip{{ID: "C", File: "audio/c.wav", Src: 100, Frames: 96000, At: 48000, FadeIn: 480, FadeOut: 480}}
	s.Sections = []Section{{ID: "v", Name: "Verse", At: 0, End: 96000}, {ID: "c", Name: "Chorus", At: 96000, End: 192000}}
	return s
}

func clipAt(t *testing.T, s State, track int, at int64) Clip {
	t.Helper()
	for _, c := range s.Tracks[track-1].Clips {
		if c.At == at {
			return c
		}
	}
	t.Fatalf("no clip on track %d at %d: %+v", track, at, s.Tracks[track-1].Clips)
	return Clip{}
}

func TestInsertPushesEveryTrackAndSectionLater(t *testing.T) {
	s := arranged()
	board := &Clipboard{Tracks: [][]Clip{{{File: "audio/x.wav", Frames: 48000}}}, Frames: 48000}
	n, err := s.insertTime(board, 4, 96000, 48000*60, 48000)
	if err != nil || n != 1 {
		t.Fatalf("insert = %d, %v", n, err)
	}
	if err := s.validate(48000 * 60); err != nil {
		t.Fatal(err)
	}
	// Before the point, as it was; after it, 48000 later; across it, split.
	if c := clipAt(t, s, 1, 0); c.ID != "A" || c.Frames != 96000 {
		t.Fatalf("A = %+v", c)
	}
	if c := clipAt(t, s, 2, 144000); c.ID != "B" {
		t.Fatalf("B = %+v", c)
	}
	head, tail := clipAt(t, s, 3, 48000), clipAt(t, s, 3, 144000)
	if head.Frames != 48000 || head.FadeIn != 480 || head.FadeOut != 0 || tail.Frames != 48000 || tail.Src != 100+48000 || tail.FadeIn != 0 || tail.FadeOut != 480 {
		t.Fatalf("C split at the point: %+v, %+v", head, tail)
	}
	// The clipboard in the gap, on track 4.
	if c := clipAt(t, s, 4, 96000); c.File != "audio/x.wav" || c.Frames != 48000 {
		t.Fatalf("inserted = %+v", c)
	}
	// The verse ends at the point and stays; the chorus starts there and moves.
	if v, c := s.Sections[0], s.Sections[1]; v.At != 0 || v.End != 96000 || c.At != 144000 || c.End != 240000 {
		t.Fatalf("sections = %+v", s.Sections)
	}
	if s.Loop.In != 144000 || s.Loop.Out != 240000 {
		t.Fatalf("loop = %+v", s.Loop)
	}
}

func TestInsertInsideASectionStretchesIt(t *testing.T) {
	s := arranged()
	board := &Clipboard{Tracks: [][]Clip{{{File: "audio/x.wav", Frames: 1000}}}, Frames: 1000}
	if _, err := s.insertTime(board, 1, 120000, 48000*60, 48000); err != nil {
		t.Fatal(err)
	}
	if c := s.Sections[1]; c.At != 96000 || c.End != 193000 {
		t.Fatalf("the chorus = %+v: an insert inside it makes it longer", c)
	}
	if s.Loop.Out != 193000 {
		t.Fatalf("the loop = %+v", s.Loop)
	}
}

func TestInsertPastTheTapesEndIsRefused(t *testing.T) {
	s := arranged()
	board := &Clipboard{Tracks: [][]Clip{{{File: "audio/x.wav", Frames: 96000}}}, Frames: 96000}
	if _, err := s.insertTime(board, 1, 0, 250000, 48000); !errors.Is(err, ErrPastTheEnd) {
		t.Fatalf("pushed past a 250000-frame tape = %v", err)
	}
	// Four tracks of clipboard from track 2 don't fit.
	four := &Clipboard{Tracks: make([][]Clip, 4), Frames: 10}
	four.Tracks[0] = []Clip{{File: "audio/x.wav", Frames: 10}}
	if _, err := s.insertTime(four, 2, 0, 48000*60, 48000); !errors.Is(err, ErrNoSuchTrack) {
		t.Fatalf("four tracks from track 2 = %v", err)
	}
}

func TestDeleteTimeClosesTheGap(t *testing.T) {
	s := arranged()
	// Delete the second half of the verse and the first of the chorus.
	if err := s.deleteTime(48000, 144000); err != nil {
		t.Fatal(err)
	}
	if err := s.validate(48000 * 60); err != nil {
		t.Fatal(err)
	}
	if c := clipAt(t, s, 1, 0); c.Frames != 48000 {
		t.Fatalf("A = %+v: its second half is gone", c)
	}
	if c := clipAt(t, s, 2, 48000); c.ID != "B" || c.Frames != 48000 || c.Src != 48000 {
		t.Fatalf("B = %+v: its first half is gone, and it moved up", c)
	}
	if n := len(s.Tracks[2].Clips); n != 0 {
		t.Fatalf("C was all inside it: %d left", n)
	}
	if v, c := s.Sections[0], s.Sections[1]; v.At != 0 || v.End != 48000 || c.At != 48000 || c.End != 96000 {
		t.Fatalf("sections = %+v", s.Sections)
	}
	// A section all inside goes.
	s2 := arranged()
	if err := s2.deleteTime(96000, 192000); err != nil {
		t.Fatal(err)
	}
	if len(s2.Sections) != 1 || s2.Sections[0].Name != "Verse" {
		t.Fatalf("after deleting the chorus' bars: %+v", s2.Sections)
	}
	if err := s2.deleteTime(5, 5); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("nothing selected = %v", err)
	}
}

func TestDuplicateSectionPlaysItTwiceInARow(t *testing.T) {
	s := arranged()
	cp, err := s.duplicateSection("v", 48000*60, 48000)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.validate(48000 * 60); err != nil {
		t.Fatal(err)
	}
	if cp.Name != "Verse" || cp.At != 96000 || cp.End != 192000 || cp.ID == "v" {
		t.Fatalf("the copy = %+v", cp)
	}
	// The verse's audio again at 96000: A's copy on track 1, C's head on
	// track 3; the chorus and B pushed a verse later.
	if c := clipAt(t, s, 1, 96000); c.File != "audio/a.wav" || c.ID == "A" {
		t.Fatalf("A again = %+v", c)
	}
	if c := clipAt(t, s, 3, 144000); c.File != "audio/c.wav" || c.Frames != 48000 {
		t.Fatalf("C's head again = %+v", c)
	}
	if c := clipAt(t, s, 2, 192000); c.ID != "B" {
		t.Fatalf("B = %+v", c)
	}
	if names := []string{s.Sections[0].Name, s.Sections[1].Name, s.Sections[2].Name}; names[0] != "Verse" || names[1] != "Verse" || names[2] != "Chorus" || s.Sections[2].At != 192000 {
		t.Fatalf("sections = %+v", s.Sections)
	}
	if _, err := s.duplicateSection("nope", 48000*60, 48000); !errors.Is(err, ErrNoSuchSection) {
		t.Fatalf("no section = %v", err)
	}
}

func TestInsertAndDeleteTimeAreOneUndoEach(t *testing.T) {
	e, sink, tp, a := firstLoop(t) // a: 96000 frames at 0, the loop 0–96000
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "copy", Track: 1}); err != nil {
		t.Fatal(err)
	}
	b := Clip{File: a.File, Src: a.Src, Frames: 96000, At: 96000}
	e.Edit(tp.ID, "", func(_ *Tape, s *State) error { _, err := s.Place(2, b, false); return err })
	e.Start()
	e.Do(Action{Kind: "locate", Pos: 96000})
	waitFor(t, func() bool { sink.play(t, 512); return e.tr.Status().Pos == 96000 })
	res, err := e.EditOp(tp.ID, EditRequest{Op: "insert", Track: 3})
	if err != nil || res.Frames != 96000 || res.At != 96000 || res.Clips != 1 {
		t.Fatalf("insert = %+v %v", res, err)
	}
	if c := track(e, 2); c[0].At != 192000 {
		t.Fatalf("track 2 after the insert: %+v", c)
	}
	if c := track(e, 3); len(c) != 1 || c[0].At != 96000 {
		t.Fatalf("track 3 after the insert: %+v", c)
	}
	e.Undo(tp.ID, false)
	if c := track(e, 2); c[0].At != 96000 || len(track(e, 3)) != 0 {
		t.Fatal("one undo should take the whole insert back")
	}
	// Delete time on the loop (0–96000): track 2's clip moves to 0.
	res, err = e.EditOp(tp.ID, EditRequest{Op: "delete-time"})
	if err != nil || res.Frames != 96000 || res.At != 0 {
		t.Fatalf("delete time = %+v %v", res, err)
	}
	if len(track(e, 1)) != 0 || track(e, 2)[0].At != 0 {
		t.Fatalf("after delete time: %+v / %+v", track(e, 1), track(e, 2))
	}
	e.Undo(tp.ID, false)
	if len(track(e, 1)) != 1 || track(e, 2)[0].At != 96000 {
		t.Fatal("one undo should take the whole delete back")
	}
}

func TestInsertFromTheCrate(t *testing.T) {
	e, sink, tp, a := firstLoop(t)
	take := takeWAV(t, 200000, func(int) float64 { return 0.25 })
	k, err := e.KeepTake(take, "jam_take.wav", "jam", 0, 48000, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	e.Start()
	e.Do(Action{Kind: "locate", Pos: 0})
	waitFor(t, func() bool { sink.play(t, 512); return e.tr.Status().Pos == 0 })
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "insert", Track: 1, Crate: k.ID}); err != nil {
		t.Fatal(err)
	}
	cl := track(e, 1)
	if len(cl) != 2 || cl[0].File != k.File || cl[0].At != 0 || cl[1].ID != a.ID || cl[1].At != 48000 {
		t.Fatalf("track 1 = %+v: the kept clip, then the loop pushed after it", cl)
	}
}

// Delete time on a range cuts its span, wherever the loop is.
func TestDeleteTimeOnARangeCutsItsSpan(t *testing.T) {
	e, _, tp, _ := firstLoop(t)
	setLoop(t, e, 0, 96000)
	res, err := e.EditOp(tp.ID, EditRequest{Op: "delete-time", Span: &Span{From: 24000, To: 48000}})
	if err != nil || res.At != 24000 || res.Frames != 24000 {
		t.Fatalf("delete-time on a span = %+v %v", res, err)
	}
	if cl := track(e, 1); len(cl) != 2 || cl[0].End() != 24000 || cl[1].At != 24000 || cl[1].End() != 72000 {
		t.Fatalf("after = %+v", cl)
	}
}
