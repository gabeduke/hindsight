package audio

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
)

// extraSaveFixture is a capture with one extra input on channels 2-3, whose
// joiner (played by the test) has written them up to where the ring is now,
// less the lag: what a KEEP pressed now finds.
func extraSaveFixture(t *testing.T, save []int) (*config.Config, *Capture, *Saver, uint64) {
	t.Helper()
	cfg := &config.Config{Channels: 2, SampleRate: 48000, FramesPerBuf: 256, RingSeconds: 10,
		InputLatencyMS: 100, SaveChannels: save, OutputDir: t.TempDir(), ExtraInputs: []string{"AMS-24"}}
	c := NewCapture(cfg, nil)
	c.AddExtraInputs([]ExtraSource{&fakeExtra{}})
	s := NewSaver(c)
	t.Cleanup(s.WaitBackground)
	head := uint64(2 * 48000)
	c.Ring().WriteNarrow(make([]int32, 2*head), 2)
	lag := c.ExtraLag()
	c.Ring().WriteChannels(0, 2, 2, filled(head-lag, 2, 1000))
	c.extras[0].written.Store(head - lag)
	return cfg, c, s, head
}

func filled(frames uint64, ch int, v int32) []int32 {
	b := make([]int32, int(frames)*ch)
	for i := range b {
		b[i] = v
	}
	return b
}

// joinLater plays the joiner catching up after the press: the main interface
// moves the head on by the lag first, then the extra input's last frames
// before the press are written, as the ring writer does them.
func joinLater(c *Capture, head uint64) {
	time.Sleep(100 * time.Millisecond) // the save has its snapshot by now
	lag := c.ExtraLag()
	c.Ring().WriteNarrow(make([]int32, 2*lag), 2)
	time.Sleep(30 * time.Millisecond) // the moment between the head moving and the joiner writing
	c.Ring().WriteChannels(head-lag, 2, 2, filled(lag, 2, 1000))
	c.extras[0].written.Store(head)
}

// A KEEP of an extra input's channels pressed now waits for them to be
// written up to the press: the take ends with the guitar, not with the
// lag's ~0.2 s of silence, and the take is still the press's window.
func TestAKeepOfAnExtraInputWaitsForItsLag(t *testing.T) {
	cfg, c, s, head := extraSaveFixture(t, []int{2, 3})
	go joinLater(c, head)
	name, err := s.Save(1)
	if err != nil {
		t.Fatal(err)
	}
	info, all := readTake(t, filepath.Join(cfg.OutputDir, name))
	if info.Frames() != 48000 {
		t.Fatalf("%d frames, want the second before the press", info.Frames())
	}
	for f := 0; f < 48000; f++ {
		if all[2*f] != 1000 {
			t.Fatalf("frame %d of %d is %d: the take lost the extra input's last %d frames", f, 48000, all[2*f], 48000-f)
		}
	}
}

// The same for a span saved from the ring that runs up to the head.
func TestASpanOfAnExtraInputWaitsForItsLag(t *testing.T) {
	cfg, c, s, head := extraSaveFixture(t, []int{2, 3})
	go joinLater(c, head)
	got, err := s.SaveRange(head-48000, head)
	if err != nil {
		t.Fatal(err)
	}
	_, all := readTake(t, filepath.Join(cfg.OutputDir, got.Name))
	for f := 0; f < len(all)/2; f++ {
		if all[2*f] != 1000 {
			t.Fatalf("frame %d is %d: the span lost the extra input's last frames", f, all[2*f])
		}
	}
}

// A KEEP of the whole ring, full, still gets the extra input's last frames:
// only the tail past the joiner is read again, so the ring overwriting its
// oldest frames while the KEEP waits doesn't cost the fix.
func TestAKeepOfAFullRingStillWaitsForTheExtraInput(t *testing.T) {
	cfg, c, s, _ := extraSaveFixture(t, []int{2, 3})
	r := c.Ring()
	more := uint64(r.Capacity()) // fill it: the KEEP starts at its oldest frame
	lag := c.ExtraLag()
	_, head := r.Window()
	r.WriteNarrow(make([]int32, 2*more), 2)
	r.WriteChannels(head+more-uint64(r.Capacity()), 2, 2, filled(uint64(r.Capacity())-lag, 2, 1000))
	c.extras[0].written.Store(head + more - lag)
	go joinLater(c, head+more)
	name, err := s.Save(0)
	if err != nil {
		t.Fatal(err)
	}
	_, all := readTake(t, filepath.Join(cfg.OutputDir, name))
	n := len(all) / 2
	for f := n - int(lag) - 100; f < n; f++ {
		if all[2*f] != 1000 {
			t.Fatalf("frame %d of %d is %d: the full ring's KEEP lost the extra input's end", f, n, all[2*f])
		}
	}
}
