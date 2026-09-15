package audio

import (
	"sync"
)

// fitHalfWindow is how many pairs either side of the bracketing pair the
// local fit uses. At 2048 frames a block that is 16 × 43 ms ≈ 0.7 s each
// side: enough pairs to average out callback-scheduling jitter of a few ms,
// short enough that crystal drift across it (±100 ppm × 1.4 s = 0.14 ms) is
// far below the jitter it removes.
const fitHalfWindow = 16

// dropoutNS is the gap between two recorded pairs beyond which the audio is
// taken to have stopped between them -- the device was unplugged, or the
// stream was being restarted. Matches staleAfter: a stream that quiet is
// declared dead. Inside such a gap the ring did not advance, so a moment in
// it maps to the frame at the gap's start rather than to a line drawn across
// it.
const dropoutNS = int64(2e9)

// ClockBridge ties the audio ring's frame counter to the monotonic clock.
//
// It is the substitute for an ALSA htstamp anchor, and it is better than one:
// a single anchor taken at stream start assumes the interface's crystal and
// the Pi's clock agree, and at the ±50-100 ppm they actually differ by that
// is 45-90 ms out by the end of a 15-minute ring. Recording a (time, frame)
// pair for every block that reaches the ring, and interpolating between the
// pairs that bracket a moment, tracks the drift instead of assuming it away.
//
// The delivery goroutine writes one pair per block with TryLock, so it never
// waits on a reader; a save reads under the lock, copying what it needs. A
// pair skipped because a save held the lock is nothing: they arrive forty
// times a second.
type ClockBridge struct {
	mu    sync.Mutex
	ns    []int64
	frame []uint64
	w     int
	count int

	sampleRate float64
	// pipelineNS is the delay between a sample being converted and the block
	// holding it reaching Record: PortAudio's reported input latency, plus
	// what the caller adds. Applied by FrameAt so a moment on the monotonic
	// clock maps to the frame that was *being converted* then, not the one
	// that had just been handed over.
	pipelineNS int64
}

// NewClockBridge holds capPairs pairs; sampleRate is the nominal rate, used
// as the slope when there are too few pairs to fit one.
func NewClockBridge(capPairs int, sampleRate int) *ClockBridge {
	if capPairs < 2 {
		capPairs = 2
	}
	return &ClockBridge{
		ns:         make([]int64, capPairs),
		frame:      make([]uint64, capPairs),
		sampleRate: float64(sampleRate),
	}
}

// SetPipelineLatency records the delay between conversion and delivery.
func (b *ClockBridge) SetPipelineLatency(ns int64) {
	b.mu.Lock()
	b.pipelineNS = ns
	b.mu.Unlock()
}

// PipelineLatency reports what SetPipelineLatency stored.
func (b *ClockBridge) PipelineLatency() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.pipelineNS
}

// Record notes that, at monotonic time ns, endFrame frames had been handed to
// the ring writer. It never blocks: if a reader holds the lock the pair is
// dropped.
func (b *ClockBridge) Record(ns int64, endFrame uint64) {
	if !b.mu.TryLock() {
		return
	}
	b.ns[b.w] = ns
	b.frame[b.w] = endFrame
	b.w = (b.w + 1) % len(b.ns)
	if b.count < len(b.ns) {
		b.count++
	}
	b.mu.Unlock()
}

// Len is the number of pairs held.
func (b *ClockBridge) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.count
}

// at returns the k-th oldest pair. Called with mu held.
func (b *ClockBridge) at(k int) (int64, uint64) {
	i := ((b.w-b.count+k)%len(b.ns) + len(b.ns)) % len(b.ns)
	return b.ns[i], b.frame[i]
}

// FrameAt maps a monotonic moment to the ring frame being converted then, as
// a fraction of a frame. It reports false when no history covers the moment:
// before the first pair, more than a dropout after the last, or an empty
// bridge.
func (b *ClockBridge) FrameAt(ns int64) (float64, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.count == 0 {
		return 0, false
	}
	// The block delivered at time t was converted pipelineNS earlier, so the
	// frame being converted at ns is the one delivered at ns + pipelineNS.
	ns += b.pipelineNS

	firstNS, _ := b.at(0)
	lastNS, lastFrame := b.at(b.count - 1)
	if ns < firstNS-dropoutNS || ns > lastNS+dropoutNS {
		return 0, false
	}
	if b.count == 1 {
		return float64(lastFrame) + float64(ns-lastNS)*b.sampleRate/1e9, true
	}

	// Last pair at or before ns.
	lo, hi := 0, b.count-1
	for lo < hi {
		mid := (lo + hi + 1) / 2
		if t, _ := b.at(mid); t <= ns {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	i := lo
	tI, fI := b.at(i)
	if i+1 < b.count {
		tNext, _ := b.at(i + 1)
		if tNext-tI > dropoutNS && ns > tI {
			// Inside a dropout: the ring did not advance.
			return float64(fI), true
		}
	}

	// Local least-squares fit of frame against time over the neighbouring
	// pairs, excluding any that lie across a dropout from the bracketing one.
	from, to := i-fitHalfWindow, i+fitHalfWindow
	if from < 0 {
		from = 0
	}
	if to > b.count-1 {
		to = b.count - 1
	}
	for k := i; k > from; k-- {
		t1, _ := b.at(k)
		t0, _ := b.at(k - 1)
		if t1-t0 > dropoutNS {
			from = k
			break
		}
	}
	for k := i; k < to; k++ {
		t0, _ := b.at(k)
		t1, _ := b.at(k + 1)
		if t1-t0 > dropoutNS {
			to = k
			break
		}
	}
	n := float64(to - from + 1)
	if n < 2 {
		return float64(fI) + float64(ns-tI)*b.sampleRate/1e9, true
	}
	// Centre on the bracketing pair so the sums stay small.
	var sx, sy, sxx, sxy float64
	for k := from; k <= to; k++ {
		t, f := b.at(k)
		x := float64(t - tI)
		y := float64(int64(f) - int64(fI))
		sx += x
		sy += y
		sxx += x * x
		sxy += x * y
	}
	den := n*sxx - sx*sx
	slope := b.sampleRate / 1e9
	if den > 0 {
		slope = (n*sxy - sx*sy) / den
	}
	intercept := (sy - slope*sx) / n
	return float64(fI) + intercept + slope*float64(ns-tI), true
}

// NSAt is the inverse: the monotonic moment a ring frame was being
// converted. It is what places the take's first frame on the clock for the
// manifest. Same fit, axes swapped.
func (b *ClockBridge) NSAt(frame uint64) (int64, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.count == 0 {
		return 0, false
	}
	_, firstFrame := b.at(0)
	lastNS, lastFrame := b.at(b.count - 1)
	if b.count == 1 || frame >= lastFrame {
		return lastNS + int64((float64(frame)-float64(lastFrame))*1e9/b.sampleRate) - b.pipelineNS, true
	}
	if frame < firstFrame {
		firstNS, _ := b.at(0)
		return firstNS - int64((float64(firstFrame)-float64(frame))*1e9/b.sampleRate) - b.pipelineNS, true
	}
	lo, hi := 0, b.count-1
	for lo < hi {
		mid := (lo + hi + 1) / 2
		if _, f := b.at(mid); f <= frame {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	i := lo
	tI, fI := b.at(i)
	from, to := i-fitHalfWindow, i+fitHalfWindow
	if from < 0 {
		from = 0
	}
	if to > b.count-1 {
		to = b.count - 1
	}
	n := float64(to - from + 1)
	var sx, sy, sxx, sxy float64
	for k := from; k <= to; k++ {
		t, f := b.at(k)
		x := float64(int64(f) - int64(fI))
		y := float64(t - tI)
		sx += x
		sy += y
		sxx += x * x
		sxy += x * y
	}
	den := n*sxx - sx*sx
	slope := 1e9 / b.sampleRate
	if den > 0 {
		slope = (n*sxy - sx*sy) / den
	}
	intercept := (sy - slope*sx) / n
	return tI + int64(intercept+slope*(float64(frame)-float64(fI))) - b.pipelineNS, true
}
