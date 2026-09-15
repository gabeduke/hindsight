package midi

import (
	"math"
	"math/rand"
	"testing"
	"time"
)

// steady generates n pulses at bpm starting at t0, with each arrival
// jittered by up to jitter, and indices counting from idx0 (or unknown).
func steady(t0, bpm float64, n int, jitter time.Duration, idx0 int32, seed int64) []TimedPulse {
	rng := rand.New(rand.NewSource(seed))
	per := 60 / bpm / PulsesPerQuarter
	out := make([]TimedPulse, n)
	for k := range out {
		j := 0.0
		if jitter > 0 {
			j = (rng.Float64()*2 - 1) * jitter.Seconds()
		}
		idx := idx0
		if idx0 != PulseIndexUnknown {
			idx = idx0 + int32(k)
		}
		out[k] = TimedPulse{Sec: t0 + float64(k)*per + j, Index: idx}
	}
	return out
}

// checkAlignment asserts that every pulse lands within the tolerance of a
// whole pulse's tick, and that its tick converts back to within the
// tolerance of where it was measured. Segment endpoints are exact; interior
// pulses are wherever the fitted line puts them, which is the point of a fit.
func checkAlignment(t *testing.T, m *TempoMap, pulses []TimedPulse) {
	t.Helper()
	worst := 0.0
	for k, p := range pulses {
		tick := m.Tick(p.Sec)
		tolTicks := segmentToleranceSec * m.BPMAt(p.Sec) / 60 * float64(m.ppq())
		off := float64(tick % ticksPerPulse)
		if off > ticksPerPulse/2 {
			off = ticksPerPulse - off
		}
		if off > tolTicks+1 {
			t.Fatalf("pulse %d at %.4fs got tick %d, %.0f ticks off a pulse boundary (tolerance %.1f)", k, p.Sec, tick, off, tolTicks)
		}
		back := m.Seconds(tick)
		if e := math.Abs(back - p.Sec); e > worst {
			worst = e
		}
	}
	if worst > segmentToleranceSec {
		t.Errorf("worst round-trip error %.2f ms exceeds the %.0f ms tolerance", worst*1e3, segmentToleranceSec*1e3)
	}
	// And Tick is monotonic in time.
	last := uint64(0)
	for sec := 0.0; sec < pulses[len(pulses)-1].Sec+1; sec += 0.05 {
		if tk := m.Tick(sec); tk < last {
			t.Fatalf("Tick went backwards at %.2fs: %d after %d", sec, tk, last)
		} else {
			last = tk
		}
	}
	if m.Tick(0) != 0 {
		t.Errorf("Tick(0) = %d; the take's first frame must be tick 0", m.Tick(0))
	}
}

func TestBuildTempoMapWithNoPulsesIsFallback(t *testing.T) {
	m, db := BuildTempoMap(nil, 30)
	if m.Source != SourceFallback || db != nil || len(m.Segments) != 1 || m.BPMAt(10) != FallbackBPM {
		t.Fatalf("m=%+v db=%+v", m, db)
	}
	// Pulses before 0 do not count, and neither does a mid-bar pulse at 0;
	// only a downbeat at 0 does (below).
	m, db = BuildTempoMap([]TimedPulse{{Sec: -1, Index: PulseIndexUnknown}, {Sec: -0.5, Index: 96}, {Sec: 0, Index: 5}}, 30)
	if m.Source != SourceFallback || db != nil {
		t.Fatalf("pulses at <= 0 were used: m=%+v db=%+v", m, db)
	}
}

// A bar-snapped window starts on a downbeat, which the bridge places within
// a millisecond or two of 0 on either side. That pulse is tick 0, the run
// starts with no lead-in, and the whole file sits on the DAW's bars.
func TestBuildTempoMapSnappedDownbeatIsTickZero(t *testing.T) {
	for _, off := range []float64{-0.0015, 0, 0.0012} {
		pulses := steady(off, 120, 24*4*4, 0, 96, 1) // index 96: a downbeat
		m, db := BuildTempoMap(pulses, 9)
		if m.Tick(0) != 0 || db == nil || db.Tick != 0 || db.Sec != 0 || db.Aligned != "bar" {
			t.Errorf("offset %.4f: Tick(0)=%d downbeat=%+v", off, m.Tick(0), db)
		}
		if len(m.Segments) != 1 || m.Segments[0].StartSec != 0 || m.Segments[0].StartTick != 0 {
			t.Errorf("offset %.4f: segments = %+v, want a single run from 0", off, m.Segments)
		}
		// Bar 3 begins 4 s in, at tick 2*3840.
		if got := m.Tick(4 + off); got < 2*ticksPerBar-4 || got > 2*ticksPerBar+4 {
			t.Errorf("offset %.4f: bar 3 at tick %d, want %d", off, got, 2*ticksPerBar)
		}
	}
	// A pulse just after 0 that is not a downbeat still gets a lead-in.
	pulses := steady(0.001, 120, 24*4, 0, 3, 1)
	m, _ := BuildTempoMap(pulses, 3)
	if m.Tick(0) != 0 || m.Segments[0].StartSec != 0 || len(m.Segments) < 2 {
		t.Errorf("non-downbeat at 1 ms: segments = %+v", m.Segments)
	}
}

func TestBuildTempoMapSteadyClockIsOneSegmentOnABarLine(t *testing.T) {
	pulses := steady(1.0, 120, 24*4*8, 0, 0, 1) // eight bars from second 1
	m, db := BuildTempoMap(pulses, 17.5)
	checkAlignment(t, m, pulses)

	// Lead-in, then the run. A perfect clock needs one segment.
	if len(m.Segments) != 2 {
		t.Fatalf("segments = %+v, want lead-in + one", m.Segments)
	}
	if bpm := m.BPMAt(5); math.Abs(bpm-120) > 0.01 {
		t.Errorf("BPMAt(5) = %.3f, want 120", bpm)
	}
	if db == nil || db.Source != "midi-start" || db.Aligned != "bar" || db.Tick%ticksPerBar != 0 || db.Sec != 1.0 {
		t.Fatalf("downbeat = %+v", db)
	}
	if m.Source != SourceClock {
		t.Errorf("source = %q, want %q", m.Source, SourceClock)
	}
	// The lead-in is bent to reach the bar line, but not absurdly.
	if lead := m.BPMAt(0.5); lead > maxBendBPM || lead < 60 {
		t.Errorf("lead-in tempo %.1f BPM", lead)
	}
}

func TestBuildTempoMapJitteredClockStaysWithinTolerance(t *testing.T) {
	pulses := steady(0.3, 120, 24*2*60, time.Millisecond, PulseIndexUnknown, 2) // a minute
	m, db := BuildTempoMap(pulses, 61)
	checkAlignment(t, m, pulses)
	// Jitter of ±1 ms against a 2 ms tolerance should still give long
	// segments: a tempo lane with hundreds of events would be unusable.
	if n := len(m.Segments); n > 40 {
		t.Errorf("%d segments for a minute of jittered steady clock", n)
	}
	// No Start: bar 1 is the take's first frame by convention, and the first
	// pulse (0.3 s in at 120 BPM: pulse 14.4, so 14) sits that far into it.
	if db == nil || db.Source != "window-start" || db.Sec != 0 || db.Tick != 0 || db.Aligned != "bar" {
		t.Errorf("downbeat = %+v, want the window start by convention", db)
	}
	if tk := m.Tick(pulses[0].Sec); tk < 13*ticksPerPulse || tk > 15*ticksPerPulse {
		t.Errorf("first pulse at tick %d, want about %d", tk, 14*ticksPerPulse)
	}
	if lead := m.BPMAt(0.1); lead < 60 || lead > 240 {
		t.Errorf("lead-in tempo %.0f BPM, want something musical", lead)
	}
}

func TestBuildTempoMapFollowsATempoRamp(t *testing.T) {
	// 100 to 140 BPM over 30 seconds.
	var pulses []TimedPulse
	sec := 0.5
	for i := 0; sec < 30; i++ {
		bpm := 100 + 40*sec/30
		pulses = append(pulses, TimedPulse{Sec: sec, Index: int32(i)})
		sec += 60 / bpm / PulsesPerQuarter
	}
	m, _ := BuildTempoMap(pulses, 31)
	checkAlignment(t, m, pulses)
	if a, b := m.BPMAt(2), m.BPMAt(28); !(a < 106 && b > 134) {
		t.Errorf("ramp not followed: %.1f at 2s, %.1f at 28s", a, b)
	}
	if len(m.Segments) < 5 {
		t.Errorf("a ramp needs several segments, got %d", len(m.Segments))
	}
}

func TestBuildTempoMapBridgesAGapAndKeepsPhase(t *testing.T) {
	a := steady(0.5, 120, 24*4*4, 0, 0, 1) // four bars
	b := steady(20, 100, 24*4*2, 0, 5, 1)  // restarts mid-bar: index 5
	pulses := append(append([]TimedPulse{}, a...), b...)
	m, db := BuildTempoMap(pulses, 30)
	checkAlignment(t, m, pulses)
	if m.Source != SourceMixed {
		t.Errorf("source = %q, want mixed with a 10 s gap", m.Source)
	}
	// Run B's first pulse is index 5, so its tick sits 5 pulses into a bar.
	if tk := m.Tick(20); tk%ticksPerBar != 5*ticksPerPulse {
		t.Errorf("run B starts at tick %d, phase %d, want phase %d", tk, tk%ticksPerBar, 5*ticksPerPulse)
	}
	if db == nil || db.Sec != 0.5 || db.Tick%ticksPerBar != 0 {
		t.Errorf("downbeat = %+v", db)
	}
	// The gap is written near the fallback tempo, not at something absurd.
	if g := m.BPMAt(15); g < 60 || g > maxBendBPM {
		t.Errorf("gap tempo %.1f BPM", g)
	}
}

func TestBuildTempoMapDownbeatMidRun(t *testing.T) {
	// Pulses start at index 50; the downbeat is the pulse with index 96.
	pulses := steady(3, 120, 24*4*3, 0, 50, 1)
	m, db := BuildTempoMap(pulses, 20)
	checkAlignment(t, m, pulses)
	if db == nil {
		t.Fatal("no downbeat")
	}
	want := pulses[46]
	if db.Sec != want.Sec || db.Tick != m.Tick(want.Sec) || db.Tick%ticksPerBar != 0 || db.Source != "midi-start" {
		t.Errorf("downbeat = %+v, want pulse 46 at %.4fs on a bar line", db, want.Sec)
	}
}

// A first pulse 50 ms in, 95 pulses into its bar, would need a 3800-tick
// lead-in in 50 ms -- 2400 BPM, which a DAW would clamp and thereby shift
// everything after it. Bar alignment is given up rather than risk that.
func TestBuildTempoMapGivesUpBarAlignmentForAnAbsurdLeadIn(t *testing.T) {
	pulses := steady(0.05, 120, 24*4*2, 0, 95, 1)
	m, db := BuildTempoMap(pulses, 10)
	checkAlignment(t, m, pulses)
	if db == nil || db.Aligned == "bar" {
		t.Fatalf("downbeat = %+v, want alignment weaker than bar", db)
	}
	if lead := m.BPMAt(0.01); lead > maxBendBPM {
		t.Errorf("lead-in tempo %.0f BPM exceeds the bend limit", lead)
	}
	// The downbeat itself is still the right pulse.
	if db.Sec != pulses[1].Sec {
		t.Errorf("downbeat at %.4f, want pulse index 96 at %.4f", db.Sec, pulses[1].Sec)
	}
}

func TestBuildTempoMapHandlesAFifteenMinuteRingQuickly(t *testing.T) {
	pulses := steady(0.2, 128, 24*128/60*900, 500*time.Microsecond, 0, 9) // ~46,000 pulses
	start := time.Now()
	m, _ := BuildTempoMap(pulses, 900)
	if d := time.Since(start); d > 2*time.Second {
		t.Errorf("BuildTempoMap took %s for %d pulses", d, len(pulses))
	}
	checkAlignment(t, m, pulses)
	if n := len(m.Segments); n > 400 {
		t.Errorf("%d segments for fifteen minutes of steady clock", n)
	}
}

func TestPhasedTickPrefersTheNearestBar(t *testing.T) {
	// From tick 0 at 0 s to a pulse at 3 s: ideal is 5760, the nearest bar
	// line with phase 0 is 3840 or 7680 -- 5760 is exactly between, and
	// either is acceptable; what matters is the phase and a sane tempo.
	tk, aligned := phasedTick(0, 0, 3, 0)
	if aligned != "bar" || tk%ticksPerBar != 0 || (tk != 3840 && tk != 7680) {
		t.Errorf("phasedTick = %d %q", tk, aligned)
	}
	// A pulse 10 into the bar.
	tk, aligned = phasedTick(0, 0, 3, 10)
	if aligned != "bar" || tk%ticksPerBar != 10*ticksPerPulse {
		t.Errorf("phasedTick with phase 10 = %d %q", tk, aligned)
	}
	// Never at or before the previous tick.
	tk, _ = phasedTick(1000, 0, 0.001, 0)
	if tk <= 1000 {
		t.Errorf("phasedTick went backwards: %d", tk)
	}
}
