package audio

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// The peaks pyramid: min and max per 256-frame bucket for every channel of a
// take, as int16, in a small file beside it (<stem>.peaks.bin).
//
// The waveform page zooms by asking /api/peaks for ranges. Zoomed out on a
// long take, each of those spans hundreds of seconds, and computing it meant
// reading that much audio from the SD card -- most of a 15-minute take on the
// first zoom. With the pyramid, any request whose buckets are at least 256
// frames wide is answered from the pyramid -- about 1.3 MB for a whole
// 15-minute stereo take, and usually only a slice of that -- and only a deep
// zoom reads the WAV.
//
// It is built in the same loop that writes the WAV, at save and cut, so it
// costs no extra read; takes from before it existed are backfilled once, in
// the background, at startup.

const (
	// PyramidBase is the frames per bucket.
	PyramidBase = 256

	pyramidMagic   = "HPKB"
	pyramidVersion = 1
	// magic(4) version(2) channels(2) sampleRate(4) base(4) frames(8) buckets(8)
	pyramidHeaderBytes = 32
)

func pyramidPath(wav string) string { return strings.TrimSuffix(wav, ".wav") + ".peaks.bin" }

// pyramidAcc accumulates a pyramid as samples stream past, in any order.
type pyramidAcc struct {
	channels int
	frames   int64
	data     []int16 // per bucket: c0min, c0max, c1min, c1max, ...
}

func newPyramidAcc(channels int, frames int64) *pyramidAcc {
	buckets := (frames + PyramidBase - 1) / PyramidBase
	d := make([]int16, buckets*int64(channels)*2)
	for i := 0; i < len(d); i += 2 {
		d[i], d[i+1] = math.MaxInt16, math.MinInt16
	}
	return &pyramidAcc{channels: channels, frames: frames, data: d}
}

// add folds sample v of channel ch at frame into its bucket. The int16 min is
// rounded down and the max up, so a quantised bucket never claims less than
// the audio reached (bar a max within 1/32768 of full scale, which is clamped
// to the largest int16).
func (p *pyramidAcc) add(ch int, frame int64, v int32) {
	i := (frame/PyramidBase*int64(p.channels) + int64(ch)) * 2
	lo := int16(v >> 16)
	hi64 := (int64(v) + 0xFFFF) >> 16
	if hi64 > math.MaxInt16 {
		hi64 = math.MaxInt16
	}
	hi := int16(hi64)
	if lo < p.data[i] {
		p.data[i] = lo
	}
	if hi > p.data[i+1] {
		p.data[i+1] = hi
	}
}

// write writes the accumulated pyramid for a take at path wav, via a
// temporary file and a rename like every other sidecar.
func (p *pyramidAcc) write(wav string, sampleRate int) error {
	buckets := int64(0)
	if p.channels > 0 {
		buckets = int64(len(p.data)) / int64(p.channels*2)
	}
	// A bucket nothing was written into (it can't happen for a whole take,
	// but a zero-length one) reads as silence rather than as +max/-max.
	for i := 0; i < len(p.data); i += 2 {
		if p.data[i] > p.data[i+1] {
			p.data[i], p.data[i+1] = 0, 0
		}
	}
	buf := make([]byte, pyramidHeaderBytes+len(p.data)*2)
	copy(buf[0:4], pyramidMagic)
	le := binary.LittleEndian
	le.PutUint16(buf[4:], pyramidVersion)
	le.PutUint16(buf[6:], uint16(p.channels))
	le.PutUint32(buf[8:], uint32(sampleRate))
	le.PutUint32(buf[12:], PyramidBase)
	le.PutUint64(buf[16:], uint64(p.frames))
	le.PutUint64(buf[24:], uint64(buckets))
	for i, v := range p.data {
		le.PutUint16(buf[pyramidHeaderBytes+2*i:], uint16(v))
	}
	return writeFileAtomic(pyramidPath(wav), buf, ".pyramid-*.tmp")
}

// writeFileAtomic writes b to path through a temporary file in the same
// directory and a rename, with the takes directory's usual 0644.
func writeFileAtomic(path string, b []byte, pattern string) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), pattern)
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(name, 0o644); err != nil {
		return err
	}
	return os.Rename(name, path)
}

type pyramidHeader struct {
	channels, sampleRate, base int
	frames, buckets            int64
}

var errNoPyramid = errors.New("no usable peaks pyramid")

// openPyramid opens a take's pyramid and checks it describes the take as it
// is: same channels, same length. Anything else is treated as absent.
func openPyramid(wav string, info WAVInfo) (*os.File, pyramidHeader, error) {
	f, err := os.Open(pyramidPath(wav))
	if err != nil {
		return nil, pyramidHeader{}, errNoPyramid
	}
	var hb [pyramidHeaderBytes]byte
	if _, err := io.ReadFull(f, hb[:]); err != nil {
		f.Close()
		return nil, pyramidHeader{}, errNoPyramid
	}
	le := binary.LittleEndian
	h := pyramidHeader{
		channels:   int(le.Uint16(hb[6:])),
		sampleRate: int(le.Uint32(hb[8:])),
		base:       int(le.Uint32(hb[12:])),
		frames:     int64(le.Uint64(hb[16:])),
		buckets:    int64(le.Uint64(hb[24:])),
	}
	if string(hb[0:4]) != pyramidMagic || le.Uint16(hb[4:]) != pyramidVersion ||
		h.channels != info.Channels || h.frames != info.Frames() || h.base != PyramidBase ||
		h.buckets != (h.frames+PyramidBase-1)/PyramidBase {
		f.Close()
		return nil, pyramidHeader{}, errNoPyramid
	}
	return f, h, nil
}

// rangeFromPyramid answers a RangePeaks request from the pyramid. Bucket
// edges that don't fall on a 256-frame boundary take in the whole base bucket
// they cut, so an edge can show up to 255 frames (5 ms) of its neighbour's
// peak: invisible at the zoom levels this serves.
func rangeFromPyramid(wav string, info WAVInfo, from, to int64, buckets int, per int64) (*PeakData, error) {
	f, h, err := openPyramid(wav, info)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	ch := h.channels
	b0 := from / PyramidBase
	b1 := (to + PyramidBase - 1) / PyramidBase
	if b1 > h.buckets {
		b1 = h.buckets
	}
	if b1 <= b0 {
		return nil, errNoPyramid
	}
	raw := make([]byte, (b1-b0)*int64(ch)*4)
	if _, err := f.ReadAt(raw, pyramidHeaderBytes+b0*int64(ch)*4); err != nil {
		return nil, err
	}
	le := binary.LittleEndian
	at := func(b int64, c int) (int16, int16) {
		i := ((b-b0)*int64(ch) + int64(c)) * 4
		return int16(le.Uint16(raw[i:])), int16(le.Uint16(raw[i+2:]))
	}

	data := make([][]float32, ch)
	for c := range data {
		data[c] = make([]float32, 0, buckets*2)
	}
	for k := 0; k < buckets; k++ {
		s := from + int64(k)*per
		e := s + per
		if k == buckets-1 {
			e = to
		}
		lo := s / PyramidBase
		hi := (e + PyramidBase - 1) / PyramidBase
		if hi > b1 {
			hi = b1
		}
		for c := 0; c < ch; c++ {
			mn, mx := int16(math.MaxInt16), int16(math.MinInt16)
			for b := lo; b < hi; b++ {
				bmn, bmx := at(b, c)
				if bmn < mn {
					mn = bmn
				}
				if bmx > mx {
					mx = bmx
				}
			}
			if mn > mx {
				mn, mx = 0, 0
			}
			data[c] = append(data[c], float32(mn)/32768, float32(mx)/32768)
		}
	}
	return &PeakData{
		Version:    1,
		Channels:   ch,
		SampleRate: info.SampleRate,
		Duration:   float64(to-from) / float64(info.SampleRate),
		Buckets:    buckets,
		From:       from,
		Data:       data,
	}, nil
}

// pyramidLocks keeps two builds of the same take from racing.
var pyramidLocks sync.Map

// BuildPyramid makes a take's pyramid from its WAV, if it doesn't already
// have a usable one.
func BuildPyramid(wav string) error {
	v, _ := pyramidLocks.LoadOrStore(filepath.Clean(wav), &sync.Mutex{})
	mu := v.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()

	info, err := ReadWAVInfo(wav)
	if err != nil {
		return err
	}
	if info.BitsPerSample != 32 || info.Frames() == 0 {
		return fmt.Errorf("%s: not a 32-bit take", filepath.Base(wav))
	}
	if f, _, err := openPyramid(wav, info); err == nil {
		f.Close()
		return nil
	}
	acc := newPyramidAcc(info.Channels, info.Frames())
	ch := info.Channels
	if _, err := ReadFrames(wav, 0, info.Frames(), 1<<14, func(block []int32, first int64) error {
		n := len(block) / ch
		for i := 0; i < n; i++ {
			for c := 0; c < ch; c++ {
				acc.add(c, first+int64(i), block[i*ch+c])
			}
		}
		return nil
	}); err != nil {
		return err
	}
	if err := acc.write(wav, info.SampleRate); err != nil {
		return err
	}
	// The take may have been deleted while it was being read; don't leave
	// its pyramid behind as an orphan.
	if !exists(wav) {
		os.Remove(pyramidPath(wav))
	}
	return nil
}

// BackfillPyramids builds the pyramid for every take in dir that lacks one,
// one at a time. Run once in the background at startup: it reads each old
// take once, and every zoom after that is cheap.
func BackfillPyramids(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	built := 0
	for _, e := range entries {
		n := e.Name()
		if e.IsDir() || filepath.Ext(n) != ".wav" || strings.HasPrefix(n, ".") {
			continue
		}
		wav := filepath.Join(dir, n)
		if exists(pyramidPath(wav)) {
			continue
		}
		// Takes this can't make a pyramid for (a 16-bit WAV dropped in by
		// hand) are skipped quietly rather than complained about every boot;
		// their zooms read the WAV, as before.
		if info, err := ReadWAVInfo(wav); err != nil || info.BitsPerSample != 32 || info.Frames() == 0 {
			continue
		}
		// A breath between takes, so a backfill of many old takes doesn't
		// hold the SD card against a save that starts meanwhile.
		if built > 0 {
			time.Sleep(100 * time.Millisecond)
		}
		if err := BuildPyramid(wav); err != nil {
			log.Printf("[!] peaks pyramid for %s: %v", n, err)
			continue
		}
		built++
	}
	if built > 0 {
		log.Printf("[*] built peaks pyramids for %d older take(s)", built)
	}
}
