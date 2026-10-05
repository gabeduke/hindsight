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
	// alignSpan is how far either side of where Δ should be the
	// correlation looks: 150 ms. A peak is taken only within alignAccept of
	// it -- 50 ms, or 10 ms once a lock has said how good the estimate is --
	// so a strong match farther out (a rhythm repeating at its true Δ)
	// is seen and refused rather than an echo of it inside being taken.
	alignSpan        = 7200
	alignAccept      = 2400
	alignAcceptTight = 480
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
	residual int64  // the last lock minus its estimate
	locked   bool   // residual is from a lock
	outSlips uint64 // the output's slips seen so far
	capSlips uint64 // and the capture's
	prevOut  uint64 // the output frame at the last step
	lastTry  time.Time
	// A lock is taken when two measurements in a row agree.
	candidate int64
	haveCand  bool
	scratch   xcorrScratch
}

// Optional capabilities the aligner uses.
type (
	bridged interface {
		Bridge() *audio.ClockBridge
	}
	xrunner    interface{ XRuns() uint64 }
	overflower interface{ InputOverflows() uint64 }
	// outputSink is a sink that can say when its output is heard and when
	// it may have slipped: the device sink.
	outputSink interface {
		OutputBridge() *audio.ClockBridge
		Restarts() uint64
	}
	// slipPlacer says where its latest slip was, in its own output frames.
	slipPlacer interface{ LastSlip() uint64 }
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

// slipCounts counts the output's slips and the capture's: frames one side
// lost that the other didn't.
func (e *Engine) slipCounts() (out, capture uint64) {
	if o, ok := e.sink.(outputSink); ok {
		out = o.Restarts()
	}
	if x, ok := e.capture.(xrunner); ok {
		capture += x.XRuns()
	}
	if x, ok := e.capture.(overflower); ok {
		capture += x.InputOverflows()
	}
	return out, capture
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
	outSlips, capSlips := e.slipCounts()

	a.mu.Lock()
	if len(a.segs) == 0 {
		a.segs = append(a.segs, deltaSeg{From: 0, Delta: est, How: "estimated"})
	} else if outSlips != a.outSlips || capSlips != a.capSlips {
		// Where it slipped. The output says exactly; the capture's drops are
		// placed at the last step, the earliest they can have been.
		from := uint64(math.MaxUint64)
		if capSlips != a.capSlips {
			from = a.prevOut
		}
		if outSlips != a.outSlips {
			f := a.prevOut
			if sp, ok := e.sink.(slipPlacer); ok {
				f = sp.LastSlip() + uint64(e.sinkBase.Load())
			}
			from = min(from, f)
		}
		if last := a.segs[len(a.segs)-1].From; from <= last {
			from = last + 1
		}
		log.Printf("[!] tape: the output slipped against the capture; re-measuring")
		a.segs = append(a.segs, deltaSeg{From: from, Delta: est + a.residual, How: "estimated"})
		if len(a.segs) > 16 {
			a.segs = a.segs[len(a.segs)-16:]
		}
		a.haveCand = false
	}
	a.outSlips, a.capSlips, a.prevOut = outSlips, capSlips, now
	cur := &a.segs[len(a.segs)-1]
	if cur.How == "estimated" {
		cur.Delta = est + a.residual
	}
	from, how, center := cur.From, cur.How, cur.Delta
	due := (how == "estimated" && time.Since(a.lastTry) > 2*time.Second ||
		how == "locked" && time.Since(a.lastTry) > 10*time.Second) && !e.outputSilent()
	if due {
		a.lastTry = time.Now()
	}
	accept := int64(alignAccept)
	if a.locked {
		accept = alignAcceptTight
	}
	a.mu.Unlock()
	if !due {
		return
	}

	d, oStart, ok := e.measure(center, accept, from)
	if !ok {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	cur = &a.segs[len(a.segs)-1]
	// Two in a row, agreeing to a frame, before anything changes.
	if !a.haveCand || d < a.candidate-1 || d > a.candidate+1 {
		a.candidate, a.haveCand = d, true
		return
	}
	a.haveCand = false
	switch {
	case cur.How != "locked":
		log.Printf("[*] tape: locked, Δ %d frames (%.1f ms off the estimate)", d, float64(d-est)*1000/float64(e.store.SampleRate()))
		cur.Delta, cur.How = d, "locked"
	case cur.Delta != d:
		// It moved with no slip seen: from the window on, take the new one,
		// and leave what played before it with the old.
		log.Printf("[!] tape: the lock moved %d frames with no slip seen; re-locked", d-cur.Delta)
		if uint64(oStart) > cur.From {
			a.segs = append(a.segs, deltaSeg{From: uint64(oStart), Delta: d, How: "locked"})
		} else {
			cur.Delta = d
		}
	}
	a.residual, a.locked = d-est, true
}

// measure correlates the last second a bus delivered against its tap in the
// ring, around where Δ should be. It answers the locked Δ, if the match is
// sharp and near enough, and the output frame the window began at.
func (e *Engine) measure(center, accept int64, segFrom uint64) (int64, int64, bool) {
	if e.hist[0] == nil {
		return 0, 0, false
	}
	ring := e.capture.Ring()
	oldest, total := ring.Window()
	end := e.histEnd.Load()
	// The output frames whose sound the ring holds by now, with the span.
	oEnd := int64(end)
	if lim := int64(total) - center - alignSpan; lim < oEnd {
		oEnd = lim
	}
	oStart := oEnd - alignWindow
	// Inside this segment, and still in the history (with a block to spare
	// for the pulls that land while it's read).
	if oStart < 0 || oStart < int64(segFrom) || int64(end)-oStart > histFrames-BlockFrames {
		return 0, 0, false
	}
	from := oStart + center - alignSpan
	to := oEnd + center + alignSpan
	if from < int64(oldest) {
		return 0, 0, false
	}
	a := &e.align
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
		y := make([]float64, 0, to-from)
		err := ring.Range(uint64(from), uint64(to), []int{tap.Pair[0], tap.Pair[1]}, func(b []int32) error {
			for i := 0; i < len(b); i += 2 {
				y = append(y, float64(b[i])/2147483648.0)
			}
			return nil
		})
		if err != nil || len(y) != int(to-from) {
			return 0, 0, false
		}
		fit := findLagWith(&a.scratch, x, y, 48)
		off := int64(fit.Lag) - alignSpan
		if !fit.Sharp() || off < -accept || off > accept {
			continue
		}
		return center + off, oStart, true
	}
	return 0, 0, false
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

// segAt is which segment output frame o is in (-1: none yet).
func (e *Engine) segAt(o uint64) int {
	a := &e.align
	a.mu.Lock()
	defer a.mu.Unlock()
	for i := len(a.segs) - 1; i >= 0; i-- {
		if a.segs[i].From <= o {
			return i
		}
	}
	return -1
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

// outputSilent says the device is playing silence (the tape is on a phone):
// there's nothing of the tape's in the capture to lock on to.
func (e *Engine) outputSilent() bool {
	r := e.router()
	return r != nil && r.Silent()
}
