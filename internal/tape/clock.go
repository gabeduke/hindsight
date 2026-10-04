package tape

import (
	"math"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/mono"
)

// The tape leads the clock (TAPE_CLOCK=lead): it sends 24 pulses a quarter
// note to the devices that follow it -- the Bento.
//
//   - While the tape stands, the clock runs on at the tape's tempo, so a
//     follower knows it before it starts (through a count-in, too).
//   - ▶ from bar 1 sends Start; from anywhere else, Song Position and then
//     Continue. Either waits for the next sixteenth, where a follower counts
//     from.
//   - The loop coming round sends Song Position (In, again), without
//     stopping. Any other jump while playing -- a locate, a tempo change --
//     stops the followers and starts them again where the tape now is.
//   - ■ sends Stop.
//
// Every message belongs to an output frame: a pulse to the frame where the
// tape is on that pulse's line. The render head is ahead of the device, so
// those frames are known before they're heard; the output's clock bridge
// says when each will be, and the message is sent to arrive then. A pulse
// line is n × the exact pulse length, laid from the bar line before it, so a
// bar's first pulse is always on the bar line itself.

// MIDI messages the clock sends.
const (
	midiClock    = 0xF8
	midiStart    = 0xFA
	midiContinue = 0xFB
	midiStop     = 0xFC
	midiSongPos  = 0xF2
)

// pulsesPerBar: 24 a quarter, four quarters a bar.
const pulsesPerBar = 24 * BeatsPerBar

// songPosLead is how long before its Continue a Song Position is sent:
// some followers take a moment to find the place.
const songPosLead = 5 * time.Millisecond

// ClockOut is where the clock goes: midi.Out.
type ClockOut interface {
	Send(at int64, msg []byte) // at: mono ns it should arrive
	Devices() []string
}

// Optional parts of a ClockOut.
type (
	// ClockFollower can say what a follower made of the clock: the demo's.
	ClockFollower interface {
		Heard() (bpm float64, ok, running bool, spp int)
	}
	// clockNow sends a message at once, dropping what's queued: a Stop
	// when the tape goes away.
	clockNow interface{ SendNow(msg []byte) }
	// clockGen counts the times a device appeared or lost messages: after
	// one, the followers are told where the tape is again.
	clockGen interface{ Gen() uint64 }
)

// ClockStatus is the clock, for the page.
type ClockStatus struct {
	Mode    string   `json:"mode"`    // lead
	Devices []string `json:"devices"` // what it's sending to
	Pulses  uint64   `json:"pulses"`  // sent so far
	Running bool     `json:"running"` // the followers have been started
	// What a follower heard, when the output can say (the demo's).
	HeardBPM *float64 `json:"heard_bpm,omitempty"`
}

// clockState is the scheduler's: what it has sent up to.
type clockState struct {
	mu      sync.Mutex
	done    uint64 // the output frame after the last one scheduled
	moving  bool   // the tape is playing, as far as done
	next    int64  // and where it will be at done, if it plays on
	grid    Grid   // the grid the pulses are on
	pulse   int64  // the next pulse line to send, on that grid
	owe     []byte // what the followers are to be told before pulse oweAt
	oweAt   int64
	running bool    // the followers have been started
	idle    float64 // the output frame of the next pulse while the tape stands; 0: from where it stopped
	gen     uint64  // the ClockOut's Gen when last told where
	pulses  uint64
}

// clockStep is how often the scheduler looks at what's been rendered.
const clockStep = 5 * time.Millisecond

// startClock runs the scheduler, when there's somewhere to send to.
func (e *Engine) startClock() {
	if e.clockOut == nil || e.sink == nil {
		return
	}
	e.clockDone = make(chan struct{})
	go func() {
		defer close(e.clockDone)
		t := time.NewTicker(clockStep)
		defer t.Stop()
		for {
			select {
			case <-e.stop:
				e.clockStop()
				return
			case <-t.C:
				e.safely(e.clockSchedule)
			}
		}
	}()
}

// heardAt is the mono time output frame o will be heard: from the output's
// clock bridge, or, for an output without one (the demo's), when the frame
// is handed over.
func (e *Engine) heardAt(o uint64) (int64, bool) {
	if e.heardFn != nil {
		return e.heardFn(o)
	}
	if s, ok := e.sink.(outputSink); ok {
		return s.OutputBridge().NSAt(uint64(max64(0, int64(o)-e.sinkBase.Load())))
	}
	return e.pullBridge.NSAt(o)
}

// pulseLine is the tape frame of pulse k on grid g: laid from the bar line
// before it, so pulse 96n is exactly BarStart(n).
func pulseLine(g Grid, k int64) int64 {
	b := k / pulsesPerBar
	if k%pulsesPerBar < 0 {
		b--
	}
	j := k - b*pulsesPerBar
	return g.BarStart(b) + round(float64(j)*g.BarFrames()/pulsesPerBar)
}

// firstPulse is the first pulse whose line is at or after pos.
func firstPulse(g Grid, pos int64) int64 {
	k := int64(math.Floor(float64(pos)/(g.BarFrames()/pulsesPerBar))) - 1
	for pulseLine(g, k) < pos {
		k++
	}
	for k > 0 && pulseLine(g, k-1) >= pos {
		k--
	}
	return k
}

// clockSchedule sends the messages for what's been rendered since it last
// looked.
func (e *Engine) clockSchedule() {
	st := &e.clock
	st.mu.Lock()
	defer st.mu.Unlock()
	head := e.tr.Status().Out
	if head <= st.done {
		return
	}
	if _, ok := e.heardAt(st.done); !ok {
		return // nothing heard yet: no clock to place messages on
	}
	g := e.mix.Load().grid
	send := func(o uint64, early time.Duration, msg ...byte) {
		if at, ok := e.heardAt(o); ok {
			e.clockOut.Send(at-int64(early), msg)
		}
	}
	// A device that appeared, or lost messages, while the followers run:
	// tell them where the tape is at the next sixteenth, with Continue for
	// the one that wasn't running, and the pulses going on. A follower that
	// was running is already there, and ignores the Continue.
	if c, ok := e.clockOut.(clockGen); ok {
		if gen := c.Gen(); gen != st.gen {
			st.gen = gen
			if st.running && st.owe == nil {
				st.oweAt = (st.pulse + 5) / 6 * 6
				st.owe = append(songPos(st.oweAt/6), midiContinue)
			}
		}
	}
	for _, p := range e.tr.pieces(st.done, head) {
		if g == nil || !p.Playing {
			if st.running {
				send(p.Out, 0, midiStop)
			}
			st.moving, st.running, st.owe = false, false, nil
			if g != nil {
				e.idlePulses(st, p.Out, p.Out+uint64(p.Len), g.BarFrames()/pulsesPerBar, send)
			}
			continue
		}
		end := p.Pos + p.Len
		if !st.moving || p.Pos != st.next || *g != st.grid {
			// Starting, or a jump. A follower counts from a sixteenth, so
			// the next pulse sent is on the sixteenth at or after the tape.
			wrap := st.moving && p.Wrap && *g == st.grid
			if st.running && !wrap {
				// A locate, a new tempo, or a device back: stop them, and
				// start them again where the tape is now.
				send(p.Out, 0, midiStop)
				st.running = false
			}
			k := firstPulse(*g, p.Pos)
			k = (k + 5) / 6 * 6
			st.pulse, st.oweAt, st.grid = k, k, *g
			switch {
			case st.running: // the loop came round
				st.owe = songPos(k / 6)
			case k == 0:
				st.owe = []byte{midiStart}
			default:
				st.owe = append(songPos(k/6), midiContinue)
			}
			st.moving = true
		}
		// Until the followers start, the clock runs on as it did standing.
		if st.owe != nil && !st.running {
			first := pulseLine(*g, st.oweAt)
			stopAt := p.Out + uint64(min64(p.Len, max64(0, first-p.Pos)))
			if stopAt > p.Out {
				stopAt-- // nothing in the frame the Start goes in
			}
			e.idlePulses(st, p.Out, stopAt, g.BarFrames()/pulsesPerBar, send)
		}
		for ; ; st.pulse++ {
			pos := pulseLine(*g, st.pulse)
			if pos >= end {
				break
			}
			if pos < p.Pos {
				continue
			}
			o := p.Out + uint64(pos-p.Pos)
			if st.owe != nil && st.pulse == st.oweAt {
				lead := o
				if lead > 0 {
					lead-- // a frame before the pulse it's about
				}
				if st.owe[0] == midiSongPos && len(st.owe) > 3 {
					// Where, a moment before Continue.
					send(lead, songPosLead, st.owe[:3]...)
					send(lead, 0, st.owe[3:]...)
				} else {
					send(lead, 0, st.owe...)
				}
				st.owe, st.running = nil, true
				st.idle = 0
			}
			send(o, 0, midiClock)
			st.pulses++
		}
		st.next = end
	}
	st.done = head
}

// idlePulses sends the standing tape's clock over output frames [from, to):
// one every pulse length, carrying on from the last.
func (e *Engine) idlePulses(st *clockState, from, to uint64, pl float64, send func(uint64, time.Duration, ...byte)) {
	if st.idle < float64(from) {
		st.idle = float64(from)
	}
	for st.idle < float64(to) {
		send(uint64(st.idle), 0, midiClock)
		st.pulses++
		st.idle += pl
	}
}

// clockStop stops the followers when the tape goes away: at once, ahead of
// any clock still queued.
func (e *Engine) clockStop() {
	st := &e.clock
	st.mu.Lock()
	defer st.mu.Unlock()
	if !st.running {
		return
	}
	if n, ok := e.clockOut.(clockNow); ok {
		n.SendNow([]byte{midiStop})
	} else {
		e.clockOut.Send(mono.Now(), []byte{midiStop})
	}
	st.running = false
}

// songPos is a Song Position Pointer to sixteenth n (14 bits).
func songPos(n int64) []byte {
	if n < 0 {
		n = 0
	}
	if n > 0x3FFF {
		n = 0x3FFF
	}
	return []byte{midiSongPos, byte(n & 0x7F), byte(n >> 7 & 0x7F)}
}

func round(f float64) int64 { return int64(math.Round(f)) }

// ClockStatus is the clock's state, or nil when the tape doesn't lead.
func (e *Engine) ClockStatus() *ClockStatus {
	if e.clockOut == nil {
		return nil
	}
	st := &e.clock
	st.mu.Lock()
	s := &ClockStatus{Mode: "lead", Pulses: st.pulses, Running: st.running}
	st.mu.Unlock()
	s.Devices = e.clockOut.Devices()
	if s.Devices == nil {
		s.Devices = []string{}
	}
	if f, ok := e.clockOut.(ClockFollower); ok {
		if bpm, ok, _, _ := f.Heard(); ok {
			bpm = math.Round(bpm*10) / 10
			s.HeardBPM = &bpm
		}
	}
	return s
}
