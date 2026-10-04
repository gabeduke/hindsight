package tape

import (
	"math"
	"math/bits"
	"math/cmplx"
)

// fft is an in-place iterative radix-2 FFT; len(a) must be a power of two.
// inverse runs the inverse transform, scaled by 1/n.
func fft(a []complex128, inverse bool) {
	n := len(a)
	if n <= 1 {
		return
	}
	shift := 64 - bits.TrailingZeros(uint(n))
	for i := 0; i < n; i++ {
		j := int(bits.Reverse64(uint64(i)) >> shift)
		if j > i {
			a[i], a[j] = a[j], a[i]
		}
	}
	sign := -1.0
	if inverse {
		sign = 1
	}
	for size := 2; size <= n; size <<= 1 {
		half := size >> 1
		step := cmplx.Exp(complex(0, sign*2*math.Pi/float64(size)))
		for start := 0; start < n; start += size {
			w := complex(1, 0)
			for k := 0; k < half; k++ {
				u, v := a[start+k], a[start+k+half]*w
				a[start+k], a[start+k+half] = u+v, u-v
				w *= step
			}
		}
	}
	if inverse {
		inv := complex(1/float64(n), 0)
		for i := range a {
			a[i] *= inv
		}
	}
}

func nextPow2(n int) int {
	p := 1
	for p < n {
		p <<= 1
	}
	return p
}

// lagFit is what a cross-correlation found.
type lagFit struct {
	Lag    int     // y[Lag+i] best matches x[i]
	Peak   float64 // the correlation there
	Second float64 // the best elsewhere, more than a millisecond away
	Floor  float64 // the RMS of the correlation over every lag searched
}

// Sharp reports whether the peak is one clear match: well above the floor,
// and well above any other candidate. A sustained, pitched sound correlates
// with itself every period, and fails the second test rather than being
// guessed at.
func (f lagFit) Sharp() bool {
	return f.Peak > 0 && f.Peak >= 6*f.Floor && f.Peak >= 1.6*f.Second
}

// findLag finds where in y a copy of x sits, by phase-transform-weighted
// (PHAT) cross-correlation, computed by FFT: the spectrum is whitened so the
// peak is a sharp spike whatever the material, and whatever else is in y --
// a matched filter. len(y) must be at least len(x); lags 0..len(y)-len(x) are
// searched. guard is how near the peak a second candidate may be and still
// count as the same one.
func findLag(x, y []float64, guard int) lagFit { return findLagWith(nil, x, y, guard) }

// xcorrScratch holds findLag's buffers between calls, so a caller that
// correlates every few seconds doesn't make megabytes of garbage each time.
type xcorrScratch struct{ X, Y []complex128 }

func (s *xcorrScratch) get(n int) ([]complex128, []complex128) {
	if s == nil {
		return make([]complex128, n), make([]complex128, n)
	}
	if cap(s.X) < n {
		s.X, s.Y = make([]complex128, n), make([]complex128, n)
	}
	X, Y := s.X[:n], s.Y[:n]
	clear(X)
	clear(Y)
	return X, Y
}

// findLagWith is findLag with reusable buffers (nil: fresh ones).
func findLagWith(s *xcorrScratch, x, y []float64, guard int) lagFit {
	n := nextPow2(len(y))
	if len(x) == 0 || len(y) < len(x) {
		return lagFit{}
	}
	// Twice differentiated first: a steep tilt up the spectrum, so a loop's
	// bass -- strong, and periodic within the search -- doesn't drown out
	// the attacks that pin the match down.
	X, Y := s.get(n)
	for i := 2; i < len(x); i++ {
		X[i] = complex(x[i]-2*x[i-1]+x[i-2], 0)
	}
	for i := 2; i < len(y); i++ {
		Y[i] = complex(y[i]-2*y[i-1]+y[i-2], 0)
	}
	fft(X, false)
	fft(Y, false)
	// R = Y·conj(X), whitened. A floor 40 dB under the strongest bin keeps
	// bins with next to no signal in them -- leakage, the edges of the
	// windows -- from being whitened up into a peak of their own.
	var maxMag float64
	for i := range X {
		Y[i] *= cmplx.Conj(X[i])
		if m := cmplx.Abs(Y[i]); m > maxMag {
			maxMag = m
		}
	}
	if maxMag == 0 {
		return lagFit{}
	}
	eps := maxMag * 1e-2
	for i := range Y {
		Y[i] /= complex(cmplx.Abs(Y[i])+eps, 0)
	}
	fft(Y, true)

	maxLag := len(y) - len(x)
	fit := lagFit{Lag: -1}
	var sum float64
	for k := 0; k <= maxLag; k++ {
		v := real(Y[k])
		sum += v * v
		if v > fit.Peak || fit.Lag < 0 {
			fit.Peak, fit.Lag = v, k
		}
	}
	fit.Floor = math.Sqrt(sum / float64(maxLag+1))
	for k := 0; k <= maxLag; k++ {
		if k >= fit.Lag-guard && k <= fit.Lag+guard {
			continue
		}
		if v := real(Y[k]); v > fit.Second {
			fit.Second = v
		}
	}
	return fit
}
