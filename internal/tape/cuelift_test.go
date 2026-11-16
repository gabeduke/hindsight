package tape

import (
	"errors"
	"strings"
	"testing"

	"github.com/gabeduke/hindsight/internal/audio"
)

// poolFrame is frame f of a pool file's first channel.
func poolFrame(t *testing.T, s *Store, rel string, f int64) int32 {
	t.Helper()
	info, err := audio.ReadWAVInfo(s.AudioPath(rel))
	if err != nil {
		t.Fatal(err)
	}
	return readPool(t, s, rel)[int(f)*info.Channels]
}

// near says two samples are the same but for a float round trip.
func near(a, b int32) bool { return a-b <= 1 && b-a <= 1 }

func lift(t *testing.T, e *Engine, id string, req EditRequest, cut bool) CueLifted {
	t.Helper()
	l, err := e.CueLift(id, req, cut)
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func TestALiftPutsTheRangeOnTheCueLaneAndOneUndoPutsItBack(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	l := lift(t, e, tp.ID, EditRequest{Span: &Span{From: 24000, To: 72000}, Tracks: []int{1}}, true)
	c := l.Clip
	if l.Op != "lift" || l.Clips != 1 || c.Source != "lift" || c.Frames != 48000 || len(c.Lanes) != 1 || c.Grab == nil || !c.Loop {
		t.Fatalf("lifted = %+v", l)
	}
	if !strings.HasPrefix(c.Name, "Bar") || strings.Contains(c.Name, "·") {
		t.Fatalf("a one-track lift is named %q", c.Name)
	}
	// Its own file, with handles either side where the clip's file runs on,
	// playing what the tape played there.
	g := c.Grab
	if g.Before <= 0 || g.After <= 0 || c.Lanes[0].Src != g.Before || c.Lanes[0].File == orig.File {
		t.Fatalf("lane %+v, grab %+v", c.Lanes[0], g)
	}
	want := poolFrame(t, e.store, orig.File, orig.Src+24000)
	if got := poolFrame(t, e.store, c.Lanes[0].File, c.Lanes[0].Src); !near(got, want) {
		t.Fatalf("the lane starts on %d, the tape played %d there", got, want)
	}
	if got, want := poolFrame(t, e.store, c.Lanes[0].File, 0), poolFrame(t, e.store, orig.File, orig.Src+24000-g.Before); !near(got, want) {
		t.Fatalf("the handle before starts on %d, the file has %d", got, want)
	}
	// Silence on the tape, and the clip on the lane, in one edit.
	if cl := track(e, 1); len(cl) != 2 || cl[0].End() != 24000 || cl[1].At != 72000 {
		t.Fatalf("after the lift the track = %+v", cl)
	}
	if lane := e.Loaded().State.Cue; lane == nil || len(lane.Clips) != 1 || lane.Clips[0].ID != c.ID {
		t.Fatalf("the lane = %+v", lane)
	}
	files := map[string]bool{}
	e.Loaded().State.files(files)
	if !files[c.Lanes[0].File] {
		t.Fatal("the lifted lane's file isn't the tape's, for the clean-up")
	}
	if err := e.Undo(tp.ID, false); err != nil {
		t.Fatal(err)
	}
	st := e.Loaded().State
	if len(st.Tracks[0].Clips) != 1 || st.Cue != nil && len(st.Cue.Clips) != 0 {
		t.Fatalf("after one Undo: track %+v, lane %+v", st.Tracks[0].Clips, st.Cue)
	}
	// The clipboard is never touched.
	if b, err := e.Clipboard(); err != nil || b == nil || b.Grab != nil || len(b.Tracks) != 1 {
		t.Fatalf("clipboard = %+v, %v", b, err)
	}
}

func TestACopyIsAlwaysAddedAndAGrabNeverReplacesIt(t *testing.T) {
	e, _, tp := barLoop(t)
	before := e.Loaded().State.Tracks[0].Clips
	a := lift(t, e, tp.ID, EditRequest{Span: &Span{From: 0, To: 48000}, Tracks: []int{1}}, false).Clip
	b := lift(t, e, tp.ID, EditRequest{Span: &Span{From: 0, To: 48000}, Tracks: []int{1}}, false).Clip
	if a.Source != "copy" || b.Source != "copy" || a.ID == b.ID {
		t.Fatalf("copies %+v, %+v", a, b)
	}
	if cl := e.Loaded().State.Tracks[0].Clips; len(cl) != len(before) || cl[0] != before[0] {
		t.Fatalf("a copy changed the tape: %+v", cl)
	}
	if g := grabCue(t, e, tp.ID, 60000, 108000, "aux"); g.Replaced != nil {
		t.Fatalf("a GRAB took a copy's place: %+v", g.Replaced)
	}
	if n := len(e.Loaded().State.Cue.Clips); n != 3 {
		t.Fatalf("%d clips on the lane, want both copies and the grab", n)
	}
	if _, err := e.GrabToCue(tp.ID, GrabRequest{Sources: []string{"ch1"}}, a.ID); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("grabbing a copy again from other inputs = %v", err)
	}
}

func TestALiftOfARangeOverTwoTracksHasALaneForEach(t *testing.T) {
	e, _, tp := barLoop(t)
	c := lift(t, e, tp.ID, EditRequest{Span: &Span{From: 48000, To: 96000}, Tracks: []int{1, 2}}, true).Clip
	if len(c.Lanes) != 2 || !strings.HasSuffix(c.Name, " · 1–2") || c.Grab.Sources[1] != "Track 2" {
		t.Fatalf("lifted %q: %+v, sources %v", c.Name, c.Lanes, c.Grab.Sources)
	}
	// Track 2 had nothing there: a lane of silence, which drops as silence.
	for i, v := range readPool(t, e.store, c.Lanes[1].File) {
		if v != 0 {
			t.Fatalf("track 2's lane has %d at sample %d", v, i)
		}
	}
	// Nothing anywhere: refused, and nothing changes.
	if _, err := e.CueLift(tp.ID, EditRequest{Span: &Span{From: 0, To: 48000}, Tracks: []int{3, 4}}, true); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("lifting silence = %v", err)
	}
	if n := len(e.Loaded().State.Cue.Clips); n != 1 {
		t.Fatalf("a refused lift left %d clips", n)
	}
}

func TestALiftedPartKeepsItsHandlesAndItsFades(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error {
		s.Tracks[0].Clips[0].FadeIn, s.Tracks[0].Clips[0].FadeInShape = 4800, FadeLinear
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	l := lift(t, e, tp.ID, EditRequest{Clips: []string{orig.ID}}, true)
	c := l.Clip
	if l.Clips != 1 || c.Frames != orig.Frames || len(track(e, 1)) != 0 {
		t.Fatalf("lifted %+v, track %+v", l, track(e, 1))
	}
	// The part's fade is the clip's own now, so IN reaches into the handle
	// without it.
	if c.FadeIn != 4800 || c.FadeInShape != FadeLinear {
		t.Fatalf("the clip's fade = %d %q", c.FadeIn, c.FadeInShape)
	}
	if want := min64(e.grabHandle(int64(e.store.SampleRate()), c.Grab.BarFrames), orig.Src); c.Grab.Before != want {
		t.Fatalf("handle before = %d, want %d (the file's audio before the part)", c.Grab.Before, want)
	}
	if want := poolFrame(t, e.store, orig.File, orig.Src); !near(poolFrame(t, e.store, c.Lanes[0].File, c.Lanes[0].Src), want) {
		t.Fatal("the lane doesn't start where the part did")
	}
	// Trim widens into the handle, as a GRAB's does.
	if _, err := e.CueTrim(tp.ID, c.ID, -c.Grab.Before/2, c.Frames); err != nil {
		t.Fatal(err)
	}
}

func TestACueClipInsertsAtThePlayheadPushingEveryTrackAlong(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	c := lift(t, e, tp.ID, EditRequest{Span: &Span{From: 0, To: 24000}, Tracks: []int{1}}, false).Clip
	at := int64(48000)
	d, err := e.CueInsert(tp.ID, c.ID, 1, &at)
	if err != nil {
		t.Fatal(err)
	}
	cl := track(e, 1)
	if d.End != 72000 || d.Clip.At != 48000 || len(cl) != 3 || cl[0].End() != 48000 || cl[1].At != 48000 || cl[1].Frames != 24000 || cl[2].At != 72000 || cl[2].End() != orig.End()+24000 {
		t.Fatalf("inserted %+v: track %+v", d, cl)
	}
	if cl[1].Src != c.Grab.Before {
		t.Fatalf("the inserted lane starts at %d of its file, want after its handle %d", cl[1].Src, c.Grab.Before)
	}
	if !e.Loaded().State.Cue.Clips[0].Touched {
		t.Fatal("an inserted clip is touched")
	}
	if err := e.Undo(tp.ID, false); err != nil {
		t.Fatal(err)
	}
	if cl := track(e, 1); len(cl) != 1 || cl[0].End() != orig.End() || e.Loaded().State.Cue.Clips[0].Touched {
		t.Fatalf("one Undo should take back the insert and its touch: %+v", cl)
	}
	if _, err := e.CueInsert(tp.ID, c.ID, 5, &at); !errors.Is(err, ErrNoSuchTrack) {
		t.Fatalf("inserting on track 5 of 4: %v", err)
	}
}

func TestAnEdgePartsOwnFadeStaysAtTheWindowNotInTheHandle(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	// The clip's second half, from 24000, on track 1 with a fade in, and the
	// same half on track 2 with none: their fades differ.
	pos := int64(24000)
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "split", Track: 1, Pos: &pos}); err != nil {
		t.Fatal(err)
	}
	var half Clip
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error {
		cl := s.Tracks[0].Clips
		cl[1].FadeIn, cl[1].FadeInShape = 4800, FadeLinear
		half = cl[1]
		other := cl[1]
		other.ID, other.FadeIn = NewClipID(), 0
		s.Tracks[1].Clips = []Clip{other}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	other := track(e, 2)[0]
	c := lift(t, e, tp.ID, EditRequest{Clips: []string{half.ID, other.ID}}, false).Clip
	if c.FadeIn != 0 || len(c.Lanes) != 2 || c.Grab.Before <= 0 {
		t.Fatalf("fades differ, so neither is the clip's, and track 2's file runs on: %+v", c)
	}
	// Track 1's lane starts at IN on its fade's first step, its fade where
	// it was; track 2's at full level.
	want := poolFrame(t, e.store, orig.File, half.Src)
	if v := poolFrame(t, e.store, c.Lanes[0].File, c.Lanes[0].Src); v > want/1000 || v < 0 {
		t.Fatalf("track 1's lane plays %d at IN, of %d, under a fade from silence", v, want)
	}
	if want == 0 || !near(poolFrame(t, e.store, c.Lanes[1].File, c.Lanes[1].Src), want) {
		t.Fatalf("track 2's lane doesn't start where its part did (%d)", want)
	}
}

func TestANudgedEdgePartKeepsItsHandle(t *testing.T) {
	e, _, tp, orig := firstLoop(t)
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error {
		s.Tracks[0].Clips[0].NudgeMS = 5
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	c := lift(t, e, tp.ID, EditRequest{Span: &Span{From: 24000, To: 72000}, Tracks: []int{1}}, false).Clip
	if c.Grab.Before <= 0 {
		t.Fatalf("a nudged part's file runs on before the span, but the handle is %d", c.Grab.Before)
	}
	// Heard 5 ms late: the span's first frame is the file's 5 ms earlier.
	nudge := int64(5 * e.store.SampleRate() / 1000)
	if want := poolFrame(t, e.store, orig.File, orig.Src+24000-nudge); !near(poolFrame(t, e.store, c.Lanes[0].File, c.Lanes[0].Src), want) {
		t.Fatal("the lane doesn't start on what the tape plays at the span's start")
	}
}
