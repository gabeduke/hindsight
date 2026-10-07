package tape

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"io"
	"math"
)

// Listening away from the rig. The page asks for the loop -- or the whole
// tape -- as one stereo file, plays it on the phone, records over it with
// the phone recorder, and then places what it kept (PlaceTake). The jam
// room stays quiet: the tape on the Pi doesn't play.
//
// The mix is the tape as it sounds: every track at its level and pan,
// mutes and solos as they are, bus A and bus B summed, through the renderer
// the tape plays with. The loop is rendered as a pass after the first, so
// its seam is crossfaded as the tape crossfades it, and the file loops
// without a click. It's without the Sidekick: no strip EQ or FX.

// listenMaxFrames bounds a listen file: ten minutes, beyond any tape.
const listenMaxFrames = 10 * 60 * 48000

// Listen is a mix ready to write.
type Listen struct {
	From       int64 // the tape frame it starts at
	Frames     int64
	Loop       bool // it's the loop: play it round
	SampleRate int
	mix        *Mix
}

// Bytes is the file's length.
func (l *Listen) Bytes() int64 { return 44 + l.Frames*4 }

// Listen prepares the loaded tape's mix: the loop (with the loop on), or
// else from the start to the end of the last clip; all: the whole tape
// whatever the loop. click adds the tape's click on every beat.
func (e *Engine) Listen(id string, all, click bool) (*Listen, error) {
	t := e.Loaded()
	if t == nil {
		return nil, ErrNoTape
	}
	if t.ID != id {
		return nil, ErrWrongTape
	}
	sr := e.store.SampleRate()
	l := &Listen{SampleRate: sr}
	st := t.State
	if lp := t.Loop; !all && lp.On && lp.Out > lp.In {
		l.From, l.Frames, l.Loop = lp.In, lp.Out-lp.In, true
	} else {
		st.Loop = Loop{} // straight through
	}
	l.mix = NewMix(st, e.pool, sr)
	l.mix.click = click && t.Grid != nil
	if !l.Loop {
		l.Frames = l.mix.end
		if l.mix.click && l.Frames == 0 {
			l.Frames = int64(math.Round(t.Grid.BarFrames())) // an empty tape: a bar of click
		}
	}
	if l.Frames <= 0 || (l.mix.end == 0 && !l.mix.click) {
		return nil, fmt.Errorf("%w: there's nothing on the tape to hear; add the click to play along with it", ErrBadParameter)
	}
	if l.Frames > listenMaxFrames {
		return nil, fmt.Errorf("%w: that's %s, and a phone can be sent %d minutes at most",
			ErrBadParameter, clockText(l.Frames, sr), listenMaxFrames/48000/60)
	}
	return l, nil
}

// WriteTo writes it as a 16-bit stereo WAV, which every phone's browser
// decodes, at half the size of float.
func (l *Listen) WriteTo(dst io.Writer) (int64, error) {
	cw := &countWriter{w: dst}
	bw := bufio.NewWriterSize(cw, 1<<16)
	h := wav16Header(l.Frames, l.SampleRate)
	if _, err := bw.Write(h[:]); err != nil {
		return cw.n, err
	}
	const block = 4096
	buf := make([]float32, block*OutChannels)
	out := make([]byte, 0, block*4)
	le := binary.LittleEndian
	for off := int64(0); off < l.Frames; off += block {
		n := int(min64(block, l.Frames-off))
		clear(buf[:n*OutChannels])
		// As a pass after the first: In crossfades from what follows Out.
		l.mix.render(buf, l.From+off, n, l.Loop)
		out = out[:0]
		for i := 0; i < n; i++ {
			o := buf[i*OutChannels:]
			left, right := float64(o[0]+o[2]), float64(o[1]+o[3]) // both buses
			out = le.AppendUint16(out, uint16(to16(left)))
			out = le.AppendUint16(out, uint16(to16(right)))
		}
		if _, err := bw.Write(out); err != nil {
			return cw.n, err
		}
	}
	err := bw.Flush()
	return cw.n, err
}
