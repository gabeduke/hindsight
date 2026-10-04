package tape

import (
	"sort"
	"sync"
)

// The transport maps output frames to tape position. It is driven only by the
// render goroutine, which applies queued actions on the exact frame their
// quantum falls on, advances one tape frame per output frame (through late
// renders too), and wraps at Out while looping.
//
// What it did is kept as history -- the position map and the cycle log --
// because catching reads it: a part played over the tape lands where the tape
// was when it was played.

// Quanta: when a queued action takes effect.
const (
	QuantumNow  = "now"
	QuantumBeat = "beat"
	QuantumBar  = "bar"
	QuantumLoop = "loop"
)

// Action is a transport command.
type Action struct {
	Kind    string `json:"action"`  // play, stop, locate
	Quantum string `json:"quantum"` // now, beat, bar, loop
	Pos     int64  `json:"pos"`     // for locate

	done chan struct{} // a reset's: closed once it's carried out
}

// segment is one stretch of the position map: from output frame out, the
// tape was at pos and moving (playing) or still.
type segment struct {
	out     uint64
	pos     int64
	playing bool
}

// Cycle is one complete pass of the loop, as played.
type Cycle struct {
	Out uint64 `json:"out"` // the output frame it started at
	In  int64  `json:"in"`  // the tape frame it started at
	Len int64  `json:"len"`
}

const (
	maxSegments = 8192
	maxCycles   = 64
)

type pending struct {
	at     uint64 // the output frame it takes effect at
	action Action
}

type transport struct {
	playing    bool
	pos        int64
	cycleStart int64 // output frame the current cycle began at, or -1
	cycleIn    int64 // and the loop's In it began at
	// The last wrap: at output frame wrapOut the tape jumped from Out to
	// wrapIn. The renderer crossfades across it.
	wrapped bool
	wrapOut uint64
	wrapIn  int64

	pend []pending

	mu       sync.Mutex // guards what readers see: the history below
	segments []segment
	cycles   []Cycle
	view     Status
}

// Status is the transport as the page sees it.
type Status struct {
	Playing bool   `json:"playing"`
	Pos     int64  `json:"pos"`     // tape frame at the render head
	Out     uint64 `json:"out"`     // the render head's output frame
	Pending int    `json:"pending"` // queued actions
}

func newTransport() *transport { return &transport{cycleStart: -1} }

// record notes a change of the map at output frame out. Called by the render
// goroutine.
func (t *transport) record(out uint64) {
	t.mu.Lock()
	t.segments = append(t.segments, segment{out: out, pos: t.pos, playing: t.playing})
	if len(t.segments) > maxSegments {
		t.segments = t.segments[len(t.segments)-maxSegments:]
	}
	t.mu.Unlock()
}

func (t *transport) logCycle(c Cycle) {
	t.mu.Lock()
	t.cycles = append(t.cycles, c)
	if len(t.cycles) > maxCycles {
		t.cycles = t.cycles[len(t.cycles)-maxCycles:]
	}
	t.mu.Unlock()
}

// PosAt is the tape frame that played at output frame out, if it was playing.
func (t *transport) PosAt(out uint64) (int64, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return posAtLocked(t.segments, out)
}

func posAtLocked(segs []segment, out uint64) (int64, bool) {
	i := sort.Search(len(segs), func(i int) bool { return segs[i].out > out }) - 1
	if i < 0 {
		return 0, false
	}
	s := segs[i]
	if !s.playing {
		return s.pos, false
	}
	return s.pos + int64(out-s.out), true
}

// Playing reports whether output frames [from, to) were all tape playing,
// with no stop or locate between -- wraps at the loop's end allowed -- and
// returns the tape position at from.
func (t *transport) continuous(from, to uint64, loop Loop) (int64, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	pos, ok := posAtLocked(t.segments, from)
	if !ok {
		return 0, false
	}
	p, at := pos, from
	for _, s := range t.segments {
		if s.out <= from || s.out >= to {
			continue
		}
		// A segment boundary inside the span is fine only if it's a wrap:
		// still playing, from Out back to In.
		expect := p + int64(s.out-at)
		if !s.playing || !(loop.On && expect == loop.Out && s.pos == loop.In) {
			return 0, false
		}
		p, at = s.pos, s.out
	}
	return pos, true
}

// Cycles is the log of complete loop passes, oldest first.
func (t *transport) Cycles() []Cycle {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]Cycle(nil), t.cycles...)
}

func (t *transport) Status() Status {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.view
}

// reset stops the tape, drops whatever was queued, and forgets the passes
// played: another tape is being loaded, and a pass of the last one must not
// be caught onto it. Called by the render goroutine, or before it starts.
func (t *transport) reset(out uint64) {
	t.pend = nil
	t.playing, t.cycleStart, t.wrapped = false, -1, false
	t.record(out)
	t.mu.Lock()
	t.cycles = nil
	t.view.Playing, t.view.Pending = false, 0
	t.mu.Unlock()
}

// sinceWrap reports whether the tape got to its position, at output frame
// out, by wrapping at the loop's Out and playing on unbroken since.
func (t *transport) sinceWrap(out uint64, loop Loop) bool {
	return t.wrapped && loop.On && t.wrapIn == loop.In && t.pos >= loop.In &&
		t.pos-loop.In == int64(out-t.wrapOut)
}

// queue adds an action in the order it takes effect.
func (t *transport) queue(p pending) {
	i := len(t.pend)
	for i > 0 && t.pend[i-1].at > p.at {
		i--
	}
	t.pend = append(t.pend, pending{})
	copy(t.pend[i+1:], t.pend[i:])
	t.pend[i] = p
}

// target is the output frame an action queued with the render head at
// (out, pos) takes effect at.
func (t *transport) target(a Action, out uint64, m *Mix, grid *Grid) uint64 {
	if !t.playing || a.Quantum == QuantumNow || a.Quantum == "" {
		return out
	}
	loop := m.loop
	var next int64
	switch a.Quantum {
	case QuantumLoop:
		if !loop.On {
			return out
		}
		next = loop.Out
	case QuantumBar, QuantumBeat:
		if grid == nil {
			return out
		}
		if a.Quantum == QuantumBar {
			next = grid.NextBar(t.pos)
		} else {
			next = grid.NextBeat(t.pos)
		}
		// Past the loop's end, the next line is its start, after the wrap.
		if loop.On && next > loop.Out {
			next = loop.Out
		}
	default:
		return out
	}
	if next < t.pos {
		return out
	}
	return out + uint64(next-t.pos)
}

// apply carries out an action at output frame out.
func (t *transport) apply(a Action, out uint64, m *Mix, length int64) {
	switch a.Kind {
	case "play":
		if t.playing {
			return
		}
		if t.pos >= m.end && !m.loop.On {
			t.pos = 0 // played to the end: start again
		}
		t.playing = true
		t.cycleStart = -1
		t.wrapped = false
		if m.loop.On && t.pos == m.loop.In {
			t.cycleStart, t.cycleIn = int64(out), m.loop.In
		}
	case "stop":
		t.playing = false
		t.cycleStart = -1
		t.wrapped = false
	case "locate":
		p := a.Pos
		if p < 0 {
			p = 0
		}
		if length > 0 && p >= length {
			p = length - 1
		}
		t.pos = p
		t.cycleStart = -1
		t.wrapped = false
		if t.playing && m.loop.On && p == m.loop.In {
			t.cycleStart, t.cycleIn = int64(out), m.loop.In
		}
	default:
		return
	}
	t.record(out)
}
