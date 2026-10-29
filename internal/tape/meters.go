package tape

import (
	"math"
	"sync/atomic"
)

// The tracks' meters: each track's peak as the render goroutine plays it,
// after its fader and pan, held with a release so a reader at any rate sees
// the loudest of the last moment (the SMK-37's screen, internal/surface,
// reads them ten times a second). A track that doesn't render -- muted, or
// another soloed, or the tape standing -- falls to silence on the release.
// Measured where the track renders, so they lead what's heard by the
// output's latency: tens of milliseconds, below what a meter shows.

// MeteredTracks is how many tracks have a meter.
const MeteredTracks = 8

// meterRelease is how fast a meter falls, in dB a second.
const meterRelease = 26.0

type meters struct {
	block [MeteredTracks]float32       // the render goroutine's alone: this block's peaks
	level [MeteredTracks]atomic.Uint32 // float32 bits, read anywhere
}

// note takes a track's peak in the block being rendered. Render goroutine.
func (mt *meters) note(ti int, peak float32) {
	if ti < MeteredTracks && peak > mt.block[ti] {
		mt.block[ti] = peak
	}
}

// settle ends a block of frames at sample rate sr: each level is the
// block's peak, or what it was fallen by the release, whichever is louder.
// Render goroutine.
func (mt *meters) settle(frames int, sr float64) {
	if frames <= 0 || sr <= 0 {
		return
	}
	fall := float32(math.Pow(10, -meterRelease/20*float64(frames)/sr))
	for i := range mt.block {
		was := math.Float32frombits(mt.level[i].Load())
		l := max(mt.block[i], was*fall)
		if l < 1e-6 {
			l = 0
		}
		mt.level[i].Store(math.Float32bits(l))
		mt.block[i] = 0
	}
}

// silence puts every meter at nothing: with no output, nothing renders and
// nothing is heard. Render goroutine.
func (mt *meters) silence() {
	for i := range mt.block {
		mt.block[i] = 0
		mt.level[i].Store(0)
	}
}

// TrackLevels is each track's level now, 0 to 1 at full scale (more when it
// clips), track 1 first, for the first MeteredTracks tracks.
func (e *Engine) TrackLevels() [MeteredTracks]float64 {
	var out [MeteredTracks]float64
	for i := range out {
		out[i] = float64(math.Float32frombits(e.meters.level[i].Load()))
	}
	return out
}

// Heard is where the tape is as heard now, and whether the transport plays:
// what Live says as Heard and Playing, without the rest of Live.
func (e *Engine) Heard() (pos int64, playing bool) {
	st := e.tr.Status()
	if p, ok := e.tr.PosAt(e.delivered.Load()); ok {
		return p, st.Playing
	}
	return st.Pos, st.Playing
}
