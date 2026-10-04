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
	path := e.store.AudioPath(c.File)
	info, err := audio.ReadWAVInfo(path)
	if err != nil {
		return nil, err
	}
	if c.Src < 0 || c.Src+c.Frames > info.Frames() {
		return nil, fmt.Errorf("%w: the clip runs past its audio", ErrBadParameter)
	}
	name := fmt.Sprintf("%s track %d", safeName(t.Name), tr.N)
	if c.Reversed != nil {
		name += " reversed"
	}
	return &ClipWAV{Name: name + ".wav", Frames: c.Frames, path: path, src: c.Src,
		gain: math.Pow(10, c.GainDB/20), sr: info.SampleRate, ch: info.Channels}, nil
}

// WriteTo writes the WAV.
func (w *ClipWAV) WriteTo(dst io.Writer) (int64, error) {
	bw := bufio.NewWriterSize(dst, 1<<16)
	le := binary.LittleEndian
	var h [44]byte
	copy(h[0:4], "RIFF")
	le.PutUint32(h[4:8], uint32(w.Bytes()-8))
	copy(h[8:12], "WAVE")
	copy(h[12:16], "fmt ")
	le.PutUint32(h[16:20], 16)
	le.PutUint16(h[20:22], 1)
	le.PutUint16(h[22:24], 2)
	le.PutUint32(h[24:28], uint32(w.sr))
	le.PutUint32(h[28:32], uint32(w.sr*4))
	le.PutUint16(h[32:34], 4)
	le.PutUint16(h[34:36], 16)
	copy(h[36:40], "data")
	le.PutUint32(h[40:44], uint32(w.Frames*4))
	if _, err := bw.Write(h[:]); err != nil {
		return 0, err
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
		return 0, err
	}
	return w.Bytes(), bw.Flush()
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
