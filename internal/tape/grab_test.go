package tape

import (
	"errors"
	"math"
	"path/filepath"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// barLoop is a 4-bar loop of 192000 frames (4 s at 240 BPM, a bar 48000),
// playing: its first pass, and 64000 frames into the second, as Catch's own
// test of the last bars has it.
func barLoop(t *testing.T) (*Engine, *loopSink, *Tape) {
	t.Helper()
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.5 })
	if _, err := e.DropTake(tp.ID, take, 0, 192000, 1, 4, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	e.Do(Action{Kind: "play"})
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 192000+64000)
	return e, sink, e.Loaded()
}

// ringAt is what ring frame f of a capture channel holds.
func ringAt(t *testing.T, sink *loopSink, ch int, f int64) int32 {
	t.Helper()
	var v int32
	if err := sink.ring.Range(uint64(f), uint64(f+1), []int{ch}, func(b []int32) error { v = b[0]; return nil }); err != nil {
		t.Fatal(err)
	}
	return v
}

// ramp is the AUX value of each frame of a pool file, back to ring frames.
func ringFrameOf(v int32) int64 { return int64(v) / 1000 }

// grabReq is GRAB onto the loaded tape's cue lane, the Studio's one GRAB.
func grabReq(t *testing.T, e *Engine, req GrabRequest) CueClip {
	t.Helper()
	g, err := e.GrabToCue(e.LoadedID(), req, "")
	if err != nil {
		t.Fatal(err)
	}
	return g.Clip
}

// grabTake is the Listening Room's "to the studio": a take's span onto the
// loaded tape's cue lane.
func grabTake(t *testing.T, e *Engine, take, file, title string, from, to int64) (CueClip, error) {
	t.Helper()
	g, err := e.GrabTakeToCue(e.LoadedID(), take, file, title, from, to, []int{0, 1})
	return g.Clip, err
}

func TestGrabbingTheLastBarsTakesTheSpanCatchWould(t *testing.T) {
	// The Studio's GRAB by bars is Catch's arithmetic -- lastBars, then the
	// output-to-ring mapping with Δ and TAPE_LATENCY_MS -- with the cue
	// lane for a destination. The same press must hear the same audio.
	e, _, tp := barLoop(t)
	e.latencyMS = 5 // 240 frames: a grab that skipped the latency would be off by them
	e.grabWait = 20 * time.Millisecond
	caught, err := e.Catch(tp.ID, CatchRequest{Track: 2, Source: "aux", Bars: 2})
	if err != nil {
		t.Fatal(err)
	}
	c := grabReq(t, e, GrabRequest{Bars: 2, Sources: []string{"aux"}})
	gr := c.Grab
	// The catch begins where the ring heard tape frame 144000: its file's
	// frame Src.
	head := readPool(t, e.store, caught.File)
	want := ringFrameOf(head[2*caught.Src])
	if gr.RingFrom != want || gr.Frames != 96000 || gr.Wall {
		t.Fatalf("grab = from %d, %d frames (wall %v: %s); the catch heard from %d, 96000 frames", gr.RingFrom, gr.Frames, gr.Wall, gr.Why, want)
	}
	if want != 144000+240 {
		t.Fatalf("the catch heard from %d, want 144240 (Δ 0, 5 ms of latency)", want)
	}
	lane := c.Lanes[0]
	data := readPool(t, e.store, lane.File)
	if ringFrameOf(data[2*lane.Src]) != want || lane.Frames != 96000 || c.Frames != 96000 {
		t.Fatalf("the grab's lane starts at ring frame %d (%+v), want %d", ringFrameOf(data[2*lane.Src]), lane, want)
	}
	// Its last frame is the catch's last frame too.
	last := caught.Frames - 1
	if v := readPool(t, e.store, caught.File); ringFrameOf(v[2*(caught.Src+last)]) != ringFrameOf(data[2*(lane.Src+last)]) {
		t.Fatal("the grab and the catch end on different frames")
	}
	// Bar 1 of it is a bar line, the tempo is the tape's, and it says so.
	if gr.Downbeat == nil || *gr.Downbeat != 0 || gr.BarFrames != 48000 || c.BPM != 240 || gr.Bars != 2 {
		t.Fatalf("grab = %+v, bpm %v", gr, c.BPM)
	}
	if c.Name != "aux" {
		t.Fatalf("named %q, want its input", c.Name)
	}
}

func TestGrabbingBarsTheTapeDidntPlayTakesWallClockTime(t *testing.T) {
	e, sink, tp := newEngine(t)
	e.grabWait = 20 * time.Millisecond
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error {
		g := GridFor(120, 4, 48000) // a bar is 96000
		s.Grid = &g
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	e.Start()
	sink.play(t, 400000) // the ring runs; the tape is stopped
	gr := grabReq(t, e, GrabRequest{Bars: 2, Sources: []string{"aux"}}).Grab
	_, total := sink.ring.Window() // played in whole blocks: a little past 400000
	if !gr.Wall || gr.Why == "" || gr.Frames != 192000 || gr.RingFrom != int64(total)-192000 || gr.Downbeat != nil {
		t.Fatalf("grab = %+v", gr)
	}
}

func TestAGrabFromSeveralSourcesIsOneLaneEachOverOneSpan(t *testing.T) {
	e, sink, _ := barLoop(t)
	from, to := int64(60000), int64(108000)
	// Asked for in any order, laid in the tape's: ch1, then aux.
	c := grabReq(t, e, GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"aux", "ch1"}})
	if len(c.Lanes) != 2 || c.Frames != 48000 || len(c.Grab.Sources) != 2 || c.Grab.Sources[0] != "ch1" || c.Grab.Sources[1] != "aux" {
		t.Fatalf("cue clip = %d lanes, %d frames, sources %v", len(c.Lanes), c.Frames, c.Grab.Sources)
	}
	a, b := c.Lanes[0], c.Lanes[1]
	if a.Source != "ch1" || b.Source != "aux" || a.At != 0 || b.At != 0 || a.Src != b.Src || a.Frames != 48000 || b.Frames != 48000 || a.File == b.File {
		t.Fatalf("lanes = %+v, %+v", a, b)
	}
	da, db := readPool(t, e.store, a.File), readPool(t, e.store, b.File)
	for _, f := range []int64{0, 1000, 47999} {
		if da[2*(a.Src+f)] != ringAt(t, sink, 2, from+f) || db[2*(b.Src+f)] != ringAt(t, sink, 6, from+f) {
			t.Fatalf("frame %d of the span isn't what ch1 and aux heard", f)
		}
	}
	// The tape played over that span, so its first bar line is known: tape
	// frame 96000 played at output (and ring) frame 96000.
	if c.Grab.Downbeat == nil || *c.Grab.Downbeat != 36000 {
		t.Fatalf("downbeat = %v, want 36000", c.Grab.Downbeat)
	}
}

func TestAGrabsHandlesAreAtLeastABar(t *testing.T) {
	e, sink, _ := barLoop(t) // a bar is 48000; the ring has 256000 frames
	e.handleS = 0.5
	from, to := int64(100000), int64(148000)
	c := grabReq(t, e, GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"aux"}})
	gr := c.Grab
	if gr.Before != 48000 || gr.After != 48000 {
		t.Fatalf("handles %d and %d, want a bar (48000) either side", gr.Before, gr.After)
	}
	data := readPool(t, e.store, c.Lanes[0].File)
	if int64(len(data)/2) != 48000+48000+48000 || ringFrameOf(data[0]) != from-48000 {
		t.Fatalf("the file is %d frames from ring frame %d", len(data)/2, ringFrameOf(data[0]))
	}
	// A longer TAPE_HANDLE_S wins over the bar, up to 10 s (where the ring
	// has it: never within a second of its oldest frame).
	e.handleS = 1.5
	from, to = 130000, 160000
	if gr := grabReq(t, e, GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"aux"}}).Grab; gr.Before != 72000 || gr.After != 72000 {
		t.Fatalf("handles %d and %d, want TAPE_HANDLE_S's 72000", gr.Before, gr.After)
	}
	if h := e.grabHandle(48000, 12*48000); h != 10*48000 {
		t.Fatalf("a 12 s bar's handle = %d, want 10 s", h)
	}

	// The last bars end on the last bar line heard: the bar after them is
	// still being played, and a grab waits for it.
	e.handleS = 0.5
	done := make(chan CueGrabbed, 1)
	errs := make(chan error, 1)
	go func() {
		g, err := e.GrabToCue(e.LoadedID(), GrabRequest{Bars: 1, Sources: []string{"aux"}}, "")
		if err != nil {
			errs <- err
			return
		}
		done <- g
	}()
	time.Sleep(30 * time.Millisecond) // the press, before more is played
	sink.play(t, 96000)
	select {
	case err := <-errs:
		t.Fatal(err)
	case g := <-done:
		if gr := g.Clip.Grab; gr.Before < 48000 || gr.After < 48000 || gr.Wall {
			t.Fatalf("handles %d and %d (wall %v), want at least a bar", gr.Before, gr.After, gr.Wall)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the grab never came back")
	}
}

func TestATrimNeverLeavesTheHandles(t *testing.T) {
	e, _, tp := barLoop(t)
	e.handleS = 0.5
	from, to := int64(100000), int64(148000)
	id := grabReq(t, e, GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"aux"}}).ID
	over := int64(OverhangSeconds * 48000)
	// Far past both handles: each edge stops the overhang short of its end.
	c, err := e.CueTrim(tp.ID, id, -10*48000, 10*48000)
	if err != nil {
		t.Fatal(err)
	}
	gr := c.Grab
	if gr.In != -48000+over || gr.Out != 48000+48000-over || c.Frames != gr.Out-gr.In {
		t.Fatalf("window [%d, %d), %d frames", gr.In, gr.Out, c.Frames)
	}
	lane := c.Lanes[0]
	data := readPool(t, e.store, lane.File)
	if lane.Src != over || lane.Frames != c.Frames || ringFrameOf(data[2*lane.Src]) != from+gr.In {
		t.Fatalf("lane %+v reads from ring frame %d", lane, ringFrameOf(data[2*lane.Src]))
	}
	// In past Out leaves the shortest window there is, not a negative one.
	if c, err = e.CueTrim(tp.ID, id, 30000, 20000); err != nil {
		t.Fatal(err)
	}
	if c.Grab.In != 30000 || c.Frames != over {
		t.Fatalf("window [%d, %d), %d frames", c.Grab.In, c.Grab.Out, c.Frames)
	}
	// A bar in from each end, as IN ▸ and OUT ◂ would make it.
	if c, err = e.CueTrim(tp.ID, id, 12000, 36000); err != nil {
		t.Fatal(err)
	}
	if lane := c.Lanes[0]; ringFrameOf(readPool(t, e.store, lane.File)[2*lane.Src]) != from+12000 || lane.Frames != 24000 {
		t.Fatalf("lane %+v", lane)
	}
	// Reversed, the window reads the same audio backwards.
	if c, err = e.CueShape(tp.ID, id, BoardShape{Reverse: true}); err != nil {
		t.Fatal(err)
	}
	lane = c.Lanes[0]
	rev := readPool(t, e.store, lane.File)
	if lane.Reversed == nil || ringFrameOf(rev[2*lane.Src]) != from+36000-1 || ringFrameOf(rev[2*(lane.Src+lane.Frames-1)]) != from+12000 {
		t.Fatalf("reversed lane %+v plays ring frames %d…%d", lane, ringFrameOf(rev[2*lane.Src]), ringFrameOf(rev[2*(lane.Src+lane.Frames-1)]))
	}
	// And trimmed while reversed, too.
	if c, err = e.CueTrim(tp.ID, id, 0, 48000); err != nil {
		t.Fatal(err)
	}
	lane = c.Lanes[0]
	if ringFrameOf(rev[2*lane.Src]) != from+48000-1 || lane.Frames != 48000 {
		t.Fatalf("reversed, trimmed lane %+v starts at ring frame %d", lane, ringFrameOf(rev[2*lane.Src]))
	}
	// Turned back: its own file again.
	if c, err = e.CueShape(tp.ID, id, BoardShape{Reverse: true}); err != nil {
		t.Fatal(err)
	}
	if lane := c.Lanes[0]; lane.Reversed != nil || ringFrameOf(readPool(t, e.store, lane.File)[2*lane.Src]) != from {
		t.Fatalf("turned back: %+v", lane)
	}
}

func TestKeepAsTakeWritesTheWindowSummed(t *testing.T) {
	e, sink, tp := barLoop(t)
	e.grabWait = 20 * time.Millisecond
	c := grabReq(t, e, GrabRequest{Bars: 2, Sources: []string{"ch1", "aux"}})
	from := c.Grab.RingFrom
	if _, err := e.CueTrim(tp.ID, c.ID, 4800, 96000-4800); err != nil {
		t.Fatal(err)
	}
	if _, err := e.CueShape(tp.ID, c.ID, BoardShape{GainDB: ptr(-6.0)}); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	k, err := e.CueKeep(tp.ID, c.ID, dir, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, k.Name)
	info, err := audio.ReadWAVInfo(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Channels != 2 || info.Frames() != 96000-9600 || k.Label != "Grab · ch1 + aux" {
		t.Fatalf("take %s: %d channels, %d frames, %q", k.Name, info.Channels, info.Frames(), k.Label)
	}
	var data []int32
	audio.ReadFrames(path, 0, info.Frames(), 1<<14, func(b []int32, _ int64) error { data = append(data, b...); return nil })
	half := math.Pow(10, -6.0/20)
	for _, f := range []int64{1000, 40000, 86000} {
		rf := from + 4800 + f // the window's frame f
		for ch := int64(0); ch < 2; ch++ {
			want := (float64(ringAt(t, sink, 2+int(ch), rf)) + float64(ringAt(t, sink, 6+int(ch), rf))) * half
			if got := float64(data[2*f+ch]); math.Abs(got-want) > 4 {
				t.Fatalf("frame %d ch %d = %.0f, want ch1 + aux at -6 dB = %.0f", f, ch, got, want)
			}
		}
	}
	// It starts and ends with a declick, as a cut does.
	if data[0] != 0 || data[2*(info.Frames()-1)] != 0 {
		t.Fatalf("its ends are %d and %d, not faded", data[0], data[2*(info.Frames()-1)])
	}
	m := audio.ReadMeta(path)
	if m.Origin != audio.OriginBuffer || m.BPM == nil || *m.BPM != 240 || m.TempoFrom != audio.TempoFromYou || m.DownbeatFrame == nil || *m.DownbeatFrame != 48000-4800 {
		t.Fatalf("meta = %+v", m)
	}
}

func ptr[T any](v T) *T { return &v }

func TestNormalizeBringsTheLanesSumUp(t *testing.T) {
	e, sink, tp := barLoop(t)
	from, to := int64(100000), int64(148000)
	id := grabReq(t, e, GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"ch1", "aux"}}).ID
	c, err := e.CueShape(tp.ID, id, BoardShape{Normalize: true})
	if err != nil {
		t.Fatal(err)
	}
	// The lanes as a take sums them, CH1 (the tape's 0.5 through a track at
	// -6 dB) over AUX's ramp: their sum's loudest moment sets one gain for
	// the clip, so its lanes keep their balance.
	loudest := 0.0
	for f := from; f < to; f += 7 {
		for ch := 0; ch < 2; ch++ {
			loudest = math.Max(loudest, math.Abs(float64(ringAt(t, sink, 2+ch, f))+float64(ringAt(t, sink, 6+ch, f))))
		}
	}
	want := math.Round((audio.NormalizePeakDB-20*math.Log10(loudest/2147483648.0))*10) / 10
	if g := c.GainDB; math.Abs(g-want) > 0.15 {
		t.Fatalf("the clip at %+.1f dB, want %+.1f", g, want)
	}
	// Fades: frames, kept to the window.
	if c, err = e.CueShape(tp.ID, id, BoardShape{FadeIn: ptr(int64(4800)), FadeOut: ptr(int64(1e9)), FadeOutShape: ptr("s")}); err != nil {
		t.Fatal(err)
	}
	if c.FadeIn != 4800 || c.FadeOut != c.Frames || c.FadeOutShape != "s" {
		t.Fatalf("fades = %+v", c)
	}
}

// --- what the review found ---------------------------------------------------------

func TestAGrabBeforeTheRingHasFilledStartsAtItsFirstFrame(t *testing.T) {
	// 8 s, or 4 wall-clock bars of 2 s, with 3 s in a 20 s ring: the start
	// is before the ring's first frame. It moves there, and says so; nothing
	// downstream gets a negative frame.
	for _, req := range []GrabRequest{{Seconds: 8, Sources: []string{"aux"}}, {Bars: 4, Sources: []string{"aux"}}} {
		e, sink, tp := newEngine(t)
		e.grabWait = 20 * time.Millisecond
		if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error {
			g := GridFor(120, 4, 48000) // a bar is 96000: 4 bars are 8 s
			s.Grid = &g
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		e.Start()
		sink.play(t, 48000*3)
		c := grabReq(t, e, req)
		gr, lane := c.Grab, c.Lanes[0]
		_, total := sink.ring.Window()
		if !gr.Clamped || gr.RingFrom != 0 || gr.Before != 0 || lane.Src != 0 || gr.Frames != int64(total) {
			t.Fatalf("%+v: ring_from %d, before %d, src %d, %d frames of %d, clamped %v", req, gr.RingFrom, gr.Before, lane.Src, gr.Frames, total, gr.Clamped)
		}
		if ringFrameOf(readPool(t, e.store, lane.File)[0]) != 0 {
			t.Fatal("the lane doesn't start at the ring's first frame")
		}
		// And it all works from there: a take, the audition, a drop.
		if _, err := e.CueKeep(tp.ID, c.ID, t.TempDir(), time.Now()); err != nil {
			t.Fatalf("keep as take: %v", err)
		}
		if _, err := e.CueAudio(tp.ID, c.ID); err != nil {
			t.Fatalf("audition: %v", err)
		}
		if _, err := e.CueDrop(tp.ID, c.ID, 2, false, nil); err != nil {
			t.Fatalf("drop: %v", err)
		}
	}
}

func TestAGrabClampsWhereTheRingStartsOnceItsDoneWaiting(t *testing.T) {
	// The ring has wrapped. The grab reaches right back to its oldest
	// second, then waits a bar -- 2 s, longer than that second -- for the
	// handle after, and the ring, recording on, overwrites that start
	// meanwhile. The clamp is the ring's as it is after the wait.
	e, sink, tp := newEngine(t)
	e.grabWait = 0
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error {
		g := GridFor(120, 4, 48000) // a bar is 96000: a handle of 2 s
		s.Grid = &g
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	e.Start()
	sink.play(t, 48000*25) // a 20 s ring, 5 s overwritten
	from := int64(0)
	done := make(chan CueGrabbed, 1)
	errs := make(chan error, 1)
	go func() {
		g, err := e.GrabToCue(tp.ID, GrabRequest{RingFrom: &from, Sources: []string{"aux"}}, "")
		if err != nil {
			errs <- err
			return
		}
		done <- g
	}()
	time.Sleep(30 * time.Millisecond)
	sink.play(t, 48000*3) // the ring moves on while the grab waits
	select {
	case err := <-errs:
		t.Fatal(err)
	case g := <-done:
		gr, lane := g.Clip.Grab, g.Clip.Lanes[0]
		data := readPool(t, e.store, lane.File)
		if !gr.Clamped || gr.Before < 0 || lane.Src < 0 || gr.RingFrom < 48000*(25+2-20) {
			t.Fatalf("ring_from %d, before %d, src %d: the ring had moved past %d", gr.RingFrom, gr.Before, lane.Src, 48000*(25+2-20))
		}
		if ringFrameOf(data[2*lane.Src]) != gr.RingFrom {
			t.Fatalf("the window starts at ring frame %d, the grab says %d", ringFrameOf(data[2*lane.Src]), gr.RingFrom)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the grab never came back")
	}
	// A span that has left the ring altogether is refused.
	to := int64(48000)
	if _, err := e.GrabToCue(tp.ID, GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"aux"}}, ""); !errors.Is(err, ErrGone) {
		t.Fatalf("a span long gone: %v", err)
	}
}

func TestAfterARestartAGrabCantBeTakenAgain(t *testing.T) {
	// The ring's frames start over when Hindsight does; the cue clip keeps
	// the old numbers. Taking its span again from other sources would copy
	// other audio, so it's refused.
	s := newTestStore(t)
	sink1 := &loopSink{ring: audio.NewRing(48000*20, 8)}
	e1 := NewEngine(Options{Store: s, Capture: sink1, Sink: sink1})
	tp, err := s.Create("test", 0, 0, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e1.Load(tp.ID); err != nil {
		t.Fatal(err)
	}
	testEngine = e1
	e1.Start()
	sink1.play(t, 48000*6)
	from, to := int64(48000*2), int64(48000*3)
	c := grabReq(t, e1, GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"aux"}})
	e1.Stop()

	sink2 := &loopSink{ring: audio.NewRing(48000*20, 8)}
	e2 := NewEngine(Options{Store: s, Capture: sink2, Sink: sink2})
	if _, err := e2.Load(tp.ID); err != nil {
		t.Fatal(err)
	}
	testEngine = e2
	t.Cleanup(func() { e2.Stop(); testEngine = nil })
	e2.Start()
	sink2.play(t, 48000*6)
	if _, err := e2.GrabToCue(tp.ID, GrabRequest{Sources: []string{"ch1", "aux"}}, c.ID); !errors.Is(err, ErrGone) {
		t.Fatalf("again after a restart: %v, want it refused", err)
	}
	// It still keeps: its audio is in the pool.
	if _, err := e2.CueKeep(tp.ID, c.ID, t.TempDir(), time.Now()); err != nil {
		t.Fatal(err)
	}
}

func TestAnInsertedBufferIsUsed(t *testing.T) {
	// Inserted, the buffer is used: replacing it holds nothing for Undo.
	e, _, tp := barLoop(t)
	if _, _, err := e.CopyRing(100000, 148000, "aux"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "insert", Track: 2}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.CopyRing(100000, 148000, "aux"); err != nil {
		t.Fatal(err)
	}
	if s, err := e.store.loadReplaced(); err != nil || s != nil {
		t.Fatalf("an inserted buffer was held when replaced: %+v %v", s, err)
	}
}

// fullScale counts the samples of a take at full scale, either way.
func fullScale(t *testing.T, path string) (n int, peak float64) {
	t.Helper()
	info, err := audio.ReadWAVInfo(path)
	if err != nil {
		t.Fatal(err)
	}
	audio.ReadFrames(path, 0, info.Frames(), 1<<14, func(b []int32, _ int64) error {
		for _, v := range b {
			if v >= 2147483647 || v <= -2147483647 {
				n++
			}
			peak = math.Max(peak, math.Abs(float64(v))/2147483648)
		}
		return nil
	})
	return n, peak
}

func TestNormalizeAndKeepNeverClip(t *testing.T) {
	// Four lanes normalized, then summed into a take: Normalize sets the
	// level for their sum, so the take peaks at −1.5 dBFS, not over the top.
	e, _, tp := barLoop(t)
	from, to := int64(100000), int64(148000)
	id := grabReq(t, e, GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"main", "ch1", "ch2", "aux"}}).ID
	if _, err := e.CueShape(tp.ID, id, BoardShape{Normalize: true}); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	k, err := e.CueKeep(tp.ID, id, dir, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	n, peak := fullScale(t, filepath.Join(dir, k.Name))
	if db := 20 * math.Log10(peak); n > 0 || math.Abs(db-audio.NormalizePeakDB) > 0.3 {
		t.Fatalf("normalized and kept: %d samples at full scale, peak %.2f dBFS, want %.1f", n, db, audio.NormalizePeakDB)
	}
	// Turned up past full scale by hand, the sum is brought down under it
	// as a whole -- for the take and the audition alike -- never clipped.
	if _, err := e.CueShape(tp.ID, id, BoardShape{GainDB: ptr(12.0)}); err != nil {
		t.Fatal(err)
	}
	k, err = e.CueKeep(tp.ID, id, dir, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if n, peak := fullScale(t, filepath.Join(dir, k.Name)); n > 0 || peak > 0.99 || peak < 0.9 {
		t.Fatalf("12 dB over and kept: %d samples at full scale, peak %.3f", n, peak)
	}
	pcm, err := e.CueAudio(tp.ID, id)
	if err != nil {
		t.Fatal(err)
	}
	loud := 0.0
	for _, v := range pcm {
		loud = math.Max(loud, math.Abs(float64(v)))
	}
	if loud > 0.99 || loud < 0.9 {
		t.Fatalf("the audition peaks at %.3f, want it brought under full scale", loud)
	}
}

// --- a take's span, on the cue lane (the Listening Room's "to the studio") ----------

// tempoTake is a ramp take, frame i holding i×1000, at bpm.
func tempoTake(t *testing.T, frames int, bpm float64) string {
	t.Helper()
	p := takeWAV(t, frames, func(i int) float64 { return float64(i) * 1000 / 2147483647 })
	if bpm > 0 {
		if err := audio.WriteMeta(p, audio.Meta{BPM: &bpm}); err != nil {
			t.Fatal(err)
		}
	}
	return p
}

func TestATakeGrabsHandlesAreABarOfTheTake(t *testing.T) {
	e, _, _ := newEngine(t)
	e.handleS = 0.5
	take := tempoTake(t, 1200000, 120) // a bar is 96000
	c, err := grabTake(t, e, take, "jam_take.wav", "Tuesday jam", 300000, 492000)
	if err != nil {
		t.Fatal(err)
	}
	gr, lane := c.Grab, c.Lanes[0]
	data := readPool(t, e.store, lane.File)
	if gr.Before != 96000 || gr.After != 96000 || lane.Src != 96000 || lane.Frames != 192000 || ringFrameOf(data[2*lane.Src]) != 300000 {
		t.Fatalf("handles %d and %d, lane %+v starting at take frame %d", gr.Before, gr.After, lane, ringFrameOf(data[2*lane.Src]))
	}
	if gr.Take != "jam_take.wav" || gr.TakeFrom != 300000 || gr.Sources[0] != "Tuesday jam" || c.Name != "Tuesday jam" || c.Source != "take" || c.BPM != 120 {
		t.Fatalf("grab %+v named %q from %q at %v", gr, c.Name, c.Source, c.BPM)
	}
	// No label of its own: the page names it by its time.
	if gr.TakeLabel != "" {
		t.Fatalf("take_label %q, want none", gr.TakeLabel)
	}
	// TAPE_HANDLE_S, when it's longer than the bar.
	e.handleS = 3
	if c, err = grabTake(t, e, take, "jam_take.wav", "Tuesday jam", 300000, 492000); err != nil || c.Grab.Before != 144000 {
		t.Fatalf("handle %d, want TAPE_HANDLE_S's 144000 (%v)", c.Grab.Before, err)
	}
	// At most 10 s, however slow the take.
	slow := tempoTake(t, 2400000, 20) // a bar is 12 s
	if c, err = grabTake(t, e, slow, "jam_slow.wav", "Slow", 1000000, 1100000); err != nil || c.Grab.Before != 480000 || c.Grab.After != 480000 {
		t.Fatalf("handles %d and %d, want 10 s (%v)", c.Grab.Before, c.Grab.After, err)
	}
	// As far as the take goes: near its start, and its end.
	e.handleS = 0.5
	if c, err = grabTake(t, e, take, "jam_take.wav", "Tuesday jam", 40000, 136000); err != nil || c.Grab.Before != 40000 || c.Grab.After != 96000 {
		t.Fatalf("near the start: %+v (%v)", c.Grab, err)
	}
	if c, err = grabTake(t, e, take, "jam_take.wav", "Tuesday jam", 1100000, 1180000); err != nil || c.Grab.After != 20000 {
		t.Fatalf("near the end: %+v (%v)", c.Grab, err)
	}
	// With no tempo, TAPE_HANDLE_S.
	plain := tempoTake(t, 400000, 0)
	if c, err = grabTake(t, e, plain, "jam_plain.wav", "Plain", 100000, 200000); err != nil || c.Grab.Before != 24000 || c.Grab.BarFrames != 0 {
		t.Fatalf("no tempo: %+v (%v)", c.Grab, err)
	}
	if _, err := grabTake(t, e, take, "jam_take.wav", "x", 100, 99); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("a span backwards: %v", err)
	}
}

func TestATakeGrabTrimsInsideItsHandles(t *testing.T) {
	e, _, tp := newEngine(t)
	e.handleS = 0.5
	take := tempoTake(t, 1200000, 120)
	g, err := grabTake(t, e, take, "jam_take.wav", "Tuesday jam", 300000, 492000)
	if err != nil {
		t.Fatal(err)
	}
	over := int64(OverhangSeconds * 48000)
	c, err := e.CueTrim(tp.ID, g.ID, -1e7, 1e7)
	if err != nil {
		t.Fatal(err)
	}
	lane := c.Lanes[0]
	data := readPool(t, e.store, lane.File)
	if c.Grab.In != -96000+over || c.Grab.Out != 192000+96000-over || ringFrameOf(data[2*lane.Src]) != 300000-96000+over {
		t.Fatalf("window [%d, %d), lane %+v from take frame %d", c.Grab.In, c.Grab.Out, lane, ringFrameOf(data[2*lane.Src]))
	}
	// And keeps as a take from there, at the take's tempo.
	k, err := e.CueKeep(tp.ID, g.ID, t.TempDir(), time.Now())
	if err != nil || k.Seconds != float64(c.Frames)/48000 {
		t.Fatalf("kept %+v: %v", k, err)
	}
}

func TestATakeGrabsSourcesStay(t *testing.T) {
	e, _, tp := newEngine(t)
	take := tempoTake(t, 400000, 120)
	c, err := grabTake(t, e, take, "jam_take.wav", "Tuesday jam", 100000, 200000)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.GrabToCue(tp.ID, GrabRequest{Sources: []string{"aux"}}, c.ID); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("other sources for a take's grab: %v", err)
	}
}

func TestAPlainTakeCopyIsNotAGrab(t *testing.T) {
	// The take page's Copy, as it was before the buffer: no grab, and the
	// handles TAPE_HANDLE_S's.
	e, _, _ := newEngine(t)
	e.handleS = 0.5
	take := tempoTake(t, 400000, 120)
	c, err := e.CopyTake(take, "jam_take.wav", 100000, 200000, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	if c.Grab != nil || c.Tracks[0][0].Src != 24000 || c.From != "jam_take.wav" {
		t.Fatalf("a plain copy = %+v, grab %+v", c.Tracks[0][0], c.Grab)
	}
}

func TestATakeGrabCarriesTheTakesOwnName(t *testing.T) {
	e, _, _ := newEngine(t)
	take := tempoTake(t, 1200000, 0)
	if err := audio.WriteMeta(take, audio.Meta{Label: " Tuesday jam "}); err != nil {
		t.Fatal(err)
	}
	c, err := grabTake(t, e, take, "jam_take.wav", "Tuesday jam", 0, 96000)
	if err != nil {
		t.Fatal(err)
	}
	if c.Grab.TakeLabel != "Tuesday jam" {
		t.Fatalf("take_label %q, want the take's label", c.Grab.TakeLabel)
	}
}
