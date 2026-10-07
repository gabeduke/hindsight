package audio

import (
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
)

// A block the ring writer couldn't take is a gap in the ring at the frame
// after the last one handed over; a burst of them at one frame is one gap,
// and a span counts a gap strictly inside it (step C4).
func TestADroppedBlockIsADropoutWhereTheGapIs(t *testing.T) {
	_, c, _ := newSaveFixture(t)
	block := make([]int32, 256*2)
	for i := 0; i < 4; i++ {
		c.processAudio(block) // 1024 frames handed over
	}
	for len(c.filled) < cap(c.filled) {
		c.filled <- block
	}
	c.processAudio(block)
	c.processAudio(block) // the same gap, still at 1024
	if got := c.Dropouts(0, 5000); !slices.Equal(got, []int64{1024}) {
		t.Fatalf("dropouts = %v, want [1024]", got)
	}
	if got := c.Dropouts(1000, 5000); !slices.Equal(got, []int64{24}) {
		t.Fatalf("from 1000 = %v, want [24]", got)
	}
	if got := c.Dropouts(1024, 5000); len(got) != 0 {
		t.Fatalf("a gap at a span's start is before its first frame: %v", got)
	}
	if got := c.Dropouts(0, 1024); len(got) != 0 {
		t.Fatalf("a gap at a span's end is after it: %v", got)
	}
}

// An overflow the interface reports is frames lost before this block: a gap
// just before it. The count the device already had when the capture first
// heard from it isn't one.
func TestAnOverflowTheDeviceReportsIsADropout(t *testing.T) {
	cfg := &config.Config{Channels: 2, SampleRate: 48000, FramesPerBuf: 256, RingSeconds: 10, SaveChannels: []int{0, 1}}
	src := NewDemoSource(cfg)
	src.(interface{ Overflow() }).Overflow() // before the capture ever heard from it
	c := NewCapture(cfg, src)
	block := make([]int32, 256*2)
	c.processAudio(block)
	if got := c.Dropouts(0, 10000); len(got) != 0 {
		t.Fatalf("an old count marked a dropout: %v", got)
	}
	src.(interface{ Overflow() }).Overflow()
	c.processAudio(block)
	c.processAudio(block)
	if got := c.Dropouts(0, 10000); !slices.Equal(got, []int64{256}) {
		t.Fatalf("dropouts = %v, want [256]", got)
	}
}

// The ring remembers the newest maxDropouts gaps.
func TestTheCaptureRemembersItsNewestDropouts(t *testing.T) {
	_, c, _ := newSaveFixture(t)
	for i := 0; i < maxDropouts+10; i++ {
		c.markDropout(uint64(100 + i))
	}
	got := c.Dropouts(0, 1<<20)
	if len(got) != maxDropouts || got[0] != 110 || got[len(got)-1] != int64(100+maxDropouts+9) {
		t.Fatalf("kept %d: %v…%v", len(got), got[0], got[len(got)-1])
	}
}

// A save, a span saved from the ring and a cut of a take each carry the gaps
// inside them, in their own frames.
func TestASaveAndACutCarryTheirDropouts(t *testing.T) {
	cfg, c, s := newSaveFixture(t)
	fillRing(c, 48000*6)
	c.markDropout(48000 * 2)   // inside both spans below
	c.markDropout(48000*5 + 7) // after the range, inside the last 2 s

	got, err := s.SaveRange(48000*1, 48000*3)
	if err != nil {
		t.Fatal(err)
	}
	if m := ReadMeta(filepath.Join(cfg.OutputDir, got.Name)); !slices.Equal(m.Dropouts, []int64{48000}) {
		t.Fatalf("range dropouts = %v, want [48000]", m.Dropouts)
	}
	name, err := s.Save(2)
	if err != nil {
		t.Fatal(err)
	}
	wav := filepath.Join(cfg.OutputDir, name)
	if m := ReadMeta(wav); !slices.Equal(m.Dropouts, []int64{48000 + 7}) {
		t.Fatalf("save dropouts = %v, want [48007]", m.Dropouts)
	}
	tk, err := ReadTake(cfg.OutputDir, name)
	if err != nil || !slices.Equal(tk.Dropouts, []int64{48007}) {
		t.Fatalf("the take's JSON: %v %v", tk.Dropouts, err)
	}

	cut, err := Cut(cfg.OutputDir, CutRequest{Source: name, StartFrame: 48000, EndFrame: 96000}, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if m := ReadMeta(filepath.Join(cfg.OutputDir, cut)); !slices.Equal(m.Dropouts, []int64{7}) {
		t.Fatalf("cut dropouts = %v, want [7]", m.Dropouts)
	}
}
