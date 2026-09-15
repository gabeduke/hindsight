package midi

import (
	"math"

	"github.com/gabeduke/hindsight/internal/smf"
)

// FallbackBPM is the tempo written when there is no clock to derive one from.
// 120 at PPQ 960 makes a tick 0.52 ms, so tick times are effectively absolute
// and a DAW's grid is at least evenly spaced, if not aligned to anything.
const FallbackBPM = 120.0

// Tempo sources, as the manifest names them.
const (
	SourceClock    = "midi-clock"
	SourceFallback = "fallback"
	SourceMixed    = "mixed"
)

// Segment is a stretch of constant tempo starting at a moment on the take's
// timeline. USPerQuarter is the integer the file will carry, so that a tick
// computed here converts back to exactly the second a DAW will place it at.
type Segment struct {
	StartSec     float64
	StartTick    uint64
	USPerQuarter uint32
}

// Marker is a labelled moment for the conductor track.
type Marker struct {
	Sec  float64
	Text string
}

// TempoMap converts seconds on the take's timeline to ticks, and renders
// itself as conductor-track events. Segments are in ascending StartSec, the
// first at 0.
type TempoMap struct {
	PPQ      uint16
	Segments []Segment
	Markers  []Marker
	Source   string
	// Downbeat is where bar 1 beat 1 falls, if a Start message placed it.
	Downbeat *Marker
}

// FixedTempoMap is the fallback: one segment at bpm for the whole window.
func FixedTempoMap(bpm float64) *TempoMap {
	return &TempoMap{
		PPQ:      smf.DefaultPPQ,
		Segments: []Segment{{StartSec: 0, StartTick: 0, USPerQuarter: smf.USPerQuarter(bpm)}},
		Source:   SourceFallback,
	}
}

// Tick maps a moment to a tick. Moments before the first segment map into it
// as if it extended backwards, clamped at 0.
func (m *TempoMap) Tick(sec float64) uint64 {
	if len(m.Segments) == 0 {
		return 0
	}
	// Binary search for the last segment starting at or before sec.
	lo, hi := 0, len(m.Segments)-1
	for lo < hi {
		mid := (lo + hi + 1) / 2
		if m.Segments[mid].StartSec <= sec {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	s := m.Segments[lo]
	dt := sec - s.StartSec
	ticks := float64(s.StartTick) + dt*1e6/float64(s.USPerQuarter)*float64(m.ppq())
	if ticks < 0 {
		return 0
	}
	return uint64(math.Round(ticks))
}

// Seconds is the inverse of Tick, for tests and for placing the downbeat.
func (m *TempoMap) Seconds(tick uint64) float64 {
	if len(m.Segments) == 0 {
		return 0
	}
	lo, hi := 0, len(m.Segments)-1
	for lo < hi {
		mid := (lo + hi + 1) / 2
		if m.Segments[mid].StartTick <= tick {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	s := m.Segments[lo]
	return s.StartSec + float64(tick-s.StartTick)*float64(s.USPerQuarter)/1e6/float64(m.ppq())
}

func (m *TempoMap) ppq() uint16 {
	if m.PPQ == 0 {
		return smf.DefaultPPQ
	}
	return m.PPQ
}

// Conductor renders the tempo map as track 0's events: a name, a 4/4 time
// signature (nothing on the wire says otherwise), every tempo change, and
// the markers.
func (m *TempoMap) Conductor() []smf.Event {
	out := []smf.Event{
		smf.TrackName(0, "Hindsight tempo"),
		smf.TimeSignature(0, 4, 4),
	}
	var lastUS uint32
	for i, s := range m.Segments {
		if i > 0 && s.USPerQuarter == lastUS {
			continue // a segment boundary with no tempo change is not an event
		}
		out = append(out, smf.Tempo(s.StartTick, s.USPerQuarter))
		lastUS = s.USPerQuarter
	}
	for _, mk := range m.Markers {
		out = append(out, smf.Marker(m.Tick(mk.Sec), mk.Text))
	}
	return out
}

// BPMAt reports the tempo in effect at a moment, in BPM.
func (m *TempoMap) BPMAt(sec float64) float64 {
	if len(m.Segments) == 0 {
		return 0
	}
	lo, hi := 0, len(m.Segments)-1
	for lo < hi {
		mid := (lo + hi + 1) / 2
		if m.Segments[mid].StartSec <= sec {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	return 60e6 / float64(m.Segments[lo].USPerQuarter)
}

// FromConductor rebuilds a TempoMap from a file's conductor track, so a
// take's .mid can be read back and its ticks converted to seconds the way a
// DAW would. Only tempo events matter; markers are not recovered.
func FromConductor(track smf.Track, ppq uint16) *TempoMap {
	m := &TempoMap{PPQ: ppq}
	var sec float64
	var lastTick uint64
	var lastUS uint32
	for _, e := range track.Events {
		us := e.Tempo()
		if us == 0 {
			continue
		}
		if lastUS != 0 {
			sec += float64(e.Tick-lastTick) * float64(lastUS) / 1e6 / float64(m.ppq())
		} else if e.Tick > 0 {
			// Ticks before the first tempo event are 120 BPM by the
			// specification.
			sec = float64(e.Tick) * 500000 / 1e6 / float64(m.ppq())
			m.Segments = append(m.Segments, Segment{0, 0, 500000})
		}
		m.Segments = append(m.Segments, Segment{StartSec: sec, StartTick: e.Tick, USPerQuarter: us})
		lastTick, lastUS = e.Tick, us
	}
	if len(m.Segments) == 0 {
		m.Segments = []Segment{{0, 0, 500000}}
	}
	return m
}

// Slice re-bases the map onto [startSec, endSec): second 0 and tick 0 of
// the result are startSec of this map, and every tempo change inside the
// range keeps its place. Used when a region of a take is cut into a new
// take, so the cut's .mid carries the same tempo lane over its stretch.
func (m *TempoMap) Slice(startSec, endSec float64) *TempoMap {
	out := &TempoMap{PPQ: m.PPQ, Source: m.Source}
	if len(m.Segments) == 0 {
		return FixedTempoMap(FallbackBPM)
	}
	t0 := m.Tick(startSec)
	// The segment in force at startSec opens the slice at 0.
	cur := m.Segments[0]
	for _, s := range m.Segments {
		if s.StartSec <= startSec {
			cur = s
		}
	}
	out.Segments = append(out.Segments, Segment{0, 0, cur.USPerQuarter})
	for _, s := range m.Segments {
		if s.StartSec <= startSec || s.StartSec >= endSec {
			continue
		}
		out.Segments = append(out.Segments, Segment{
			StartSec:     s.StartSec - startSec,
			StartTick:    s.StartTick - t0,
			USPerQuarter: s.USPerQuarter,
		})
	}
	for _, mk := range m.Markers {
		if mk.Sec >= startSec && mk.Sec < endSec {
			out.Markers = append(out.Markers, Marker{Sec: mk.Sec - startSec, Text: mk.Text})
		}
	}
	return out
}
