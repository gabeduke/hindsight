package tape

import (
	"log"
	"math"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/mono"
)

// Alignment: the Pi hears itself.
//
// Δ is where the tape's output shows up in the ring: what output frame o
// played is in the channel taps at ring frame o + Δ. A catch needs it. The
// demo knows it exactly. On the Sidekick it's measured:
//
//   - estimated, from the capture's and the output's clock bridges: the ring
//     frame being converted at a moment, minus the output frame being heard
//     then, corrected by the last lock's residual;
//   - locked, by correlating what the output delivered on a bus against that
//     bus's channel tap in the ring, within ±50 ms of the estimate (xcorr.go).
//
// Both sides of the Sidekick run off one crystal, so Δ only moves when one
// side loses frames the other didn't: the output restarts or underflows, or
// the capture drops a block. Δ is kept as segments over output frames, so a
// pass from before a slip is caught with the Δ that held when it played.

const (
	// histFrames is how much of what each bus delivered is kept: 5.5 s.
	histFrames = 1 << 18
	histMask   = histFrames - 1

	alignWindow = 48000 // frames of delivered audio a lock correlates: 1 s
	alignSearch = 2400  // ± frames around the estimate it searches: 50 ms
	// alignMinRMS is how loud a bus must be to lock on: -50 dBFS.
	alignMinRMS = 0.00316
)

// deltaSeg is the Δ that holds from output frame From.
type deltaSeg struct {
	From  uint64
	Delta int64
	How   string // locked or estimated
}

type aligner struct {
	mu       sync.Mutex
	segs     []deltaSeg
	residual int64 // the last lock minus its estimate
	locked   bool  // residual is from a lock
	slips    uint64
	lastLock time.Time
}

// Optional capabilities the aligner uses.
type (
	bridged interface {
		Bridge() *audio.ClockBridge
	}
	xrunner interface{ XRuns() uint64 }
	// OutputSink is a sink that can say when its output is heard and when
	// it may have slipped: the device sink.
	outputSink interface {
		OutputBridge() *audio.ClockBridge
		Restarts() uint64
	}
)

// startAligner runs the aligner when the output doesn't know its own Δ.
func (e *Engine) startAligner() {
	if e.sink == nil || e.capture == nil {
		return
	}
	if kd, ok := e.sink.(audio.KnownDelta); ok {
		if _, known := kd.Delta(); known {
			return
		}
	}
	if _, ok := e.sink.(outputSink); !ok {
		return
	}
	if _, ok := e.capture.(bridged); !ok {
		return
	}
	go func() {
		t := time.NewTicker(500 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-e.stop:
				return
			case <-t.C:
				e.safely(e.alignStep)
			}
		}
	}()
}

// estimate is Δ from the two clock bridges alone.
func (e *Engine) estimate() (int64, bool) {
	out, ok := e.sink.(outputSink)
	if !ok {
		return 0, false
	}
	cb, ok := e.capture.(bridged)
	if !ok {
		return 0, false
	}
	// A moment both bridges have recorded around: the output's runs ahead,
	// the capture's behind.
	t := mono.Now() - int64(300*time.Millisecond)
	rf, ok1 := cb.Bridge().FrameAt(t)
	of, ok2 := out.OutputBridge().FrameAt(t)
	if !ok1 || !ok2 {
		return 0, false
	}
	return int64(math.Round(rf - (of + float64(e.sinkBase.Load())))), true
}

func (e *Engine) slipCount() uint64 {
	var n uint64
	if o, ok := e.sink.(outputSink); ok {
		n += o.Restarts()
	}
	if x, ok := e.capture.(xrunner); ok {
		n += x.XRuns()
	}
	return n
}

// alignStep keeps the current segment's Δ up to date, starts a new one at a
// slip, and tries to lock.
func (e *Engine) alignStep() {
	est, ok := e.estimate()
	if !ok {
		return
	}
	a := &e.align
	now := e.delivered.Load()
	slips := e.slipCount()

	a.mu.Lock()
	if len(a.segs) == 0 || slips != a.slips {
		from := uint64(0) // the first holds from the start
		if len(a.segs) > 0 {
			log.Printf("[!] tape: the output slipped against the capture; re-measuring")
			from = now
		}
		a.slips = slips
		a.segs = append(a.segs, deltaSeg{From: from, Delta: est + a.residual, How: "estimated"})
		if len(a.segs) > 16 {
			a.segs = a.segs[len(a.segs)-16:]
		}
	}
	cur := &a.segs[len(a.segs)-1]
	if cur.How == "estimated" {
		cur.Delta = est + a.residual
	}
	from, how := cur.From, cur.How
	due := how == "estimated" && time.Since(a.lastLock) > 2*time.Second ||
		how == "locked" && time.Since(a.lastLock) > 10*time.Second
	a.mu.Unlock()
	if !due {
		return
	}

	d, ok := e.measure(est, from)
	if !ok {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.lastLock = time.Now()
	cur = &a.segs[len(a.segs)-1]
	if cur.From != from {
		return // slipped meanwhile
	}
	if cur.How == "locked" && cur.Delta != d {
		log.Printf("[!] tape: the lock moved %d frames without a slip; taking the new one", d-cur.Delta)
	} else if cur.How != "locked" {
		log.Printf("[*] tape: locked, Δ %d frames (%.1f ms off the estimate)", d, float64(d-est)*1000/float64(e.store.SampleRate()))
	}
	cur.Delta, cur.How = d, "locked"
	a.residual, a.locked = d-est, true
}

// measure correlates the last second a bus delivered against its tap in the
// ring, around the estimate. It answers the locked Δ, if the match is sharp.
func (e *Engine) measure(est int64, segFrom uint64) (int64, bool) {
	if e.hist[0] == nil {
		return 0, false
	}
	ring := e.capture.Ring()
	_, total := ring.Window()
	end := e.histEnd.Load()
	// The output frames whose sound the ring holds by now, ±search.
	oEnd := int64(end)
	if lim := int64(total) - est - alignSearch; lim < oEnd {
		oEnd = lim
	}
	oStart := oEnd - alignWindow
	// Inside this segment, and still in the history (with a block to spare
	// for the pulls that land while it's read).
	if oStart < 0 || oStart < int64(segFrom) || int64(end)-oStart > histFrames-BlockFrames {
		return 0, false
	}
	for bus := 0; bus < 2; bus++ {
		tap, ok := e.tapFor(bus)
		if !ok {
			continue
		}
		x := make([]float64, alignWindow)
		var sum float64
		for i := range x {
			v := float64(e.hist[bus][(uint64(oStart)+uint64(i))&histMask].Load()) / 2147483648.0
			x[i] = v
			sum += v * v
		}
		if math.Sqrt(sum/alignWindow) < alignMinRMS {
			continue // this bus isn't sounding
		}
		from := oStart + est - alignSearch
		to := oEnd + est + alignSearch
		oldest, _ := ring.Window()
		if from < int64(oldest) {
			return 0, false
		}
		y := make([]float64, 0, to-from)
		err := ring.Range(uint64(from), uint64(to), []int{tap.Pair[0], tap.Pair[1]}, func(b []int32) error {
			for i := 0; i < len(b); i += 2 {
				y = append(y, float64(b[i])/2147483648.0)
			}
			return nil
		})
		if err != nil || len(y) != int(to-from) {
			return 0, false
		}
		fit := findLag(x, y, 48)
		if !fit.Sharp() {
			continue
		}
		return est - alignSearch + int64(fit.Lag), true
	}
	return 0, false
}

// tapFor is the source that hears one bus alone: where that bus's sound is
// looked for.
func (e *Engine) tapFor(bus int) (Source, bool) {
	name := BusA
	if bus == 1 {
		name = BusB
	}
	for _, s := range e.sources {
		if len(s.Leaks) == 1 && s.Leaks[0] == name {
			return s, true
		}
	}
	return Source{}, false
}

// deltaAt is the Δ that held at output frame o, and how it's known.
func (e *Engine) deltaAt(o uint64) (int64, string) {
	if kd, ok := e.sink.(audio.KnownDelta); ok && e.sink != nil {
		if d, ok := kd.Delta(); ok {
			return d - e.sinkBase.Load(), "exact"
		}
	}
	a := &e.align
	a.mu.Lock()
	defer a.mu.Unlock()
	for i := len(a.segs) - 1; i >= 0; i-- {
		if a.segs[i].From <= o || i == 0 {
			return a.segs[i].Delta, a.segs[i].How
		}
	}
	return 0, "none"
}

// delta is the Δ that holds now.
func (e *Engine) delta() (int64, string) { return e.deltaAt(e.delivered.Load()) }

// keepHistory notes what a pull delivered on each bus, for the aligner.
// It runs on the device's thread: no locks, no allocation.
func (e *Engine) keepHistory(start uint64, out []int32) {
	if e.hist[0] == nil {
		return
	}
	n := len(out) / OutChannels
	for i := 0; i < n; i++ {
		k := (start + uint64(i)) & histMask
		e.hist[0][k].Store(out[i*OutChannels])
		e.hist[1][k].Store(out[i*OutChannels+2])
	}
	e.histEnd.Store(start + uint64(n))
}
