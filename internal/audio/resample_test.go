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

// An hour of frames at ±100 ppm, the most two USB crystals drift apart,
// lands within a thousandth of a sample of where it should: the position is
// kept as whole frames and a fraction. A single float64 sum is off by about
// 0.3 of a sample by then, which this fails.
func TestTheSteeredResamplerHoldsADriftForAnHour(t *testing.T) {
	const hour = 3600 * 48000
	for _, ppm := range []float64{100, -100} {
		r := newSteeredResampler(1)
		r.SetRatio(1 + ppm*1e-6)
		for i := 0; i < hour; i++ {
			r.step()
		}
		want := float64(hour) * (1 + ppm*1e-6)
		got := float64(r.at) + r.frac
		if math.Abs(got-want) > 1e-3 {
			t.Errorf("%+g ppm: an hour in, at input frame %.3f, want %.3f", ppm, got, want)
		}
	}
}

// A tone through a ratio that steps from -100 ppm to +200 ppm and back comes
// out as the same tone, its phase following the ratio, with no click where
// the ratio changes: every frame within 1e-3 of the tone it should be.
func TestTheSteeredResamplerChangesItsRatioWithoutAClick(t *testing.T) {
	const fs, freq, n = 48000.0, 997.0, 48000
	in := tone(n, fs, freq, 0) // stereo: 0.5 sin left, -0.25 sin right
	r := newSteeredResampler(2)
	ratios := []float64{1 - 100e-6, 1 + 200e-6, 1}
	var got []float32
	var pos []float64 // the input position each output frame was read at
	at := 0.0
	dst := make([]float32, 2*512)
	for i, block := 0, 0; i < len(in); i += 2 * 960 {
		r.Write(in[i:min(i+2*960, len(in))])
		r.SetRatio(ratios[(block/10)%len(ratios)])
		block++
		for {
			m := r.Read(dst)
			if m == 0 {
				break
			}
			for f := 0; f < m; f++ {
				got = append(got, dst[2*f], dst[2*f+1])
				pos = append(pos, at)
				at += r.Ratio()
			}
		}
	}
	if len(pos) < n-200 {
		t.Fatalf("%d frames out of %d in", len(pos), n)
	}
	worst := 0.0
	for f := 48; f < len(pos); f++ { // past the kernel's half width of silence before the start
		v := math.Sin(2 * math.Pi * freq * pos[f] / fs)
		worst = math.Max(worst, math.Abs(float64(got[2*f])-0.5*v))
		worst = math.Max(worst, math.Abs(float64(got[2*f+1])+0.25*v))
	}
	if worst > 1e-3 {
		t.Fatalf("worst error %.2g, want under 1e-3", worst)
	}
}

// Buffered is what the hand-over holds ahead of the next output frame, and
// Reset forgets it all.
func TestTheSteeredResamplerSaysWhatItHolds(t *testing.T) {
	r := newSteeredResampler(1)
	r.Write(make([]float32, 1000))
	if b := r.Buffered(); b != 1000 {
		t.Fatalf("buffered %v, want 1000", b)
	}
	m := r.Read(make([]float32, 100))
	if m != 100 || r.Buffered() != 900 {
		t.Fatalf("read %d, buffered %v; want 100, 900", m, r.Buffered())
	}
	if m := r.Read(make([]float32, 2000)); m != 900-resampleHalfWidth {
		t.Fatalf("read %d, want all but the kernel's half width: %d", m, 900-resampleHalfWidth)
	}
	r.Reset()
	if r.Buffered() != 0 || r.Read(make([]float32, 10)) != 0 {
		t.Fatal("Reset should forget every frame")
	}
}

// Reading in pieces, with the history trimmed after each, gives the same
// frames as one read of everything: the trim never drops a frame a later
// output still needs.
func TestTheSteeredResamplerTrimsOnlyWhatItHasUsed(t *testing.T) {
	in := tone(9600, 48000, 3001, 0)
	whole := newSteeredResampler(2)
	whole.SetRatio(1 + 150e-6)
	whole.Write(in)
	want := make([]float32, len(in))
	nw := whole.Read(want)

	r := newSteeredResampler(2)
	r.SetRatio(1 + 150e-6)
	var got []float32
	dst := make([]float32, 2*37)
	for i := 0; i < len(in); i += 2 * 101 {
		r.Write(in[i:min(i+2*101, len(in))])
		for m := r.Read(dst); m > 0; m = r.Read(dst) {
			got = append(got, dst[:2*m]...)
		}
	}
	if len(got)/2 != nw {
		t.Fatalf("%d frames in pieces, %d in one read", len(got)/2, nw)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("sample %d: %v in pieces, %v in one read", i, got[i], want[i])
		}
	}
}

// A ratio past a thousandth of 1 is held there, and a NaN changes nothing.
func TestTheSteeredResamplerHoldsItsRatioNearOne(t *testing.T) {
	r := newSteeredResampler(1)
	r.SetRatio(1.5)
	if r.Ratio() != 1+maxSteer {
		t.Fatalf("ratio %v, want %v", r.Ratio(), 1+maxSteer)
	}
	r.SetRatio(math.NaN())
	if r.Ratio() != 1+maxSteer {
		t.Fatalf("a NaN moved the ratio to %v", r.Ratio())
	}
	r.SetRatio(0)
	if r.Ratio() != 1-maxSteer {
		t.Fatalf("ratio %v, want %v", r.Ratio(), 1-maxSteer)
	}
}
