package audio

import (
	"errors"
	"sync"
)

// Ring is a fixed-capacity circular buffer of interleaved int32 frames.
//
// Exactly one goroutine writes to it (the ring writer started by Capture);
// readers take the mutex only long enough to memcpy a snapshot out, then do
// any deinterleaving on their own copy. The PortAudio callback never touches
// this type directly and so can never block on it.
type Ring struct {
	mu        sync.Mutex
	buf       []int32
	channels  int
	capFrames int

	writePos    int    // sample index of the next write
	totalFrames uint64 // frames ever written; saturates the ring once >= capFrames
}

func NewRing(capFrames, channels int) *Ring {
	return &Ring{
		buf:       make([]int32, capFrames*channels),
		channels:  channels,
		capFrames: capFrames,
	}
}

// WriteFrames appends a block and accounts for it in frames rather than samples.
func (r *Ring) WriteFrames(block []int32) {
	frames := len(block) / r.channels
	r.mu.Lock()
	n := len(r.buf)
	for len(block) > 0 {
		c := copy(r.buf[r.writePos:], block)
		block = block[c:]
		r.writePos = (r.writePos + c) % n
	}
	r.totalFrames += uint64(frames)
	r.mu.Unlock()
}

// BufferedFrames reports how many frames are currently retrievable.
func (r *Ring) BufferedFrames() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.bufferedLocked()
}

func (r *Ring) bufferedLocked() int {
	if r.totalFrames >= uint64(r.capFrames) {
		return r.capFrames
	}
	return int(r.totalFrames)
}

// Window reports the absolute frame range the ring holds right now,
// [oldest, total), under one lock acquisition. Pairing TotalFrames with
// BufferedFrames instead lets a write land between the two, and while the
// ring is still filling that makes buffered exceed total and the subtraction
// wrap.
func (r *Ring) Window() (oldest, total uint64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.totalFrames - uint64(r.bufferedLocked()), r.totalFrames
}

// TotalFrames reports how many frames have ever been written. It is monotonic
// for the life of the Ring, and the Ring is built once in NewCapture and never
// rebuilt -- supervise() reopens the stream, not the ring -- so this is a valid
// absolute clock across USB unplugs. Flags are stored against it.
//
// It advances only when audio arrives, so it stalls during a dropout. That is
// deliberate: a mark stays pinned to the audio rather than to wall clock.
func (r *Ring) TotalFrames() uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.totalFrames
}

// Snapshot copies the most recent `frames` frames out in chronological order.
// It clamps to what is actually buffered and returns the interleaved copy plus
// the frame count.
func (r *Ring) Snapshot(frames int) ([]int32, int) {
	data, got, _ := r.SnapshotAt(frames)
	return data, got
}

// SnapshotAt is Snapshot plus the absolute frame the window ends at, read under
// the same lock acquisition as the copy itself. Callers mapping absolute
// positions into the returned window must use this rather than pairing
// Snapshot with a separate TotalFrames call: a write landing between the two
// would shift the window out from under the position.
//
// The window covers absolute frames [endFrame-got, endFrame).
func (r *Ring) SnapshotAt(frames int) ([]int32, int, uint64) {
	r.mu.Lock()

	avail := r.bufferedLocked()
	if frames <= 0 || frames > avail {
		frames = avail
	}
	if frames == 0 {
		r.mu.Unlock()
		return nil, 0, 0
	}

	n := len(r.buf)
	want := frames * r.channels
	start := ((r.writePos-want)%n + n) % n

	out := make([]int32, want)
	c := copy(out, r.buf[start:])
	if c < want {
		copy(out[c:], r.buf[:want-c])
	}
	end := r.totalFrames

	r.mu.Unlock()
	return out, frames, end
}

// Peaks reports each channel's largest absolute sample over the most recent
// frames (fewer if the ring holds fewer), as a fraction of full scale: a
// meter's reading. It also answers TotalFrames as of the scan, so a caller
// can tell a reading of fresh audio from one of the last audio before a
// dropout. It scans in place under the lock, keeping each channel's min and
// max: a third of a second of eight channels takes about a millisecond on a
// Pi, and the writer has seconds of blocks in hand.
func (r *Ring) Peaks(frames int) ([]float64, uint64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]float64, r.channels)
	avail := r.bufferedLocked()
	if frames <= 0 || frames > avail {
		frames = avail
	}
	if frames == 0 {
		return out, r.totalFrames
	}
	lo := make([]int32, r.channels)
	hi := make([]int32, r.channels)
	n := len(r.buf)
	pos := ((r.writePos-frames*r.channels)%n + n) % n
	for f := 0; f < frames; f++ {
		for c, v := range r.buf[pos : pos+r.channels] {
			if v < lo[c] {
				lo[c] = v
			} else if v > hi[c] {
				hi[c] = v
			}
		}
		pos += r.channels
		if pos >= n {
			pos -= n
		}
	}
	for c := range out {
		out[c] = max(-float64(lo[c]), float64(hi[c])) / 2147483648.0
	}
	return out, r.totalFrames
}

// ErrRangeGone reports a range the ring doesn't hold: older than its oldest
// frame (overwritten), or newer than its newest (not recorded yet).
var ErrRangeGone = errors.New("that audio is no longer in the buffer")

// rangeChunkFrames is how much Range copies per lock: under a millisecond of
// memcpy, so the ring writer never waits on a long save.
const rangeChunkFrames = 1 << 15

// Range copies the absolute frames [from, to) out of the ring, only the
// channels in pick, in order, handing each chunk to emit (interleaved,
// len(pick) channels; the slice is reused, so emit must not keep it). It
// holds the lock for one chunk at a time and re-checks the window before
// each, so a long range costs the writer nothing, and a range that the ring
// overwrites while it is being copied fails with ErrRangeGone rather than
// handing out newer audio in its place.
//
// Today's SnapshotAt copies the most recent N frames of every channel under
// one lock; for a span of minutes that is the whole ring held while
// gigabytes move. This is what the ribbon's saves (and the tape's catches)
// use instead.
func (r *Ring) Range(from, to uint64, pick []int, emit func([]int32) error) error {
	if to <= from {
		return nil
	}
	for _, c := range pick {
		if c < 0 || c >= r.channels {
			return errors.New("channel out of range")
		}
	}
	out := make([]int32, rangeChunkFrames*len(pick))
	n := len(r.buf)
	for at := from; at < to; {
		frames := to - at
		if frames > rangeChunkFrames {
			frames = rangeChunkFrames
		}
		r.mu.Lock()
		oldest := r.totalFrames - uint64(r.bufferedLocked())
		if at < oldest || at+frames > r.totalFrames {
			r.mu.Unlock()
			return ErrRangeGone
		}
		// writePos is where frame totalFrames would go; count back from it.
		back := int(r.totalFrames-at) * r.channels
		pos := ((r.writePos-back)%n + n) % n
		k := 0
		for f := uint64(0); f < frames; f++ {
			for _, c := range pick {
				out[k] = r.buf[pos+c]
				k++
			}
			pos += r.channels
			if pos >= n {
				pos -= n
			}
		}
		r.mu.Unlock()
		if err := emit(out[:k]); err != nil {
			return err
		}
		at += frames
	}
	return nil
}

// Capacity returns the ring size in frames.
func (r *Ring) Capacity() int { return r.capFrames }

// Channels returns the interleave width.
func (r *Ring) Channels() int { return r.channels }
