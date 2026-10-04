package tape

import (
	"fmt"
	"math"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// The free loop: no tempo, no count-in. Play until a part sounds right, tap
// where it starts and again where it comes round. Each tap is stamped when
// it reaches the Pi -- the phone's clock isn't trusted -- turned into a ring
// frame by the capture's clock bridge, and snapped to the strongest attack
// in the source from 250 ms before it to 50 ms after: people tap on the
// beat, and Wi-Fi delivers late. The span becomes the tape's first loop,
// and its length sets the tempo; playback starts in phase, as if the loop
// had been playing since the second tap.

const (
	tapBefore = 0.250 // seconds before a tap an attack may be
	tapAfter  = 0.050 // and after
	tapExpiry = 2 * time.Minute
	// minLoopSeconds is the shortest free loop: one bar at 400 BPM.
	// Shorter is a double tap, taken as a new first tap.
	minLoopSeconds = 0.6
)

type pendingTap struct {
	tape   string
	ring   int64 // the ring frame being converted when it arrived
	track  int
	source string
	at     time.Time
}

// TapResult is what a tap did: the first waits for the second, which makes
// the loop.
type TapResult struct {
	Stage string  `json:"stage"` // first, or loop
	Clip  *Clip   `json:"clip,omitempty"`
	BPM   float64 `json:"bpm,omitempty"`
	Bars  int     `json:"bars,omitempty"`
}

func (e *Engine) tapPending() bool {
	e.recMu.Lock()
	defer e.recMu.Unlock()
	if e.tap != nil && time.Since(e.tap.at) > tapExpiry {
		e.tap = nil
	}
	return e.tap != nil
}

// CancelTap forgets a first tap.
func (e *Engine) CancelTap() {
	e.recMu.Lock()
	e.tap = nil
	e.recMu.Unlock()
}

// Tap takes a free-loop tap that arrived at monotonic time ns.
func (e *Engine) Tap(id string, track int, source string, ns int64) (TapResult, error) {
	t := e.Loaded()
	if t == nil {
		return TapResult{}, ErrNoTape
	}
	if t.ID != id {
		return TapResult{}, ErrWrongTape
	}
	if t.Grid != nil || !t.Empty() {
		return TapResult{}, fmt.Errorf("%w: this tape has its tempo; catch bars or a pass instead", ErrBadParameter)
	}
	if _, err := t.Track(track); err != nil {
		return TapResult{}, err
	}
	src, ok := e.source(source)
	if !ok {
		return TapResult{}, fmt.Errorf("%w: no source %q", ErrBadParameter, source)
	}
	cb, ok := e.capture.(bridged)
	if !ok {
		return TapResult{}, ErrNoCapture
	}
	f, ok := cb.Bridge().FrameAt(ns)
	if !ok {
		return TapResult{}, ErrNotYet
	}
	ring := int64(math.Round(f))

	sr := int64(e.store.SampleRate())
	this := &pendingTap{tape: id, ring: ring, track: track, source: source, at: time.Now()}
	e.recMu.Lock()
	if e.LoadedID() != id { // a load raced this tap
		e.recMu.Unlock()
		return TapResult{}, ErrWrongTape
	}
	first := e.tap
	if first != nil && (time.Since(first.at) > tapExpiry || first.source != source || first.track != track || first.tape != id) {
		first = nil
	}
	// A second tap too soon after the first is a fresh first tap.
	if first == nil || ring-first.ring < int64(minLoopSeconds*float64(sr)) {
		e.tap = this
		e.recMu.Unlock()
		return TapResult{Stage: "first"}, nil
	}
	e.tap = nil
	e.recMu.Unlock()
	keepFirst := func() {
		e.recMu.Lock()
		if e.tap == nil && e.LoadedID() == id {
			e.tap = first
		}
		e.recMu.Unlock()
	}

	before, after := int64(tapBefore*float64(sr)), int64(tapAfter*float64(sr))
	over := int64(OverhangSeconds * float64(sr))
	r := e.capture.Ring()
	// Wait for the ring to hold the second tap's window, and the overhang
	// past wherever in it the loop's end snaps to.
	for tries := 0; ; tries++ {
		_, total := r.Window()
		if ring+after+over <= int64(total) {
			break
		}
		if tries >= 100 {
			keepFirst()
			return TapResult{}, ErrNotYet
		}
		time.Sleep(20 * time.Millisecond)
	}
	start := snapAttack(r, src.Pair, first.ring, before, after)
	end := snapAttack(r, src.Pair, ring, before, after)
	frames := end - start
	if frames < int64(minLoopSeconds*float64(sr)) {
		keepFirst()
		return TapResult{}, fmt.Errorf("%w: both taps found the same hit; tap where the loop starts, then where it comes round", ErrBadParameter)
	}
	bars := guessBarsNear(frames, int(sr), e.lastBPM(id))
	g := Grid{Frames: frames, Bars: bars}
	if bpm := g.BPM(int(sr)); bpm < 20 || bpm > 400 {
		return TapResult{}, fmt.Errorf("%w: %.1f s doesn't make a tempo of 20–400 BPM", ErrBadParameter, float64(frames)/float64(sr))
	}

	oldest, _ := r.Window()
	if start-over < int64(oldest) {
		return TapResult{}, ErrGone
	}
	if e.minFreeGB > 0 {
		if free, _ := audio.FreeGB(e.store.Dir()); free < e.minFreeGB {
			return TapResult{}, fmt.Errorf("%w: %.2f GB free where the tapes are, need %.2f GB", audio.ErrLowDisk, free, e.minFreeGB)
		}
	}
	rel, path, err := e.store.NewPoolFile("loop", time.Now())
	if err != nil {
		return TapResult{}, err
	}
	peak, err := audio.WriteSpan(r, uint64(start-over), uint64(end+over), src.Pair[:], path, int(sr))
	if err != nil {
		return TapResult{}, err
	}
	clean := true
	for _, b := range src.Leaks {
		for _, tr := range t.Tracks {
			if tr.Bus == b && len(tr.Clips) > 0 && !tr.Mute {
				clean = false
			}
		}
	}
	clip := Clip{File: rel, Src: over, Frames: frames, Source: src.Name, Clean: clean, PeakDB: peakDB(peak)}
	var placed Clip
	err = e.Edit(id, "", func(tp *Tape, s *State) error {
		if s.Grid != nil || !tp.Empty() {
			return fmt.Errorf("%w: this tape got a tempo meanwhile", ErrBadParameter)
		}
		tp.Click = false
		s.Grid = &g
		s.Loop = Loop{In: 0, Out: frames, On: true}
		var err error
		placed, err = s.Place(track, clip, true)
		return err
	})
	if err != nil {
		return TapResult{}, err
	}
	// In phase: the loop came round at ring frame end, which the output
	// played at end - Δ; it has been going round since.
	if d, how := e.delta(); how != "none" {
		d += int64(math.Round(e.latencyMS * float64(sr) / 1000)) // as catches do
		e.Do(Action{Kind: "phase", Anchor: end - d})
	} else {
		e.Do(Action{Kind: "locate", Pos: 0})
		e.Do(Action{Kind: "play"})
	}
	return TapResult{Stage: "loop", Clip: &placed, BPM: math.Round(g.BPM(int(sr))*10) / 10, Bars: bars}, nil
}

// lastBPM is the tempo of the most recently changed other tape with one, or
// 90: a free loop's bar count is the one that puts it nearest.
func (e *Engine) lastBPM(except string) float64 {
	if list, err := e.store.List(); err == nil {
		for _, s := range list {
			if s.ID != except && s.BPM > 0 {
				return s.BPM
			}
		}
	}
	return 90
}

// guessBarsNear picks the bar count, a power of two, that puts a loop's
// tempo nearest bpm, among those that make a tempo of 20–400 BPM (1 if
// none does; the caller refuses it).
func guessBarsNear(frames int64, sampleRate int, bpm float64) int {
	best, bestDiff := 1, math.Inf(1)
	for b := 1; b <= 32; b *= 2 {
		got := Grid{Frames: frames, Bars: b}.BPM(sampleRate)
		if got < 20 || got > 400 {
			continue
		}
		if d := math.Abs(math.Log(got / bpm)); d < bestDiff {
			best, bestDiff = b, d
		}
	}
	return best
}

// snapAttack finds the strongest attack in a source between before frames
// before ring frame center and after frames after it, and answers the frame
// it starts at -- or center, if nothing in the window rises.
func snapAttack(r *audio.Ring, pair [2]int, center, before, after int64) int64 {
	from, to := center-before, center+after
	if from < 0 {
		from = 0
	}
	var x []float64
	err := r.Range(uint64(from), uint64(to), []int{pair[0], pair[1]}, func(b []int32) error {
		for i := 0; i+1 < len(b); i += 2 {
			x = append(x, (float64(b[i])+float64(b[i+1]))/2/2147483648.0)
		}
		return nil
	})
	if err != nil || len(x) < 1024 {
		return center
	}
	if i := attackIn(x); i >= 0 {
		return from + int64(i)
	}
	return center
}

// attackIn is where in x the strongest attack starts: the hop whose energy
// rises most over the few before it, then the first sample there that
// reaches a third of what follows. -1: nothing rises.
func attackIn(x []float64) int {
	const hop = 128
	n := len(x) / hop
	if n < 6 {
		return -1
	}
	e := make([]float64, n)
	for k := 0; k < n; k++ {
		for _, v := range x[k*hop : (k+1)*hop] {
			e[k] += v * v
		}
	}
	best, bestRise := -1, 0.0
	for k := 4; k < n; k++ {
		past := (e[k-1] + e[k-2] + e[k-3] + e[k-4]) / 4
		if rise := e[k] - past; rise > bestRise {
			best, bestRise = k, rise
		}
	}
	if best < 0 || bestRise < 1e-9*hop {
		return -1
	}
	lo, hi := (best-1)*hop, min((best+2)*hop, len(x))
	var peak float64
	for _, v := range x[best*hop : hi] {
		peak = max(peak, math.Abs(v))
	}
	for i := lo; i < hi; i++ {
		if math.Abs(x[i]) >= peak/3 {
			return i
		}
	}
	return best * hop
}
