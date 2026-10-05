package tape

import (
	"sync"
	"sync/atomic"
	"time"
)

// Listener is where the stream goes: a browser's WebSocket now, a Sonos
// room later. Send must not block, and reports false once it's gone; Moved
// tells it another listener has taken the stream.
type Listener interface {
	Send(pkt []byte) bool
	Moved()
}

// streamRingFrames is how much mixed audio the hub holds: 1.4 s at 48 kHz.
const streamRingFrames = 1 << 16

// Stream is the hub. The device's thread only mixes into the ring (Push);
// the hub's goroutine cuts it into packets, stamps them and sends them on.
type Stream struct {
	rate, step int
	posAt      func(uint64) (int64, bool)

	// ring holds a stereo frame per slot (left in the high 16 bits), indexed
	// by output frame & mask. Atomic, so a reader racing a writer that has
	// lapped it reads a whole frame, never a torn one.
	ring []atomic.Uint32
	head atomic.Uint64 // the output frame after the newest pushed

	mu        sync.Mutex
	l         Listener
	listeners atomic.Int32
	attaches  atomic.Uint64
	fill      atomic.Int32
	pushed    atomic.Bool   // audio has been pushed since the listener attached
	first     atomic.Uint64 // the first frame pushed since then

	// the hub's own, under flushMu (its goroutine, or a test calling flush)
	flushMu sync.Mutex
	started bool
	seen    uint64 // attaches when it started
	next    uint64
	pcm     []int16
}

// NewStream makes a hub for a tape at rate; posAt is the engine's
// transport: the tape position at an output frame, and whether it played.
func NewStream(rate int, posAt func(uint64) (int64, bool)) *Stream {
	step := rate / 50
	return &Stream{rate: rate, step: step, posAt: posAt,
		ring: make([]atomic.Uint32, streamRingFrames), pcm: make([]int16, 2*step)}
}

func (s *Stream) Rate() int        { return s.rate }
func (s *Stream) Listeners() int   { return int(s.listeners.Load()) }
func (s *Stream) Attaches() uint64 { return s.attaches.Load() }
func (s *Stream) SetFill(ms int)   { s.fill.Store(int32(ms)) }
func (s *Stream) FillMS() int      { return int(s.fill.Load()) }

// Push mixes a pulled block, starting at output frame frame, into the ring.
// It runs on the device's thread: no locks, no allocation.
func (s *Stream) Push(frame uint64, block []int32) {
	n := len(block) / OutChannels
	if s.listeners.Load() > 0 {
		if !s.pushed.Load() {
			s.first.Store(frame)
			s.pushed.Store(true)
		}
		var lr [2]int16
		for i := 0; i < n; i++ {
			MixStereo(lr[:], block[i*OutChannels:(i+1)*OutChannels])
			k := (frame + uint64(i)) & (streamRingFrames - 1)
			s.ring[k].Store(uint32(uint16(lr[0]))<<16 | uint32(uint16(lr[1])))
		}
	}
	s.head.Store(frame + uint64(n))
}

// Attach makes l the listener; the one before it is told it moved. detach
// removes l, if it is still the listener.
func (s *Stream) Attach(l Listener) (detach func()) {
	s.mu.Lock()
	old := s.l
	s.l = l
	s.mu.Unlock()
	s.pushed.Store(false)
	s.listeners.Store(1)
	s.attaches.Add(1)
	s.fill.Store(0)
	if old != nil {
		old.Moved()
	}
	return func() {
		s.mu.Lock()
		if s.l == l {
			s.l = nil
			s.listeners.Store(0)
			s.fill.Store(0)
		}
		s.mu.Unlock()
	}
}

func (s *Stream) run(stop <-chan struct{}) {
	t := time.NewTicker(10 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			s.flush()
		}
	}
}

// flush sends every whole packet the ring holds past the last one sent.
func (s *Stream) flush() {
	s.flushMu.Lock()
	defer s.flushMu.Unlock()
	h := s.head.Load()
	s.mu.Lock()
	l := s.l
	s.mu.Unlock()
	if l == nil {
		s.started = false
		return
	}
	if a := s.attaches.Load(); !s.started || a != s.seen {
		// A new listener: from the first audio pushed since it attached.
		if !s.pushed.Load() {
			return
		}
		s.started, s.seen, s.next = true, a, s.first.Load()
	}
	if h < s.next || h-s.next > streamRingFrames/2 {
		// The hub fell behind the ring: from the newest whole packet.
		s.next = h - min(h, uint64(s.step))
	}
	for h-s.next >= uint64(s.step) {
		for i := 0; i < s.step; i++ {
			v := s.ring[(s.next+uint64(i))&(streamRingFrames-1)].Load()
			s.pcm[2*i], s.pcm[2*i+1] = int16(v>>16), int16(uint16(v))
		}
		pos, playing := s.posAt(s.next)
		l.Send(EncodePacket(nil, s.next, pos, playing, s.pcm))
		s.next += uint64(s.step)
	}
}
