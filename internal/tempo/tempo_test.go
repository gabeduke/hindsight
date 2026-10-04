package tempo

import (
	"math"
	"math/rand"
	"testing"
)

const sr = 48000

// beats is seconds of audio at bpm: a decaying noise burst on every beat,
// louder on the first of four, each hit moved by up to jitterMS at random,
// over a noise floor at floorDB.
func beats(bpm, seconds, jitterMS, floorDB float64, seed int64) []float32 {
	return beatsAtRate(bpm, seconds, jitterMS, floorDB, seed, sr)
}

// beatsAtRate is like beats but at a specified sample rate.
func beatsAtRate(bpm, seconds, jitterMS, floorDB float64, seed int64, sampleRate int) []float32 {
	r := rand.New(rand.NewSource(seed))
	n := int(seconds * float64(sampleRate))
	x := make([]float32, n)
	floor := math.Pow(10, floorDB/20)
	for i := range x {
		x[i] = float32(floor * (r.Float64()*2 - 1))
	}
	beat := 60 / bpm * float64(sampleRate)
	for k := 0; ; k++ {
		at := int(float64(k)*beat + (r.Float64()*2-1)*jitterMS/1000*float64(sampleRate))
		if at >= n {
			break
		}
		amp := 0.5
		if k%4 == 0 {
			amp = 0.9
		}
		decayFactor := float64(sampleRate) * 0.02
		for i := 0; i < sampleRate/10 && at+i < n; i++ {
			if at+i < 0 {
				continue
			}
			x[at+i] += float32(amp * math.Exp(-float64(i)/decayFactor) * (r.Float64()*2 - 1))
		}
	}
	return x
}

func TestMeasure(t *testing.T) {
	cases := []struct {
		name      string
		bpm, hint float64
		want, tol float64
	}{
		{"off-grid, right hint", 125.25, 125.32, 125.25, 0.02},
		{"off-grid, no hint", 125.25, 0, 125.25, 0.02},
		{"a hint that's wrong is ignored", 125.25, 92, 125.25, 0.02},
		{"a half-time hint picks half time", 125.25, 62.6, 62.625, 0.02},
		{"slow", 83.47, 0, 83.47, 0.02},
		{"fast, double-time hint", 172.4, 172.4, 172.4, 0.03},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r, ok := Measure(beats(c.bpm, 60, 3, -50, 1), sr, c.hint)
			if !ok {
				t.Fatalf("no tempo")
			}
			if math.Abs(r.BPM-c.want) > c.tol {
				t.Errorf("BPM = %.3f, want %.3f ± %.2f (confidence %.2f)", r.BPM, c.want, c.tol, r.Confidence)
			}
		})
	}
}

// Across seeds and tempos in 80–160 (where no hint is needed to choose the
// octave), with and without a hint just off the true tempo.
func TestMeasureHoldsAcrossSeedsAndTempos(t *testing.T) {
	for seed := int64(1); seed <= 5; seed++ {
		for _, bpm := range []float64{82.3, 96, 125.25, 143.7, 158.4} {
			for _, hint := range []float64{0, bpm * 1.004} {
				r, ok := Measure(beats(bpm, 40, 5, -45, seed), sr, hint)
				if !ok || math.Abs(r.BPM-bpm) > 0.03 {
					t.Errorf("seed %d, %.2f BPM, hint %.2f: got %.3f (ok %v, confidence %.2f)", seed, bpm, hint, r.BPM, ok, r.Confidence)
				}
			}
		}
	}
}

func TestMeasureFindsNoTempoWithoutAPulse(t *testing.T) {
	r := rand.New(rand.NewSource(2))
	noise := make([]float32, 30*sr)
	for i := range noise {
		noise[i] = float32(0.3 * (r.Float64()*2 - 1))
	}
	sine := make([]float32, 30*sr)
	for i := range sine {
		sine[i] = float32(0.5 * math.Sin(2*math.Pi*220*float64(i)/sr))
	}
	for name, x := range map[string][]float32{"noise": noise, "a sine": sine, "silence": make([]float32, 30*sr), "too short": beats(120, 1, 0, -60, 3)} {
		if got, ok := Measure(x, sr, 120); ok {
			t.Errorf("%s: BPM %.2f (confidence %.2f), want no tempo", name, got.BPM, got.Confidence)
		}
	}
}

// Test that the algorithm works correctly at non-standard sample rates.
func TestMeasureAt44100Hz(t *testing.T) {
	r, ok := Measure(beatsAtRate(125.25, 60, 3, -50, 1, 44100), 44100, 0)
	if !ok {
		t.Fatalf("no tempo at 44100 Hz")
	}
	if math.Abs(r.BPM-125.25) > 0.02 {
		t.Errorf("BPM at 44100 Hz = %.3f, want 125.25 ± 0.02 (confidence %.2f)", r.BPM, r.Confidence)
	}
}

func TestMeasureAt22050Hz(t *testing.T) {
	r, ok := Measure(beatsAtRate(125.25, 60, 3, -50, 1, 22050), 22050, 0)
	if !ok {
		t.Fatalf("no tempo at 22050 Hz")
	}
	if math.Abs(r.BPM-125.25) > 0.02 {
		t.Errorf("BPM at 22050 Hz = %.3f, want 125.25 ± 0.02 (confidence %.2f)", r.BPM, r.Confidence)
	}
}

// Test that invalid sample rates are rejected without panicking.
func TestMeasureRejectsInvalidSampleRates(t *testing.T) {
	audio := beatsAtRate(120, 10, 2, -50, 1, 48000)
	for _, sr := range []int{0, 999} {
		_, ok := Measure(audio, sr, 120)
		if ok {
			t.Errorf("sample rate %d: expected false, got true", sr)
		}
	}
}
