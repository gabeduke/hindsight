package audio

import (
	"errors"
	"math"
	"path/filepath"
	"testing"
	"time"
)

// fillRing writes frames whose channel c carries frame*10+c, starting at the
// ring's current total.
func fillRing(c *Capture, frames int) {
	r := c.Ring()
	ch := r.Channels()
	start := int(r.TotalFrames())
	block := make([]int32, 0, 1000*ch)
	for f := start; f < start+frames; f++ {
		for k := 0; k < ch; k++ {
			block = append(block, int32(f*10+k))
		}
		if len(block) == cap(block) {
			r.WriteFrames(block)
			block = block[:0]
		}
	}
	if len(block) > 0 {
		r.WriteFrames(block)
	}
}

func TestSaveRangeSavesASpanThatEndedInThePast(t *testing.T) {
	cfg, cap, s := newSaveFixture(t) // 48 kHz, 10 s ring, stereo
	fillRing(cap, 48000*6)
	cap.Flags().Mark(48000 * 2) // inside the span
	cap.Flags().Mark(48000 * 5) // after it

	got, err := s.SaveRange(48000*1, 48000*3)
	if err != nil {
		t.Fatal(err)
	}
	if got.Clamped || got.From != 48000 || got.To != 48000*3 || got.Seconds != 2 {
		t.Fatalf("saved = %+v", got)
	}
	wav := filepath.Join(cfg.OutputDir, got.Name)
	info, samples := readTake(t, wav)
	if info.Frames() != 96000 || info.Channels != 2 {
		t.Fatalf("take is %d frames, %d ch", info.Frames(), info.Channels)
	}
	for _, i := range []int{0, 1, 50000, 95999} {
		f := int32(48000 + i)
		if samples[2*i] != f*10 || samples[2*i+1] != f*10+1 {
			t.Fatalf("frame %d = %d,%d", i, samples[2*i], samples[2*i+1])
		}
	}
	m := ReadMeta(wav)
	if len(m.Flags) != 1 || m.Flags[0].Frame != 48000 {
		t.Fatalf("flags = %+v, want the one inside, at 1 s into the take", m.Flags)
	}
	// Dated by when its last frame was played: 3 s of the 6 recorded ago.
	if m.Created == nil {
		t.Fatal("no created time")
	}
	if ago := time.Since(*m.Created).Seconds(); math.Abs(ago-3) > 0.5 {
		t.Fatalf("created %.2f s ago, want about 3", ago)
	}
	if !exists(peaksPath(wav)) || !exists(pyramidPath(wav)) {
		t.Error("the peaks and pyramid should be written as for any save")
	}
	if exists(PartPath(wav)) {
		t.Error(".part left behind")
	}
}

func TestSaveRangeMovesAStartThatAgedOut(t *testing.T) {
	_, cap, s := newSaveFixture(t)
	fillRing(cap, 48000*14) // 10 s ring: frames 4 s .. 14 s remain
	got, err := s.SaveRange(48000*1, 48000*6)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Clamped || got.From < 48000*4 || got.From > 48000*4+48000/4 || got.To != 48000*6 {
		t.Fatalf("saved = %+v, want it to start just inside the oldest frame", got)
	}
	// Wholly gone.
	if _, err := s.SaveRange(48000*1, 48000*3); !errors.Is(err, ErrRangeGone) {
		t.Fatalf("a span the ring no longer holds: %v", err)
	}
	// to == 0 is now.
	got, err = s.SaveRange(48000*12, 0)
	if err != nil || got.To != 48000*14 {
		t.Fatalf("to now = %+v %v", got, err)
	}
}

func TestSaveRangeWithNothingRecorded(t *testing.T) {
	_, _, s := newSaveFixture(t)
	if _, err := s.SaveRange(0, 0); !errors.Is(err, ErrNoAudio) {
		t.Fatalf("err = %v, want ErrNoAudio", err)
	}
}
