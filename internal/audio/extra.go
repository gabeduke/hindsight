package audio

import (
	"log"
	"math"
	"slices"
	"sync/atomic"
	"time"

	"github.com/gabeduke/hindsight/internal/mono"
)

// An extra input (EXTRA_INPUTS) is a second interface that only records: the
// AMS-24 beside the EP-136 (docs/architecture/capture.md, Extra inputs). It
// runs on its own crystal, so its frames are resampled onto the main
// interface's, the ring's clock, and written into the ring's channels after
// the main interface's a fixed lag behind the head: frame n of the ring is
// then the same instant on every channel.
//
// Two goroutines touch it. Its stream's delivers blocks (deliver), which
// meter at once and go into a pool, as the capture's do; the ring writer
// drains them (join), resamples and writes. A third, supervise, keeps the
// stream open and never rescans anything, so the main interface's stream is
// never closed for it.

const (
	// extraPoolBlocks is the extra stream's slack, as blockPoolSize is the
	// capture's: seconds of blocks while the ring writer is held up.
	extraPoolBlocks = 64
	// extraSlackMS is added to the lag past the main block and the extra
	// stream's own latency, for the extra blocks' arrival to wobble in.
	extraSlackMS = 50
	// extraSteerS is the steering's time constant: slow, so the bridges'
	// jitter never wobbles the pitch.
	extraSteerS = 10
	// extraMaxPPM bounds the steering: ±200 ppm is 0.35 cents.
	extraMaxPPM = 200
	// extraLockMS is how near, smoothed over a second, the steering must
	// hold the extra input to where the bridges place it to call it locked:
	// the bridges themselves wobble by a fraction of that.
	extraLockMS = 1
	// extraLostMS is how far off it can be before it is placed again (a
	// gap): further than ±200 ppm could steer back in a reasonable time, so
	// one of the clocks jumped.
	extraLostMS = 20
	// extraMaxGaps is how many extra-input gaps are remembered.
	extraMaxGaps = 64
	// extraBridgePairs is the extra stream's bridge: a pair a block, more
	// than the time the steering looks back.
	extraBridgePairs = 4096
)

type extraBlock struct {
	data  []int32
	start uint64 // the extra stream's frame index of data's first frame
	epoch uint64 // which open of the stream it came from
}

type extraInput struct {
	match        string
	first, width int // the ring's channels it fills
	src          ExtraSource
	levels       *Levels
	rate         int
	offsetNS     int64
	lag          uint64       // frames behind the head the joiner writes
	now          func() int64 // the monotonic clock: mono.Now, but for a test's

	free   chan []int32
	filled chan extraBlock

	// The stream's side: written by supervise between opens, and by the
	// delivery goroutine while open.
	handed    uint64 // frames delivered in this open
	overflows int64
	epoch     atomic.Uint64
	bridge    atomic.Pointer[ClockBridge] // this open's frames and the clock
	lost      atomic.Bool                 // a block dropped or an overflow: the joiner re-seeds
	lastBlock atomic.Int64                // unix nanos
	live      atomic.Bool
	name      atomic.Value // string

	// The ring writer's side.
	rs       *steeredResampler
	seen     uint64 // the epoch the resampler's frames are from
	start    uint64 // the extra frame of the resampler's input frame 0
	inFrames uint64 // frames written into the resampler since its reset
	seeded   bool
	next     uint64 // the ring frame the next resampled frame lands on
	integ    float64
	inBuf    []float32
	outBuf   []float32
	conv     []int32
	steered  uint64  // next, as of the last steer
	errAvg   float64 // the steering's error, smoothed over a second
	lockFrom uint64  // the ring frame the error came within extraLockFrames at; 0 while outside

	locked atomic.Bool
	ppm    atomic.Int64 // the ratio's distance from 1, in thousandths of a ppm

	// gaps are the spans of the ring its audio doesn't hold, newest last:
	// from where it stopped (restart) to where it was placed again (seed),
	// each +1 so 0 is empty; a To of 0 is a gap still open.
	gapFrom [extraMaxGaps]atomic.Uint64
	gapTo   [extraMaxGaps]atomic.Uint64
	gapN    atomic.Uint64
	gapOpen bool // the ring writer's: the newest gap has no end yet
}

func newExtraInput(match string, first, width, rate int, src ExtraSource, levels *Levels, offsetMS float64, lag uint64) *extraInput {
	x := &extraInput{match: match, first: first, width: width, src: src, levels: levels, rate: rate,
		offsetNS: int64(offsetMS * 1e6), lag: lag, overflows: -1,
		free:   make(chan []int32, extraPoolBlocks),
		filled: make(chan extraBlock, extraPoolBlocks),
		rs:     newSteeredResampler(width), now: mono.Now}
	for i := 0; i < extraPoolBlocks; i++ {
		x.free <- make([]int32, 0, 2048*width)
	}
	x.name.Store("")
	x.bridge.Store(NewClockBridge(2, rate))
	return x
}

// deliver runs on the extra stream's goroutine. Like processAudio it never
// blocks or allocates (but for a block bigger than the pool's).
func (x *extraInput) deliver(in []int32) {
	x.lastBlock.Store(time.Now().UnixNano())
	x.levels.AccumulateAt(x.first, x.width, in)
	// The device lost frames: what follows is a new stretch of its clock,
	// so a new bridge, and the joiner re-seeds from it.
	if ov := int64(x.src.Overflows()); ov != x.overflows {
		if x.overflows >= 0 && ov > x.overflows {
			x.newStretch()
		}
		x.overflows = ov
	}
	start := x.handed
	x.handed += uint64(len(in) / x.width)
	// Every block is on the bridge, kept or not: it maps this stream's
	// frames to the clock, which a dropped block doesn't change.
	x.bridge.Load().Record(x.now(), x.handed)
	select {
	case b := <-x.free:
		b = append(b[:0], in...)
		select {
		case x.filled <- extraBlock{data: b, start: start, epoch: x.epoch.Load()}:
		default:
			x.lost.Store(true)
		}
	default:
		x.lost.Store(true)
	}
}

// newStretch starts a stretch of the extra stream's frames with nothing
// lost inside it: a new bridge counting from 0, and a new epoch, so the
// joiner drops what it holds and re-seeds. It runs before an open, or on
// the delivery goroutine after an overflow.
func (x *extraInput) newStretch() {
	x.handed = 0
	b := NewClockBridge(extraBridgePairs, x.rate)
	b.SetPipelineLatency(int64(x.src.InputLatency()))
	x.bridge.Store(b)
	x.epoch.Add(1)
}

// supervise keeps the extra stream open: an open that fails waits and tries
// again, a stream with no block for staleAfter is closed and opened again.
// Nothing here rescans, so a replugged card just opens.
func (x *extraInput) supervise(stop <-chan struct{}) {
	backoff := time.Second
	lastErr := ""
	for {
		x.overflows = -1
		x.newStretch()
		x.lastBlock.Store(time.Now().UnixNano())
		name, err := x.src.Open(x.deliver)
		if err != nil {
			if err.Error() != lastErr {
				log.Printf("[!] extra input %q: %v (retrying)", x.match, err)
				lastErr = err.Error()
			}
			select {
			case <-stop:
				return
			case <-time.After(backoff):
			}
			backoff = min(backoff*2, 15*time.Second)
			continue
		}
		// The latency is known once it's open.
		x.bridge.Load().SetPipelineLatency(int64(x.src.InputLatency()))
		backoff, lastErr = time.Second, ""
		x.name.Store(name)
		x.live.Store(true)
		log.Printf("[*] extra input live on %q: channels %d-%d", name, x.first+1, x.first+x.width)
		tick := time.NewTicker(500 * time.Millisecond)
		for alive := true; alive; {
			select {
			case <-stop:
				tick.Stop()
				x.src.Close()
				x.live.Store(false)
				return
			case <-tick.C:
				if time.Since(time.Unix(0, x.lastBlock.Load())) > staleAfter {
					log.Printf("[!] extra input %q stalled (no block for %s); reopening", name, staleAfter)
					alive = false
				}
			}
		}
		tick.Stop()
		x.src.Close()
		x.live.Store(false)
		x.locked.Store(false)
		x.name.Store("")
	}
}

// join runs on the ring writer, after each block of the main interface's
// reaches the ring: it takes the extra stream's blocks in, and writes their
// frames, resampled, into the ring up to the head less the lag.
func (x *extraInput) join(ring *Ring, main *ClockBridge) {
	x.take()
	oldest, head := ring.Window()
	if head < x.lag {
		return
	}
	target := head - x.lag
	if !x.seeded && !x.seed(ring, main, target) {
		return
	}
	if x.next < oldest {
		x.restart() // the ring has moved past it: a long hold-up
		return
	}
	for x.next < target {
		n := min(target-x.next, uint64(cap(x.outBuf)/x.width))
		m := x.rs.Read(x.outBuf[:int(n)*x.width])
		if m == 0 {
			break
		}
		out := x.outBuf[:m*x.width]
		x.conv = slices.Grow(x.conv[:0], len(out))[:len(out)]
		for i, v := range out {
			x.conv[i] = toInt32(v)
		}
		if err := ring.WriteChannels(x.next, x.first, x.width, x.conv); err != nil {
			log.Printf("[!] extra input %q: writing ring frame %d: %v; placing it again", x.match, x.next, err)
			x.restart()
			return
		}
		x.next += uint64(m)
	}
	// Nothing coming: the stream stopped, or fell more than a second
	// behind. What's not written stays silent, and the span is a gap.
	if x.next < target && target-x.next > uint64(x.rate) {
		x.restart()
		return
	}
	x.steer(main)
}

// restart forgets the resampler's frames, to be placed again from the
// bridges. Where it was writing, the extra input's audio stops holding: a
// gap.
func (x *extraInput) restart() {
	if x.seeded && !x.gapOpen {
		i := x.gapN.Load() % extraMaxGaps
		x.gapTo[i].Store(0)
		x.gapFrom[i].Store(x.next + 1)
		x.gapN.Add(1)
		x.gapOpen = true
	}
	x.rs.Reset()
	x.inFrames, x.seeded = 0, false
	x.locked.Store(false)
}

// closeGap ends the open gap where the audio holds again.
func (x *extraInput) closeGap(frame uint64) {
	if x.gapOpen {
		x.gapTo[(x.gapN.Load()-1)%extraMaxGaps].Store(frame + 1)
		x.gapOpen = false
	}
}

// Gaps answers where the extra input's audio doesn't hold in the ring frames
// [start, end), in frames from start: the start of each gap that overlaps
// the span, or 0 for one the span starts inside.
func (x *extraInput) Gaps(start, end uint64) []int64 {
	n := x.gapN.Load()
	var out []int64
	for i := n - min(n, extraMaxGaps); i < n; i++ {
		from, to := x.gapFrom[i%extraMaxGaps].Load(), x.gapTo[i%extraMaxGaps].Load()
		if from == 0 {
			continue
		}
		from--
		if to == 0 {
			to = math.MaxUint64 // still open
		} else {
			to--
		}
		if from < end && to > start {
			out = append(out, int64(max(from, start)-start))
		}
	}
	slices.Sort(out)
	return slices.Compact(out)
}

// toInt32 is a resampled sample back on the ring's scale, held at full
// scale: the kernel can ring a hair past it on a clipped input.
func toInt32(v float32) int32 {
	f := float64(v) * 2147483648.0
	if f >= 2147483647 {
		return math.MaxInt32
	}
	if f <= -2147483648 {
		return math.MinInt32
	}
	return int32(f)
}

// take drains the stream's blocks into the resampler, re-seeding on a new
// open, a block lost, or a frame missing between two blocks.
func (x *extraInput) take() {
	if x.lost.Swap(false) {
		x.restart()
	}
	for {
		var b extraBlock
		select {
		case b = <-x.filled:
		default:
			return
		}
		if b.epoch != x.seen || (x.inFrames > 0 && b.start != x.start+x.inFrames) {
			x.restart()
			x.seen = b.epoch
		}
		if x.inFrames == 0 {
			x.start = b.start
		}
		x.inBuf = slices.Grow(x.inBuf[:0], len(b.data))[:len(b.data)]
		for i, v := range b.data {
			x.inBuf[i] = float32(float64(v) / 2147483648.0)
		}
		x.rs.Write(x.inBuf)
		x.inFrames += uint64(len(b.data) / x.width)
		select {
		case x.free <- b.data:
		default:
		}
	}
}

// expected is the resampler's input position (from its frame 0) that ring
// frame f should be read at: the moment f was converted, by the main
// bridge, less the offset, mapped to the extra stream's frame by its own.
func (x *extraInput) expected(main *ClockBridge, f uint64) (float64, bool) {
	ns, ok := main.NSAt(f)
	if !ok {
		return 0, false
	}
	e, ok := x.bridge.Load().FrameAt(ns - x.offsetNS)
	if !ok {
		return 0, false
	}
	return e - float64(x.start), true
}

// seed places the resampler's first frame in the ring, by the bridges, and
// starts the ratio from their slopes.
func (x *extraInput) seed(ring *Ring, main *ClockBridge, target uint64) bool {
	if x.inFrames == 0 || x.bridge.Load().Len() < 2 {
		return false
	}
	pos, ok := x.expected(main, target)
	if !ok {
		return false
	}
	// Ring frame target reads input frame pos, so input frame 0 lands on
	// target - pos: earlier frames are written behind target at once, a
	// later one waits for the head to reach it.
	at := int64(target) - int64(math.Round(pos))
	oldest, _ := ring.Window()
	if at < int64(oldest) {
		at = int64(oldest)
	}
	x.next = uint64(at)
	x.closeGap(x.next)
	x.integ = 0
	x.rs.SetRatio(1)
	x.seeded = true
	x.steered, x.lockFrom, x.errAvg = x.next, 0, 0
	if x.outBuf == nil {
		x.outBuf = make([]float32, 4096*x.width)
	}
	return true
}

// steer moves the ratio so the resampler reads where the bridges say it
// should: proportional and integral on that error, critically damped at
// extraSteerS, held within extraMaxPPM. It is locked once the error,
// smoothed over a second, has stayed within extraLockMS for two seconds.
func (x *extraInput) steer(main *ClockBridge) {
	want, ok := x.expected(main, x.next)
	if !ok {
		return
	}
	err := want - (float64(x.rs.at) + x.rs.frac) // input frames; > 0: reading behind
	if math.Abs(err) > float64(extraLostMS*x.rate/1000) {
		x.restart()
		return
	}
	tau := float64(extraSteerS * x.rate) // in output frames
	maxDev := extraMaxPPM * 1e-6
	dt := float64(x.next - x.steered) // output frames since the last steer
	x.steered = x.next
	x.errAvg += (err - x.errAvg) * min(dt/float64(x.rate), 1)
	x.integ = min(max(x.integ+err*dt/(tau*tau), -maxDev), maxDev)
	dev := min(max(2*err/tau+x.integ, -maxDev), maxDev)
	x.rs.SetRatio(1 + dev)
	x.ppm.Store(int64(x.integ * 1e9)) // the clocks' difference, without the correction's wobble
	switch {
	case math.Abs(x.errAvg) > float64(extraLockMS*x.rate/1000):
		x.lockFrom = 0
	case x.lockFrom == 0:
		x.lockFrom = x.next
	}
	x.locked.Store(x.lockFrom != 0 && x.next-x.lockFrom > 2*uint64(x.rate))
}
