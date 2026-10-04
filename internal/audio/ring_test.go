package audio

import (
	"errors"
	"sync"
	"testing"
)

func TestTotalFramesCountsEverythingEverWritten(t *testing.T) {
	r := NewRing(10, 2)
	if got := r.TotalFrames(); got != 0 {
		t.Errorf("TotalFrames on a fresh ring = %d, want 0", got)
	}
	r.WriteFrames(make([]int32, 4*2)) // 4 frames
	r.WriteFrames(make([]int32, 3*2)) // 3 frames
	if got := r.TotalFrames(); got != 7 {
		t.Errorf("TotalFrames = %d, want 7", got)
	}
}

func TestTotalFramesKeepsCountingPastCapacity(t *testing.T) {
	r := NewRing(4, 1)
	r.WriteFrames(make([]int32, 10))
	if got := r.TotalFrames(); got != 10 {
		t.Errorf("TotalFrames = %d, want 10 (not clamped to capacity)", got)
	}
	if got := r.BufferedFrames(); got != 4 {
		t.Errorf("BufferedFrames = %d, want 4", got)
	}
}

func TestSnapshotAtReportsTheWindowEnd(t *testing.T) {
	r := NewRing(100, 1)
	in := make([]int32, 10)
	for i := range in {
		in[i] = int32(i + 1)
	}
	r.WriteFrames(in)

	data, got, end := r.SnapshotAt(4)
	if got != 4 {
		t.Fatalf("frames = %d, want 4", got)
	}
	if end != 10 {
		t.Errorf("endFrame = %d, want 10", end)
	}
	// The newest 4 frames are 7,8,9,10.
	want := []int32{7, 8, 9, 10}
	for i, v := range want {
		if data[i] != v {
			t.Errorf("data[%d] = %d, want %d", i, data[i], v)
		}
	}
}

func TestSnapshotAtOnEmptyRingReportsZeroEnd(t *testing.T) {
	r := NewRing(10, 1)
	data, got, end := r.SnapshotAt(4)
	if data != nil || got != 0 || end != 0 {
		t.Errorf("SnapshotAt on empty ring = (%v, %d, %d), want (nil, 0, 0)", data, got, end)
	}
}

func TestSnapshotAtClampsToWhatIsBuffered(t *testing.T) {
	r := NewRing(100, 1)
	r.WriteFrames(make([]int32, 5))
	_, got, end := r.SnapshotAt(50)
	if got != 5 || end != 5 {
		t.Errorf("got (%d, %d), want (5, 5)", got, end)
	}
}

// TestSnapshotAtWrapsAroundRingBoundary exercises the wraparound branch where
// the snapshot data straddles the ring's circular boundary. The second memcpy
// is required to reassemble the window.
func TestSnapshotAtWrapsAroundRingBoundary(t *testing.T) {
	r := NewRing(4, 1)
	// Write frames valued 1..6; the ring wraps after 4 frames.
	// Buffer state after write: [5,6,3,4] with writePos=2.
	in := make([]int32, 6)
	for i := range in {
		in[i] = int32(i + 1)
	}
	r.WriteFrames(in)

	// SnapshotAt(4) must return the 4 newest frames: 3,4,5,6
	data, got, end := r.SnapshotAt(4)
	if got != 4 {
		t.Fatalf("frames = %d, want 4", got)
	}
	if end != 6 {
		t.Errorf("endFrame = %d, want 6", end)
	}
	want := []int32{3, 4, 5, 6}
	for i, v := range want {
		if data[i] != v {
			t.Errorf("data[%d] = %d, want %d", i, data[i], v)
		}
	}
}

// The whole point of SnapshotAt: the copy and its position must describe the
// same instant. If they were read separately a concurrent write could slip
// between them and every flag in the window would be off by that much.
// The data itself must agree with its reported position: the last sample in
// the window must match the absolute frame the window ends at.
func TestSnapshotAtIsConsistentUnderConcurrentWrites(t *testing.T) {
	r := NewRing(1000, 1)
	var wg sync.WaitGroup
	stop := make(chan struct{})
	var frameCounter uint64

	wg.Add(1)
	go func() {
		defer wg.Done()
		block := make([]int32, 8)
		for {
			select {
			case <-stop:
				return
			default:
				// Stamp each frame with its sequence number so we can verify
				// the data agrees with the reported position.
				for i := range block {
					block[i] = int32(frameCounter + uint64(i) + 1)
				}
				r.WriteFrames(block)
				frameCounter += uint64(len(block))
			}
		}
	}()

	for i := 0; i < 500; i++ {
		data, got, end := r.SnapshotAt(16)
		if uint64(got) > end {
			t.Fatalf("window of %d frames ends at absolute frame %d: the copy outruns the counter", got, end)
		}
		// The last sample in the window must match the absolute end position.
		// If the counter were read outside the lock, a concurrent write would
		// shift the window and this check would catch it immediately.
		if got > 0 && uint64(data[got-1]) != end {
			t.Fatalf("window ends at %d but its last sample is %d: data and position disagree", end, data[got-1])
		}
	}
	close(stop)
	wg.Wait()
}

// All-zero frames pass for any implementation, right or wrong: an all-zero
// input and a bug that skips the copy entirely (make([]int32, len(data)) and
// nothing more) are indistinguishable, and neither catches a window built from
// the wrong end of the buffer. Frames valued 1..5 pin both: Snapshot(3) must
// return the newest three, in order, not the oldest three and not zeros.
func TestSnapshotStillReturnsTwoValues(t *testing.T) {
	r := NewRing(10, 1)
	r.WriteFrames([]int32{1, 2, 3, 4, 5})
	data, got := r.Snapshot(3)
	if got != 3 || len(data) != 3 {
		t.Fatalf("Snapshot = (%d values, %d frames), want (3, 3)", len(data), got)
	}
	want := []int32{3, 4, 5}
	for i := range want {
		if data[i] != want[i] {
			t.Fatalf("data = %v, want %v", data, want)
		}
	}
}

// rangeAll collects Range's chunks.
func rangeAll(t *testing.T, r *Ring, from, to uint64, pick []int) ([]int32, error) {
	t.Helper()
	var got []int32
	err := r.Range(from, to, pick, func(c []int32) error { got = append(got, c...); return nil })
	return got, err
}

func TestRangeCopiesAbsoluteFramesOfTheChosenChannels(t *testing.T) {
	r := NewRing(100, 3)
	// Frame f carries f*10+c on channel c; write 250 frames so the ring has
	// wrapped twice and holds frames 150..249.
	for f := 0; f < 250; f += 10 {
		block := make([]int32, 0, 30)
		for i := f; i < f+10; i++ {
			for c := 0; c < 3; c++ {
				block = append(block, int32(i*10+c))
			}
		}
		r.WriteFrames(block)
	}
	got, err := rangeAll(t, r, 160, 240, []int{2, 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 80*2 {
		t.Fatalf("len = %d, want 160", len(got))
	}
	for i := 0; i < 80; i++ {
		f := int32(160 + i)
		if got[2*i] != f*10+2 || got[2*i+1] != f*10 {
			t.Fatalf("frame %d = %d,%d", f, got[2*i], got[2*i+1])
		}
	}
	if _, err := rangeAll(t, r, 149, 160, []int{0}); !errors.Is(err, ErrRangeGone) {
		t.Fatalf("a range older than the ring: %v", err)
	}
	if _, err := rangeAll(t, r, 240, 251, []int{0}); !errors.Is(err, ErrRangeGone) {
		t.Fatalf("a range newer than the ring: %v", err)
	}
}

func TestRangeSpansChunksAndStopsOnAnEmitError(t *testing.T) {
	frames := rangeChunkFrames*2 + 7
	r := NewRing(frames+10, 2)
	data := make([]int32, frames*2)
	for i := range data {
		data[i] = int32(i)
	}
	r.WriteFrames(data)
	chunks := 0
	var got []int32
	err := r.Range(0, uint64(frames), []int{0, 1}, func(c []int32) error {
		chunks++
		got = append(got, c...)
		return nil
	})
	if err != nil || chunks != 3 || len(got) != len(data) {
		t.Fatalf("chunks %d len %d err %v", chunks, len(got), err)
	}
	for i := range data {
		if got[i] != data[i] {
			t.Fatalf("sample %d = %d", i, got[i])
		}
	}
	stop := errors.New("disk full")
	if err := r.Range(0, uint64(frames), []int{0}, func([]int32) error { return stop }); !errors.Is(err, stop) {
		t.Fatalf("emit error = %v", err)
	}
}
