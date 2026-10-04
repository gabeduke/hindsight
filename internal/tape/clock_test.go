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
	return clockEngineAt(t, 120, bars)
}

func clockEngineAt(t *testing.T, bpm float64, bars int) (*Engine, *loopSink, *Tape, *clockRec) {
	t.Helper()
	s := newTestStore(t)
	sink := &loopSink{ring: audio.NewRing(48000*30, 8)}
	rec := &clockRec{}
	e := NewEngine(Options{Store: s, Capture: sink, Sink: sink, Clock: rec})
	e.heardFn = func(o uint64) (int64, bool) { return int64(o), true }
	tp, err := s.Create("clock", bpm, bars, time.Now())
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

// firstNotClock is the index of the first message that isn't a pulse.
func firstNotClock(msg [][]byte) int {
	for i, m := range msg {
		if m[0] != midiClock {
			return i
		}
	}
	return -1
}

func TestTheClockStartsAtBarOneAndPulsesOnTheTapesLines(t *testing.T) {
	e, sink, _, rec := clockEngine(t, 2)
	e.Start()
	sink.play(t, 4096)
	settle(e)
	// Standing, the clock runs at the tape's tempo already.
	at, msg := rec.sent()
	if len(msg) < 3 || firstNotClock(msg) != -1 || at[1]-at[0] != 1000 {
		t.Fatalf("standing: %d messages, %v", len(msg), at[:min(len(at), 3)])
	}
	e.Do(Action{Kind: "play"})
	sink.play(t, 50000)
	settle(e)
	at, msg = rec.sent()
	i := firstNotClock(msg)
	if i < 0 || msg[i][0] != midiStart || msg[i+1][0] != midiClock || at[i] != at[i+1]-1 {
		t.Fatalf("around the Start: %x at %v", msg[max(0, i-1):min(len(msg), i+3)], at[max(0, i-1):min(len(at), i+3)])
	}
	// Nothing between the last standing pulse and the Start but the Start.
	if at[i-1] >= at[i] {
		t.Fatalf("a standing pulse at %d, after the Start at %d", at[i-1], at[i])
	}
	for j := i + 2; j < len(msg); j++ {
		if msg[j][0] != midiClock || at[j]-at[j-1] != 1000 {
			t.Fatalf("message %d: %x at %d, after %d", j, msg[j], at[j], at[j-1])
		}
	}
	// Stopped: Stop, where it stopped, and the clock runs on.
	e.Do(Action{Kind: "stop"})
	sink.play(t, 8192)
	settle(e)
	at, msg = rec.sent()
	k := len(msg) - 1
	for k >= 0 && msg[k][0] == midiClock {
		k--
	}
	if k < 0 || msg[k][0] != midiStop || len(msg)-k < 3 {
		t.Fatalf("after ■: %x", msg[max(0, k-1):])
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
	at, msg := rec.sent()
	// The sixteenth at or after 30500 is 36000: sixteenth 6, said 5 ms
	// before Continue, which goes a frame before its pulse.
	i := firstNotClock(msg)
	if i < 0 || string(msg[i]) != string([]byte{midiSongPos, 6, 0}) || msg[i+1][0] != midiContinue || msg[i+2][0] != midiClock {
		t.Fatalf("around the start: %x", msg[max(0, i):min(len(msg), i+4)])
	}
	if at[i+1]-at[i] != int64(songPosLead) || at[i+2]-at[i+1] != 1 {
		t.Fatalf("Song Position at %d, Continue at %d, the pulse at %d", at[i], at[i+1], at[i+2])
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

func TestEveryBarsFirstPulseIsOnItsBarLine(t *testing.T) {
	for _, bpm := range []float64{84, 101.3, 83.73, 97, 120, 61.7} {
		for _, bars := range []int{1, 2, 3, 4, 7} {
			g := GridFor(bpm, bars, 48000)
			for n := int64(0); n < 200; n++ {
				if got, want := pulseLine(g, n*pulsesPerBar), g.BarStart(n); got != want {
					t.Fatalf("%v BPM %d bars: bar %d's pulse at %d, its line at %d", bpm, bars, n, got, want)
				}
				if k := firstPulse(g, g.BarStart(n)); k != n*pulsesPerBar {
					t.Fatalf("%v BPM %d bars: the first pulse at bar %d is %d, want %d", bpm, bars, n, k, n*pulsesPerBar)
				}
			}
		}
	}
}

func TestAt84BPMALoopFromBarTwoComesRoundOnBarTwo(t *testing.T) {
	e, sink, tp, rec := clockEngineAt(t, 84, 4)
	g := *e.Loaded().Grid
	in, out := g.BarStart(1), g.BarStart(3)
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error { s.Loop = Loop{In: in, Out: out, On: true}; return nil }); err != nil {
		t.Fatal(err)
	}
	e.Start()
	sink.play(t, 4096)
	e.Do(Action{Kind: "locate", Pos: in})
	sink.play(t, 4096)
	e.Do(Action{Kind: "play"})
	sink.play(t, int(2*(out-in))+20000) // round twice
	settle(e)
	at, msg := rec.sent()
	var where []int
	start := -1
	for i, m := range msg {
		if m[0] == midiSongPos {
			where = append(where, int(m[1])|int(m[2])<<7)
			if start < 0 {
				start = i
			}
		}
		if m[0] == midiStop {
			t.Fatalf("a Stop at message %d", i)
		}
	}
	// Bar 2 is sixteenth 16: at the start, and at each time round.
	if len(where) != 3 || where[0] != 16 || where[1] != 16 || where[2] != 16 {
		t.Fatalf("song positions %v", where)
	}
	// From the first tape pulse on, pulses are a pulse apart, through the
	// wraps: none missing, none doubled.
	pl := float64(g.BarFrames()) / pulsesPerBar
	prev := int64(-1)
	for i := start + 2; i < len(msg); i++ {
		if msg[i][0] != midiClock {
			continue
		}
		if prev >= 0 {
			if d := float64(at[i] - prev); d < pl-1 || d > pl+1 {
				t.Fatalf("pulse %d is %v frames after the last, want %.1f", i, d, pl)
			}
		}
		prev = at[i]
	}
}

func TestANewTempoWhilePlayingStartsTheFollowersAgainOnIt(t *testing.T) {
	e, sink, tp, rec := clockEngine(t, 4)
	e.Start()
	sink.play(t, 4096)
	e.Do(Action{Kind: "play"})
	sink.play(t, 200000) // two bars in
	settle(e)
	n := len(func() [][]byte { _, m := rec.sent(); return m }())
	// The same frames, called 2 bars: twice as long a bar, half the tempo.
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error { s.Grid.Bars = 2; return nil }); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 60000)
	settle(e)
	at, msg := rec.sent()
	after := msg[n:]
	i := firstNotClock(after)
	if i < 0 || after[i][0] != midiStop {
		t.Fatalf("after the new tempo: %x", after[:min(len(after), 6)])
	}
	j := i + 1 + firstNotClock(after[i+1:])
	if after[j][0] != midiSongPos || after[j+1][0] != midiContinue {
		t.Fatalf("then: %x", after[j:min(len(after), j+3)])
	}
	// And pulses on the new grid: 2000 frames apart.
	var last []int64
	for k := n + j + 2; k < len(msg); k++ {
		if msg[k][0] == midiClock {
			last = append(last, at[k])
		}
	}
	if len(last) < 5 || last[1]-last[0] != 2000 || last[len(last)-1]-last[len(last)-2] != 2000 {
		t.Fatalf("pulses after: %v", last[:min(len(last), 5)])
	}
	// The gap is at most a sixteenth of the new tempo: no long silence.
	if gap := at[n+j+1] - at[n]; gap > 6*2000+1000 {
		t.Fatalf("%d frames without clock", gap)
	}
}

// genRec is a recorder whose devices can change.
type genRec struct {
	clockRec
	gen uint64
}

func (g *genRec) Gen() uint64 { g.mu.Lock(); defer g.mu.Unlock(); return g.gen }

func TestADeviceArrivingWhileRunningIsToldWhereWithoutStoppingTheRest(t *testing.T) {
	s := newTestStore(t)
	sink := &loopSink{ring: audio.NewRing(48000*30, 8)}
	rec := &genRec{}
	e := NewEngine(Options{Store: s, Capture: sink, Sink: sink, Clock: rec})
	e.heardFn = func(o uint64) (int64, bool) { return int64(o), true }
	tp, _ := s.Create("clock", 120, 4, time.Now())
	e.Load(tp.ID)
	testEngine = e
	t.Cleanup(func() { e.Stop(); testEngine = nil })
	e.Start()
	sink.play(t, 4096)
	e.Do(Action{Kind: "play"})
	sink.play(t, 50000)
	settle(e)
	_, before := rec.sent()
	rec.mu.Lock()
	rec.gen++
	rec.mu.Unlock()
	sink.play(t, 20000)
	settle(e)
	at, msg := rec.sent()
	after := msg[len(before):]
	i := firstNotClock(after)
	if i < 0 || after[i][0] != midiSongPos || after[i+1][0] != midiContinue {
		t.Fatalf("after a device arrived: %x", after[max(0, i):min(len(after), i+3)])
	}
	for _, m := range after {
		if m[0] == midiStop {
			t.Fatal("the others were stopped")
		}
	}
	// The pulses go on evenly through it.
	var p []int64
	for k := len(before); k < len(msg); k++ {
		if msg[k][0] == midiClock {
			p = append(p, at[k])
		}
	}
	for k := 1; k < len(p); k++ {
		if p[k]-p[k-1] != 1000 {
			t.Fatalf("pulses %d apart", p[k]-p[k-1])
		}
	}
}
