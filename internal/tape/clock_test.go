package tape

import (
	"sync"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// clockRec is a ClockOut that keeps what it's sent; its times are output
// frames (the test's heardFn).
type clockRec struct {
	mu  sync.Mutex
	at  []int64
	msg [][]byte
}

func (c *clockRec) Send(at int64, msg []byte) {
	c.mu.Lock()
	c.at = append(c.at, at)
	c.msg = append(c.msg, append([]byte(nil), msg...))
	c.mu.Unlock()
}
func (c *clockRec) Devices() []string { return []string{"Bento"} }

// sent is what's been sent, and when.
func (c *clockRec) sent() ([]int64, [][]byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]int64(nil), c.at...), append([][]byte(nil), c.msg...)
}

// clockEngine is a 120 BPM tape of bars bars, its loop the lot, leading a
// recorder: a bar is 96000 frames, a pulse exactly 1000.
func clockEngine(t *testing.T, bars int) (*Engine, *loopSink, *Tape, *clockRec) {
	t.Helper()
	s := newTestStore(t)
	sink := &loopSink{ring: audio.NewRing(48000*30, 8)}
	rec := &clockRec{}
	e := NewEngine(Options{Store: s, Capture: sink, Sink: sink, Clock: rec})
	e.heardFn = func(o uint64) (int64, bool) { return int64(o), true }
	tp, err := s.Create("clock", 120, bars, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Load(tp.ID); err != nil {
		t.Fatal(err)
	}
	testEngine = e
	t.Cleanup(func() { e.Stop(); testEngine = nil })
	return e, sink, tp, rec
}

// settle lets the scheduler catch up with what's been rendered.
func settle(e *Engine) {
	for i := 0; i < 100; i++ {
		e.clock.mu.Lock()
		done := e.clock.done
		e.clock.mu.Unlock()
		if done >= e.tr.Status().Out {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestTheClockStartsAtBarOneAndPulsesOnTheTapesLines(t *testing.T) {
	e, sink, _, rec := clockEngine(t, 2)
	e.Start()
	sink.play(t, 4096)
	e.Do(Action{Kind: "play"})
	sink.play(t, 50000)
	settle(e)
	at, msg := rec.sent()
	if len(msg) < 10 || msg[0][0] != midiStart || msg[1][0] != midiClock {
		t.Fatalf("first messages: %v", msg[:min(len(msg), 4)])
	}
	start := at[1] // the first pulse: where bar 1 played
	if at[0] != start-1 {
		t.Fatalf("Start at %d, the first pulse at %d", at[0], start)
	}
	for i := 2; i < len(msg); i++ {
		if msg[i][0] != midiClock || at[i]-at[i-1] != 1000 {
			t.Fatalf("message %d: %x at %d, after %d", i, msg[i], at[i], at[i-1])
		}
	}
	// Stopped: Stop, where it stopped, and no more pulses.
	e.Do(Action{Kind: "stop"})
	sink.play(t, 8192)
	settle(e)
	_, msg = rec.sent()
	if last := msg[len(msg)-1]; last[0] != midiStop {
		t.Fatalf("after ■: %x", last)
	}
	n := len(msg)
	sink.play(t, 8192)
	settle(e)
	if _, msg = rec.sent(); len(msg) != n {
		t.Fatal("pulses while stopped")
	}
	if s := e.ClockStatus(); s == nil || s.Running || s.Pulses == 0 || len(s.Devices) != 1 {
		t.Fatalf("status = %+v", s)
	}
}

func TestPlayingFromMidBarSaysWhereThenContinuesOnTheSixteenth(t *testing.T) {
	e, sink, _, rec := clockEngine(t, 2)
	e.Start()
	sink.play(t, 4096)
	e.Do(Action{Kind: "locate", Pos: 30500})
	sink.play(t, 4096)
	e.Do(Action{Kind: "play"})
	sink.play(t, 20000)
	settle(e)
	_, msg := rec.sent()
	// The sixteenth at or after 30500 is 36000: sixteenth 6, said with
	// Continue in one write, a frame before its pulse.
	if len(msg) < 2 || string(msg[0]) != string([]byte{midiSongPos, 6, 0, midiContinue}) || msg[1][0] != midiClock {
		t.Fatalf("first messages: %x", msg[:min(len(msg), 4)])
	}
}

func TestTheLoopComingRoundSaysWhereWithoutStopping(t *testing.T) {
	e, sink, _, rec := clockEngine(t, 1) // a one-bar loop
	e.Start()
	sink.play(t, 4096)
	e.Do(Action{Kind: "play"})
	sink.play(t, 96000*2+10000) // round twice
	settle(e)
	at, msg := rec.sent()
	var spps []int
	for i, m := range msg {
		switch m[0] {
		case midiSongPos:
			spps = append(spps, i)
			if m[1] != 0 || m[2] != 0 {
				t.Fatalf("at the wrap: song position %x", m)
			}
		case midiStop:
			t.Fatal("a Stop at the wrap")
		}
	}
	if len(spps) != 2 {
		t.Fatalf("%d song positions for two wraps", len(spps))
	}
	// The pulses run on evenly through it: the pulse before and after.
	i := spps[0]
	if at[i+1]-at[i-1] != 1000 {
		t.Fatalf("pulses across the wrap at %d and %d", at[i-1], at[i+1])
	}
}
