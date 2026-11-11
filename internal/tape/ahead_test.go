package tape

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// The renderer keeps as far ahead of the device as the device buffers, and
// never less than a block: a small buffer (the rig's 20 ms) is a quick
// instrument, and the default's 100 ms keeps the five blocks it always had.
func TestTheRendererKeepsAsFarAheadAsTheDevicesBuffer(t *testing.T) {
	for _, c := range []struct {
		ms     float64
		pull   int
		blocks int
	}{
		{0, 0, 5}, {100, 1024, 5}, {50, 1024, 3}, {20, 1024, 1}, {10, 0, 1}, {1, 1024, 1},
		{5000, 1024, 47}, // never more than a second
		{20, 2048, 2},    // the demo's FRAMES_PER_BUFFER: two blocks, or every pull runs short
	} {
		if got := aheadFor(c.ms, c.pull, 48000); got != c.blocks {
			t.Errorf("%v ms, pulls of %d: %d blocks ahead, want %d", c.ms, c.pull, got, c.blocks)
		}
	}
}

func TestARendererOneBlockAheadStaysOneBlockAhead(t *testing.T) {
	s := newTestStore(t)
	sink := &loopSink{ring: audio.NewRing(48000*20, 8)}
	e := NewEngine(Options{Store: s, Capture: sink, Sink: sink, OutputLatencyMS: 20})
	testEngine = e
	t.Cleanup(func() { e.Stop(); testEngine = nil })
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 4096)
	// Left alone, it renders up to its lead and waits there.
	waitFor(t, func() bool { return len(e.blocks) >= 1 })
	time.Sleep(50 * time.Millisecond)
	if n := len(e.blocks); n != 1 {
		t.Fatalf("%d blocks waiting for the device, want 1", n)
	}
}

// The rig's 20 ms keeps one block ahead of the interface, but with the tape
// on a phone and no device pulling, the pacer drives the tape in 20 ms
// steps, several back to back when its ticker fires late. One block ahead
// ran out on the second step and a third of the stream was silence
// ("distorted and crumbly" on the phone).
func TestAPacedPhoneHearsNoGapsAtALowOutputLatency(t *testing.T) {
	s := newTestStore(t)
	sink := &loopSink{ring: audio.NewRing(48000*20, 8)}
	e := NewEngine(Options{Store: s, Capture: sink, Sink: NewOutput(sink), OutputLatencyMS: 20})
	testEngine = e
	t.Cleanup(func() { e.Stop(); testEngine = nil })
	o := e.router()
	o.Stream().Attach(&recorder{})
	o.setMode(ModePhone)
	var now atomic.Int64 // the pacer's goroutine reads it too
	now.Store(int64(time.Hour))
	o.now = now.Load
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	now.Add(int64(300 * time.Millisecond)) // the device never called: quiet
	o.paceStep()                           // the pacer starts its clock
	time.Sleep(20 * time.Millisecond)      // the renderer gets its lead
	e.late.Store(0)
	for i := 0; i < 40; i++ {
		now.Add(int64(80 * time.Millisecond)) // a late tick: four steps at once
		o.paceStep()
		time.Sleep(5 * time.Millisecond) // the renderer catches up between ticks
	}
	if d := e.delivered.Load(); d < 40*4*960 {
		t.Fatalf("the pacer delivered %d frames, want at least %d", d, 40*4*960)
	}
	if n := e.late.Load(); n != 0 {
		t.Fatalf("%d pulls found nothing rendered and played silence, want 0", n)
	}
}
