package audio

import (
	"math"
	"testing"
	"time"
)

// simExtra drives an extra input against a main interface on two simulated
// clocks: the main at exactly rate, the extra ppm off it, each delivering
// blocks late by its latency plus a jitter, as USB does. Both hear the same
// pulse train, so where the pulses land in the ring says whether the joiner
// lined the two up. stall, if set, is a span of seconds the extra delivers
// nothing.
type simExtra struct {
	rate       int
	ppm        float64
	seconds    float64
	stall      [2]float64
	offsetMS   float64
	extraLatMS float64
	// jump is when the main interface loses audio, and how much: its frames
	// from then on are that many seconds later, as a dropout leaves them.
	jump [2]float64
}

const simMainCh = 2

// pulse is the signal both interfaces hear at time t (seconds): a smooth
// bump every 0.37 s, narrow enough to place to a frame, wide enough for the
// resampler's band.
func pulse(t float64) float64 {
	const every, sigma = 0.37, 0.002
	k := math.Round(t / every)
	d := (t - k*every) / sigma
	return 0.5 * math.Exp(-d*d)
}

func (s simExtra) run(t *testing.T) (*Ring, *extraInput) {
	t.Helper()
	const mainBlock, extraBlock = 512, 256
	ring := NewRing(int(s.seconds+1)*s.rate, simMainCh+2)
	levels := NewLevels(simMainCh+2, s.rate, 10)
	levels.SetWidth(simMainCh)
	mainLat := int64(20 * time.Millisecond)
	extraLat := int64(s.extraLatMS * float64(time.Millisecond))
	lag := uint64(mainBlock + (int(s.extraLatMS)+extraSlackMS)*s.rate/1000)
	src := &fakeExtra{lat: time.Duration(extraLat)}
	x := newExtraInput("sim", simMainCh, 2, s.rate, src, levels, s.offsetMS, lag)
	var clock int64
	x.now = func() int64 { return clock }
	x.newStretch() // as supervise does before an open
	stalled := false
	main := NewClockBridge(4096, s.rate)
	main.SetPipelineLatency(mainLat)

	// A deterministic jitter of up to 3 ms on every delivery.
	jit := func(k int, salt float64) int64 {
		return int64(3e6 * (0.5 + 0.5*math.Sin(float64(k)*12.9898+salt)))
	}
	xRate := float64(s.rate) * (1 + s.ppm*1e-6)
	mainBuf := make([]int32, mainBlock*simMainCh)
	extraBuf := make([]int32, extraBlock*2)
	var mainHanded, extraHanded int
	mainAt := func(n int) float64 { // when main frame n was converted, in seconds
		t := float64(n) / float64(s.rate)
		if s.jump[1] != 0 && t >= s.jump[0] {
			t += s.jump[1]
		}
		return t
	}
	nextMain := func() int64 {
		return int64(mainAt(mainHanded+mainBlock)*1e9) + mainLat + jit(mainHanded, 1)
	}
	nextExtra := func() int64 {
		return int64(float64(extraHanded+extraBlock)/xRate*1e9) + extraLat + jit(extraHanded, 2)
	}
	end := int64(s.seconds * 1e9)
	for clock < end {
		tm, te := nextMain(), nextExtra()
		if tm <= te {
			clock = tm
			for f := 0; f < mainBlock; f++ {
				v := int32(pulse(mainAt(mainHanded+f)) * 2147483647)
				mainBuf[f*simMainCh], mainBuf[f*simMainCh+1] = v, v
			}
			mainHanded += mainBlock
			main.Record(clock, uint64(mainHanded))
			ring.WriteNarrow(mainBuf, simMainCh)
			x.join(ring, main)
			continue
		}
		clock = te
		for f := 0; f < extraBlock; f++ {
			v := int32(pulse(float64(extraHanded+f)/xRate) * 2147483647)
			extraBuf[2*f], extraBuf[2*f+1] = v, v
		}
		extraHanded += extraBlock
		if sec := float64(clock) / 1e9; sec >= s.stall[0] && sec < s.stall[1] {
			stalled = true
			continue // nothing reaches the joiner: unplugged, then back
		}
		if stalled { // supervise saw the stall and opened it again
			x.newStretch()
			stalled = false
		}
		x.deliver(extraBuf)
	}
	return ring, x
}

// peaks finds each pulse's centre on channel ch of the ring's frames
// [from, to), to a fraction of a frame.
func peaks(t *testing.T, ring *Ring, ch int, from, to uint64) []float64 {
	t.Helper()
	var v []float64
	if err := ring.Range(from, to, []int{ch}, func(c []int32) error {
		for _, s := range c {
			v = append(v, float64(s))
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var out []float64
	for i := 1; i+1 < len(v); i++ {
		if v[i] > 0.4*2147483647 && v[i] >= v[i-1] && v[i] > v[i+1] {
			d := (v[i-1] - v[i+1]) / (2 * (v[i-1] - 2*v[i] + v[i+1]))
			out = append(out, float64(from)+float64(i)+d)
		}
	}
	return out
}

// worstAlign is the furthest a pulse on the extra channels lands from the
// same pulse on the main ones, in frames, over the ring's frames [from, to).
func worstAlign(t *testing.T, ring *Ring, from, to uint64, shift float64) float64 {
	t.Helper()
	pm, px := peaks(t, ring, 0, from, to), peaks(t, ring, simMainCh, from, to)
	if len(pm) < 5 || len(px) != len(pm) {
		t.Fatalf("%d pulses on the main channels, %d on the extra ones", len(pm), len(px))
	}
	worst := 0.0
	for i := range pm {
		worst = math.Max(worst, math.Abs(px[i]-pm[i]-shift))
	}
	return worst
}

// Two clocks 80 ppm apart (the demo's) and 150 ppm the other way: after the
// steering has settled, every pulse on the extra channels lands within a
// frame and a half of the same pulse on the main ones, and it says it is
// locked, at the drift there is.
func TestTheExtraInputLandsOnTheMainInterfacesFrames(t *testing.T) {
	for _, ppm := range []float64{80, -150} {
		s := simExtra{rate: 8000, ppm: ppm, seconds: 240, extraLatMS: 60}
		ring, x := s.run(t)
		_, head := ring.Window()
		end := head - x.lag
		if w := worstAlign(t, ring, end-60*8000, end, 0); w > 1.5 {
			t.Errorf("%+g ppm: a pulse lands %.2f frames off", ppm, w)
		}
		if !x.locked.Load() {
			t.Errorf("%+g ppm: not locked", ppm)
		}
		// The ratio steps over the extra's frames: a fast extra clock is
		// read faster.
		if got := float64(x.ppm.Load()) / 1000; math.Abs(got-ppm) > 10 {
			t.Errorf("%+g ppm: steering at %+.1f ppm", ppm, got)
		}
	}
}

// EXTRA_INPUT_OFFSET_MS moves the extra channels that much later.
func TestTheExtraInputOffsetMovesItLater(t *testing.T) {
	s := simExtra{rate: 8000, ppm: 50, seconds: 120, extraLatMS: 60, offsetMS: 5}
	ring, x := s.run(t)
	_, head := ring.Window()
	end := head - x.lag
	if w := worstAlign(t, ring, end-30*8000, end, 40); w > 1.5 {
		t.Errorf("5 ms later should be 40 frames later: off by %.2f", w)
	}
}

// When the extra input stops (unplugged) and comes back, the span between is
// marked as a gap and silent, and once it is back it lines up again.
func TestTheExtraInputMarksAGapAndComesBack(t *testing.T) {
	s := simExtra{rate: 8000, ppm: 80, seconds: 200, extraLatMS: 60, stall: [2]float64{100, 104}}
	ring, x := s.run(t)
	gaps := x.Gaps(0, 1<<40)
	if len(gaps) != 1 {
		t.Fatalf("gaps at %v, want one", gaps)
	}
	if g := float64(gaps[0]) / 8000; g < 99 || g > 104 {
		t.Fatalf("gap at %.1f s, want about 100", g)
	}
	_, head := ring.Window()
	end := head - x.lag
	if w := worstAlign(t, ring, end-40*8000, end, 0); w > 1.5 {
		t.Errorf("after the gap a pulse lands %.2f frames off", w)
	}
	if p := peaks(t, ring, simMainCh, 101*8000, 103*8000); len(p) != 0 {
		t.Errorf("%d pulses in the gap, want silence", len(p))
	}
}

type fakeExtra struct{ lat time.Duration }

func (f *fakeExtra) Open(func([]int32)) (string, error) { return "sim", nil }
func (f *fakeExtra) Close()                             {}
func (f *fakeExtra) Overflows() uint64                  { return 0 }
func (f *fakeExtra) InputLatency() time.Duration        { return f.lat }

// When the main interface loses 50 ms (a dropout), the extra input is out by
// more than steering can bring back: it is placed again from the bridges,
// the span marked a gap, and lines up again.
func TestTheExtraInputFollowsAJumpOfTheMainClock(t *testing.T) {
	s := simExtra{rate: 8000, ppm: 80, seconds: 150, extraLatMS: 60, jump: [2]float64{60, 0.05}}
	ring, x := s.run(t)
	if len(x.Gaps(0, 1<<40)) == 0 {
		t.Error("no gap marked at the jump")
	}
	_, head := ring.Window()
	end := head - x.lag
	if w := worstAlign(t, ring, end-40*8000, end, 0); w > 1.5 {
		t.Errorf("after the jump a pulse lands %.2f frames off", w)
	}
}
