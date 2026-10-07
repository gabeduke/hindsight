package tape

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"io"
	"math"

	"github.com/gabeduke/hindsight/internal/audio"
)

// ClipWAV is one clip as a file to share: its own audio, at its own level,
// with the 3 ms declick at either end, as a 16-bit stereo WAV -- what
// phones and messaging apps take. Neither the track's level nor its pan:
// it's the part, not the mix.
type ClipWAV struct {
	Name   string
	Frames int64
	path   string
	src    int64
	gain   float64
	sr     int
	ch     int
	// The clip's fades (Clip.fades), over the declick.
	fadeIn, fadeOut int64
}

// Bytes is the file's length.
func (w *ClipWAV) Bytes() int64 { return 44 + w.Frames*4 }

// ShareClip prepares a clip of the loaded tape (or any tape) for sharing.
func (e *Engine) ShareClip(id, clipID string) (*ClipWAV, error) {
	var t *Tape
	if l := e.Loaded(); l != nil && l.ID == id {
		t = l
	} else {
		var err error
		if t, err = e.store.Load(id); err != nil {
			return nil, err
		}
	}
	tr, c, err := t.Clip(clipID)
	if err != nil {
		return nil, err
	}
	return e.clipWAV(*c, fmt.Sprintf("%s track %d", t.Name, tr.N), c.GainDB)
}

// clipWAV prepares a clip's audio, at gainDB, as a WAV named for name.
func (e *Engine) clipWAV(c Clip, name string, gainDB float64) (*ClipWAV, error) {
	path := e.store.AudioPath(c.File)
	info, err := audio.ReadWAVInfo(path)
	if err != nil {
		return nil, err
	}
	if info.BitsPerSample != 32 {
		return nil, fmt.Errorf("%w: %d-bit audio in the pool", ErrBadParameter, info.BitsPerSample)
	}
	if c.Src < 0 || c.Src+c.Frames > info.Frames() {
		return nil, fmt.Errorf("%w: the clip runs past its audio", ErrBadParameter)
	}
	name = safeName(name)
	if c.Reversed != nil {
		name += " reversed"
	}
	in, out := c.fades()
	return &ClipWAV{Name: name + ".wav", Frames: c.Frames, path: path, src: c.Src,
		gain: math.Pow(10, gainDB/20), sr: info.SampleRate, ch: info.Channels, fadeIn: in, fadeOut: out}, nil
}

// WriteTo writes the WAV, and answers how much of it was written.
func (w *ClipWAV) WriteTo(dst io.Writer) (int64, error) {
	cw := &countWriter{w: dst}
	bw := bufio.NewWriterSize(cw, 1<<16)
	le := binary.LittleEndian
	h := wav16Header(w.Frames, w.sr)
	if _, err := bw.Write(h[:]); err != nil {
		return cw.n, err
	}
	fade := int64(declickSeconds * float64(w.sr))
	out := make([]byte, 0, 4*(1<<14))
	_, err := audio.ReadFrames(w.path, w.src, w.src+w.Frames, 1<<14, func(b []int32, first int64) error {
		out = out[:0]
		for i := 0; i < len(b)/w.ch; i++ {
			k := first - w.src + int64(i) // the clip's frame
			g := w.gain
			if k < fade {
				g *= (float64(k) + 0.5) / float64(fade)
			}
			if left := w.Frames - k; left <= fade {
				g *= (float64(left) - 0.5) / float64(fade)
			}
			if w.fadeIn > 0 || w.fadeOut > 0 {
				g *= fadeGain(k, w.Frames, w.fadeIn, w.fadeOut)
			}
			l := float64(b[i*w.ch]) / 2147483648.0
			r := l
			if w.ch > 1 {
				r = float64(b[i*w.ch+1]) / 2147483648.0
			}
			out = le.AppendUint16(out, uint16(to16(l*g)))
			out = le.AppendUint16(out, uint16(to16(r*g)))
		}
		_, err := bw.Write(out)
		return err
	})
	if err != nil {
		return cw.n, err
	}
	err = bw.Flush()
	return cw.n, err
}

// wav16Header is a 16-bit stereo PCM WAV's 44-byte header.
func wav16Header(frames int64, sampleRate int) [44]byte {
	le := binary.LittleEndian
	var h [44]byte
	copy(h[0:4], "RIFF")
	le.PutUint32(h[4:8], uint32(36+frames*4))
	copy(h[8:12], "WAVE")
	copy(h[12:16], "fmt ")
	le.PutUint32(h[16:20], 16)
	le.PutUint16(h[20:22], 1)
	le.PutUint16(h[22:24], 2)
	le.PutUint32(h[24:28], uint32(sampleRate))
	le.PutUint32(h[28:32], uint32(sampleRate*4))
	le.PutUint16(h[32:34], 4)
	le.PutUint16(h[34:36], 16)
	copy(h[36:40], "data")
	le.PutUint32(h[40:44], uint32(frames*4))
	return h
}

// countWriter counts what's written through it.
type countWriter struct {
	w io.Writer
	n int64
}

func (c *countWriter) Write(b []byte) (int, error) {
	n, err := c.w.Write(b)
	c.n += int64(n)
	return n, err
}

func to16(v float64) int16 {
	switch {
	case math.IsNaN(v):
		return 0
	case v >= 1:
		return math.MaxInt16
	case v <= -1:
		return math.MinInt16
	}
	return int16(math.Round(v * 32767))
}
