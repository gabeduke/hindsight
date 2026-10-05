package tape

import (
	"sync"
	"testing"
)

// recorder is a listener that keeps what it's sent.
type recorder struct {
	mu    sync.Mutex
	pkts  []Packet
	moved bool
}

func (r *recorder) Send(b []byte) bool {
	p, err := DecodePacket(b)
	if err != nil {
		panic(err)
	}
	r.mu.Lock()
	r.pkts = append(r.pkts, p)
	r.mu.Unlock()
	return true
}
func (r *recorder) Moved() { r.mu.Lock(); r.moved = true; r.mu.Unlock() }
func (r *recorder) got() []Packet {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]Packet(nil), r.pkts...)
}

// streamBlock is n frames on four channels: bus A left carries the frame number.
func streamBlock(from uint64, n int) []int32 {
	b := make([]int32, n*OutChannels)
	for i := 0; i < n; i++ {
		b[i*OutChannels] = int32((from+uint64(i))%30000) << 16
	}
	return b
}

func TestTheHubCutsWhatItsPushedIntoStampedPackets(t *testing.T) {
	s := NewStream(48000, func(o uint64) (int64, bool) { return int64(o) + 1000, true })
	r := &recorder{}
	s.Attach(r)
	for f := uint64(5000); f < 5000+4096; f += 512 {
		s.Push(f, streamBlock(f, 512))
	}
	s.flush()
	p := r.got()
	if len(p) != 4 { // 4096 frames make four whole packets of 960
		t.Fatalf("%d packets", len(p))
	}
	for i, k := range p {
		if k.Frame != 5000+uint64(i)*960 || k.Pos != int64(k.Frame)+1000 || !k.Playing || len(k.PCM) != 960*2 {
			t.Fatalf("packet %d: frame %d pos %d", i, k.Frame, k.Pos)
		}
		if got := int(k.PCM[2*10]); got != int((k.Frame+10)%30000) {
			t.Fatalf("packet %d sample 10 = %d", i, got)
		}
	}
	s.Push(9096, streamBlock(9096, 1000))
	s.flush()
	if p := r.got(); len(p) != 5 || p[4].Frame != 5000+4*960 {
		t.Fatalf("the remainder should go out next: %d packets", len(p))
	}
}

func TestWithNobodyListeningTheHubKeepsTimeAndSendsNothing(t *testing.T) {
	s := NewStream(48000, func(uint64) (int64, bool) { return 0, false })
	s.Push(0, streamBlock(0, 4800))
	s.flush()
	r := &recorder{}
	s.Attach(r)
	s.Push(4800, streamBlock(4800, 960))
	s.flush() // starts from now, not from what nobody heard
	s.Push(5760, streamBlock(5760, 960))
	s.flush()
	p := r.got()
	if len(p) == 0 || p[0].Frame < 4800 {
		t.Fatalf("a new listener starts at the newest audio: %+v", p)
	}
}

func TestANewListenerTakesTheStreamAndTheOldOneIsMoved(t *testing.T) {
	s := NewStream(48000, func(uint64) (int64, bool) { return 0, false })
	a, b := &recorder{}, &recorder{}
	detachA := s.Attach(a)
	s.Attach(b)
	if !a.moved || b.moved || s.Listeners() != 1 || s.Attaches() != 2 {
		t.Fatalf("moved %v %v, listeners %d", a.moved, b.moved, s.Listeners())
	}
	detachA() // the old one's handler leaving must not detach the new one
	if s.Listeners() != 1 {
		t.Fatal("detaching the moved listener dropped the new one")
	}
}

func TestTheFillIsForgottenWithItsListener(t *testing.T) {
	s := NewStream(48000, func(uint64) (int64, bool) { return 0, false })
	detach := s.Attach(&recorder{})
	s.SetFill(812)
	if s.FillMS() != 812 {
		t.Fatal(s.FillMS())
	}
	detach()
	if s.FillMS() != 0 || s.Listeners() != 0 {
		t.Fatal("a gone listener leaves no fill")
	}
}
