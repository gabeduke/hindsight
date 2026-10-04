package audio

import (
	"math"
	"testing"
)

// resampleAll runs in through a resampler in uneven pieces, as chunks
// arrive, and returns everything it produced.
func resampleAll(inRate, outRate int, in []float32) []float32 {
	r := newResampler(inRate, outRate, 2)
	var out []float32
	for i, step := 0, 0; i < len(in); i += step {
		step = 2 * (97 + (i/2)%311) // odd sizes, whole frames
		end := i + step
		if end > len(in) {
			end = len(in)
		}
		out = append(out, r.Process(in[i:end])...)
	}
	return append(out, r.Flush()...)
}

func TestResamplerUpsamplesATone(t *testing.T) {
	for _, tc := range []struct {
		in, out int
		freq    float64
	}{{44100, 48000, 1000}, {44100, 48000, 15000}, {32000, 48000, 440}, {96000, 48000, 1000}} {
		n := tc.in // one second
		got := resampleAll(tc.in, tc.out, tone(n, tc.in, tc.freq, 0))
		if len(got)/2 != tc.out {
			t.Errorf("%d→%d: %d frames, want %d", tc.in, tc.out, len(got)/2, tc.out)
			continue
		}
		worst := 0.0
		for i := 400; i < tc.out-400; i++ {
			v := math.Sin(2 * math.Pi * tc.freq * float64(i) / float64(tc.out))
			dl := math.Abs(float64(got[2*i]) - 0.5*v)
			dr := math.Abs(float64(got[2*i+1]) + 0.25*v)
			worst = math.Max(worst, math.Max(dl, dr))
		}
		if worst > 1e-3 {
			t.Errorf("%d→%d at %g Hz: worst error %.2g, want under 1e-3", tc.in, tc.out, tc.freq, worst)
		}
	}
}

func TestResamplerHoldsDCAndStartsOnTime(t *testing.T) {
	in := make([]float32, 2*4410)
	for i := range in {
		in[i] = 0.25
	}
	got := resampleAll(44100, 48000, in)
	// Past the first and last kernel widths, a held level comes out as is.
	for i := 100; i < len(got)/2-100; i++ {
		if math.Abs(float64(got[2*i])-0.25) > 1e-4 {
			t.Fatalf("frame %d = %v, want 0.25", i, got[2*i])
		}
	}
	// No delay: an impulse at input frame 441 (10 ms) peaks at output 480.
	imp := make([]float32, 2*4410)
	imp[2*441] = 1
	got = resampleAll(44100, 48000, imp)
	peak := 0
	for i := range got[:len(got)/2] {
		if got[2*i] > got[2*peak] {
			peak = i
		}
	}
	if peak != 480 {
		t.Errorf("impulse peaks at output frame %d, want 480", peak)
	}
}
