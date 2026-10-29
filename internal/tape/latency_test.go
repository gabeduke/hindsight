package tape

import (
	"math"
	"testing"
)

// latRig is a rig whose ear hears output frame o lead ms after now, the
// moment every control reaches the Pi, with the render head at r.out.
func (r *rig) latRig(leadMS float64) int64 {
	const now = int64(1e12)
	at := int64(r.out)
	r.e.nowFn = func() int64 { return now }
	r.e.heardFn = func(o uint64) (int64, bool) {
		return now + int64(leadMS*1e6) + (int64(o)-at)*1e9/48000, true
	}
	return now
}

// heard has the device take everything rendered, then collects.
func (r *rig) heard() LatencyReport {
	r.e.delivered.Store(r.out)
	return r.e.Latency()
}

func path(t *testing.T, rep LatencyReport, key string) LatencyPath {
	t.Helper()
	for _, p := range rep.Paths {
		if p.Path == key {
			return p
		}
	}
	t.Fatalf("no %s in %+v", key, rep.Paths)
	return LatencyPath{}
}

func TestAPagesSetIsTimedFromTheTouchToTheRoom(t *testing.T) {
	r := newRig(t, Loop{})
	r.playFrom(0)
	r.run(2)
	now := r.latRig(100)
	// Touched 30 ms before it reached the Pi, sent 20 ms before.
	st := Stamp{Via: ViaPage, Touch: now - 30e6, Sent: now - 20e6}
	if err := r.e.SetStamped(st, PadFilter, 0.4); err != nil {
		t.Fatal(err)
	}
	r.run(1) // drained with the render head at r.out, heard 100 ms on
	p := path(t, r.heard(), "page→room")
	if p.Via != "page" || p.Ear != "room" || p.Count != 1 {
		t.Fatalf("%+v", p)
	}
	if p.Total.P50 != 130 || p.PiToEar.P50 != 100 || p.TouchToSend == nil || p.TouchToSend.P50 != 10 || p.SendToPi == nil || p.SendToPi.P50 != 20 {
		t.Fatalf("total %+v, pi→ear %+v, touch→send %+v, send→pi %+v: want 130, 100, 10, 20",
			p.Total, p.PiToEar, p.TouchToSend, p.SendToPi)
	}
}

func TestAControllersPressAndReleaseAreTimedOnTheBlockTheyLandIn(t *testing.T) {
	r := newRig(t, Loop{})
	r.playFrom(0)
	r.run(2)
	r.latRig(50)
	via := Stamp{Via: ViaMIDI}
	if err := r.e.PressStamped(via, PadStop, QuantumNow, math.NaN()); err != nil {
		t.Fatal(err)
	}
	r.run(1)
	if err := r.e.ReleaseStamped(via, PadStop); err != nil {
		t.Fatal(err)
	}
	r.run(1) // a block later: 1024 frames, 21.3 ms, further from now
	p := path(t, r.heard(), "midi→room")
	if p.Count != 2 || p.TouchToSend != nil || p.SendToPi != nil {
		t.Fatalf("%+v: want two, with no page legs", p)
	}
	if p.Total.P50 != 50 || p.Total.Max != 71.3 {
		t.Fatalf("total %+v: want 50 and 71.3 ms", p.Total)
	}
}

func TestAPressThatWaitsForItsLineIsCountedNotTimed(t *testing.T) {
	r := newRig(t, Loop{})
	r.playFrom(1) // just past a line: the next 16th is most of one away
	r.run(1)
	r.latRig(50)
	if err := r.e.PressStamped(Stamp{Via: ViaMIDI}, PadStop, QuantumSixteenth, math.NaN()); err != nil {
		t.Fatal(err)
	}
	r.run(8)
	rep := r.heard()
	if rep.Quantised != 1 || len(rep.Paths) != 0 {
		t.Fatalf("quantised %d, paths %+v: want one counted, none timed", rep.Quantised, rep.Paths)
	}
}

func TestAnUntimedControlLeavesNoTrace(t *testing.T) {
	r := newRig(t, Loop{})
	r.playFrom(0)
	r.latRig(50)
	_ = r.e.Set(PadFilter, 0.5)
	_ = r.e.Press(PadStop, QuantumNow)
	r.run(2)
	if rep := r.heard(); len(rep.Paths) != 0 || rep.Quantised != 0 || rep.Missed != 0 {
		t.Fatalf("%+v", rep)
	}
}

func TestAPhoneListeningTimesByWhatItSaysItPlays(t *testing.T) {
	r := newRig(t, Loop{})
	o := &Output{}
	o.mode.Store(ModePhone)
	r.e.sink = o // the tape on a phone: the room hears nothing
	r.playFrom(0)
	r.run(2)
	now := r.latRig(100)
	// The phone plays output frame r.out 900 ms from now: its jitter
	// buffer and its speaker behind the Pi's stream.
	r.e.HearOnPhone(Ear{Frame: r.out, At: now + 900e6, FillMS: 800, OutputMS: 40, Underruns: 2})
	if err := r.e.SetStamped(Stamp{Via: ViaPage, Sent: now - 15e6}, PadFilter, 0.4); err != nil {
		t.Fatal(err)
	}
	r.run(1)
	rep := r.heard()
	if len(rep.Paths) != 1 {
		t.Fatalf("%+v: want the phone alone", rep.Paths)
	}
	p := path(t, rep, "page→phone")
	if p.Total.P50 != 900 || p.SendToPi.P50 != 15 {
		t.Fatalf("total %+v, send→pi %+v: want 900 from the arrival, 15 on the Wi-Fi", p.Total, p.SendToPi)
	}
	if rep.Phone == nil || rep.Phone.FillMS != 800 || rep.Phone.OutputMS != 40 || rep.Underflows.Phone == nil || *rep.Underflows.Phone != 2 {
		t.Fatalf("phone %+v, underflows %+v", rep.Phone, rep.Underflows)
	}
}

func TestAControlNotYetAtTheDeviceWaitsToBeTimed(t *testing.T) {
	r := newRig(t, Loop{})
	r.playFrom(0)
	r.run(1)
	r.latRig(50)
	_ = r.e.SetStamped(Stamp{Via: ViaMIDI}, PadFilter, 0.4)
	r.run(1)
	r.e.collectLatency() // delivered is 0: the device hasn't had it
	if rep := r.e.Latency(); len(rep.Paths) != 0 {
		t.Fatalf("timed before it was played: %+v", rep.Paths)
	}
	if p := path(t, r.heard(), "midi→room"); p.Count != 1 {
		t.Fatalf("%+v", p)
	}
}

func TestTheRingKeepsTheNewestAndCountsWhatItLost(t *testing.T) {
	r := newRig(t, Loop{})
	for i := 0; i < latSlots+10; i++ {
		r.e.timed(Stamp{Via: ViaMIDI}, 1, uint64(i), uint64(i))
	}
	r.e.heardFn = func(o uint64) (int64, bool) { return 2, true }
	r.e.delivered.Store(1 << 20)
	rep := r.e.Latency()
	if rep.Missed != 10 {
		t.Fatalf("missed %d, want 10", rep.Missed)
	}
	if p := path(t, rep, "midi→room"); p.Count != latSlots || p.Total.N != latKeep {
		t.Fatalf("%+v: want %d timed, figures of the last %d", p, latSlots, latKeep)
	}
}

func TestSpreadIsTheMedianThe95thAndTheWorst(t *testing.T) {
	var v []float64
	for i := 100; i >= 1; i-- {
		v = append(v, float64(i))
	}
	if s := spread(v); s != (Spread{N: 100, P50: 50, P95: 95, Max: 100}) {
		t.Fatalf("%+v", s)
	}
	if s := spread(nil); s != (Spread{}) {
		t.Fatalf("%+v", s)
	}
}

// TestTimingAllocatesNothing is the render path's promise: stamping a
// control as it is applied is atomic stores into a ring made with the
// engine, and a timed control costs the render goroutine no more than an
// untimed one.
func TestTimingAllocatesNothing(t *testing.T) {
	r := newRig(t, Loop{})
	st := Stamp{Via: ViaPage, Touch: 1, Sent: 2}
	if n := testing.AllocsPerRun(1000, func() { r.e.timed(st, 3, 5, 5) }); n != 0 {
		t.Fatalf("timed allocates %v times a call", n)
	}
	r.playFrom(0)
	buf := make([]float32, BlockFrames*OutChannels)
	block := func(set func()) func() {
		return func() {
			set()
			// What the render goroutine does: drain the inbox, render a block.
			r.e.drainTricks(r.out, r.e.mix.Load())
			r.e.advance(buf, r.out, BlockFrames)
			r.out += BlockFrames
		}
	}
	v := 0.0
	plain := testing.AllocsPerRun(200, block(func() { v = 1 - v; _ = r.e.Set(PadFilter, v) }))
	timed := testing.AllocsPerRun(200, block(func() { v = 1 - v; _ = r.e.SetStamped(st, PadFilter, v) }))
	if timed > plain {
		t.Fatalf("a timed set costs %v allocations a block, an untimed one %v", timed, plain)
	}
}
