// Package midi reads the MIDI clock the EP-136 free-runs over USB and answers
// one question: what tempo was playing over a given wall-clock interval.
//
// It deliberately knows nothing about audio. The audio package takes a
// one-method interface instead of importing this one, so a MIDI failure has no
// path into the capture thread and neither package needs the other to test.
package midi

import (
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gabeduke/hindsight/internal/mono"
)

// MIDI System Realtime status bytes. Every byte at or above ClockByte is a
// single-byte realtime message that may arrive *inside* another message, which
// is why they are tested before anything else and why every byte below them is
// discarded unread: no consumer here wants notes, CC or SysEx, and SysEx data
// bytes are 0x00-0x7F, so there is no enclosing message left to corrupt.
const (
	ClockByte    byte = 0xF8
	StartByte    byte = 0xFA
	ContinueByte byte = 0xFB
	StopByte     byte = 0xFC
)

// PulsesPerQuarter is fixed by the MIDI specification. It is not configurable
// and no device varies it.
const PulsesPerQuarter = 24

// minPulses is two quarter notes. Below this there is no tempo to report: the
// spec's rule is that a short window yields no BPM, absent rather than zero.
// At exactly this count the estimator gets 24 rolling windows.
const minPulses = 2 * PulsesPerQuarter

// MaxPulsesPerSecond sizes the ring: 400 BPM (the top of the editable range)
// at 24 pulses per quarter is 160 pulses a second. Sizing by count rather than
// by age means a slow tempo simply retains more history than asked for, which
// is harmless because every query is bounded by its interval.
const MaxPulsesPerSecond = 160

// Clock is a ring of clock-pulse arrival times.
//
// Timestamps are mono nanoseconds -- the same clock the audio bridge records
// -- so a pulse can be placed against a ring frame. The BPM query still takes
// time.Time, because that is what its callers hold; a time.Now()-derived
// value carries the monotonic reading the conversion needs, and every caller
// in this codebase is one.
//
// Alongside each pulse is its index since the last Start message, which is
// what turns a run of pulses into bars: the pulse after Start is beat 1 of
// bar 1. Before any Start has been seen the index is unknown.
type Clock struct {
	mu       sync.Mutex
	buf      []int64
	idx      []int32 // pulse index since the last Start, or -1 for unknown
	writePos int

	// sinceStart counts pulses since the last Start, or is -1 before one.
	// Written only by Feed, on one goroutine.
	sinceStart int32

	pulses    atomic.Uint64
	starts    atomic.Uint64
	continues atomic.Uint64
	stops     atomic.Uint64
}

// Pulse is one clock pulse with its bar-phase index.
type Pulse struct {
	NS    int64 // mono
	Index int32 // pulses since the last Start, or -1 when no Start has been seen
}

// PulseIndexUnknown is Pulse.Index before any Start has been seen.
const PulseIndexUnknown int32 = -1

// NewClock sizes the ring in pulses. A capacity below 1 is raised to 1 so the
// zero case cannot panic in the modulo below.
func NewClock(capPulses int) *Clock {
	if capPulses < 1 {
		capPulses = 1
	}
	return &Clock{buf: make([]int64, capPulses), idx: make([]int32, capPulses), sinceStart: PulseIndexUnknown}
}

// CapacityFor returns a ring size covering ringSeconds at the fastest tempo the
// field accepts. Callers derive it from the audio ring's length so the two
// windows cannot drift apart.
func CapacityFor(ringSeconds int) int {
	if ringSeconds < 1 {
		ringSeconds = 1
	}
	return ringSeconds * MaxPulsesPerSecond
}

// Feed offers one received byte, stamped with the time it was read.
//
// Anything below ClockByte is discarded without inspection: no consumer here
// wants notes, CC or SysEx, and discarding them unconditionally is what makes a
// realtime byte arriving mid-message harmless rather than corrupting.
func (c *Clock) Feed(ts time.Time, b byte) {
	switch b {
	case ClockByte:
	case StartByte:
		c.starts.Add(1)
		// Start resets the song position: the next pulse is beat 1 of bar 1.
		// Stored as -1 here and incremented on that pulse to 0.
		c.mu.Lock()
		c.sinceStart = -1
		c.mu.Unlock()
		return
	case ContinueByte:
		c.continues.Add(1)
		return
	case StopByte:
		c.stops.Add(1)
		return
	default:
		return
	}

	c.pulses.Add(1)
	n := mono.Of(ts)

	c.mu.Lock()
	if c.sinceStart != PulseIndexUnknown || c.starts.Load() > 0 {
		c.sinceStart++
	}
	c.buf[c.writePos] = n
	c.idx[c.writePos] = c.sinceStart
	c.writePos = (c.writePos + 1) % len(c.buf)
	c.mu.Unlock()
}

// Pulses is the lifetime clock count, not the ring occupancy. It is the
// cheapest "is the clock arriving at all" signal there is.
func (c *Clock) Pulses() uint64 { return c.pulses.Load() }

// Transport reports Start, Continue and Stop counts. Nothing consumes these
// yet. They exist because whether the EP sends transport at all was never
// validly tested -- the probe drained its pipe between phases and the device
// was operated before each phase began -- and a counter that ticks during
// ordinary use settles the question for free.
func (c *Clock) Transport() (starts, continues, stops uint64) {
	return c.starts.Load(), c.continues.Load(), c.stops.Load()
}

// BPM reports the tempo over [start, end] as the median of rolling
// quarter-note windows, or false when there is no defensible reading.
//
// Median, not mean: during free play the overall count-over-span figure sat
// above the median, the signature of a tempo that climbed mid-window, and a
// mean inherits that skew.
func (c *Clock) BPM(start, end time.Time) (float64, bool) {
	ts := c.between(mono.Of(start), mono.Of(end))
	if len(ts) < minPulses {
		return 0, false
	}

	// Refuse when the pulses did not get individual arrival times. Several
	// pulses sharing one timestamp means bytes were batched before being
	// stamped, and then the windows that survive measure the batch boundaries
	// rather than the device: eight 500ms batches of 31 pulses produces a
	// rock-steady, entirely fictional 120 BPM from its 168 non-collapsed
	// windows. Counting collapsed windows does not catch that -- 56 against
	// 168 -- so the guard measures the property that actually matters.
	distinct := 1
	for i := 1; i < len(ts); i++ {
		if ts[i] != ts[i-1] {
			distinct++
		}
	}
	if distinct*2 < len(ts) {
		return 0, false
	}

	bpms := make([]float64, 0, len(ts))
	for i := PulsesPerQuarter; i < len(ts); i++ {
		dt := ts[i] - ts[i-PulsesPerQuarter]
		if dt <= 0 {
			// Two pulses in one read. Skipped rather than counted: 60/0 is not
			// a tempo, and the guard above has already decided whether this is
			// happening often enough to matter.
			continue
		}
		bpms = append(bpms, 60*float64(time.Second)/float64(dt))
	}
	if len(bpms) == 0 {
		return 0, false
	}

	sort.Float64s(bpms)
	// Upper-middle element for an even count, matching
	// scripts/midi-probe.py's `bpms[len(bpms) // 2]`, so a hardware
	// cross-check compares like with like.
	return bpms[len(bpms)/2], true
}

// between copies out the timestamps in [startNs, endNs] in ascending order.
func (c *Clock) between(startNs, endNs int64) []int64 {
	ps := c.PulsesBetween(startNs, endNs)
	out := make([]int64, len(ps))
	for i, p := range ps {
		out[i] = p.NS
	}
	return out
}

// PulsesBetween copies out the pulses in [startNs, endNs] (mono) in ascending
// order, each with its index since the last Start.
//
// It walks backwards from the newest and stops at the first pulse older than
// the window, so an 8-second status query touches a few hundred entries rather
// than the whole ring, while a full-ring save query still gets everything.
func (c *Clock) PulsesBetween(startNs, endNs int64) []Pulse {
	c.mu.Lock()
	defer c.mu.Unlock()

	n := len(c.buf)
	out := make([]Pulse, 0, 512)
	for k := 0; k < n; k++ {
		i := ((c.writePos-1-k)%n + n) % n
		ts := c.buf[i]
		if ts == 0 { // never written
			break
		}
		if ts > endNs {
			continue
		}
		if ts < startNs {
			break
		}
		out = append(out, Pulse{NS: ts, Index: c.idx[i]})
	}

	for l, r := 0, len(out)-1; l < r; l, r = l+1, r-1 {
		out[l], out[r] = out[r], out[l]
	}
	return out
}
