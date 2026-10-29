package tape

import (
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
