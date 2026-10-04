package tape

import (
	"math"
	"math/rand"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/config"
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
