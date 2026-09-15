package midi

import (
	"math"

	"github.com/gabeduke/hindsight/internal/smf"
)

// Constants of the tempo map's construction.
const (
	// ticksPerPulse is fixed by PPQ 960 and the 24 pulses per quarter of the
	// MIDI specification.
	ticksPerPulse = smf.DefaultPPQ / PulsesPerQuarter // 40
	// pulsesPerBar at 4/4, the only meter the wire can convey.
	pulsesPerBar = 4 * PulsesPerQuarter // 96
	ticksPerBar  = pulsesPerBar * ticksPerPulse

	// maxPulseGapSec is the longest interval between two pulses that still
	// counts as a running clock. 250 ms is a pulse every 10 BPM; nothing
	// musical runs slower, and a stopped clock produces gaps of seconds.
	maxPulseGapSec = 0.25

	// segmentToleranceSec is how far a pulse may sit from the straight line
	// of the segment it is in. It bounds the alignment error of every tick
	// in the file: converting any tick back to seconds lands within this of
	// the real moment. 2 ms is inside what a listener can hear as an offset
	// and well outside read-wakeup jitter, so a steady clock yields long
	// segments.
	segmentToleranceSec = 0.002

	// uncoveredSourceSec is how much of the window may be without clock
	// before the tempo source is reported as mixed rather than midi-clock.
	uncoveredSourceSec = 2.0
)

// TimedPulse is a clock pulse placed on the take's timeline.
type TimedPulse struct {
	Sec   float64
	Index int32 // since the last Start, or PulseIndexUnknown
}

// Downbeat describes where bar 1 beat 1 was put.
type Downbeat struct {
	Sec  float64 `json:"seconds"`
	Tick uint64  `json:"tick"`
	// Source is "midi-start" when a Start message fixed the phase, or
	// "first-pulse" when no Start has been seen and the first pulse in the
	// window is declared the downbeat by convention.
	Source string `json:"source"`
	// Aligned is "bar" when the tick is a DAW bar line, "beat" when only a
	// beat line could be reached without an absurd lead-in tempo, "none"
	// when neither could. See maxBendBPM.
	Aligned string `json:"aligned"`
}

// BuildTempoMap turns the clock pulses inside a window into a tempo map on
// which every pulse is a multiple of 40 ticks, downbeats are multiples of
// 3840, and every tick converts back to the second it was measured at within
// segmentToleranceSec.
//
// Pulses must be ascending in Sec. Stretches with no pulses -- before the
// first, after the last, and any gap longer than maxPulseGapSec -- are
// written at FallbackBPM, bent slightly where necessary so that the tick the
// next run begins on keeps its bar phase.
func BuildTempoMap(pulses []TimedPulse, duration float64) (*TempoMap, *Downbeat) {
	m := &TempoMap{PPQ: smf.DefaultPPQ}
	// A pulse before the take's first frame cannot be given a tick: tick 0
	// is second 0 and nothing precedes it. Except a downbeat within the
	// tolerance of 0, which is what a bar-snapped window puts there: it is
	// taken to be at 0 exactly, so the run starts at tick 0 with no lead-in.
	for len(pulses) > 0 {
		p := pulses[0]
		if p.Sec > 0 && p.Sec > segmentToleranceSec {
			break
		}
		if math.Abs(p.Sec) <= segmentToleranceSec && p.Index != PulseIndexUnknown && p.Index%pulsesPerBar == 0 {
			pulses = append([]TimedPulse{{Sec: 0, Index: p.Index}}, pulses[1:]...)
			break
		}
		pulses = pulses[1:]
	}
	if len(pulses) == 0 {
		m.Segments = []Segment{{0, 0, smf.USPerQuarter(FallbackBPM)}}
		m.Source = SourceFallback
		return m, nil
	}

	// Split into runs of continuous clock.
	var runs [][]TimedPulse
	start := 0
	for i := 1; i <= len(pulses); i++ {
		if i == len(pulses) || pulses[i].Sec-pulses[i-1].Sec > maxPulseGapSec {
			runs = append(runs, pulses[start:i])
			start = i
		}
	}

	var (
		db        *Downbeat
		prevTick  uint64 // tick of the previous run's last pulse
		prevSec   float64
		uncovered float64
		haveRun   bool
	)
	for _, run := range runs {
		first := run[0]
		// Phase: which bar position pulse 0 of this run should get. With a
		// known index, the downbeat is any pulse whose index is a multiple of
		// a bar. Without one, the first pulse of the first run is declared
		// the downbeat, and later runs continue counting from there.
		phase := 0 // pulses into the bar at run[0]
		if first.Index != PulseIndexUnknown {
			phase = int(first.Index) % pulsesPerBar
		}

		// The tick this run starts on. Its bar phase must match, and its
		// distance from whatever came before should make the tempo across
		// the empty stretch as close to the fallback as possible.
		var runStartTick uint64
		var aligned string
		if !haveRun && first.Sec == 0 {
			// The window starts on this pulse: tick 0, by construction on
			// its bar phase since the snap only accepts downbeats.
			runStartTick, aligned = 0, "bar"
		} else if !haveRun {
			runStartTick, aligned = phasedTick(0, 0, first.Sec, phase)
		} else {
			runStartTick, aligned = phasedTick(prevTick, prevSec, first.Sec, phase)
		}
		gapSec := first.Sec - prevSec
		if !haveRun {
			gapSec = first.Sec
		}
		if gapSec > 0 {
			// The stretch before this run: from prevSec (or 0) at prevTick
			// (or 0) to first.Sec at runStartTick, at whatever tempo makes
			// the ends meet.
			fromTick := prevTick
			if !haveRun {
				fromTick = 0
			}
			us := usPerQuarterFor(gapSec, runStartTick-fromTick)
			if !haveRun {
				m.Segments = append(m.Segments, Segment{0, 0, us})
			} else {
				m.Segments = append(m.Segments, Segment{prevSec, prevTick, us})
			}
			uncovered += gapSec
		}

		// Segments within the run.
		m.Segments = append(m.Segments, fitRun(run, runStartTick)...)

		// Downbeat: the first pulse in the whole window at bar phase 0.
		if db == nil {
			for k, p := range run {
				if (phase+k)%pulsesPerBar == 0 {
					src := "first-pulse"
					if p.Index != PulseIndexUnknown {
						src = "midi-start"
					}
					db = &Downbeat{Sec: p.Sec, Tick: runStartTick + uint64(k)*ticksPerPulse, Source: src, Aligned: aligned}
					break
				}
			}
		}

		prevTick = runStartTick + uint64(len(run)-1)*ticksPerPulse
		prevSec = run[len(run)-1].Sec
		haveRun = true
	}
	if duration > prevSec {
		uncovered += duration - prevSec
	}

	// Tidy: a run that begins at second 0 leaves no leading segment, and the
	// first segment must start at 0 for Tick to be total. Guarantee it.
	if len(m.Segments) == 0 || m.Segments[0].StartSec > 0 {
		m.Segments = append([]Segment{{0, 0, smf.USPerQuarter(FallbackBPM)}}, m.Segments...)
	}

	switch {
	case uncovered <= uncoveredSourceSec:
		m.Source = SourceClock
	default:
		m.Source = SourceMixed
	}
	if db != nil {
		m.Downbeat = &Marker{Sec: db.Sec, Text: "Bar 1"}
	}
	return m, db
}

// maxBendBPM is the fastest tempo a stretch without clock may be written at
// to make the next run land on its bar phase. DAWs clamp imported tempos --
// Reaper at 960 BPM, Ableton at 999 -- and a clamped tempo shifts everything
// after it, so a lead-in that would need more than this gives up bar
// alignment for beat alignment, and then for none, rather than risk that.
const maxBendBPM = 480.0

// phasedTick picks the tick for a pulse at sec, given that the timeline is at
// (fromTick, fromSec) and the tick should be at bar phase `phase` (pulses
// into the bar). Among ticks with the right phase at or after fromTick, it
// picks the one closest to where the fallback tempo would put it -- unless
// getting there would need a tempo over maxBendBPM, in which case it settles
// for beat alignment (phase mod 24), and failing that for the nearest pulse
// boundary. Returns the tick and how much phase survived.
func phasedTick(fromTick uint64, fromSec, sec float64, phase int) (uint64, string) {
	ideal := float64(fromTick) + (sec-fromSec)*float64(smf.DefaultPPQ)*FallbackBPM/60
	try := func(residue, modulus uint64) (uint64, bool) {
		base := math.Round((ideal - float64(residue)) / float64(modulus))
		if base < 0 {
			base = 0
		}
		t := uint64(base)*modulus + residue
		for t < fromTick+ticksPerPulse {
			t += modulus
		}
		if sec <= fromSec {
			return t, false
		}
		bpm := float64(t-fromTick) / float64(smf.DefaultPPQ) * 60 / (sec - fromSec)
		return t, bpm <= maxBendBPM
	}
	if t, ok := try(uint64(phase)*ticksPerPulse, ticksPerBar); ok {
		return t, "bar"
	}
	if t, ok := try(uint64(phase%PulsesPerQuarter)*ticksPerPulse, smf.DefaultPPQ); ok {
		return t, "beat"
	}
	t, _ := try(0, ticksPerPulse)
	return t, "none"
}

// usPerQuarterFor is the tempo that makes ticks take exactly sec seconds.
func usPerQuarterFor(sec float64, ticks uint64) uint32 {
	if ticks == 0 {
		return smf.USPerQuarter(FallbackBPM)
	}
	us := sec * 1e6 / float64(ticks) * float64(smf.DefaultPPQ)
	if us < 1 {
		us = 1
	}
	if us > 0xFFFFFF {
		us = 0xFFFFFF
	}
	return uint32(math.Round(us))
}

// maxSegmentPulses caps a segment so that rounding its tempo to whole
// microseconds per quarter cannot accumulate into a visible error: at 8192
// pulses the drift from rounding is under 0.2 ms, a tenth of the tolerance.
// At 120 BPM that is a tempo event every 170 s for a steady clock.
const maxSegmentPulses = 8192

// fitRun splits a run of pulses into constant-tempo segments. A segment runs
// from one measured pulse to another, so its endpoints are exact, and it is
// extended pulse by pulse for as long as every pulse inside it stays within
// segmentToleranceSec of the straight line between its ends.
//
// The check is incremental. Each interior pulse k constrains the slope of any
// acceptable line through the segment's first pulse to an interval; the
// segment can take a new last pulse b only if the slope of the line to b lies
// in the intersection of those intervals. One comparison per pulse, rather
// than re-checking every interior pulse each time the end moves, which for a
// 50,000-pulse steady clock is the difference between milliseconds and
// minutes.
func fitRun(run []TimedPulse, startTick uint64) []Segment {
	if len(run) == 1 {
		return []Segment{{run[0].Sec, startTick, smf.USPerQuarter(FallbackBPM)}}
	}
	var out []Segment
	a := 0
	for a < len(run)-1 {
		b := a + 1
		sLo, sHi := math.Inf(-1), math.Inf(1) // feasible slopes from interior pulses
		for b+1 < len(run) && b-a < maxSegmentPulses {
			nb := b + 1
			// b becomes interior: add its constraint.
			d := float64(b - a)
			lo := (run[b].Sec - run[a].Sec - segmentToleranceSec) / d
			hi := (run[b].Sec - run[a].Sec + segmentToleranceSec) / d
			if lo > sLo {
				sLo = lo
			}
			if hi < sHi {
				sHi = hi
			}
			s := (run[nb].Sec - run[a].Sec) / float64(nb-a)
			if s < sLo || s > sHi {
				break
			}
			b = nb
		}
		us := usPerQuarterForPulses(run[a].Sec, run[b].Sec, b-a)
		out = append(out, Segment{run[a].Sec, startTick + uint64(a)*ticksPerPulse, us})
		a = b
	}
	return out
}

// usPerQuarterForPulses is the tempo at which n pulses take exactly the time
// between two pulses.
func usPerQuarterForPulses(fromSec, toSec float64, n int) uint32 {
	perPulse := (toSec - fromSec) / float64(n)
	us := perPulse * PulsesPerQuarter * 1e6
	if us < 1 {
		us = 1
	}
	if us > 0xFFFFFF {
		us = 0xFFFFFF
	}
	return uint32(math.Round(us))
}
