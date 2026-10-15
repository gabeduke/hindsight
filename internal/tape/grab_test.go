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

func TestGrabbingTheLastBarsTakesTheSpanCatchWould(t *testing.T) {
	// The Studio's GRAB by bars is Catch's arithmetic -- lastBars, then the
	// output-to-ring mapping with Δ and TAPE_LATENCY_MS -- with the
	// clipboard for a destination. The same press must hear the same audio.
	e, _, tp := barLoop(t)
	e.latencyMS = 5 // 240 frames: a grab that skipped the latency would be off by them
	e.grabWait = 20 * time.Millisecond
	caught, err := e.Catch(tp.ID, CatchRequest{Track: 2, Source: "aux", Bars: 2})
	if err != nil {
		t.Fatal(err)
	}
	g, err := e.Grab(GrabRequest{Bars: 2, Sources: []string{"aux"}})
	if err != nil {
		t.Fatal(err)
	}
	gr := g.Board.Grab
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
	lane := g.Board.Tracks[0][0]
	data := readPool(t, e.store, lane.File)
	if ringFrameOf(data[2*lane.Src]) != want || lane.Frames != 96000 || g.Board.Frames != 96000 {
		t.Fatalf("the grab's lane starts at ring frame %d (%+v), want %d", ringFrameOf(data[2*lane.Src]), lane, want)
	}
	// Its last frame is the catch's last frame too.
	last := caught.Frames - 1
	if v := readPool(t, e.store, caught.File); ringFrameOf(v[2*(caught.Src+last)]) != ringFrameOf(data[2*(lane.Src+last)]) {
		t.Fatal("the grab and the catch end on different frames")
	}
	// Bar 1 of it is a bar line, the tempo is the tape's, and it says so.
	if gr.Downbeat == nil || *gr.Downbeat != 0 || gr.BarFrames != 48000 || g.Board.BPM != 240 || gr.Bars != 2 {
		t.Fatalf("grab = %+v, bpm %v", gr, g.Board.BPM)
	}
	if g.Board.From != "the feed, last 2 bars (aux)" {
		t.Fatalf("from = %q", g.Board.From)
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
	g, err := e.Grab(GrabRequest{Bars: 2, Sources: []string{"aux"}})
	if err != nil {
		t.Fatal(err)
	}
	gr := g.Board.Grab
	_, total := sink.ring.Window() // played in whole blocks: a little past 400000
	if !gr.Wall || gr.Why == "" || gr.Frames != 192000 || gr.RingFrom != int64(total)-192000 || gr.Downbeat != nil {
		t.Fatalf("grab = %+v", gr)
	}
}

func TestAGrabFromSeveralSourcesIsOneTrackEachOverOneSpan(t *testing.T) {
	e, sink, _ := barLoop(t)
	from, to := int64(60000), int64(108000)
	// Asked for in any order, laid in the tape's: ch1, then aux.
	g, err := e.Grab(GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"aux", "ch1"}})
	if err != nil {
		t.Fatal(err)
	}
	c := g.Board
	if len(c.Tracks) != 2 || c.Frames != 48000 || len(c.Grab.Sources) != 2 || c.Grab.Sources[0] != "ch1" || c.Grab.Sources[1] != "aux" {
		t.Fatalf("board = %d tracks, %d frames, sources %v", len(c.Tracks), c.Frames, c.Grab.Sources)
	}
	a, b := c.Tracks[0][0], c.Tracks[1][0]
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
	g, err := e.Grab(GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"aux"}})
	if err != nil {
		t.Fatal(err)
	}
	gr := g.Board.Grab
	if gr.Before != 48000 || gr.After != 48000 {
		t.Fatalf("handles %d and %d, want a bar (48000) either side", gr.Before, gr.After)
	}
	data := readPool(t, e.store, g.Board.Tracks[0][0].File)
	if int64(len(data)/2) != 48000+48000+48000 || ringFrameOf(data[0]) != from-48000 {
		t.Fatalf("the file is %d frames from ring frame %d", len(data)/2, ringFrameOf(data[0]))
	}
	// A longer TAPE_HANDLE_S wins over the bar, up to 10 s (where the ring
	// has it: never within a second of its oldest frame).
	e.handleS = 1.5
	from, to = 130000, 160000
	if g, err = e.Grab(GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"aux"}}); err != nil {
		t.Fatal(err)
	}
	if gr := g.Board.Grab; gr.Before != 72000 || gr.After != 72000 {
		t.Fatalf("handles %d and %d, want TAPE_HANDLE_S's 72000", gr.Before, gr.After)
	}
	if h := e.grabHandle(48000, 12*48000); h != 10*48000 {
		t.Fatalf("a 12 s bar's handle = %d, want 10 s", h)
	}

	// The last bars end on the last bar line heard: the bar after them is
	// still being played, and a grab waits for it.
	e.handleS = 0.5
	done := make(chan Grabbed, 1)
	errs := make(chan error, 1)
	go func() {
		g, err := e.Grab(GrabRequest{Bars: 1, Sources: []string{"aux"}})
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
		if gr := g.Board.Grab; gr.Before < 48000 || gr.After < 48000 || gr.Wall {
			t.Fatalf("handles %d and %d (wall %v), want at least a bar", gr.Before, gr.After, gr.Wall)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the grab never came back")
	}
}

func TestATrimNeverLeavesTheHandles(t *testing.T) {
	e, _, _ := barLoop(t)
	e.handleS = 0.5
	from, to := int64(100000), int64(148000)
	if _, err := e.Grab(GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"aux"}}); err != nil {
		t.Fatal(err)
	}
	over := int64(OverhangSeconds * 48000)
	// Far past both handles: each edge stops the overhang short of its end.
	c, err := e.TrimClipboard(-10*48000, 10*48000)
	if err != nil {
		t.Fatal(err)
	}
	gr := c.Grab
	if gr.In != -48000+over || gr.Out != 48000+48000-over || c.Frames != gr.Out-gr.In {
		t.Fatalf("window [%d, %d), %d frames", gr.In, gr.Out, c.Frames)
	}
	lane := c.Tracks[0][0]
	data := readPool(t, e.store, lane.File)
	if lane.Src != over || lane.Frames != c.Frames || ringFrameOf(data[2*lane.Src]) != from+gr.In {
		t.Fatalf("lane %+v reads from ring frame %d", lane, ringFrameOf(data[2*lane.Src]))
	}
	// In past Out leaves the shortest window there is, not a negative one.
	if c, err = e.TrimClipboard(30000, 20000); err != nil {
		t.Fatal(err)
	}
	if c.Grab.In != 30000 || c.Frames != over {
		t.Fatalf("window [%d, %d), %d frames", c.Grab.In, c.Grab.Out, c.Frames)
	}
	// A bar in from each end, as IN ▸ and OUT ◂ would make it.
	if c, err = e.TrimClipboard(12000, 36000); err != nil {
		t.Fatal(err)
	}
	if lane := c.Tracks[0][0]; ringFrameOf(readPool(t, e.store, lane.File)[2*lane.Src]) != from+12000 || lane.Frames != 24000 {
		t.Fatalf("lane %+v", lane)
	}
	// Reversed, the window reads the same audio backwards.
	if c, err = e.ShapeClipboard(BoardShape{Reverse: true}); err != nil {
		t.Fatal(err)
	}
	lane = c.Tracks[0][0]
	rev := readPool(t, e.store, lane.File)
	if lane.Reversed == nil || ringFrameOf(rev[2*lane.Src]) != from+36000-1 || ringFrameOf(rev[2*(lane.Src+lane.Frames-1)]) != from+12000 {
		t.Fatalf("reversed lane %+v plays ring frames %d…%d", lane, ringFrameOf(rev[2*lane.Src]), ringFrameOf(rev[2*(lane.Src+lane.Frames-1)]))
	}
	// And trimmed while reversed, too.
	if c, err = e.TrimClipboard(0, 48000); err != nil {
		t.Fatal(err)
	}
	lane = c.Tracks[0][0]
	if ringFrameOf(rev[2*lane.Src]) != from+48000-1 || lane.Frames != 48000 {
		t.Fatalf("reversed, trimmed lane %+v starts at ring frame %d", lane, ringFrameOf(rev[2*lane.Src]))
	}
	// Turned back: its own file again.
	if c, err = e.ShapeClipboard(BoardShape{Reverse: true}); err != nil {
		t.Fatal(err)
	}
	if lane := c.Tracks[0][0]; lane.Reversed != nil || ringFrameOf(readPool(t, e.store, lane.File)[2*lane.Src]) != from {
		t.Fatalf("turned back: %+v", lane)
	}
	// A copy isn't a grab: it isn't trimmed in the buffer.
	if _, _, err := e.CopyRing(from, to, "aux"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.TrimClipboard(0, 1000); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("trimming a copy: %v", err)
	}
}

func TestKeepAsTakeWritesTheWindowSummed(t *testing.T) {
	e, sink, _ := barLoop(t)
	e.grabWait = 20 * time.Millisecond
	g, err := e.Grab(GrabRequest{Bars: 2, Sources: []string{"ch1", "aux"}})
	if err != nil {
		t.Fatal(err)
	}
	from := g.Board.Grab.RingFrom
	if _, err := e.TrimClipboard(4800, 96000-4800); err != nil {
		t.Fatal(err)
	}
	if _, err := e.ShapeClipboard(BoardShape{GainDB: ptr(-6.0)}); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	k, err := e.KeepClipboardTake(dir, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, k.Name)
	info, err := audio.ReadWAVInfo(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Channels != 2 || info.Frames() != 96000-9600 || k.Label != "Buffer · ch1 + aux" {
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
	// Kept, it's used: replacing it now keeps nothing in the crate.
	if c, _ := e.Clipboard(); !c.Grab.Used {
		t.Fatal("a buffer kept as a take isn't marked used")
	}
}

func ptr[T any](v T) *T { return &v }

func TestAReplacedUnusedBufferIsInTheCrate(t *testing.T) {
	e, _, tp := barLoop(t)
	from, to := int64(100000), int64(148000)
	one, err := e.Grab(GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"ch1", "aux"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(one.Crated) != 0 {
		t.Fatalf("the first grab kept %+v", one.Crated)
	}
	// Another grab: the first, never dropped or kept, goes to the crate, a
	// kept clip for each of its lanes.
	two, err := e.Grab(GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"aux"}})
	if err != nil {
		t.Fatal(err)
	}
	list, _ := e.CrateList("", "")
	if len(two.Crated) != 2 || len(list) != 2 {
		t.Fatalf("crated %+v, the crate has %d", two.Crated, len(list))
	}
	files := map[string]bool{one.Board.Tracks[0][0].File: true, one.Board.Tracks[1][0].File: true}
	for _, k := range list {
		if !files[k.File] || k.Frames != 48000 || k.Source.Kind != "clipboard" {
			t.Fatalf("kept %+v, not one of the first grab's lanes", k)
		}
	}
	if list[0].Name != "The feed (ch1) · 0:01" {
		t.Fatalf("named %q", list[0].Name)
	}
	// Dropped, it's used: a third grab keeps nothing.
	if _, err := e.DropClipboard(tp.ID, 3, false); err != nil {
		t.Fatal(err)
	}
	three, err := e.Grab(GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"aux"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(three.Crated) != 0 {
		t.Fatalf("a dropped buffer was kept again: %+v", three.Crated)
	}
	// Taking the same span from other sources is the same buffer: nothing is
	// kept, and the window stays.
	if _, err := e.TrimClipboard(1000, 47000); err != nil {
		t.Fatal(err)
	}
	again, err := e.Grab(GrabRequest{Again: true, Sources: []string{"ch2", "aux"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(again.Crated) != 0 || len(again.Board.Tracks) != 2 || again.Board.Grab.In != 1000 || again.Board.Grab.Out != 47000 || again.Board.Frames != 46000 {
		t.Fatalf("again = %+v crated %+v", again.Board.Grab, again.Crated)
	}
	// Any copy replaces an unused grab the same way: Copy on the tape too.
	if _, _, err := e.CopyRing(from, to, "aux"); err != nil {
		t.Fatal(err)
	}
	if list, _ := e.CrateList("", ""); len(list) != 4 {
		t.Fatalf("the crate has %d, want the again's two lanes added", len(list))
	}
	// A copy isn't a grab: replacing it keeps nothing.
	if g, err := e.Grab(GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"aux"}}); err != nil || len(g.Crated) != 0 {
		t.Fatalf("replacing a copy: %+v %v", g.Crated, err)
	}
}

func TestATossCanBeUndone(t *testing.T) {
	e, _, _ := barLoop(t)
	from, to := int64(100000), int64(148000)
	g, err := e.Grab(GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"aux"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.TossClipboard(); err != nil {
		t.Fatal(err)
	}
	if c, _ := e.Clipboard(); c != nil {
		t.Fatalf("tossed, the clipboard holds %+v", c)
	}
	// Tossed, its audio is kept from a clean-up until the next toss.
	old := time.Now().Add(-time.Hour)
	osChtimes(e.store.AudioPath(g.Board.Tracks[0][0].File), old)
	if _, _, err := e.store.Cleanup(nil); err != nil {
		t.Fatal(err)
	}
	if !poolNames(t, e)[g.Board.Tracks[0][0].File] {
		t.Fatal("a clean-up took the tossed buffer's audio")
	}
	c, kept, err := e.RestoreClipboard()
	if err != nil || len(kept) != 0 || c.Grab == nil || !c.Created.Equal(g.Board.Created) {
		t.Fatalf("restored %+v kept %+v: %v", c, kept, err)
	}
	if c, _ := e.Clipboard(); c == nil || c.Tracks[0][0].File != g.Board.Tracks[0][0].File {
		t.Fatal("the restored buffer isn't on the clipboard")
	}
	if _, _, err := e.RestoreClipboard(); !errors.Is(err, ErrNothingToDo) {
		t.Fatalf("a second restore: %v", err)
	}
	// A plain clear keeps nothing to restore.
	if err := e.ClearClipboard(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.RestoreClipboard(); !errors.Is(err, ErrNothingToDo) {
		t.Fatalf("restore after a clear: %v", err)
	}
}

func TestKeepingTheClipboardKeepsEachLane(t *testing.T) {
	e, _, _ := barLoop(t)
	from, to := int64(100000), int64(148000)
	if _, err := e.Grab(GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"ch1", "aux"}}); err != nil {
		t.Fatal(err)
	}
	ks, err := e.KeepClipboardLanes()
	if err != nil || len(ks) != 2 || ks[0].Name != "The feed (ch1) · 0:01" || ks[1].Name != "The feed (aux) · 0:01" {
		t.Fatalf("kept %+v: %v", ks, err)
	}
	if c, _ := e.Clipboard(); !c.Grab.Used {
		t.Fatal("kept in the crate, it isn't marked used")
	}
}

func TestNormalizeBringsTheLoudestLaneUp(t *testing.T) {
	e, sink, _ := barLoop(t)
	from, to := int64(100000), int64(148000)
	if _, err := e.Grab(GrabRequest{RingFrom: &from, RingTo: &to, Sources: []string{"ch1", "aux"}}); err != nil {
		t.Fatal(err)
	}
	c, err := e.ShapeClipboard(BoardShape{Normalize: true})
	if err != nil {
		t.Fatal(err)
	}
	// The loudest of the two lanes sets the gain, so they keep their balance:
	// CH1, the tape's 0.5 through a track at -6 dB, over AUX's ramp.
	loudest := 0.0
	for ch := 2; ch < 8; ch++ {
		if ch == 4 || ch == 5 {
			continue // CH2 isn't a lane
		}
		for f := from; f < to; f += 7 {
			loudest = math.Max(loudest, math.Abs(float64(ringAt(t, sink, ch, f))))
		}
	}
	want := math.Round((audio.NormalizePeakDB-20*math.Log10(loudest/2147483648.0))*10) / 10
	for _, tr := range c.Tracks {
		if g := tr[0].GainDB; math.Abs(g-want) > 0.15 {
			t.Fatalf("lane %s at %+.1f dB, want %+.1f", tr[0].Source, g, want)
		}
	}
	// Fades: frames, kept to the window.
	if c, err = e.ShapeClipboard(BoardShape{FadeIn: ptr(int64(4800)), FadeOut: ptr(int64(1e9)), FadeOutShape: ptr("s")}); err != nil {
		t.Fatal(err)
	}
	if cl := c.Tracks[1][0]; cl.FadeIn != 4800 || cl.FadeOut != c.Frames || cl.FadeOutShape != "s" {
		t.Fatalf("fades = %+v", cl)
	}
	if _, err := e.ShapeClipboard(BoardShape{FadeInShape: ptr("wobbly")}); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("a curve that doesn't exist: %v", err)
	}
}
