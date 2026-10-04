package tape

import (
	"math"
	"math/cmplx"
	"math/rand"
	"testing"
)

func TestTheFFTMatchesTheDFT(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	const n = 64
	a := make([]complex128, n)
	for i := range a {
		a[i] = complex(r.Float64()-0.5, r.Float64()-0.5)
	}
	want := make([]complex128, n)
	for k := 0; k < n; k++ {
		for j := 0; j < n; j++ {
			want[k] += a[j] * cmplx.Exp(complex(0, -2*math.Pi*float64(j*k)/n))
		}
	}
	got := append([]complex128(nil), a...)
	fft(got, false)
	for k := range want {
		if cmplx.Abs(got[k]-want[k]) > 1e-9 {
			t.Fatalf("bin %d = %v, want %v", k, got[k], want[k])
		}
	}
	fft(got, true)
	for i := range a {
		if cmplx.Abs(got[i]-a[i]) > 1e-9 {
			t.Fatalf("round trip %d = %v, want %v", i, got[i], a[i])
		}
	}
}

// drums is a second of decaying noise hits, four a beat-ish, like a loop.
func drums(r *rand.Rand, n int) []float64 {
	x := make([]float64, n)
	for start := 0; start < n; start += 12000 {
		for i := 0; i < 6000 && start+i < n; i++ {
			x[start+i] = (r.Float64() - 0.5) * math.Exp(-float64(i)/900)
		}
	}
	return x
}

func TestTheCorrelationFindsTheTapeInTheTap(t *testing.T) {
	r := rand.New(rand.NewSource(2))
	const n, w, delay = 48000, 2400, 1234
	x := drums(r, n)
	// The tap: the tape a little quieter and dulled by the strip's EQ, with
	// an MPC in jack 1 playing something else on top.
	y := make([]float64, n+2*w)
	lp := 0.0
	for i := range y {
		if j := i - delay; j >= 0 && j < n {
			lp += 0.6 * (x[j] - lp)
		} else {
			lp *= 0.4
		}
		y[i] = 0.5*lp + 0.05*math.Sin(2*math.Pi*110*float64(i)/48000) + 0.02*(r.Float64()-0.5)
	}
	fit := findLag(x, y, 48)
	if fit.Lag != delay || !fit.Sharp() {
		t.Fatalf("fit = %+v, want lag %d and sharp", fit, delay)
	}
}

func TestASustainedToneIsNotGuessedAt(t *testing.T) {
	const n, w = 48000, 2400
	x := make([]float64, n)
	for i := range x {
		x[i] = 0.3 * math.Sin(2*math.Pi*220*float64(i)/48000)
	}
	y := make([]float64, n+2*w)
	for i := range y {
		y[i] = 0.3 * math.Sin(2*math.Pi*220*float64(i-700)/48000)
	}
	if fit := findLag(x, y, 48); fit.Sharp() {
		t.Fatalf("a pure tone locked: %+v", fit)
	}
	if fit := findLag(make([]float64, n), make([]float64, n+2*w), 48); fit.Sharp() {
		t.Fatalf("silence locked: %+v", fit)
	}
}

func TestTheCorrelationHoldsUnderAsMuchAgainOfSomethingElse(t *testing.T) {
	r := rand.New(rand.NewSource(3))
	const n, w, delay = 48000, 2400, 3001
	x := drums(r, n)
	other := drums(rand.New(rand.NewSource(4)), n+2*w) // another drum machine, as loud
	y := make([]float64, n+2*w)
	for i := range y {
		if j := i - delay; j >= 0 && j < n {
			y[i] = 0.7 * x[j]
		}
		y[i] += 0.7 * other[(i+5000)%len(other)]
	}
	fit := findLag(x, y, 48)
	if fit.Lag != delay || !fit.Sharp() {
		t.Fatalf("fit = %+v, want lag %d and sharp", fit, delay)
	}
}

func TestTheCorrelationLocksOnALoopWithBass(t *testing.T) {
	// A 96 BPM loop like the demo's: a strong 55 Hz bass under kick and hat.
	r := rand.New(rand.NewSource(6))
	const n, w, delay = 48000, 2400, 2042
	sig := make([]float64, 3*48000)
	for i := range sig {
		tt := float64(i) / 48000
		v := 0.4 * math.Sin(2*math.Pi*55*tt)
		if k := i % 30000; k < 3000 {
			v += 0.5 * math.Sin(2*math.Pi*60*float64(k)/48000) * math.Exp(-float64(k)/1200)
		}
		if k := i % 7500; k < 600 {
			v += 0.1 * (r.Float64() - 0.5) * math.Exp(-float64(k)/150)
		}
		sig[i] = v
	}
	x := sig[24000 : 24000+n]
	y := make([]float64, n+2*w)
	for i := range y {
		y[i] = 0.5 * sig[24000+i-delay]
	}
	fit := findLag(x, y, 48)
	if fit.Lag != delay || !fit.Sharp() {
		t.Fatalf("fit = %+v, want lag %d and sharp", fit, delay)
	}
}
