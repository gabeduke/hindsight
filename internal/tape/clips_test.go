package tape

import (
	"errors"
	"testing"
)

// threeClips is firstLoop's clip on track 1 at 0, and two more clips of the
// same audio: on track 2 a bar on (96000), and on track 3 half a bar in.
func threeClips(t *testing.T) (*Engine, *Tape, [3]Clip) {
	t.Helper()
	e, _, tp, a := firstLoop(t)
	b := Clip{File: a.File, Src: a.Src, Frames: a.Frames, At: 96000}
	c := Clip{File: a.File, Src: a.Src, Frames: 48000, At: 48000}
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error {
		var err error
		if b, err = s.Place(2, b, false); err != nil {
			return err
		}
		c, err = s.Place(3, c, false)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return e, tp, [3]Clip{a, b, c}
}

func where(t *testing.T, e *Engine, id string) (int, Clip) {
	t.Helper()
	for i, tr := range e.Loaded().Tracks {
		for _, c := range tr.Clips {
			if c.ID == id {
				return i + 1, c
			}
		}
	}
	t.Fatalf("no clip %s", id)
	return 0, Clip{}
}

func TestMoveClipsTogether(t *testing.T) {
	e, tp, cl := threeClips(t)
	a, b := cl[0], cl[1]
	res, err := e.EditOp(tp.ID, EditRequest{Op: "move", Clips: []string{a.ID, b.ID}, DT: 48000, DTrack: 1})
	if err != nil || res.Clips != 2 {
		t.Fatalf("move = %+v %v", res, err)
	}
	if n, c := where(t, e, a.ID); n != 2 || c.At != 48000 {
		t.Fatalf("a went to track %d at %d", n, c.At)
	}
	// b lands on track 3 clear of the clip there (48000–96000): the base.
	if n, c := where(t, e, b.ID); n != 3 || c.At != 144000 || c.Layer != 0 {
		t.Fatalf("b went to track %d at %d layer %d", n, c.At, c.Layer)
	}
	if n := len(track(e, 1)); n != 0 {
		t.Fatalf("track 1 kept %d clips", n)
	}
	// One undo puts both back.
	e.Undo(tp.ID, false)
	if n, c := where(t, e, a.ID); n != 1 || c.At != 0 {
		t.Fatalf("after undo a is on track %d at %d", n, c.At)
	}
	if n, c := where(t, e, b.ID); n != 2 || c.At != 96000 {
		t.Fatalf("after undo b is on track %d at %d", n, c.At)
	}
}

func TestAMoveThatWouldLoseAClipIsRefusedWhole(t *testing.T) {
	e, tp, cl := threeClips(t)
	ids := []string{cl[0].ID, cl[1].ID}
	for _, req := range []EditRequest{
		{Op: "move", Clips: ids, DTrack: 3},             // b off the fourth track
		{Op: "move", Clips: ids, DTrack: -1},            // a above the first
		{Op: "move", Clips: ids, DT: -1},                // a before the start
		{Op: "move", Clips: ids, DT: e.Loaded().Length}, // past the end
		{Op: "move", Clips: []string{cl[0].ID, "nope"}, DT: 1},
		{Op: "move", Clips: ids}, // nowhere
		{Op: "move"},
	} {
		if _, err := e.EditOp(tp.ID, req); err == nil {
			t.Fatalf("%+v was let through", req)
		}
	}
	if n, c := where(t, e, cl[0].ID); n != 1 || c.At != 0 {
		t.Fatalf("a refused move moved a clip: track %d at %d", n, c.At)
	}
}

func TestMovedClipsStayStacked(t *testing.T) {
	e, tp, cl := threeClips(t)
	// A part over a: the same span on track 1, a layer up.
	over := Clip{File: cl[0].File, Src: cl[0].Src, Frames: 96000, At: 0}
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error { var err error; over, err = s.Place(1, over, false); return err }); err != nil {
		t.Fatal(err)
	}
	if over.Layer != 1 {
		t.Fatalf("the part over it is on layer %d", over.Layer)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "move", Clips: []string{over.ID, cl[0].ID}, DT: 192000}); err != nil {
		t.Fatal(err)
	}
	if _, c := where(t, e, cl[0].ID); c.Layer != 0 || c.At != 192000 {
		t.Fatalf("the base moved to %+v", c)
	}
	if _, c := where(t, e, over.ID); c.Layer != 1 || c.At != 192000 {
		t.Fatalf("the part over it moved to %+v", c)
	}
}

func TestRemoveClipsTogether(t *testing.T) {
	e, tp, cl := threeClips(t)
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "remove", Clips: []string{cl[0].ID, cl[2].ID}}); err != nil {
		t.Fatal(err)
	}
	if len(track(e, 1)) != 0 || len(track(e, 3)) != 0 || len(track(e, 2)) != 1 {
		t.Fatal("remove took the wrong clips")
	}
	e.Undo(tp.ID, false)
	if len(track(e, 1)) != 1 || len(track(e, 3)) != 1 {
		t.Fatal("one undo should bring both back")
	}
	// A clip named twice is one clip.
	if res, err := e.EditOp(tp.ID, EditRequest{Op: "remove", Clips: []string{cl[1].ID, cl[1].ID}}); err != nil || res.Clips != 1 {
		t.Fatalf("remove a clip named twice = %+v %v", res, err)
	}
	e.Undo(tp.ID, false)
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "remove", Clips: []string{cl[0].ID, "nope"}}); !errors.Is(err, ErrNoSuchClip) {
		t.Fatalf("remove with a missing clip = %v", err)
	}
	if len(track(e, 1)) != 1 {
		t.Fatal("a refused remove took a clip")
	}
}

func TestDuplicateClipsLaysThemAfterTheLast(t *testing.T) {
	e, tp, cl := threeClips(t)
	a, b := cl[0], cl[1] // [0, 96000) on 1, [96000, 192000) on 2
	res, err := e.EditOp(tp.ID, EditRequest{Op: "duplicate", Clips: []string{a.ID, b.ID}})
	if err != nil || res.Clips != 2 || len(res.IDs) != 2 {
		t.Fatalf("duplicate = %+v %v", res, err)
	}
	// The copies' ids, so a second duplicate can carry the run on.
	for _, id := range res.IDs {
		if n, c := where(t, e, id); c.At < 192000 || (n != 1 && n != 2) {
			t.Fatalf("copy %s on track %d at %d", id, n, c.At)
		}
	}
	if c := track(e, 1); len(c) != 2 || c[1].At != 192000 || c[1].File != a.File || c[1].ID == a.ID {
		t.Fatalf("track 1 = %+v", c)
	}
	if c := track(e, 2); len(c) != 2 || c[1].At != 288000 {
		t.Fatalf("track 2 = %+v", c)
	}
	e.Undo(tp.ID, false)
	if len(track(e, 1)) != 1 || len(track(e, 2)) != 1 {
		t.Fatal("one undo should take both copies back")
	}
}

func TestCopyClipsKeepsTheirTracksAndSpacing(t *testing.T) {
	e, tp, cl := threeClips(t)
	a, c := cl[0], cl[2] // track 1 at 0, track 3 at 48000
	steps := len(e.Loaded().History)
	res, err := e.EditOp(tp.ID, EditRequest{Op: "copy", Clips: []string{c.ID, a.ID}})
	if err != nil || res.Clips != 2 || res.Board == nil {
		t.Fatalf("copy = %+v %v", res, err)
	}
	b := res.Board
	if len(b.Tracks) != 3 || len(b.Tracks[0]) != 1 || len(b.Tracks[1]) != 0 || len(b.Tracks[2]) != 1 || b.Frames != 96000 {
		t.Fatalf("clipboard = %+v", b)
	}
	if b.Tracks[0][0].At != 0 || b.Tracks[2][0].At != 48000 || b.Tracks[2][0].ID != "" {
		t.Fatalf("clipboard spacing = %+v", b.Tracks)
	}
	// The tape is as it was.
	if len(track(e, 1)) != 1 || len(track(e, 3)) != 1 || len(e.Loaded().History) != steps {
		t.Fatal("a copy changed the tape")
	}
}

func TestReverseClipsTogether(t *testing.T) {
	e, tp, cl := threeClips(t)
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "reverse", Clips: []string{cl[0].ID, cl[1].ID}}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{cl[0].ID, cl[1].ID} {
		if _, c := where(t, e, id); c.Reversed == nil {
			t.Fatalf("%s isn't reversed", id)
		}
	}
	if _, c := where(t, e, cl[2].ID); c.Reversed != nil {
		t.Fatal("a clip not picked was reversed")
	}
	e.Undo(tp.ID, false)
	for _, id := range []string{cl[0].ID, cl[1].ID} {
		if _, c := where(t, e, id); c.Reversed != nil {
			t.Fatal("one undo should turn both back")
		}
	}
	// A missing clip: refused, and no reversed file is left behind.
	before := poolCount(t, e)
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "reverse", Clips: []string{cl[0].ID, "nope"}}); !errors.Is(err, ErrNoSuchClip) {
		t.Fatalf("reverse with a missing clip = %v", err)
	}
	if after := poolCount(t, e); after != before {
		t.Fatalf("%d pool files before, %d after", before, after)
	}
}

func TestDuplicateOverAudioLayersAndPastTheEndIsRefused(t *testing.T) {
	e, tp, cl := threeClips(t)
	// The copy of c (track 3, 48000–96000) lands on 96000–144000; put a clip
	// there first: the copy goes a layer above it.
	under := Clip{File: cl[0].File, Src: cl[0].Src, Frames: 1000, At: 100000}
	e.Edit(tp.ID, "", func(_ *Tape, s *State) error { _, err := s.Place(3, under, false); return err })
	res, err := e.EditOp(tp.ID, EditRequest{Op: "duplicate", Clips: []string{cl[2].ID}})
	if err != nil {
		t.Fatal(err)
	}
	if _, c := where(t, e, res.IDs[0]); c.At != 96000 || c.Layer != 1 {
		t.Fatalf("the copy over audio = %+v", c)
	}
	// One at the very end can't be copied after itself.
	at := e.Loaded().Length - cl[2].Frames
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "slide", Clip: cl[2].ID, At: &at}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "duplicate", Clips: []string{cl[2].ID}}); !errors.Is(err, ErrPastTheEnd) {
		t.Fatalf("a copy past the end = %v", err)
	}
}

// Clips copied as they lie drop back where they lay, replacing only what's
// under each: a clip between them on another track, and the gaps, stay.
func TestADroppedSelectionLeavesWhatWasntPicked(t *testing.T) {
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 400000, func(i int) float64 { return 0.25 })
	if _, err := e.DropTake(tp.ID, take, 0, 96000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	a := track(e, 1)[0]
	c := Clip{File: a.File, Src: a.Src, Frames: 48000, At: 48000}
	mid := Clip{File: a.File, Src: a.Src, Frames: 10000, At: 20000}
	e.Edit(tp.ID, "", func(_ *Tape, s *State) error {
		var err error
		if c, err = s.Place(3, c, false); err != nil {
			return err
		}
		mid, err = s.Place(2, mid, false)
		return err
	})
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "copy", Clips: []string{a.ID, c.ID}}); err != nil {
		t.Fatal(err)
	}
	e.Start()
	e.Do(Action{Kind: "locate", Pos: 0})
	waitFor(t, func() bool { sink.play(t, 512); return e.tr.Status().Pos == 0 })
	if _, err := e.DropClipboard(tp.ID, 1, false); err != nil {
		t.Fatal(err)
	}
	if cl := track(e, 2); len(cl) != 1 || cl[0].ID != mid.ID {
		t.Fatalf("track 2 after the drop = %+v: the clip between them went", cl)
	}
	if n1, n3 := len(track(e, 1)), len(track(e, 3)); n1 != 1 || n3 != 1 {
		t.Fatalf("tracks 1 and 3 have %d and %d clips: each copy should replace its original", n1, n3)
	}
}

func TestReversingAMixTurnsEachItsOwnWay(t *testing.T) {
	e, tp, cl := threeClips(t)
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "reverse", Clip: cl[0].ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "reverse", Clips: []string{cl[0].ID, cl[1].ID, cl[1].ID}}); err != nil {
		t.Fatal(err)
	}
	if _, a := where(t, e, cl[0].ID); a.Reversed != nil || a.File != cl[0].File {
		t.Fatalf("the reversed one should play forwards again: %+v", a)
	}
	if _, b := where(t, e, cl[1].ID); b.Reversed == nil {
		t.Fatalf("the forwards one should be reversed: %+v", b)
	}
}
