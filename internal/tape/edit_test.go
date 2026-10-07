package tape

import (
	"errors"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// firstLoop makes an empty test tape's first loop: a take's first 96000
// frames dropped on track 1, a ramp so a clip's Src can be read back.
func firstLoop(t *testing.T) (*Engine, *loopSink, *Tape, Clip) {
	t.Helper()
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return float64(i) / 1e6 })
	if _, err := e.CopyTake(take, "jam_take.wav", 0, 96000, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	d, err := e.DropClipboard(tp.ID, 1, false)
	if err != nil {
		t.Fatal(err)
	}
	return e, sink, tp, d.Clip
}

func setLoop(t *testing.T, e *Engine, in, out int64) {
	t.Helper()
	if err := e.Edit(e.LoadedID(), "", func(_ *Tape, s *State) error {
		s.Loop = Loop{In: in, Out: out, On: true}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func track(e *Engine, n int) []Clip { return e.Loaded().Tracks[n-1].Clips }

func TestLiftTakesTheSelectionAndLeavesSilence(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	setLoop(t, e, 24000, 72000)
	res, err := e.EditOp(tp.ID, EditRequest{Op: "lift", Track: 1})
	if err != nil || res.Clips != 1 || res.Frames != 48000 {
		t.Fatalf("lift = %+v %v", res, err)
	}
	// On the clipboard: the middle, from 0, reading the same audio.
	c, _ := e.Clipboard()
	if len(c.Tracks) != 1 || len(c.Tracks[0]) != 1 {
		t.Fatalf("clipboard = %+v", c)
	}
	if got := c.Tracks[0][0]; got.At != 0 || got.Frames != 48000 || got.Src != orig.Src+24000 || got.File != orig.File {
		t.Fatalf("lifted clip = %+v, from %+v", got, orig)
	}
	// On the tape: the two ends, and a gap.
	cl := track(e, 1)
	if len(cl) != 2 || cl[0].End() != 24000 || cl[1].At != 72000 || cl[1].End() != 96000 {
		t.Fatalf("after the lift the track = %+v", cl)
	}
	// One undo puts it back.
	if err := e.Undo(tp.ID, false); err != nil || len(track(e, 1)) != 1 {
		t.Fatalf("undo: %v, track = %+v", err, track(e, 1))
	}
	// Nothing there: refused, and the clipboard is as it was.
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "lift", Track: 2}); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("lifting an empty track = %v", err)
	}
	if c2, _ := e.Clipboard(); c2.Tracks[0][0].Src != c.Tracks[0][0].Src {
		t.Fatal("a refused lift changed the clipboard")
	}
}

func TestCopyAllKeepsTheTracksApartAndTheTapeAsItIs(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	setLoop(t, e, 0, 48000)
	res, err := e.EditOp(tp.ID, EditRequest{Op: "copy", All: true})
	if err != nil || res.Clips != 1 {
		t.Fatalf("copy all = %+v %v", res, err)
	}
	c, _ := e.Clipboard()
	if len(c.Tracks) != 4 || len(c.Tracks[0]) != 1 || len(c.Tracks[1]) != 0 || c.Frames != 48000 {
		t.Fatalf("clipboard = %+v", c)
	}
	if cl := track(e, 1); len(cl) != 1 || cl[0] != orig {
		t.Fatalf("a copy changed the tape: %+v", cl)
	}
	// Dropped from track 1 it lands on all four; from track 2 it can't fit.
	if _, err := e.DropClipboard(tp.ID, 2, false); !errors.Is(err, ErrNoSuchTrack) {
		t.Fatalf("four tracks from track 2 = %v", err)
	}
	// Merged, it fits anywhere.
	if _, err := e.DropClipboard(tp.ID, 2, true); err != nil {
		t.Fatalf("merge drop: %v", err)
	}
}

func TestMergeDropLayersEveryTrackOnOne(t *testing.T) {
	e, sink, tp, _ := firstLoop(t)
	// Track 2 gets the same loop, so there are two tracks to merge.
	e.Start()
	waitFor(t, func() bool { sink.play(t, 512); return e.tr.Status().Pos == 96000 })
	e.Do(Action{Kind: "locate", Pos: 0})
	waitFor(t, func() bool { sink.play(t, 512); return e.tr.Status().Pos == 0 })
	if _, err := e.DropClipboard(tp.ID, 2, false); err != nil {
		t.Fatal(err)
	}
	setLoop(t, e, 0, 96000)
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "copy", All: true}); err != nil {
		t.Fatal(err)
	}
	e.Do(Action{Kind: "locate", Pos: 96000})
	waitFor(t, func() bool { sink.play(t, 512); return e.tr.Status().Pos == 96000 })
	d, err := e.DropClipboard(tp.ID, 3, true)
	if err != nil || d.Tracks != 1 || d.End != 192000 {
		t.Fatalf("merge drop = %+v %v", d, err)
	}
	cl := track(e, 3)
	if len(cl) != 2 || cl[0].Layer == cl[1].Layer || cl[0].At != 96000 || cl[1].At != 96000 {
		t.Fatalf("merged = %+v, want two layers at 96000", cl)
	}
	if len(track(e, 4)) != 0 {
		t.Fatal("a merge drop reached another track")
	}
}

func TestSplitAndJoinUndoEachOther(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	pos := int64(30000)
	res, err := e.EditOp(tp.ID, EditRequest{Op: "split", Track: 1, Pos: &pos})
	if err != nil || res.Clips != 1 {
		t.Fatalf("split = %+v %v", res, err)
	}
	cl := track(e, 1)
	if len(cl) != 2 || cl[0].End() != 30000 || cl[1].At != 30000 || cl[1].Src != orig.Src+30000 || cl[1].End() != orig.End() {
		t.Fatalf("split into %+v", cl)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "join", Clip: cl[0].ID}); err != nil {
		t.Fatalf("join: %v", err)
	}
	if got := track(e, 1); len(got) != 1 || got[0] != orig {
		t.Fatalf("joined = %+v, want %+v", got, orig)
	}
	// Nowhere to split; nothing to join.
	pos = 150000
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "split", Track: 1, Pos: &pos}); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("split in silence = %v", err)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "join", Clip: orig.ID}); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("join with nothing after = %v", err)
	}
	// Halves at different levels don't join: one of them would change.
	pos = 30000
	e.EditOp(tp.ID, EditRequest{Op: "split", Track: 1, Pos: &pos})
	e.Edit(tp.ID, "", func(_ *Tape, s *State) error { s.Tracks[0].Clips[1].GainDB = -3; return nil })
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "join", Clip: track(e, 1)[0].ID}); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("joining different levels = %v", err)
	}
}

func TestSlideMovesAClipToTheLowestFreeLayer(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	pos := int64(48000)
	e.EditOp(tp.ID, EditRequest{Op: "split", Track: 1, Pos: &pos})
	tail := track(e, 1)[1]
	// Onto the head: it goes above it.
	at := int64(24000)
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "slide", Clip: tail.ID, At: &at}); err != nil {
		t.Fatal(err)
	}
	moved := findClip(t, e, tail.ID)
	if moved.At != 24000 || moved.Layer != 1 || moved.Src != tail.Src {
		t.Fatalf("slid onto the head = %+v", moved)
	}
	// Clear of it: back on the base.
	at = 96000
	e.EditOp(tp.ID, EditRequest{Op: "slide", Clip: tail.ID, At: &at})
	if moved = findClip(t, e, tail.ID); moved.At != 96000 || moved.Layer != 0 {
		t.Fatalf("slid clear = %+v", moved)
	}
	// Off either end: refused.
	at = -1
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "slide", Clip: tail.ID, At: &at}); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("slide before the start = %v", err)
	}
	at = e.Loaded().Length - 100
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "slide", Clip: tail.ID, At: &at}); !errors.Is(err, ErrPastTheEnd) {
		t.Fatalf("slide past the end = %v", err)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "slide", Clip: "nope", At: &at}); !errors.Is(err, ErrNoSuchClip) {
		t.Fatalf("slide no clip = %v", err)
	}
	_ = orig
}

func findClip(t *testing.T, e *Engine, id string) Clip {
	t.Helper()
	_, c, err := e.Loaded().Clip(id)
	if err != nil {
		t.Fatal(err)
	}
	return *c
}

func TestMultiplyDoublesTheLoopOverWhatFollows(t *testing.T) {
	e, sink, tp, orig := firstLoop(t)
	// Something after the loop on track 2, which the doubling replaces.
	e.Start()
	waitFor(t, func() bool { sink.play(t, 512); return e.tr.Status().Pos == 96000 })
	e.DropClipboard(tp.ID, 2, false)
	setLoop(t, e, 0, 96000)
	res, err := e.EditOp(tp.ID, EditRequest{Op: "multiply"})
	if err != nil || res.Clips != 1 || res.Frames != 192000 {
		t.Fatalf("multiply = %+v %v", res, err)
	}
	if l := e.Loaded().Loop; l.In != 0 || l.Out != 192000 || !l.On {
		t.Fatalf("loop = %+v", l)
	}
	cl := track(e, 1)
	if len(cl) != 2 || cl[1].At != 96000 || cl[1].Src != orig.Src || cl[1].File != orig.File || cl[1].ID == orig.ID {
		t.Fatalf("track 1 = %+v", cl)
	}
	if len(track(e, 2)) != 0 {
		t.Fatalf("track 2 = %+v, want what followed the loop gone", track(e, 2))
	}
	// Too long to double: refused.
	setLoop(t, e, 1000000, 2000000)
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "multiply"}); !errors.Is(err, ErrPastTheEnd) {
		t.Fatalf("multiplying past the end = %v", err)
	}
}

func TestAnEditNamesItsTape(t *testing.T) {
	e, _, _, _ := firstLoop(t)
	if _, err := e.EditOp("other", EditRequest{Op: "multiply"}); err != ErrWrongTape {
		t.Fatalf("another tape = %v", err)
	}
	if _, err := e.EditOp(e.LoadedID(), EditRequest{Op: "explode"}); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("no such edit = %v", err)
	}
}

func TestALiftWhoseClipboardCantBeWrittenLiftsNothing(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	setLoop(t, e, 0, 48000)
	undo, _ := e.UndoDepth()
	// A directory where clipboard.json goes: the write fails.
	os.Remove(e.store.clipboardPath())
	if err := os.MkdirAll(filepath.Join(e.store.clipboardPath(), "x"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "lift", Track: 1}); err == nil {
		t.Fatal("a lift with nowhere to put it succeeded")
	}
	if cl := track(e, 1); len(cl) != 1 || cl[0] != orig {
		t.Fatalf("the tape after a failed lift = %+v", cl)
	}
	if u, r := e.UndoDepth(); u != undo || r != 0 {
		t.Fatalf("undo %d redo %d after a failed lift, want %d and 0", u, r, undo)
	}
}

func TestJoinWorksFromEitherHalf(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	pos := int64(30000)
	e.EditOp(tp.ID, EditRequest{Op: "split", Track: 1, Pos: &pos})
	tail := track(e, 1)[1]
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "join", Clip: tail.ID}); err != nil {
		t.Fatalf("join from the second half: %v", err)
	}
	if got := track(e, 1); len(got) != 1 || got[0] != orig {
		t.Fatalf("joined = %+v, want %+v", got, orig)
	}
}

func TestANudgedClipSplitsWhereItsHeard(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	// +100 ms: it sounds from 4800 to 100800.
	e.Edit(tp.ID, "", func(_ *Tape, s *State) error { s.Tracks[0].Clips[0].NudgeMS = 100; return nil })
	pos := int64(2000) // before it sounds
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "split", Track: 1, Pos: &pos}); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("split before a nudged clip sounds = %v", err)
	}
	pos = 98000 // after it's placed, but while it sounds
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "split", Track: 1, Pos: &pos}); err != nil {
		t.Fatalf("split while it sounds: %v", err)
	}
	cl := track(e, 1)
	if len(cl) != 2 || cl[1].At != 98000-4800 || cl[1].Src != orig.Src+98000-4800 || cl[1].NudgeMS != 100 {
		t.Fatalf("split = %+v", cl)
	}
}

func TestASlideFarPastTheEndIsRefused(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	for _, at := range []int64{e.Loaded().Length, math.MaxInt64 - 10} {
		at := at
		if _, err := e.EditOp(tp.ID, EditRequest{Op: "slide", Clip: orig.ID, At: &at}); !errors.Is(err, ErrPastTheEnd) {
			t.Fatalf("slide to %d = %v", at, err)
		}
	}
	// And a state with such a clip doesn't validate, however it got there.
	err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error { s.Tracks[0].Clips[0].At = math.MaxInt64 - 10; return nil })
	if !errors.Is(err, ErrPastTheEnd) {
		t.Fatalf("a clip at MaxInt64 = %v", err)
	}
}

func TestSlideOntoAnotherTrack(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	// Track 3 is muted: a clip still goes there, on its base layer.
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error { s.Tracks[2].Mute = true; return nil }); err != nil {
		t.Fatal(err)
	}
	at := int64(48000)
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "slide", Track: 1, Clip: orig.ID, At: &at, To: 3}); err != nil {
		t.Fatal(err)
	}
	if n := len(track(e, 1)); n != 0 {
		t.Fatalf("track 1 still has %d clips", n)
	}
	moved := track(e, 3)
	if len(moved) != 1 || moved[0].ID != orig.ID || moved[0].At != 48000 || moved[0].Layer != 0 || moved[0].File != orig.File || moved[0].Src != orig.Src {
		t.Fatalf("on track 3: %+v", moved)
	}
	// Onto a track with audio under it: the lowest free layer there.
	at = 0
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "slide", Clip: orig.ID, At: &at, To: 3}); err != nil {
		t.Fatal(err)
	}
	other := Clip{File: orig.File, Src: orig.Src, Frames: 1000, At: 2000}
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error { _, err := s.Place(2, other, false); return err }); err != nil {
		t.Fatal(err)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "slide", Clip: orig.ID, At: &at, To: 2}); err != nil {
		t.Fatal(err)
	}
	if c := findClip(t, e, orig.ID); c.Layer != 1 || len(track(e, 2)) != 2 {
		t.Fatalf("onto track 2's audio: %+v", c)
	}
	// Each move is one undo: the slide onto track 2, then the clip placed
	// there, leave it on track 3 at 0; then the slide to 0 and the slide
	// onto track 3 put it back.
	for i := 0; i < 2; i++ {
		if err := e.Undo(tp.ID, false); err != nil {
			t.Fatal(err)
		}
	}
	if c := track(e, 3); len(c) != 1 || c[0].At != 0 {
		t.Fatalf("two undos: track 3 = %+v", c)
	}
	for i := 0; i < 2; i++ {
		if err := e.Undo(tp.ID, false); err != nil {
			t.Fatal(err)
		}
	}
	if c := track(e, 1); len(c) != 1 || c[0] != orig {
		t.Fatalf("back where it began: %+v", c)
	}
	// No such track: refused, nothing moved.
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "slide", Clip: orig.ID, At: &at, To: 5}); !errors.Is(err, ErrNoSuchTrack) {
		t.Fatalf("to track 5 = %v", err)
	}
	if c := track(e, 1); len(c) != 1 {
		t.Fatalf("a refused slide moved it: %+v", c)
	}
}

func TestRepeatLaysCopiesEndToEnd(t *testing.T) {
	e, _, tp, orig := firstLoop(t) // 96000 frames at 0
	res, err := e.EditOp(tp.ID, EditRequest{Op: "repeat", Clip: orig.ID, Count: 3})
	if err != nil || res.Clips != 3 {
		t.Fatalf("repeat = %+v %v", res, err)
	}
	cl := track(e, 1)
	if len(cl) != 4 {
		t.Fatalf("%d clips, want the clip and 3 copies", len(cl))
	}
	ids := map[string]bool{}
	for k, c := range cl {
		if c.At != int64(k)*96000 || c.Frames != orig.Frames || c.File != orig.File || c.Src != orig.Src || c.Layer != 0 {
			t.Fatalf("clip %d = %+v", k, c)
		}
		ids[c.ID] = true
	}
	if len(ids) != 4 {
		t.Fatal("the copies need ids of their own")
	}
	// Not linked: a copy's level is its own.
	g := -6.0
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error { s.Tracks[0].Clips[2].GainDB = g; return nil }); err != nil {
		t.Fatal(err)
	}
	if cl := track(e, 1); cl[1].GainDB != 0 || cl[3].GainDB != 0 {
		t.Fatalf("changing one copy changed another: %+v", cl)
	}
	// Over audio already there, copies go on a layer above it.
	e.Undo(tp.ID, false)
	e.Undo(tp.ID, false)
	other := Clip{File: orig.File, Src: orig.Src, Frames: 1000, At: 100000}
	e.Edit(tp.ID, "", func(_ *Tape, s *State) error { _, err := s.Place(1, other, false); return err })
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "repeat", Clip: orig.ID, Count: 2}); err != nil {
		t.Fatal(err)
	}
	layers := map[int64]int{}
	for _, c := range track(e, 1) {
		if c.Frames == orig.Frames {
			layers[c.At] = c.Layer
		}
	}
	if layers[96000] != 1 || layers[192000] != 0 {
		t.Fatalf("copies' layers = %v: the one over audio goes above it", layers)
	}
	// One undo takes all the copies back.
	e.Undo(tp.ID, false)
	if n := len(track(e, 1)); n != 2 {
		t.Fatalf("after one undo: %d clips, want the clip and the other", n)
	}
}

func TestRepeatNeedsRoomAndACount(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	length := e.Loaded().Length
	fits := int((length - orig.End()) / orig.Frames)
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "repeat", Clip: orig.ID, Count: min(fits+1, MaxRepeat+1)}); err == nil {
		t.Fatal("a repeat past the end (or over the most) was let through")
	}
	for _, n := range []int{0, -1, MaxRepeat + 1} {
		if _, err := e.EditOp(tp.ID, EditRequest{Op: "repeat", Clip: orig.ID, Count: n}); !errors.Is(err, ErrBadParameter) {
			t.Fatalf("count %d = %v", n, err)
		}
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "repeat", Clip: "nope", Count: 1}); !errors.Is(err, ErrNoSuchClip) {
		t.Fatalf("no clip = %v", err)
	}
	if n := len(track(e, 1)); n != 1 {
		t.Fatalf("refused repeats left %d clips", n)
	}
}

func TestRepeatStopsAtTheTapesEnd(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	// Slid so that exactly two copies fit before the end.
	at := e.Loaded().Length - 3*orig.Frames
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "slide", Clip: orig.ID, At: &at}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "repeat", Clip: orig.ID, Count: 3}); !errors.Is(err, ErrPastTheEnd) {
		t.Fatalf("three copies past the end = %v", err)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "repeat", Clip: orig.ID, Count: 2}); err != nil {
		t.Fatalf("two copies to the end = %v", err)
	}
}
