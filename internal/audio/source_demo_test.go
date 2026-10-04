package audio

import (
	"math"
	"sync"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
)

func demoConfig() *config.Config {
	return &config.Config{
		Channels:     8,
		SampleRate:   48000,
		FramesPerBuf: 2048,
		SaveChannels: []int{0, 1},
	}
}

func TestDemoSourceDeliversBlocksOfTheRightShape(t *testing.T) {
	cfg := demoConfig()
	src := NewDemoSource(cfg)

	var mu sync.Mutex
	var blocks [][]int32

	name, err := src.Open(func(in []int32) {
		mu.Lock()
		defer mu.Unlock()
		if len(blocks) < 8 {
			cp := make([]int32, len(in))
			copy(cp, in)
			blocks = append(blocks, cp)
		}
	})
	if err != nil {
		t.Fatalf("Open() error: %v", err)
	}
	defer src.Close()

	if name == "" {
		t.Error("Open() returned an empty device name; the UI shows this")
	}

	deadline := time.After(2 * time.Second)
	for {
		mu.Lock()
		n := len(blocks)
		mu.Unlock()
		if n >= 3 {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("got %d blocks in 2s, want at least 3", n)
		case <-time.After(10 * time.Millisecond):
		}
	}

	mu.Lock()
	defer mu.Unlock()
	want := cfg.FramesPerBuf * cfg.Channels
	for i, b := range blocks {
		if len(b) != want {
			t.Errorf("block %d has %d samples, want %d", i, len(b), want)
		}
	}
}

// The point of the demo is that a screenshot looks like audio. A signal that
// never moves would satisfy every structural check above and still be useless.
func TestDemoSourceProducesMovingAudioOnTheSavedPair(t *testing.T) {
	cfg := demoConfig()
	src := NewDemoSource(cfg)

	var mu sync.Mutex
	var minL, maxL float64 = 1, -1
	var maxOther float64

	_, err := src.Open(func(in []int32) {
		mu.Lock()
		defer mu.Unlock()
		for i := 0; i+cfg.Channels <= len(in); i += cfg.Channels {
			v := float64(in[i]) / 2147483648.0
			minL, maxL = math.Min(minL, v), math.Max(maxL, v)
			for c := 2; c < cfg.Channels; c++ {
				maxOther = math.Max(maxOther, math.Abs(float64(in[i+c])/2147483648.0))
			}
		}
	})
	if err != nil {
		t.Fatalf("Open() error: %v", err)
	}
	defer src.Close()

	time.Sleep(500 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()

	if maxL < 0.05 {
		t.Errorf("peak on the saved pair is %.4f, want a signal above 0.05", maxL)
	}
	if maxL > 1.0 || minL < -1.0 {
		t.Errorf("signal clips: range [%.4f, %.4f]", minL, maxL)
	}
	if maxL-minL < 0.05 {
		t.Errorf("signal barely moves: range [%.4f, %.4f]", minL, maxL)
	}
	// Unused inputs carry bleed, as the hardware does, so the channel panel
	// looks real -- but they must stay well below the master.
	if maxOther > maxL/4 {
		t.Errorf("bleed on unused channels is %.4f against a master of %.4f; too loud", maxOther, maxL)
	}
}

func TestDemoSourceCloseIsIdempotent(t *testing.T) {
	src := NewDemoSource(demoConfig())
	if _, err := src.Open(func([]int32) {}); err != nil {
		t.Fatalf("Open() error: %v", err)
	}
	src.Close()
	src.Close() // must not panic or block
	if err := src.Shutdown(); err != nil {
		t.Errorf("Shutdown() error: %v", err)
	}
}

// Open must be safe to call on a source that is already running: the previous
// generator has to be torn down, not orphaned, because both would then share
// the source's RNG -- which is not safe for concurrent use.
func TestDemoSourceOpenTwiceDoesNotOrphanTheFirstGenerator(t *testing.T) {
	src := NewDemoSource(demoConfig())

	var mu sync.Mutex
	calls := make(map[int]int) // generation -> sink calls seen

	open := func(generation int) {
		if _, err := src.Open(func([]int32) {
			mu.Lock()
			calls[generation]++
			mu.Unlock()
		}); err != nil {
			t.Errorf("Open(%d) error: %v", generation, err)
		}
	}

	open(1)
	time.Sleep(200 * time.Millisecond)
	open(2) // deliberately no Close
	defer src.Close()

	mu.Lock()
	first := calls[1]
	mu.Unlock()

	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if calls[1] != first {
		t.Errorf("the first generator was still delivering after a second Open: %d -> %d calls", first, calls[1])
	}
	if calls[2] == 0 {
		t.Error("the second generator delivered nothing")
	}
}

// The demo's MIDI is derived from the same frame counter as its audio, so a
// kick's note-on falls on exactly the frame fill starts the kick on, and the
// clock runs at 24 pulses per beat with a Start on the very first frame.
func TestDemoMIDIMatchesTheLoop(t *testing.T) {
	const rate = 48000
	beatFrames := int64(rate * 60 / DemoBPM) // 30000 at 96 BPM

	var all []DemoEvent
	var absolute []int64
	block := 2048
	for n := int64(0); n < 4*beatFrames; n += int64(block) {
		for _, ev := range DemoMIDI(n, block, rate) {
			all = append(all, ev)
			absolute = append(absolute, n+ev.Frame)
		}
	}
	if all[0].Status != 0xFA || absolute[0] != 0 {
		t.Fatalf("first event = %+v at %d, want Start at frame 0", all[0], absolute[0])
	}
	pulses, kicks := 0, 0
	for i, ev := range all {
		if absolute[i] >= 4*beatFrames {
			break // the last block runs past the fourth beat
		}
		switch {
		case ev.Status == 0xF8:
			pulses++
		case ev.Status == 0x90|demoDrumChannel && ev.D1 == demoKick:
			if absolute[i]%beatFrames != 0 {
				t.Errorf("kick at frame %d is off the beat (%d)", absolute[i], beatFrames)
			}
			kicks++
		}
	}
	if kicks != 4 || pulses != 4*24 {
		t.Errorf("kicks=%d pulses=%d over four beats, want 4 and 96", kicks, pulses)
	}
	// Events within a block are in frame order.
	for i := 1; i < len(absolute); i++ {
		if absolute[i] < absolute[i-1] {
			t.Fatalf("events out of order at %d: %d after %d", i, absolute[i], absolute[i-1])
		}
	}
	// A drum note-off follows each hit by demoNoteLen, even across a block
	// boundary.
	offs := 0
	for i, ev := range all {
		if absolute[i] < 4*beatFrames && ev.Status == 0x80|demoDrumChannel && ev.D1 == demoKick {
			offs++
		}
	}
	if offs != 4 {
		t.Errorf("kick note-offs = %d, want 4", offs)
	}
}

func TestTheDemoLoopbackLandsTheTapeWhereItsDeltaSays(t *testing.T) {
	cfg := demoConfig()
	cfg.RingSeconds = 5
	src := NewDemoSource(cfg)
	cap := NewCapture(cfg, src)
	sink := NewDemoSink(src, cap)
	// Output frame o carries (o+1)*100 on bus A.
	var out int64
	if _, err := sink.Open(4, func(b []int32) {
		for i := 0; i < len(b)/4; i++ {
			v := int32((out + int64(i) + 1) * 100)
			b[i*4], b[i*4+1], b[i*4+2], b[i*4+3] = v, v, 0, 0
		}
		out += int64(len(b) / 4)
	}); err != nil {
		t.Fatal(err)
	}
	defer sink.Close()
	if err := cap.Start(); err != nil {
		t.Fatal(err)
	}
	defer cap.Stop()
	time.Sleep(700 * time.Millisecond)

	delta, ok := sink.(KnownDelta).Delta()
	if !ok {
		t.Fatal("the demo should know its delta")
	}
	_, total := cap.Ring().Window()
	from, to := total-4096, total-2048
	var got []int32
	if err := cap.Ring().Range(from, to, []int{2, 3}, func(b []int32) error { got = append(got, b...); return nil }); err != nil {
		t.Fatal(err)
	}
	// The CH1 tap hears bus A alone: ring frame f is output frame f - delta.
	for i := 0; i < len(got)/2; i++ {
		f := int64(from) + int64(i)
		if want := int32((f - delta + 1) * 100); got[2*i] != want {
			t.Fatalf("ring frame %d holds %d, want output frame %d (%d); delta %d", f, got[2*i], f-delta, want, delta)
		}
	}
}
