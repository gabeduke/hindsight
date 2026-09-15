package audio

import (
	"math"
	"math/rand"
	"testing"
	"time"
)

const (
	testRate  = 48000
	testBlock = 2048
)

// fill records n blocks of testBlock frames at the nominal rate, with the
// interface's clock running fast or slow by ppm and each delivery jittered by
// up to jitter either way. Returns the true (time, frame) relation so a test
// can check FrameAt against reality rather than against the jittered pairs.
func fill(b *ClockBridge, n int, ppm float64, jitter time.Duration, seed int64) func(ns int64) float64 {
	rng := rand.New(rand.NewSource(seed))
	rate := testRate * (1 + ppm/1e6) // true frames per second of the interface
	for k := 1; k <= n; k++ {
		frame := uint64(k * testBlock)
		trueNS := int64(float64(frame) / rate * 1e9)
		j := int64(0)
		if jitter > 0 {
			j = rng.Int63n(int64(2*jitter)) - int64(jitter)
		}
		b.Record(trueNS+j, frame)
	}
	return func(ns int64) float64 { return float64(ns) / 1e9 * rate }
}

func TestBridgeEmptyKnowsNothing(t *testing.T) {
	b := NewClockBridge(16, testRate)
	if _, ok := b.FrameAt(0); ok {
		t.Fatal("an empty bridge placed a moment")
	}
	if _, ok := b.NSAt(0); ok {
		t.Fatal("an empty bridge placed a frame")
	}
}

func TestBridgeExactPairsAreExact(t *testing.T) {
	b := NewClockBridge(1000, testRate)
	truth := fill(b, 200, 0, 0, 1)
	for _, ns := range []int64{1e9, 2_500_000_000, 4_000_000_001} {
		got, ok := b.FrameAt(ns)
		if !ok {
			t.Fatalf("FrameAt(%d) refused", ns)
		}
		if want := truth(ns); math.Abs(got-want) > 0.5 {
			t.Errorf("FrameAt(%d) = %.2f, want %.2f", ns, got, want)
		}
	}
}

// Delivery jitter of a few milliseconds is what the local fit exists to
// remove. A single bracketing pair would be off by the jitter; the fit must
// do an order of magnitude better.
func TestBridgeFitRemovesDeliveryJitter(t *testing.T) {
	b := NewClockBridge(2000, testRate)
	truth := fill(b, 1000, 0, 4*time.Millisecond, 7)
	worst := 0.0
	for ns := int64(2e9); ns < 40e9; ns += 333_333_333 {
		got, ok := b.FrameAt(ns)
		if !ok {
			t.Fatalf("FrameAt(%d) refused", ns)
		}
		if e := math.Abs(got - truth(ns)); e > worst {
			worst = e
		}
	}
	// 48 frames is 1 ms.
	if worst > 48 {
		t.Errorf("worst error %.1f frames (%.2f ms) with ±4 ms jitter", worst, worst/48)
	}
}

// The interface's crystal runs 100 ppm fast. Over 15 minutes that is 90 ms
// of drift, and a single anchor at stream start would be that far out at the
// end. The bridge must stay within a millisecond throughout.
func TestBridgeTracksCrystalDrift(t *testing.T) {
	blocks := 900 * testRate / testBlock // 15 minutes
	b := NewClockBridge(blocks+10, testRate)
	truth := fill(b, blocks, 100, 2*time.Millisecond, 3)

	anchorNS, anchorFrame := b.at(0)
	for _, sec := range []int64{60, 300, 600, 890} {
		ns := sec * 1e9
		got, ok := b.FrameAt(ns)
		if !ok {
			t.Fatalf("FrameAt(%ds) refused", sec)
		}
		want := truth(ns)
		if e := math.Abs(got - want); e > 48 {
			t.Errorf("at %ds: error %.1f frames (%.2f ms)", sec, e, e/48)
		}
		// And the naive single anchor really would have been wrong, so the
		// test is measuring something.
		naive := float64(anchorFrame) + float64(ns-anchorNS)*testRate/1e9
		if sec == 890 && math.Abs(naive-want) < 48*50 {
			t.Errorf("a single anchor was only %.1f frames out at %ds; the fixture has no drift", math.Abs(naive-want), sec)
		}
	}
}

func TestBridgeRefusesOutsideItsHistory(t *testing.T) {
	b := NewClockBridge(100, testRate)
	fill(b, 50, 0, 0, 1)
	firstNS, _ := b.at(0)
	lastNS, _ := b.at(b.count - 1)
	if _, ok := b.FrameAt(firstNS - dropoutNS - 1); ok {
		t.Error("placed a moment long before the first pair")
	}
	if _, ok := b.FrameAt(lastNS + dropoutNS + 1); ok {
		t.Error("placed a moment long after the last pair")
	}
	// Just past the last pair is fine: a save happens moments after the
	// last block landed, and the window's end is exactly that.
	if _, ok := b.FrameAt(lastNS + 50_000_000); !ok {
		t.Error("refused a moment 50 ms after the last pair")
	}
}

// A dropout -- unplugged interface, stream restart -- is a gap in time with
// no frames. A moment inside the gap is the frame the ring was at when the
// gap began, not a point on a line drawn across it.
func TestBridgeDropoutDoesNotAdvanceFrames(t *testing.T) {
	b := NewClockBridge(100, testRate)
	blockNS := int64(testBlock) * 1e9 / testRate
	for k := 1; k <= 10; k++ {
		b.Record(int64(k)*blockNS, uint64(k*testBlock))
	}
	gapEnd := 10*blockNS + 5e9 // five seconds of silence
	for k := 11; k <= 20; k++ {
		b.Record(gapEnd+int64(k-10)*blockNS, uint64(k*testBlock))
	}
	got, ok := b.FrameAt(10*blockNS + 2e9)
	if !ok || got != 10*testBlock {
		t.Errorf("inside the gap: %.1f, %v; want %d", got, ok, 10*testBlock)
	}
	// After the gap the fit must not reach back across it.
	after := gapEnd + 5*blockNS
	got, _ = b.FrameAt(after)
	if want := float64(15 * testBlock); math.Abs(got-want) > 1 {
		t.Errorf("after the gap: %.1f, want %.0f", got, want)
	}
	// Before it, likewise.
	got, _ = b.FrameAt(5 * blockNS)
	if want := float64(5 * testBlock); math.Abs(got-want) > 1 {
		t.Errorf("before the gap: %.1f, want %.0f", got, want)
	}
}

// The pipeline latency is the time between a sample being converted and its
// block being recorded. The frame being converted at a moment is therefore
// the one recorded that much later.
func TestBridgePipelineLatencyShiftsForward(t *testing.T) {
	b := NewClockBridge(1000, testRate)
	truth := fill(b, 200, 0, 0, 1)
	b.SetPipelineLatency(100_000_000) // 100 ms
	ns := int64(2e9)
	got, _ := b.FrameAt(ns)
	if want := truth(ns + 100_000_000); math.Abs(got-want) > 0.5 {
		t.Errorf("FrameAt with 100 ms pipeline = %.1f, want %.1f", got, want)
	}
	back, _ := b.NSAt(uint64(got))
	if math.Abs(float64(back-ns)) > 1e9/testRate {
		t.Errorf("NSAt did not undo the shift: %d vs %d", back, ns)
	}
}

func TestBridgeNSAtInvertsFrameAt(t *testing.T) {
	b := NewClockBridge(2000, testRate)
	fill(b, 1000, 50, 2*time.Millisecond, 11)
	for _, ns := range []int64{3e9, 10e9, 30e9} {
		f, ok := b.FrameAt(ns)
		if !ok {
			t.Fatal("refused")
		}
		back, ok := b.NSAt(uint64(f))
		if !ok {
			t.Fatal("NSAt refused")
		}
		if e := math.Abs(float64(back - ns)); e > 1e6 {
			t.Errorf("round trip at %d off by %.2f ms", ns, e/1e6)
		}
	}
	// A frame past the newest pair extrapolates rather than refusing: the
	// window's end is a few frames past the last recorded block.
	_, lastFrame := b.at(b.count - 1)
	if _, ok := b.NSAt(lastFrame + 100); !ok {
		t.Error("NSAt refused a frame just past the last pair")
	}
}

func TestBridgeRingWraps(t *testing.T) {
	b := NewClockBridge(8, testRate)
	truth := fill(b, 100, 0, 0, 1)
	if b.Len() != 8 {
		t.Fatalf("Len = %d, want 8", b.Len())
	}
	// Only the last eight blocks are known; a moment in them is placed, one
	// long before them is not.
	lastNS, _ := b.at(7)
	got, ok := b.FrameAt(lastNS - 1e8)
	if !ok || math.Abs(got-truth(lastNS-1e8)) > 0.5 {
		t.Errorf("recent moment: %.1f %v", got, ok)
	}
	if _, ok := b.FrameAt(1e9); ok {
		t.Error("placed a moment that has fallen out of the ring")
	}
}

// Record must never wait. With the lock held by a reader, it drops the pair
// and returns at once.
func TestBridgeRecordNeverBlocks(t *testing.T) {
	b := NewClockBridge(8, testRate)
	b.mu.Lock()
	done := make(chan struct{})
	go func() {
		b.Record(1, 1)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Record blocked on a held lock")
	}
	b.mu.Unlock()
	if b.Len() != 0 {
		t.Error("the dropped pair was stored")
	}
}

// NSAt must not fit across a dropout either: a frame just before the gap was
// converted just before it, and a frame in the first block after the gap
// just before the pair that ended it.
func TestBridgeNSAtRespectsDropouts(t *testing.T) {
	b := NewClockBridge(100, testRate)
	blockNS := int64(testBlock) * 1e9 / testRate
	for k := 1; k <= 20; k++ {
		b.Record(int64(k)*blockNS, uint64(k*testBlock))
	}
	gapEnd := 20*blockNS + 600e9 // ten minutes unplugged
	for k := 21; k <= 40; k++ {
		b.Record(gapEnd+int64(k-20)*blockNS, uint64(k*testBlock))
	}
	// Five blocks before the gap.
	got, ok := b.NSAt(15 * testBlock)
	if !ok || math.Abs(float64(got-15*blockNS)) > 1e6 {
		t.Errorf("before the gap: %d, want %d", got, 15*blockNS)
	}
	// The last frame before the gap.
	got, _ = b.NSAt(20 * testBlock)
	if math.Abs(float64(got-20*blockNS)) > 1e6 {
		t.Errorf("at the gap's start: %d, want %d", got, 20*blockNS)
	}
	// Halfway into the first block after the gap: half a block before the
	// pair that ended it.
	got, _ = b.NSAt(20*testBlock + testBlock/2)
	want := gapEnd + blockNS - blockNS/2
	if math.Abs(float64(got-want)) > 1e6 {
		t.Errorf("inside the first block after the gap: %d, want %d", got, want)
	}
	// Three blocks after.
	got, _ = b.NSAt(24 * testBlock)
	if want := gapEnd + 4*blockNS; math.Abs(float64(got-want)) > 1e6 {
		t.Errorf("after the gap: %d, want %d", got, want)
	}
}
