package tape

import (
	"math"
	"math/rand"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/mono"
)

// The demo, told to keep its Δ to itself, is the Sidekick in miniature: the
// aligner has to estimate Δ from the clock bridges and lock it by
// correlation, and a catch then has to hold exactly what was played.
func TestTheAlignerLocksOnTheDemoAndACatchHoldsWhatPlayed(t *testing.T) {
	if testing.Short() {
		t.Skip("runs the demo in real time")
	}
	cfg := &config.Config{Channels: 8, SampleRate: 48000, FramesPerBuf: 2048, RingSeconds: 20, SaveChannels: []int{0, 1}}
	src := audio.NewDemoSource(cfg)
	cap := audio.NewCapture(cfg, src)
	if err := cap.Start(); err != nil {
		t.Fatal(err)
	}
	defer cap.Stop()
	s := newTestStore(t)
	e := NewEngine(Options{Store: s, Capture: cap, Sink: audio.NewDemoSink(src, cap, true)})
	tp, _ := s.Create("align", 0, 0, time.Now())
	if _, err := e.Load(tp.ID); err != nil {
		t.Fatal(err)
	}
	// Two seconds of drum-like hits: transients a lock can find.
	r := rand.New(rand.NewSource(5))
	take := takeWAV(t, 98000, func(i int) float64 {
		k := i % 12000
		if k < 4000 {
			return 0.8 * (r.Float64() - 0.5) * math.Exp(-float64(k)/700)
		}
		return 0
	})
	first, err := e.DropTake(tp.ID, take, 0, 96000, 1, 1, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	defer e.Stop()
	e.Do(Action{Kind: "play"})

	deadline := time.Now().Add(20 * time.Second)
	for e.Live().Aligned != "locked" {
		if time.Now().After(deadline) {
			t.Fatalf("no lock: %+v", e.Live())
		}
		time.Sleep(100 * time.Millisecond)
	}
	// A whole pass after the lock, then catch it from the CH1 tap, which
	// hears bus A alone.
	n := len(e.Live().Cycles)
	for len(e.Live().Cycles) < n+1 {
		if time.Now().After(deadline.Add(10 * time.Second)) {
			t.Fatal("the loop isn't going round")
		}
		time.Sleep(100 * time.Millisecond)
	}
	clip, err := e.Catch(tp.ID, CatchRequest{Track: 2, Source: "ch1", Pass: 1})
	if err != nil {
		t.Fatal(err)
	}
	played := readPool(t, s, first.File)
	caught := readPool(t, s, clip.File)
	gain := math.Pow(10, float64(DefaultTrackGainDB)/20)
	var worst float64
	for i := 400; i < 95000; i++ { // clear of the seam's crossfade
		want := float64(played[2*(first.Src+int64(i))]) * gain
		got := float64(caught[2*(clip.Src+int64(i))])
		if d := math.Abs(got-want) / 2147483648.0; d > worst {
			worst = d
		}
	}
	if worst > 1e-6 {
		t.Fatalf("the catch differs from what played by up to %.6f of full scale: Δ is off", worst)
	}
}

func TestAPassIsCaughtWithTheDeltaThatHeldWhenItPlayed(t *testing.T) {
	e := NewEngine(Options{Store: newTestStore(t)})
	e.align.segs = []deltaSeg{{From: 0, Delta: 5000, How: "locked"}, {From: 96000, Delta: 7048, How: "estimated"}}
	for _, c := range []struct {
		o   uint64
		d   int64
		how string
	}{{0, 5000, "locked"}, {95999, 5000, "locked"}, {96000, 7048, "estimated"}, {500000, 7048, "estimated"}} {
		if d, how := e.deltaAt(c.o); d != c.d || how != c.how {
			t.Fatalf("deltaAt(%d) = %d %s, want %d %s", c.o, d, how, c.d, c.how)
		}
	}
	if _, how := NewEngine(Options{Store: newTestStore(t)}).deltaAt(0); how != "none" {
		t.Fatalf("with nothing measured: %s, want none", how)
	}
}

// fakeCap and fakeOut stand in for a capture and a device output: clock
// bridges a test fills, and slips it counts.
type fakeCap struct {
	ring   *audio.Ring
	bridge *audio.ClockBridge
	xruns  uint64
}

func (c *fakeCap) Ring() *audio.Ring          { return c.ring }
func (c *fakeCap) Bridge() *audio.ClockBridge { return c.bridge }
func (c *fakeCap) XRuns() uint64              { return c.xruns }
func (c *fakeCap) InputOverflows() uint64     { return 0 }

type fakeOut struct {
	bridge   *audio.ClockBridge
	restarts uint64
	slipAt   uint64
}

func (o *fakeOut) Open(int, func([]int32)) (string, error) { return "fake", nil }
func (o *fakeOut) Close()                                  {}
func (o *fakeOut) OutputBridge() *audio.ClockBridge        { return o.bridge }
func (o *fakeOut) Restarts() uint64                        { return o.restarts }
func (o *fakeOut) LastSlip() uint64                        { return o.slipAt }

// clocks fills both bridges for the last two seconds, so that at every
// moment the ring is delta frames ahead of the output.
func clocks(c *fakeCap, o *fakeOut, delta int64) {
	c.bridge = audio.NewClockBridge(256, 48000)
	o.bridge = audio.NewClockBridge(256, 48000)
	now := mono.Now()
	for t := now - int64(2*time.Second); t <= now; t += int64(20 * time.Millisecond) {
		f := uint64(float64(t) / 1e9 * 48000)
		o.bridge.Record(t, f)
		c.bridge.Record(t, uint64(int64(f)+delta))
	}
}

func TestASlipStartsASegmentWhereItHappened(t *testing.T) {
	c := &fakeCap{ring: audio.NewRing(48000, 8)}
	o := &fakeOut{}
	clocks(c, o, 5000)
	e := NewEngine(Options{Store: newTestStore(t), Capture: c, Sink: o})
	e.alignStep()
	if d, how := e.deltaAt(0); how != "estimated" || d < 4999 || d > 5001 {
		t.Fatalf("first estimate = %d %s, want about 5000", d, how)
	}
	// The output underflows at its frame 120000; the step after notices.
	e.delivered.Store(100000)
	e.alignStep()
	o.restarts, o.slipAt = 1, 120000
	clocks(c, o, 7000)
	e.delivered.Store(150000)
	e.alignStep()
	if d, _ := e.deltaAt(119999); d < 4999 || d > 5001 {
		t.Fatalf("before the slip Δ = %d, want the old one", d)
	}
	if d, _ := e.deltaAt(120000); d < 6999 || d > 7001 {
		t.Fatalf("from the slip Δ = %d, want the new one", d)
	}
	// The capture drops a block: placed at the last step, the earliest it
	// can have been.
	c.xruns = 1
	clocks(c, o, 9048)
	e.delivered.Store(200000)
	e.alignStep()
	if d, _ := e.deltaAt(150000); d < 9047 || d > 9049 {
		t.Fatalf("from the drop Δ = %d, want the newest", d)
	}
	if d, _ := e.deltaAt(149999); d < 6999 || d > 7001 {
		t.Fatalf("before the drop Δ = %d", d)
	}
}

// hats is a hi-hat every 60 ms with a kick every half second: a rhythm that
// nearly matches itself 60 ms either side. same makes every hat the same
// sample, so it matches itself exactly.
func hats(n int, same bool) []int32 {
	r := rand.New(rand.NewSource(9))
	hat := make([]float64, 400)
	out := make([]int32, n)
	for i := range out {
		k := i % 2880
		if k == 0 && (!same || i == 0) {
			for j := range hat {
				hat[j] = (r.Float64() - 0.5) * math.Exp(-float64(j)/80)
			}
		}
		v := 0.0
		if k < 400 {
			v = 0.4 * hat[k]
		}
		if k := i % 24000; k < 2400 {
			v += 0.5 * math.Sin(2*math.Pi*70*float64(k)/48000) * math.Exp(-float64(k)/600)
		}
		out[i] = int32(v * 2147483647)
	}
	return out
}

func measureWith(t *testing.T, same bool, trueDelta, est int64) (int64, bool) {
	t.Helper()
	const n = 4 * 48000
	sig := hats(n, same)
	c := &fakeCap{ring: audio.NewRing(10*48000, 8)}
	o := &fakeOut{}
	e := NewEngine(Options{Store: newTestStore(t), Capture: c, Sink: o})
	e.hist[0] = make([]atomic.Int32, histFrames)
	e.hist[1] = make([]atomic.Int32, histFrames)
	for i := 0; i < n; i++ {
		e.hist[0][i&histMask].Store(sig[i])
	}
	e.histEnd.Store(n)
	// The ring: output frame o's sound at ring frame o + trueDelta, on the
	// CH1 tap, through n + trueDelta + a second.
	frames := n + int(trueDelta) + 48000
	in := make([]int32, frames*8)
	for r := 0; r < frames; r++ {
		if o := r - int(trueDelta); o >= 0 && o < n {
			in[r*8+2], in[r*8+3] = sig[o]/2, sig[o]/2
		}
	}
	c.ring.WriteFrames(in)
	d, _, ok := e.measure(est, alignAccept, 0)
	return d, ok
}

func TestALockIsTakenOnlyNearWhereDeltaShouldBe(t *testing.T) {
	// The estimate 20 ms out: found, exactly.
	if d, ok := measureWith(t, false, 6000, 5040); !ok || d != 6000 {
		t.Fatalf("20 ms out: %d %v, want 6000", d, ok)
	}
	// 62 ms out, past the 50 ms it trusts: the true match is seen beyond
	// it and refused, rather than a hat's echo inside being taken.
	if d, ok := measureWith(t, false, 6000, 3000); ok {
		t.Fatalf("62 ms out: locked at %d, want no lock", d)
	}
	// Hats that are all the same sample match themselves every 60 ms: no
	// lock at all, whatever the estimate.
	for _, est := range []int64{6000, 3000} {
		if d, ok := measureWith(t, true, 6000, est); ok {
			t.Fatalf("identical hats, estimate %d: locked at %d", est, d)
		}
	}
}
