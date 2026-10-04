package tape

import (
	"math"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/mono"
)

// The tape leads the clock (TAPE_CLOCK=lead): it sends 24 pulses a quarter
// note to the devices that follow it -- the Bento -- with Start when it
// plays from bar 1, Song Position and Continue when it plays from anywhere
// else, Song Position where it jumps while playing (a locate, or the loop
// coming round), and Stop when it stops.
//
// Every message belongs to an output frame: a pulse to the frame where the
// tape is on that pulse's line. The render head is ahead of the device, so
// those frames are known before they're heard; the output's clock bridge
// says when each will be, and the message is sent to arrive then. A tempo
// that isn't a whole number of frames a pulse is fine: each pulse is placed
// on its own line, n × the exact pulse length, as the bar lines are.

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

// ClockOut is where the clock goes: midi.Out.
type ClockOut interface {
	Send(at int64, msg []byte) // at: mono ns it should arrive
	Devices() []string
}

// ClockFollower is a ClockOut that can say what a follower made of it:
// the demo's.
type ClockFollower interface {
	Heard() (bpm float64, ok, running bool, spp int)
}

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
	pulse   int64  // the next pulse line to send
	owe     []byte // what the followers are to be told before that pulse: Start, or where to
	running bool   // the followers have been started
	pulses  uint64
}

// clockStep is how often the scheduler looks at what's been rendered.
const clockStep = 5 * time.Millisecond

// startClock runs the scheduler, when there's somewhere to send to.
func (e *Engine) startClock() {
	if e.clockOut == nil || e.sink == nil {
		return
	}
	go func() {
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
	send := func(o uint64, msg []byte) {
		if at, ok := e.heardAt(o); ok {
			e.clockOut.Send(at, msg)
		}
	}
	for _, p := range e.tr.pieces(st.done, head) {
		if !p.Playing || g == nil {
			if st.running {
				send(p.Out, []byte{midiStop})
			}
			st.moving, st.running, st.owe = false, false, nil
			continue
		}
		pl := g.BarFrames() / pulsesPerBar // frames a pulse: not a whole number
		end := p.Pos + p.Len
		if !st.moving || p.Pos != st.next {
			// Starting, or a jump: the followers count from a sixteenth
			// (six pulses), so the next pulse sent is on the sixteenth at
			// or after the tape, and they're told where that is.
			k := int64(math.Ceil(float64(p.Pos)/pl - 1e-9))
			k = (k + 5) / 6 * 6
			st.pulse = k
			switch {
			case st.running:
				st.owe = songPos(k / 6)
			case k == 0:
				st.owe = []byte{midiStart}
			default:
				st.owe = append(songPos(k/6), midiContinue)
			}
			st.moving = true
		}
		for ; ; st.pulse++ {
			pos := round(float64(st.pulse) * pl)
			if pos >= end {
				break
			}
			if pos < p.Pos {
				continue
			}
			o := p.Out + uint64(pos-p.Pos)
			if st.owe != nil {
				lead := o
				if lead > 0 {
					lead-- // a frame before the pulse it's about
				}
				send(lead, st.owe)
				st.owe, st.running = nil, true
			}
			send(o, []byte{midiClock})
			st.pulses++
		}
		st.next = end
	}
	st.done = head
}

// clockStop stops the followers when the tape goes away.
func (e *Engine) clockStop() {
	st := &e.clock
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.running {
		e.clockOut.Send(mono.Now(), []byte{midiStop})
		st.running = false
	}
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
