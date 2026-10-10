package audio

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/mono"
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
	// The ring is full and overwriting: a second's margin inside the oldest.
	if !got.Clamped || got.From != 48000*5 || got.To != 48000*6 {
		t.Fatalf("saved = %+v, want it to start a second inside the oldest frame", got)
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

// The reviewer's checks, kept: Range agrees with SnapshotAt everywhere, fails
// rather than hand out newer audio, and never tears a frame under a writer;
// a streamed save's files match a capture's byte for byte.

func TestRangeMatchesSnapshotEverywhere(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	for iter := 0; iter < 400; iter++ {
		capF := 1 + rng.Intn(300)
		ch := 1 + rng.Intn(4)
		r := NewRing(capF, ch)
		written := rng.Intn(1000)
		for next := 0; next < written; {
			n := 1 + rng.Intn(400)
			if next+n > written {
				n = written - next
			}
			b := make([]int32, n*ch)
			for f := 0; f < n; f++ {
				for c := 0; c < ch; c++ {
					b[f*ch+c] = int32((next+f)*10 + c)
				}
			}
			r.WriteFrames(b)
			next += n
		}
		oldest, total := r.Window()
		if total == 0 {
			continue
		}
		from := oldest + uint64(rng.Intn(int(total-oldest)))
		to := from + 1 + uint64(rng.Intn(int(total-from)))
		pick := []int{rng.Intn(ch), rng.Intn(ch)}
		var got []int32
		if err := r.Range(from, to, pick, func(c []int32) error { got = append(got, c...); return nil }); err != nil {
			t.Fatalf("iter %d: %v", iter, err)
		}
		for i := 0; i < int(to-from); i++ {
			f := int(from) + i
			for k, c := range pick {
				if got[i*len(pick)+k] != int32(f*10+c) {
					t.Fatalf("iter %d: frame %d ch %d = %d", iter, f, c, got[i*len(pick)+k])
				}
			}
		}
	}
}

func TestRangeFailsWhenOverwrittenBetweenChunks(t *testing.T) {
	capF := rangeChunkFrames * 3
	r := NewRing(capF, 1)
	r.WriteFrames(make([]int32, capF))
	calls := 0
	err := r.Range(0, uint64(capF), []int{0}, func(c []int32) error {
		calls++
		r.WriteFrames(make([]int32, rangeChunkFrames*3/2)) // the writer gets ahead
		return nil
	})
	if !errors.Is(err, ErrRangeGone) || calls != 1 {
		t.Fatalf("err %v after %d chunks", err, calls)
	}
}

func TestRangeNeverTearsAFrameUnderAWriter(t *testing.T) {
	r := NewRing(48000, 2)
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for f := 0; ; f += 256 {
			select {
			case <-stop:
				return
			default:
			}
			b := make([]int32, 256*2)
			for i := 0; i < 256; i++ {
				b[2*i], b[2*i+1] = int32(f+i), -int32(f+i)
			}
			r.WriteFrames(b)
		}
	}()
	for i := 0; i < 500; i++ {
		oldest, total := r.Window()
		if total-oldest < 10 {
			continue
		}
		err := r.Range(oldest+(total-oldest)/2, total, []int{1, 0}, func(c []int32) error {
			for k := 0; k+1 < len(c); k += 2 {
				if c[k] != -c[k+1] {
					return errors.New("torn frame")
				}
			}
			return nil
		})
		if err != nil && !errors.Is(err, ErrRangeGone) {
			t.Fatal(err)
		}
	}
	close(stop)
	wg.Wait()
}

func TestASpanSavesTheSameFilesAsACapture(t *testing.T) {
	cfg, cap, s := newSaveFixture(t)
	rng := rand.New(rand.NewSource(2))
	b := make([]int32, (48000*3+1234)*2)
	for i := range b {
		b[i] = int32(rng.Uint32())
	}
	cap.Ring().WriteFrames(b)
	name, err := s.Save(0)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.SaveRange(0, 0)
	if err != nil {
		t.Fatal(err)
	}
	a, c := filepath.Join(cfg.OutputDir, name), filepath.Join(cfg.OutputDir, got.Name)
	for _, p := range [][2]string{{a, c}, {peaksPath(a), peaksPath(c)}, {pyramidPath(a), pyramidPath(c)}} {
		x, err1 := os.ReadFile(p[0])
		y, err2 := os.ReadFile(p[1])
		if err1 != nil || err2 != nil || !bytes.Equal(x, y) {
			t.Errorf("%s differs from %s", filepath.Base(p[1]), filepath.Base(p[0]))
		}
	}
}

func TestASpanIsDatedAndTimedThroughTheClockBridge(t *testing.T) {
	cfg, cap, s := newSaveFixture(t)
	ft := &fakeTempo{bpm: 120, ok: true}
	s.SetTempoSource(ft)
	br := cap.Bridge()
	br.SetPipelineLatency(int64(200 * time.Millisecond))
	now := mono.Now()
	wall := time.Now() // the same moment, on the wall clock
	total := 48000 * 6
	for f := 256; f <= total; f += 256 {
		br.Record(now-int64(float64(total-f)/48000*1e9), uint64(f))
	}
	fillRing(cap, total)
	got, err := s.SaveRange(48000*1, 48000*3)
	if err != nil {
		t.Fatal(err)
	}
	m := ReadMeta(filepath.Join(cfg.OutputDir, got.Name))
	// Its last frame was converted 3 s before the bridge's newest, plus the
	// 0.2 s pipeline -- measured from that moment, not from after the save,
	// however long the save took.
	if ago := wall.Sub(*m.Created).Seconds(); ago < 3.15 || ago > 3.25 {
		t.Errorf("created %.3f s before the bridge's newest pair, want 3.2", ago)
	}
	if w := ft.gotEnd.Sub(ft.gotStart).Seconds(); w < 1.99 || w > 2.01 {
		t.Errorf("tempo window %.3f s, want the span's 2", w)
	}
}

func TestASpanNeverReusesADeletedTakesName(t *testing.T) {
	cfg, cap, s := newSaveFixture(t)
	fillRing(cap, 48000*4)
	first, err := s.SaveRange(48000*1, 48000*2)
	if err != nil {
		t.Fatal(err)
	}
	RemoveTake(cfg.OutputDir, first.Name)
	time.Sleep(1100 * time.Millisecond) // a new second, so only the past could collide
	second, err := s.SaveRange(48000*1+100, 48000*2)
	if err != nil {
		t.Fatal(err)
	}
	if second.Name == first.Name {
		t.Errorf("name %s reused for different audio", second.Name)
	}
}

func TestOverlappingSavesKeepSavingTrue(t *testing.T) {
	_, _, s := newSaveFixture(t)
	s.beginSave()
	s.beginSave()
	s.endSave()
	if !s.Saving() {
		t.Fatal("one save still running, but Saving() is false")
	}
	s.endSave()
	if s.Saving() {
		t.Fatal("Saving() true with nothing running")
	}
}

// fillRingWith writes frames whose channels carry vals, frame after frame.
func fillRingWith(c *Capture, frames int, vals ...int32) {
	b := make([]int32, 0, frames*len(vals))
	for f := 0; f < frames; f++ {
		b = append(b, vals...)
	}
	c.Ring().WriteFrames(b)
}

// SAVE_MIX=mono: both ways a take leaves the ring write the pair averaged,
// the same on both sides — at full scale too, where a plain sum would wrap.
func TestMonoMixAveragesThePairOntoBothSides(t *testing.T) {
	for _, tc := range []struct{ l, r, want int32 }{
		{1000, 3000, 2000},
		{math.MaxInt32, math.MaxInt32, math.MaxInt32},
		{math.MinInt32, math.MinInt32, math.MinInt32},
		{math.MaxInt32, math.MinInt32, 0}, // -0.5 truncates toward zero
	} {
		cfg, cap, s := newSaveFixture(t)
		cfg.SaveMix = "mono"
		fillRingWith(cap, 4800, tc.l, tc.r)
		name, err := s.Save(0)
		if err != nil {
			t.Fatal(err)
		}
		got, err := s.SaveRange(0, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, n := range []string{name, got.Name} {
			wav := filepath.Join(cfg.OutputDir, n)
			info, samples := readTake(t, wav)
			if info.Channels != 2 || info.Frames() != 4800 {
				t.Fatalf("%s is %d frames, %d ch", n, info.Frames(), info.Channels)
			}
			for i := 0; i < len(samples); i += 2 {
				if samples[i] != tc.want || samples[i+1] != tc.want {
					t.Fatalf("%d,%d: %s frame %d = %d,%d, want %d both sides",
						tc.l, tc.r, n, i/2, samples[i], samples[i+1], tc.want)
				}
			}
		}
		// The peaks describe what was written, not the inputs.
		raw, err := os.ReadFile(peaksPath(filepath.Join(cfg.OutputDir, name)))
		if err != nil {
			t.Fatal(err)
		}
		var pd PeakData
		if err := json.Unmarshal(raw, &pd); err != nil {
			t.Fatal(err)
		}
		want := float32(float64(tc.want) / 2147483648.0)
		if pd.Channels != 2 || pd.Data[0][1] != want || pd.Data[1][1] != want {
			t.Fatalf("peaks = %d ch, max %v/%v, want %v", pd.Channels, pd.Data[0][1], pd.Data[1][1], want)
		}
	}
}

// Stereo writes the pair as it is, and SAVE_ALL_CHANNELS ignores mono.
func TestMonoMixLeavesStereoAndAllChannelsAlone(t *testing.T) {
	for _, tc := range []struct {
		mix string
		all bool
	}{{"stereo", false}, {"mono", true}} {
		cfg, cap, s := newSaveFixture(t)
		cfg.SaveMix, cfg.SaveAllChannels = tc.mix, tc.all
		fillRingWith(cap, 4800, 1000, 3000)
		name, err := s.Save(0)
		if err != nil {
			t.Fatal(err)
		}
		got, err := s.SaveRange(0, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, n := range []string{name, got.Name} {
			_, samples := readTake(t, filepath.Join(cfg.OutputDir, n))
			if samples[0] != 1000 || samples[1] != 3000 || samples[len(samples)-1] != 3000 {
				t.Fatalf("%s/all=%v: %s starts %d,%d, want 1000,3000", tc.mix, tc.all, n, samples[0], samples[1])
			}
		}
	}
}
