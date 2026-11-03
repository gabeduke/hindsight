package audio

import "math"

// A streaming sample-rate converter for phone recordings, which arrive at
// whatever rate the phone's audio runs at -- 48 kHz on most iPhones, 44.1 on
// some Androids -- and are stored at the 48 kHz every take is.
//
// It is a windowed-sinc interpolator: each output sample is the input around
// its exact position, weighted by a Kaiser-windowed sinc low-passed below the
// lower of the two Nyquist rates. The filter is symmetric and centred on the
// output's position, so the output starts at the same instant as the input,
// with no delay to trim. Positions are tracked as exact integer ratios, so a
// three-hour recording does not drift.
//
// The kernel is tabulated at resamplePhases fractional positions and
// interpolated linearly between them. That keeps one small table for any
// pair of rates, rather than one phase per step of the rates' ratio.

const (
	// resampleHalfWidth is the kernel's half-width in input samples (or in
	// output samples when downsampling, where the kernel is stretched).
	resampleHalfWidth = 24
	resamplePhases    = 512
	// resampleBeta shapes the Kaiser window: about 80 dB of stopband.
	resampleBeta = 8.0
	// resampleRolloff puts the cutoff a little under Nyquist, leaving room
	// for the transition band.
	resampleRolloff = 0.94
)

type resampler struct {
	inRate, outRate int64
	channels        int
	half            int       // kernel half-width, in input samples
	table           []float64 // (resamplePhases+1) rows of 2*half taps
	cutoff          float64

	buf     []float64 // input history, interleaved
	bufBase int64     // input frame index of buf[0]
	inCount int64     // input frames received
	outN    int64     // next output frame
}

func newResampler(inRate, outRate, channels int) *resampler {
	r := &resampler{inRate: int64(inRate), outRate: int64(outRate), channels: channels}
	// Cutoff in cycles per input sample.
	r.cutoff = 0.5 * resampleRolloff
	scale := 1.0
	if outRate < inRate {
		scale = float64(outRate) / float64(inRate)
		r.cutoff *= scale
	}
	r.half = int(math.Ceil(resampleHalfWidth / scale))
	r.table = resampleKernel(r.cutoff, r.half)
	return r
}

// resampleKernel tabulates the Kaiser-windowed sinc at resamplePhases+1
// fractional positions, each row 2*half taps normalised to unity gain at DC,
// so a held level stays put. cutoff is in cycles per input sample.
func resampleKernel(cutoff float64, half int) []float64 {
	taps := 2 * half
	table := make([]float64, (resamplePhases+1)*taps)
	for p := 0; p <= resamplePhases; p++ {
		frac := float64(p) / resamplePhases
		row := table[p*taps : (p+1)*taps]
		sum := 0.0
		for j := 0; j < taps; j++ {
			// Tap j sits at input offset k = j - half + 1 from floor(t); its
			// distance from t is k - frac.
			d := float64(j-half+1) - frac
			v := 2 * cutoff * sinc(2*cutoff*d) * kaiser(d/float64(half), resampleBeta)
			row[j] = v
			sum += v
		}
		for j := range row {
			row[j] /= sum
		}
	}
	return table
}

// kernelRows answers the two tabulated rows either side of frac (0 <= frac <
// 1) and the weight between them.
func kernelRows(table []float64, taps int, frac float64) (row0, row1 []float64, w float64) {
	fp := frac * resamplePhases
	p := int(fp)
	return table[p*taps : (p+1)*taps], table[(p+1)*taps : (p+2)*taps], fp - float64(p)
}

func sinc(x float64) float64 {
	if x == 0 {
		return 1
	}
	return math.Sin(math.Pi*x) / (math.Pi * x)
}

// kaiser is the Kaiser window at x in [-1, 1] (0 outside).
func kaiser(x, beta float64) float64 {
	if x < -1 || x > 1 {
		return 0
	}
	return besselI0(beta*math.Sqrt(1-x*x)) / besselI0(beta)
}

func besselI0(x float64) float64 {
	sum, term := 1.0, 1.0
	for k := 1; k < 50; k++ {
		term *= (x / (2 * float64(k))) * (x / (2 * float64(k)))
		sum += term
		if term < 1e-12*sum {
			break
		}
	}
	return sum
}

// Process takes interleaved input frames and returns the output frames that
// can now be computed, interleaved. The result is only valid until the next
// call.
func (r *resampler) Process(in []float32) []float32 {
	for _, v := range in {
		r.buf = append(r.buf, float64(v))
	}
	r.inCount += int64(len(in) / r.channels)
	return r.drain(false)
}

// Flush returns the remaining output, treating the input as silent past its
// end. The total output is the input's length converted to the output rate,
// rounded up.
func (r *resampler) Flush() []float32 {
	return r.drain(true)
}

func (r *resampler) drain(final bool) []float32 {
	ch := r.channels
	taps := 2 * r.half
	total := (r.inCount*r.outRate + r.inRate - 1) / r.inRate // output frames for all input
	var out []float32
	for {
		if final && r.outN >= total {
			break
		}
		num := r.outN * r.inRate
		k0 := num / r.outRate // floor of the input position
		frac := float64(num%r.outRate) / float64(r.outRate)
		last := k0 + int64(r.half) // the newest input tap
		if !final && last >= r.inCount {
			break
		}
		row0, row1, w := kernelRows(r.table, taps, frac)
		first := k0 - int64(r.half) + 1
		for c := 0; c < ch; c++ {
			acc := 0.0
			for j := 0; j < taps; j++ {
				k := first + int64(j)
				if k < 0 || k >= r.inCount {
					continue // silence before the start and past the end
				}
				x := r.buf[(k-r.bufBase)*int64(ch)+int64(c)]
				acc += x * (row0[j] + w*(row1[j]-row0[j]))
			}
			out = append(out, float32(acc))
		}
		r.outN++
	}
	// Drop history no future output can reach.
	num := r.outN * r.inRate
	keepFrom := num/r.outRate - int64(r.half) + 1
	if drop := keepFrom - r.bufBase; drop > 0 {
		n := drop * int64(ch)
		if n > int64(len(r.buf)) {
			n = int64(len(r.buf))
		}
		r.buf = append(r.buf[:0], r.buf[n:]...)
		r.bufBase += n / int64(ch)
	}
	return out
}

// steeredResampler turns one interface's frames into another's when the two
// run on different crystals at nominally the same rate: an extra input's
// frames into the main interface's (docs/plan/extra-inputs.md, decision 1).
// It is the same kernel, but its ratio -- input frames per output frame,
// within a few hundred ppm of 1 -- is the caller's to steer between reads,
// from the two clock bridges and from how full the hand-over is.
//
// The input position is kept as a whole frame and a fraction, so an hour of
// frames at a held ratio lands within a thousandth of a sample of where it
// should (a single float sum would be off by a third of one), and a change
// of ratio only changes the step, never the position: no click.
//
// It is not safe for concurrent use: one goroutine (the ring writer) both
// writes and reads it.
type steeredResampler struct {
	channels int
	half     int
	table    []float64
	ratio    float64

	buf     []float64 // input history, interleaved
	bufBase int64     // input frame index of buf[0]
	inCount int64     // input frames received
	at      int64     // the next output frame's input position: whole frames
	frac    float64   // and the fraction, in [0, 1)
}

func newSteeredResampler(channels int) *steeredResampler {
	half := resampleHalfWidth
	cutoff := 0.5 * resampleRolloff
	return &steeredResampler{channels: channels, half: half, ratio: 1,
		table: resampleKernel(cutoff, half)}
}

// maxSteer bounds how far SetRatio moves from 1: a thousandth, five times
// the ±200 ppm the steering asks for, so a wild ratio from a bridge that has
// just re-seeded can't stall or race the position.
const maxSteer = 1e-3

// SetRatio sets how many input frames each output frame steps over, from the
// next output frame on, held within maxSteer of 1. A NaN is ignored.
func (r *steeredResampler) SetRatio(ratio float64) {
	if math.IsNaN(ratio) {
		return
	}
	r.ratio = min(max(ratio, 1-maxSteer), 1+maxSteer)
}

// Ratio is the step SetRatio last set.
func (r *steeredResampler) Ratio() float64 { return r.ratio }

// Write appends interleaved input frames: whole frames only, as a source
// delivers them.
func (r *steeredResampler) Write(in []float32) {
	for _, v := range in {
		r.buf = append(r.buf, float64(v))
	}
	r.inCount += int64(len(in) / r.channels)
}

// Buffered is how many input frames lie ahead of the next output frame's
// position: what the hand-over holds, which the caller steers on. It counts
// the kernel's half width that Read can't use yet, so steer it to a level
// above resampleHalfWidth.
func (r *steeredResampler) Buffered() float64 {
	return float64(r.inCount-r.at) - r.frac
}

// Read fills dst with as many interleaved output frames as the input written
// so far allows, answering how many. An output frame needs the kernel's half
// width of input past its position.
func (r *steeredResampler) Read(dst []float32) int {
	ch := r.channels
	taps := 2 * r.half
	n := 0
	for ; (n+1)*ch <= len(dst); n++ {
		if r.at+int64(r.half) >= r.inCount {
			break
		}
		row0, row1, w := kernelRows(r.table, taps, r.frac)
		first := r.at - int64(r.half) + 1
		for c := 0; c < ch; c++ {
			acc := 0.0
			for j := 0; j < taps; j++ {
				k := first + int64(j)
				if k < r.bufBase {
					continue // silence before the first frame
				}
				acc += r.buf[(k-r.bufBase)*int64(ch)+int64(c)] * (row0[j] + w*(row1[j]-row0[j]))
			}
			dst[n*ch+c] = float32(acc)
		}
		r.step()
	}
	// Drop history no future output can reach.
	if drop := r.at - int64(r.half) + 1 - r.bufBase; drop > 0 {
		k := min(drop*int64(ch), int64(len(r.buf)))
		r.buf = append(r.buf[:0], r.buf[k:]...)
		r.bufBase += k / int64(ch)
	}
	return n
}

// step moves the position on by one output frame.
func (r *steeredResampler) step() {
	r.frac += r.ratio
	whole := math.Floor(r.frac)
	r.at += int64(whole)
	r.frac -= whole
}

// Reset forgets every frame and starts again at the next one written: after
// a gap, when the input comes back on a new clock. The first frames after it
// are filtered against silence before them, a fade-in of a millisecond.
func (r *steeredResampler) Reset() {
	r.buf = r.buf[:0]
	r.bufBase, r.inCount, r.at, r.frac = 0, 0, 0, 0
}
