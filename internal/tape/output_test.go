package tape

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// newOutputEngine is newEngine with the loop sink behind an Output, and a
// tape with half-scale audio on bus A looping from bar 1.
func newOutputEngine(t *testing.T) (*Engine, *loopSink, *Output, *Tape) {
	t.Helper()
	s := newTestStore(t)
	sink := &loopSink{ring: audio.NewRing(48000*20, 8)}
	e := NewEngine(Options{Store: s, Capture: sink, Sink: NewOutput(sink)})
	tp, err := s.Create("test", 0, 0, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Load(tp.ID); err != nil {
		t.Fatal(err)
	}
	testEngine = e
	t.Cleanup(func() { e.Stop(); testEngine = nil })
	take := takeWAV(t, 200000, func(int) float64 { return 0.5 })
	if _, err := e.DropTake(tp.ID, take, 96000, 192000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	return e, sink, e.router(), tp
}

func allZero(b []int32) bool {
	for _, v := range b {
		if v != 0 {
			return false
		}
	}
	return true
}

func TestPhoneModeStreamsTheMixAndTheDevicePlaysSilence(t *testing.T) {
	e, sink, o, _ := newOutputEngine(t)
	r := &recorder{}
	o.Stream().Attach(r)
	o.setMode(ModePhone)
	e.Do(Action{Kind: "play"})
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	if out := sink.play(t, 48000); !allZero(out) {
		t.Fatal("the jam room should be silent in phone mode")
	}
	o.Stream().flush()
	p := r.got()
	if len(p) < 45 {
		t.Fatalf("%d packets for a second", len(p))
	}
	for i := 1; i < len(p); i++ {
		if p[i].Frame != p[i-1].Frame+960 {
			t.Fatalf("packet %d at %d after %d", i, p[i].Frame, p[i-1].Frame)
		}
	}
	// 0.5 at -6 dB on bus A: about 0.25 of full scale, 8192 in int16.
	if v := p[len(p)-1].PCM[0]; v < 7800 || v > 8600 || !p[len(p)-1].Playing {
		t.Fatalf("left = %d, playing %v", v, p[len(p)-1].Playing)
	}
}

func TestJamModePlaysTheDeviceAndStreamsNothing(t *testing.T) {
	e, sink, o, _ := newOutputEngine(t)
	r := &recorder{}
	o.Stream().Attach(r)
	e.Do(Action{Kind: "play"})
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	if out := sink.play(t, 9600); allZero(out) {
		t.Fatal("the jam room should play")
	}
	o.Stream().flush()
	if n := len(r.got()); n != 0 {
		t.Fatalf("%d packets in jam mode", n)
	}
}

func TestBothModePlaysTheDeviceAndStreams(t *testing.T) {
	e, sink, o, _ := newOutputEngine(t)
	r := &recorder{}
	o.Stream().Attach(r)
	o.setMode(ModeBoth)
	e.Do(Action{Kind: "play"})
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	if out := sink.play(t, 9600); allZero(out) {
		t.Fatal("the jam room should play in both")
	}
	o.Stream().flush()
	if len(r.got()) < 8 {
		t.Fatal("and the stream should carry it")
	}
}

func TestThePacerPlaysOnlyWhileTheDeviceIsQuiet(t *testing.T) {
	e, sink, o, _ := newOutputEngine(t)
	o.Stream().Attach(&recorder{})
	o.setMode(ModePhone)
	var now atomic.Int64 // the pacer's goroutine reads it too
	now.Store(int64(time.Hour))
	o.now = now.Load
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 512) // the device is pulling
	o.paceStep()
	now.Add(int64(100 * time.Millisecond))
	o.paceStep()
	if d := e.delivered.Load(); d != 512 {
		t.Fatalf("the pacer pulled %d frames while the device was pulling", d-512)
	}
}

func TestThePacerHandsBackToTheDeviceWithoutLosingAFrame(t *testing.T) {
	e, sink, o, _ := newOutputEngine(t)
	o.Stream().Attach(&recorder{})
	o.setMode(ModePhone)
	var now atomic.Int64 // the pacer's goroutine reads it too
	now.Store(int64(time.Hour))
	o.now = now.Load
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	base := e.sinkBase.Load()
	now.Add(int64(300 * time.Millisecond)) // the device never called: quiet
	o.paceStep()                           // the device has never pulled: the pacer starts its clock
	now.Add(int64(100 * time.Millisecond))
	o.paceStep() // five 20 ms steps
	if d := e.delivered.Load(); d != 4800 {
		t.Fatalf("the pacer delivered %d, want 4800", d)
	}
	if e.sinkBase.Load() != base {
		t.Fatal("sinkBase moves at the handback, not before")
	}
	sink.play(t, 512) // the Sidekick is back
	if d := e.delivered.Load(); d != 4800+512 {
		t.Fatalf("delivered %d after the handback", d)
	}
	if got := e.sinkBase.Load(); got != base+4800 {
		t.Fatalf("sinkBase %d, want %d: engine frame = sinkBase + device frame", got, base+4800)
	}
	if o.handbacks.Load() != 1 || o.lastHandback.Load() != 0 {
		t.Fatalf("one handback, at device frame 0: %d at %d", o.handbacks.Load(), o.lastHandback.Load())
	}
}

func TestAListenerGoneForTwoSecondsStopsThePhonesTape(t *testing.T) {
	e, sink, o, _ := newOutputEngine(t)
	detach := o.Stream().Attach(&recorder{})
	o.setMode(ModePhone)
	var now atomic.Int64 // the pacer's goroutine reads it too
	now.Store(int64(time.Hour))
	o.now = now.Load
	e.Do(Action{Kind: "play"})
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 4096)
	detach()
	o.paceStep()
	now.Add(int64(1900 * time.Millisecond))
	o.paceStep()
	sink.play(t, 4096)
	if !e.tr.Status().Playing {
		t.Fatal("stopped before 2 s")
	}
	now.Add(int64(200 * time.Millisecond))
	o.paceStep()
	sink.play(t, 8192)
	if e.tr.Status().Playing || o.status().State != "lost" {
		t.Fatalf("playing %v, state %q", e.tr.Status().Playing, o.status().State)
	}
	o.Stream().Attach(&recorder{})
	o.paceStep()
	if o.status().State == "lost" {
		t.Fatal("a listener back clears lost")
	}
}

func TestAListenerGoneWhileStoppedIsNotLostAndTheNextPlayStillStops(t *testing.T) {
	e, sink, o, _ := newOutputEngine(t)
	detach := o.Stream().Attach(&recorder{})
	o.setMode(ModePhone)
	var now atomic.Int64
	now.Store(int64(time.Hour))
	o.now = now.Load
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	detach()
	o.paceStep()
	now.Add(int64(3 * time.Second))
	o.paceStep()
	if st := o.status().State; st == "lost" {
		t.Fatalf("state %q though nothing was playing", st)
	}
	e.Do(Action{Kind: "play"})
	sink.play(t, 4096)
	o.paceStep() // starts counting
	now.Add(int64(2100 * time.Millisecond))
	o.paceStep()
	sink.play(t, 8192)
	if e.tr.Status().Playing || o.status().State != "lost" {
		t.Fatalf("playing %v, state %q", e.tr.Status().Playing, o.status().State)
	}
}
