package audio

import (
	"math"
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
		{0.5, -6, 5},                   // -6.02 dBFS: up 5 dB
		{1, 0, -1},                     // full scale: down a decibel
		{math.Pow(10, -1.0/20), -1, 0}, // already there
		{0.001, -60, 24},               // near silence: capped
		{0, silentDB, 0},               // silence: nothing to bring up
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
