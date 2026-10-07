package audio

import (
	"math"
	"path/filepath"
	"strings"
	"testing"
)

// Normalize takes a span's peak to a decibel under full scale, boosting by
// no more than MaxNormalizeGainDB, and leaves silence alone (step C5).
func TestLevelForBringsThePeakToOneDecibelUnder(t *testing.T) {
	for _, c := range []struct {
		peak         float64
		peakDB, gain float64
	}{
		{0.5, -6, 4.5},                   // -6.02 dBFS: up 4.5 dB
		{1, 0, -1.5},                     // full scale: down 1.5 dB
		{math.Pow(10, -1.5/20), -1.5, 0}, // already there
		{0.001, -60, 24},                 // near silence: capped
		{0, silentDB, 0},                 // silence: nothing to bring up
	} {
		got := levelFor(c.peak)
		if got.PeakDB != c.peakDB || got.GainDB != c.gain {
			t.Errorf("levelFor(%v) = %+v, want peak %v gain %v", c.peak, got, c.peakDB, c.gain)
		}
	}
}

// LevelOf reads the span's peak from the pyramid when there is one, and
// from the WAV when not, and the two agree.
func TestLevelOfReadsTheSpansPeak(t *testing.T) {
	dir := t.TempDir()
	wav := writeTestTake(t, dir, "jam_l.wav", 48000) // frame i is ±i<<10
	fromWAV, err := LevelOf(wav, []int{0, 1}, 0, 24000)
	if err != nil {
		t.Fatal(err)
	}
	want := math.Round(20*math.Log10(float64(23999<<10)/(1<<31))*10) / 10
	if math.Abs(fromWAV.PeakDB-want) > 0.1 {
		t.Fatalf("peak = %v, want about %v", fromWAV.PeakDB, want)
	}
	if err := BuildPyramid(wav); err != nil {
		t.Fatal(err)
	}
	fromPyr, err := LevelOf(wav, []int{0, 1}, 0, 24000)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(fromPyr.PeakDB-fromWAV.PeakDB) > 0.1 || fromPyr.GainDB != MaxNormalizeGainDB {
		t.Fatalf("pyramid %+v vs WAV %+v", fromPyr, fromWAV)
	}
}

// A quiet span that ends a few frames before a loud entry is measured on its
// own frames, not on the pyramid's whole bucket that holds the entry too.
func TestLevelOfReadsOnlyTheSpanAtItsEdges(t *testing.T) {
	dir := t.TempDir()
	wav := filepath.Join(dir, "jam_e.wav")
	data := make([]int32, 2*96000)
	for i := 0; i < 96000; i++ {
		a := 0.1 // -20 dBFS, then -1 from frame 48000
		if i >= 48000 {
			a = 0.89
		}
		v := int32(a * math.MaxInt32 * math.Sin(2*math.Pi*441*float64(i)/48000))
		data[2*i], data[2*i+1] = v, v
	}
	if _, err := WriteWAV(wav, data, 2, []int{0, 1}, 48000); err != nil {
		t.Fatal(err)
	}
	if err := BuildPyramid(wav); err != nil {
		t.Fatal(err)
	}
	lv, err := LevelOf(wav, []int{0, 1}, 1000, 48000-15)
	if err != nil {
		t.Fatal(err)
	}
	if lv.PeakDB > -19.9 || lv.GainDB != 18.5 {
		t.Fatalf("level = %+v, want the quiet span's -20 dBFS and +18.5", lv)
	}
	// A whole cycle into the loud part, it counts.
	if lv, _ := LevelOf(wav, []int{0, 1}, 1000, 48000+120); lv.PeakDB < -1.2 {
		t.Fatalf("a cycle into the loud part: %+v, want about -1 dBFS", lv)
	}
}

func TestRenderArgsAppliesTheGainLast(t *testing.T) {
	info := WAVInfo{Channels: 2, SampleRate: 48000, BitsPerSample: 32}
	af := RenderArgs("/t.wav", info, []int{0, 1}, 0, 48000, 6.25)[6]
	if !strings.HasSuffix(af, ",volume=6.2dB") && !strings.HasSuffix(af, ",volume=6.3dB") {
		t.Fatalf("filter = %s, want the volume last", af)
	}
	if af := RenderArgs("/t.wav", info, []int{0, 1}, 0, 48000, 0)[6]; strings.Contains(af, "volume") {
		t.Fatalf("no gain, but %s", af)
	}
}
