package tape

import (
	"errors"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// grabCue is GRAB onto the cue lane of ring frames [from, to) from sources.
func grabCue(t *testing.T, e *Engine, id string, from, to int64, sources ...string) CueGrabbed {
	t.Helper()
	g, err := e.GrabToCue(id, GrabRequest{RingFrom: &from, RingTo: &to, Sources: sources}, "")
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestAGrabLandsOnTheCueLaneWithItsLanesAndHandles(t *testing.T) {
	e, sink, tp := barLoop(t)
	from, to := int64(60000), int64(108000)
	g := grabCue(t, e, tp.ID, from, to, "aux", "ch1")
	c := g.Clip
	if g.Replaced != nil || !c.Loop || c.Frames != 48000 || c.Source != "grab" || c.Name != "ch1 + aux" {
		t.Fatalf("cue clip = %+v, replaced %v", c, g.Replaced)
	}
	// A lane per input, in the tape's order, each over the window of a file
	// with handles either side; the clip's own file is the first lane's.
	if len(c.Lanes) != 2 || c.Lanes[0].Source != "ch1" || c.Lanes[1].Source != "aux" || c.Grab == nil {
		t.Fatalf("lanes = %+v, grab %+v", c.Lanes, c.Grab)
	}
	if c.Grab.Before <= 0 || c.Grab.After <= 0 || c.Lanes[0].Src != c.Grab.Before || c.File != c.Lanes[0].File || c.Src != c.Lanes[0].Src {
		t.Fatalf("handles %d/%d, lane src %d, clip %s@%d", c.Grab.Before, c.Grab.After, c.Lanes[0].Src, c.File, c.Src)
	}
	for i, ch := range []int{2, 6} {
		l := c.Lanes[i]
		if got := readPool(t, e.store, l.File)[2*l.Src]; got != ringAt(t, sink, ch, from) {
			t.Fatalf("lane %d starts on %d, not what %s heard at the span's start", i, got, l.Source)
		}
	}
	// The clipboard is left alone: a range's Copy and Paste keep it to
	// themselves.
	if b, err := e.Clipboard(); err != nil || b != nil {
		t.Fatalf("clipboard = %+v, %v", b, err)
	}
	if st := e.Loaded().State; st.Cue == nil || len(st.Cue.Clips) != 1 {
		t.Fatalf("lane = %+v", st.Cue)
	}
	// Every lane's file is the tape's, for the clean-up.
	files := map[string]bool{}
	e.Loaded().State.files(files)
	if !files[c.Lanes[0].File] || !files[c.Lanes[1].File] {
		t.Fatalf("the state's files %v miss a lane", files)
	}
}

func TestAGrabReplacesTheNewestClipOnlyWhileItIsUntouched(t *testing.T) {
	e, _, tp := barLoop(t)
	first := grabCue(t, e, tp.ID, 60000, 108000, "aux").Clip

	// Untouched: the next GRAB takes its place, and Undo puts it back.
	g := grabCue(t, e, tp.ID, 70000, 118000, "aux")
	if g.Replaced == nil || g.Replaced.ID != first.ID || g.Clip.ID == first.ID {
		t.Fatalf("second grab = %+v, replaced %+v", g.Clip, g.Replaced)
	}
	if cl := e.Loaded().State.Cue.Clips; len(cl) != 1 || cl[0].ID != g.Clip.ID {
		t.Fatalf("lane = %+v", cl)
	}
	if err := e.Undo(tp.ID, false); err != nil {
		t.Fatal(err)
	}
	if cl := e.Loaded().State.Cue.Clips; len(cl) != 1 || cl[0].ID != first.ID {
		t.Fatalf("after Undo the lane = %+v, want the first grab back", cl)
	}

	// Trimmed, it's touched: a GRAB is added after it.
	if _, err := e.CueTrim(tp.ID, first.ID, 1000, 40000); err != nil {
		t.Fatal(err)
	}
	g = grabCue(t, e, tp.ID, 70000, 118000, "aux")
	if g.Replaced != nil || len(e.Loaded().State.Cue.Clips) != 2 {
		t.Fatalf("a grab after a touched clip replaced %+v", g.Replaced)
	}

	// Launched, it's used, though nothing in the tape says so.
	if err := e.CueLaunch(tp.ID, g.Clip.ID, "launch", true); err != nil {
		t.Fatal(err)
	}
	if g = grabCue(t, e, tp.ID, 80000, 128000, "aux"); g.Replaced != nil || len(e.Loaded().State.Cue.Clips) != 3 {
		t.Fatalf("a grab after a launched clip replaced %+v", g.Replaced)
	}

	// Kept, too.
	if _, err := e.CueKeep(tp.ID, g.Clip.ID, t.TempDir(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if g = grabCue(t, e, tp.ID, 80000, 128000, "aux"); g.Replaced != nil || len(e.Loaded().State.Cue.Clips) != 4 {
		t.Fatalf("a grab after a kept clip replaced %+v", g.Replaced)
	}

	// Renamed, too.
	c := g.Clip
	c.Name = "Riff"
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "cue-set", CueClip: &c}); err != nil {
		t.Fatal(err)
	}
	if g = grabCue(t, e, tp.ID, 80000, 128000, "aux"); g.Replaced != nil || len(e.Loaded().State.Cue.Clips) != 5 {
		t.Fatalf("a grab after a renamed clip replaced %+v", g.Replaced)
	}
}

func TestACueClipsInputsChangeWithItsWindowKept(t *testing.T) {
	e, sink, tp := barLoop(t)
	from := int64(60000)
	c := grabCue(t, e, tp.ID, from, 108000, "aux").Clip
	if _, err := e.CueTrim(tp.ID, c.ID, 12000, 36000); err != nil {
		t.Fatal(err)
	}
	g, err := e.GrabToCue(tp.ID, GrabRequest{Sources: []string{"ch1", "aux"}}, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	got := g.Clip
	if got.ID != c.ID || len(got.Lanes) != 2 || got.Frames != 24000 || got.Grab.In != 12000 || g.Replaced != nil {
		t.Fatalf("again = %+v", got)
	}
	if l := got.Lanes[0]; readPool(t, e.store, l.File)[2*l.Src] != ringAt(t, sink, 2, from+12000) {
		t.Fatal("ch1's lane doesn't start where the window does")
	}
	if cl := e.Loaded().State.Cue.Clips; len(cl) != 1 {
		t.Fatalf("lane = %+v", cl)
	}
}

func TestACueClipTrimsInsideItsHandles(t *testing.T) {
	e, _, tp := barLoop(t)
	e.handleS = 0.5
	from := int64(100000)
	c := grabCue(t, e, tp.ID, from, 148000, "aux").Clip
	over := int64(OverhangSeconds * 48000)
	got, err := e.CueTrim(tp.ID, c.ID, -10*48000, 10*48000)
	if err != nil {
		t.Fatal(err)
	}
	if got.Grab.In != -48000+over || got.Grab.Out != 96000-over || got.Frames != got.Grab.Out-got.Grab.In {
		t.Fatalf("window [%d, %d), %d frames", got.Grab.In, got.Grab.Out, got.Frames)
	}
	l := got.Lanes[0]
	if l.Src != over || l.Frames != got.Frames || got.Src != l.Src || ringFrameOf(readPool(t, e.store, l.File)[2*l.Src]) != from+got.Grab.In {
		t.Fatalf("lane %+v", l)
	}
	// A run of trims is one Undo.
	if _, err := e.CueTrim(tp.ID, c.ID, 12000, 36000); err != nil {
		t.Fatal(err)
	}
	if err := e.Undo(tp.ID, false); err != nil {
		t.Fatal(err)
	}
	if back := e.Loaded().State.Cue.Clips[0]; back.Frames != 48000 || back.Touched {
		t.Fatalf("after Undo = %+v, want the grab as it was", back)
	}
	// A clip with no handles isn't trimmed on the lane.
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error {
		_, err := s.cueAdd(CueClip{File: c.File, Frames: 1000, Loop: true})
		return err
	}); err != nil {
		t.Fatal(err)
	}
	old := e.Loaded().State.Cue.Clips[1]
	if _, err := e.CueTrim(tp.ID, old.ID, 0, 500); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("trimming a clip with no handles: %v", err)
	}
}

func TestACueClipPlaysItsLanesSummed(t *testing.T) {
	e, sink, tp := newEngine(t)
	lo, _, err := e.grabTake(takeWAV(t, 48000, func(int) float64 { return 0.2 }), "a.wav", "A", 0, 24000, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	hi, _, err := e.grabTake(takeWAV(t, 48000, func(int) float64 { return 0.1 }), "b.wav", "B", 0, 24000, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	lo.Tracks = append(lo.Tracks, hi.Tracks...)
	var c CueClip
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error {
		cl := CueClip{Loop: true, GainDB: -6}
		cl.take(lo)
		cl.GainDB = -6
		var err error
		c, err = s.cueAdd(cl)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 4096)
	if err := e.CueLaunch(tp.ID, c.ID, "launch", false); err != nil {
		t.Fatal(err)
	}
	out := sink.play(t, 30000)
	want := 0.3 * math.Pow(10, -6.0/20)
	if got := cueBusA(out, 20000); math.Abs(got-want) > 0.01 {
		t.Fatalf("bus A = %.4f, want both lanes at the clip's level (%.4f)", got, want)
	}
}

func TestACueClipDropsEveryLaneWithItsHandlesInOneUndo(t *testing.T) {
	e, _, tp := barLoop(t)
	c := grabCue(t, e, tp.ID, 60000, 108000, "ch1", "aux").Clip
	if _, err := e.CueShape(tp.ID, c.ID, BoardShape{GainDB: ptr(-3.0)}); err != nil {
		t.Fatal(err)
	}
	at := int64(0)
	d, err := e.CueDrop(tp.ID, c.ID, 2, false, &at)
	if err != nil {
		t.Fatal(err)
	}
	st := e.Loaded().State
	a, b := st.Tracks[1].Clips, st.Tracks[2].Clips
	if d.Tracks != 2 || len(a) != 1 || len(b) != 1 || a[0].Source != "ch1" || b[0].Source != "aux" {
		t.Fatalf("drop %+v: track 2 %+v, track 3 %+v", d, a, b)
	}
	if a[0].Src != c.Grab.Before || a[0].Frames != 48000 || a[0].GainDB != -3 || a[0].At != 0 {
		t.Fatalf("dropped lane %+v: want its handles before it and the clip's level", a[0])
	}
	if !st.Cue.Clips[0].Touched {
		t.Fatal("a dropped clip is touched")
	}
	if err := e.Undo(tp.ID, false); err != nil {
		t.Fatal(err)
	}
	st = e.Loaded().State
	if len(st.Tracks[1].Clips) != 0 || st.Cue.Clips[0].GainDB != -3 || st.Cue.Clips[0].Touched != true {
		t.Fatalf("one Undo should take back the drop alone: %+v / %+v", st.Tracks[1].Clips, st.Cue.Clips[0])
	}
	// Dragged onto a track, it lands the same way.
	at = 96000
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "cue-to-track", Clip: c.ID, Track: 1, At: &at}); err != nil {
		t.Fatal(err)
	}
	st = e.Loaded().State
	if n := len(st.Tracks[1].Clips); n != 1 || st.Tracks[1].Clips[0].Source != "aux" || st.Tracks[1].Clips[0].At != 96000 {
		t.Fatalf("dragged: track 2 = %+v", st.Tracks[1].Clips)
	}
	if _, err := e.CueDrop(tp.ID, c.ID, 4, false, &at); !errors.Is(err, ErrNoSuchTrack) {
		t.Fatalf("two lanes from track 4 of 4: %v", err)
	}
}

func TestACueClipIsKeptAsATakeOfItsWindowSummed(t *testing.T) {
	e, _, tp := barLoop(t)
	c := grabCue(t, e, tp.ID, 60000, 108000, "ch1", "aux").Clip
	if _, err := e.CueTrim(tp.ID, c.ID, 0, 24000); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	k, err := e.CueKeep(tp.ID, c.ID, dir, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if k.Label != "Grab · ch1 + aux" || k.Seconds != 0.5 {
		t.Fatalf("kept %+v", k)
	}
	info, err := audio.ReadWAVInfo(filepath.Join(dir, k.Name))
	if err != nil || info.Frames() != 24000 {
		t.Fatalf("the take: %+v, %v", info, err)
	}
	if m := audio.ReadMeta(filepath.Join(dir, k.Name)); m.Origin != audio.OriginBuffer || m.BPM == nil || *m.BPM != 240 {
		t.Fatalf("its meta = %+v", m)
	}
	// And auditioned from the same lanes.
	pcm, err := e.CueAudio(tp.ID, c.ID)
	if err != nil || len(pcm) != 2*24000 {
		t.Fatalf("audition: %d samples, %v", len(pcm), err)
	}
}

func TestACueClipReversesAndTurnsBackAndNormalizes(t *testing.T) {
	e, _, tp := barLoop(t)
	from := int64(60000)
	c := grabCue(t, e, tp.ID, from, 108000, "aux").Clip
	if _, err := e.CueShape(tp.ID, c.ID, BoardShape{FadeIn: ptr(int64(100)), FadeInShape: ptr("linear")}); err != nil {
		t.Fatal(err)
	}
	r, err := e.CueShape(tp.ID, c.ID, BoardShape{Reverse: true})
	if err != nil {
		t.Fatal(err)
	}
	l := r.Lanes[0]
	if !r.Grab.Reversed || l.Reversed == nil || r.FadeOut != 100 || r.FadeIn != 0 || r.FadeOutShape != "linear" {
		t.Fatalf("reversed = %+v, lane %+v", r, l)
	}
	if got := ringFrameOf(readPool(t, e.store, l.File)[2*l.Src]); got != from+48000-1 {
		t.Fatalf("reversed, it starts at ring frame %d", got)
	}
	back, err := e.CueShape(tp.ID, c.ID, BoardShape{Reverse: true})
	if err != nil {
		t.Fatal(err)
	}
	if back.Grab.Reversed || back.Lanes[0].File != c.Lanes[0].File || back.FadeIn != 100 {
		t.Fatalf("turned back = %+v", back)
	}
	n, err := e.CueShape(tp.ID, c.ID, BoardShape{Normalize: true})
	if err != nil {
		t.Fatal(err)
	}
	if n.GainDB == 0 {
		t.Fatalf("normalized gain = %v", n.GainDB)
	}
	if _, err := e.CueShape(tp.ID, c.ID, BoardShape{FadeInShape: ptr("wobbly")}); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("a curve that isn't one: %v", err)
	}
}

func TestTheBufferOnTheCueLaneKeepsItsLanes(t *testing.T) {
	e, _, tp := barLoop(t)
	from, to := int64(60000), int64(108000)
	b, err := e.Grab(GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"ch1", "aux"}})
	if err != nil {
		t.Fatal(err)
	}
	c, err := e.CueFromClipboard(tp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Lanes) != 2 || c.Grab == nil || c.Lanes[0].File != b.Board.Tracks[0][0].File || c.Source != "buffer" {
		t.Fatalf("cue clip = %+v", c)
	}
	// A take on the lane has handles too.
	take := takeWAV(t, 96000, func(int) float64 { return 0.25 })
	tc, err := e.CueFromTake(tp.ID, take, "Jam", 24000, 48000, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	if tc.Grab == nil || tc.Grab.Take != filepath.Base(take) || tc.Grab.Before <= 0 || tc.Src != tc.Grab.Before || len(tc.Lanes) != 1 || tc.Name != "Jam" {
		t.Fatalf("take on the lane = %+v, grab %+v", tc, tc.Grab)
	}
	if _, err := os.Stat(e.store.AudioPath(tc.File)); err != nil {
		t.Fatal(err)
	}
}
