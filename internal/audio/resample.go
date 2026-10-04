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
	taps := 2 * r.half
	r.table = make([]float64, (resamplePhases+1)*taps)
	for p := 0; p <= resamplePhases; p++ {
		frac := float64(p) / resamplePhases
		row := r.table[p*taps : (p+1)*taps]
		sum := 0.0
		for j := 0; j < taps; j++ {
			// Tap j sits at input offset k = j - half + 1 from floor(t); its
			// distance from t is k - frac.
			d := float64(j-r.half+1) - frac
			v := 2 * r.cutoff * sinc(2*r.cutoff*d) * kaiser(d/float64(r.half), resampleBeta)
			row[j] = v
			sum += v
		}
		// Unity gain at DC for every phase, so a held level stays put.
		for j := range row {
			row[j] /= sum
		}
	}
	return r
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
		fp := frac * resamplePhases
		p := int(fp)
		w := fp - float64(p)
		row0 := r.table[p*taps : (p+1)*taps]
		row1 := r.table[(p+1)*taps : (p+2)*taps]
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
