package tape

import (
	"math"
	"math/rand"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/mono"
)

// tempoEngine is an engine on the loopSink with a tape that has a tempo of
// 120 BPM and bars bars, and nothing on it.
func tempoEngine(t *testing.T, bars int) (*Engine, *loopSink, *Tape) {
	t.Helper()
	s := newTestStore(t)
	sink := &loopSink{ring: audio.NewRing(48000*30, 8)}
	e := NewEngine(Options{Store: s, Capture: sink, Sink: sink})
	tp, err := s.Create("rec", 120, bars, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Load(tp.ID); err != nil {
		t.Fatal(err)
	}
	testEngine = e
	t.Cleanup(func() { e.Stop(); testEngine = nil })
	return e, sink, tp
}

func busA(out []int32, f int) float64 { return float64(out[f*OutChannels]) / 2147483647 }

func TestAnEmptyTapeWithATempoClicksOnTheBeat(t *testing.T) {
	e, sink, tp := tempoEngine(t, 1)
	if !e.Loaded().Click {
		t.Fatal("a new tape's click should be on")
	}
	e.Do(Action{Kind: "play"})
	e.Start()
	out := sink.play(t, 96000*2+2000)
	// Beats every 24000 frames; a blip of 25 ms on each, silence between.
	for _, beat := range []int{0, 24000, 48000, 72000} {
		var peak float64
		for f := beat; f < beat+600; f++ {
			peak = math.Max(peak, math.Abs(busA(out, f)))
		}
		if peak < 0.05 {
			t.Fatalf("no click at beat frame %d (peak %.3f)", beat, peak)
		}
		if v := busA(out, beat+12000); v != 0 {
			t.Fatalf("between beats: %.4f", v)
		}
	}
	// The first catch turns it off.
	if _, err := e.Catch(tp.ID, CatchRequest{Track: 1, Source: "aux", Pass: 1}); err != nil {
		t.Fatal(err)
	}
	if e.Loaded().Click {
		t.Fatal("the click should go off once the tape has audio")
	}
}

func TestPlayingArmedCountsInABarThenRecordsFromTheBar(t *testing.T) {
	e, sink, tp := tempoEngine(t, 4) // a 4-bar loop of 384000; a bar is 96000
	e.SetMeta(tp.ID, func(t *Tape) error { t.Click = false; return nil })
	e.Start()
	if r, err := e.Record(tp.ID, 2, "aux"); err != nil || r.State != "armed" {
		t.Fatalf("Record while stopped = %+v %v, want armed", r, err)
	}
	if _, err := e.Transport(tp.ID, Action{Kind: "play"}); err != nil {
		t.Fatal(err)
	}
	out := sink.play(t, 96000+1000)
	// The count-in: four clicks with the tape standing at bar 1.
	if v := math.Abs(busA(out, 100)); v < 0.001 {
		t.Fatalf("no count-in click: %.4f", v)
	}
	if st := e.Live(); !st.Playing || st.Heard > 2000 {
		t.Fatalf("after the count-in: %+v, want playing from bar 1", st.Status)
	}
	sink.play(t, 96000*2+30000) // two and a bit bars
	clip, err := e.Transport(tp.ID, Action{Kind: "stop"})
	if err != nil || clip == nil {
		t.Fatalf("stop = %v %v, want the recording kept", clip, err)
	}
	// From bar 1 to the last complete bar: two bars, at the loop's start,
	// holding what aux heard from the end of the count-in.
	if clip.At != 0 || clip.Frames != 192000 {
		t.Fatalf("kept %+v, want two bars at 0", clip)
	}
	data := readPool(t, e.store, clip.File)
	if data[2*clip.Src] != auxAt(96000) {
		t.Fatalf("starts at ring frame %d, want 96000", data[2*clip.Src]/1000)
	}
	if e.Recording() != nil {
		t.Fatal("still recording after stop")
	}
}

func TestAPunchOverSeveralPassesKeepsTheLastFullOne(t *testing.T) {
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.5 })
	if _, err := e.DropTake(tp.ID, take, 0, 96000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	e.Do(Action{Kind: "play"})
	e.Start()
	sink.play(t, 30000) // into the first pass
	if r, err := e.Record(tp.ID, 2, "aux"); err != nil || r.State != "on" {
		t.Fatalf("Record while playing = %+v %v, want on", r, err)
	}
	if _, err := e.Record(tp.ID, 3, "aux"); err == nil {
		t.Fatal("a second Record should be refused")
	}
	sink.play(t, 96000*3) // to 318000: passes at 96000 and 192000 are full
	clip, err := e.EndRecording(tp.ID, false)
	if err != nil || clip == nil {
		t.Fatal(err)
	}
	if clip.At != 0 || clip.Frames != 96000 {
		t.Fatalf("kept %+v, want a whole pass", clip)
	}
	data := readPool(t, e.store, clip.File)
	if data[2*clip.Src] != auxAt(192000) {
		t.Fatalf("kept the pass from ring frame %d, want the last full one at 192000", data[2*clip.Src]/1000)
	}
	// Cancelling keeps nothing.
	e.Record(tp.ID, 3, "aux")
	sink.play(t, 96000*2)
	if clip, err := e.EndRecording(tp.ID, true); clip != nil || err != nil {
		t.Fatalf("cancel = %v %v", clip, err)
	}
	if n := len(e.Loaded().Tracks[2].Clips); n != 0 {
		t.Fatalf("track 3 has %d clips after a cancel", n)
	}
}

func TestTwoTapsMakeTheFirstLoopFromTheAttacksNearThem(t *testing.T) {
	s := newTestStore(t)
	// A capture whose clock says frame f was converted at t0 + f/48 kHz,
	// holding two hits on aux 2.5 s apart.
	c := &fakeCap{ring: audio.NewRing(48000*20, 8), bridge: audio.NewClockBridge(1024, 48000)}
	t0 := mono.Now() - int64(8*time.Second)
	for f := int64(0); f <= 8*48000; f += 2048 {
		c.bridge.Record(t0+f*1e9/48000, uint64(f))
	}
	r := rand.New(rand.NewSource(7))
	in := make([]int32, 8*48000*8)
	for _, hit := range []int{48000, 168000} {
		for i := 0; i < 4000; i++ {
			v := int32((r.Float64() - 0.5) * math.Exp(-float64(i)/500) * 1.6e9)
			in[(hit+i)*8+6], in[(hit+i)*8+7] = v, v
		}
	}
	c.ring.WriteFrames(in)
	e := NewEngine(Options{Store: s, Capture: c})
	tp, _ := s.Create("free", 0, 0, time.Now())
	e.Load(tp.ID)
	at := func(f int64) int64 { return t0 + f*1e9/48000 }

	// Tapped 100 ms late, then 30 ms early.
	res, err := e.Tap(tp.ID, 1, "aux", at(48000+4800))
	if err != nil || res.Stage != "first" || !e.Live().Tapped {
		t.Fatalf("first tap = %+v %v", res, err)
	}
	res, err = e.Tap(tp.ID, 1, "aux", at(168000-1440))
	if err != nil || res.Stage != "loop" {
		t.Fatalf("second tap = %+v %v", res, err)
	}
	g := e.Loaded().Grid
	if g == nil || g.Frames < 119990 || g.Frames > 120010 || g.Bars != 1 || res.BPM < 95.9 || res.BPM > 96.1 {
		t.Fatalf("grid %+v bpm %v, want 2.5 s as 1 bar at 96", g, res.BPM)
	}
	if res.Clip.At != 0 || !e.Loaded().Loop.On {
		t.Fatalf("clip %+v loop %+v", res.Clip, e.Loaded().Loop)
	}
	// A tape with a tempo takes no taps.
	if _, err := e.Tap(tp.ID, 1, "aux", at(200000)); err == nil {
		t.Fatal("a tap on a tape with a tempo should be refused")
	}
}

func TestAnAttackIsFoundToTheMillisecond(t *testing.T) {
	r := rand.New(rand.NewSource(8))
	x := make([]float64, 15000)
	for i := range x {
		x[i] = (r.Float64() - 0.5) * 0.001 // a quiet room
	}
	for i := 0; i < 3000; i++ {
		x[9000+i] += (r.Float64() - 0.5) * math.Exp(-float64(i)/400)
	}
	for i := 0; i < 3000; i++ {
		x[3000+i] += 0.1 * (r.Float64() - 0.5) * math.Exp(-float64(i)/400) // a weaker one
	}
	if got := attackIn(x); got < 9000-48 || got > 9000+48 {
		t.Fatalf("attack at %d, want 9000 ±1 ms", got)
	}
	if got := attackIn(make([]float64, 15000)); got != -1 {
		t.Fatalf("silence has an attack at %d", got)
	}
}
