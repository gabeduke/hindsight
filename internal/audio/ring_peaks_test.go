package audio

import "testing"

func TestRingPeaksReadsTheLatestFramesOfEachChannel(t *testing.T) {
	r := NewRing(8, 2) // eight frames, so the writes below wrap
	r.WriteFrames([]int32{-2147483648, 0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0})
	// Six frames in. The newest four hold 100 in ch 0 and nothing in ch 1.
	if p := r.Peaks(4); p[0] != 100.0/2147483648.0 || p[1] != 0 {
		t.Fatalf("peaks = %v", p)
	}
	if p := r.Peaks(100); p[0] != 1 {
		t.Fatalf("all six: %v, want full scale in ch 0", p)
	}
	// Wrap: four more frames, the loudest one in ch 1 and negative.
	r.WriteFrames([]int32{0, 0, 0, -1073741824, 0, 0, 0, 0})
	if p := r.Peaks(4); p[0] != 0 || p[1] != 0.5 {
		t.Fatalf("after the wrap: %v", p)
	}
	if p := NewRing(4, 3).Peaks(4); len(p) != 3 || p[0] != 0 {
		t.Fatalf("empty ring: %v", p)
	}
}

func TestPeakDataPeak(t *testing.T) {
	pd := &PeakData{Data: [][]float32{{-0.25, 0.1}, {-0.5, 0.75}}}
	if p := pd.Peak(); p != 0.75 {
		t.Fatalf("peak = %v", p)
	}
	if p := (*PeakData)(nil).Peak(); p != 0 {
		t.Fatalf("nil peak = %v", p)
	}
}
