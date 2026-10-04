package tape

import (
	"archive/zip"
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/gabeduke/hindsight/internal/smf"
)

// Export is the tape for a DAW: a stem per track with audio, rendered from
// tape frame 0 -- bar 1 -- to the end of the last clip, so every stem has
// the same length and they line up when dropped in at the start; and a .mid
// with the tempo, 4/4, and the loop's In and Out as markers. Each stem is the
// track at its own level and pan, through the same renderer the tape plays
// with; mutes and solos are left out of it, since a stem is for choosing
// that again.

// exportPPQ is the .mid's resolution.
const exportPPQ = 480

// exportMu lets one export render at a time: on a Pi, two at once would
// take the cores the capture shares.
var exportMu sync.Mutex

// Export is an export ready to write.
type Export struct {
	Name   string // the zip's name, from the tape's
	folder string
	frames int64
	sr     int
	stems  []stem
	mid    []byte
}

type stem struct {
	name string
	mix  *Mix
}

// ErrExporting is an export refused while another renders.
var ErrExporting = errors.New("another export is being made; try again when it's done")

// Export prepares the loaded tape's export. Only the loaded tape: its audio
// is the audio already in memory. A prepared export holds the one export
// slot until WriteZip has run, so call it.
func (e *Engine) Export(id string) (*Export, error) {
	t := e.Loaded()
	if t == nil {
		return nil, ErrNoTape
	}
	if t.ID != id {
		return nil, ErrWrongTape
	}
	if !exportMu.TryLock() {
		return nil, ErrExporting
	}
	x, err := e.prepareExport(t)
	if err != nil {
		exportMu.Unlock()
		return nil, err
	}
	return x, nil
}

func (e *Engine) prepareExport(t *Tape) (*Export, error) {
	sr := e.store.SampleRate()
	x := &Export{sr: sr, folder: safeName(t.Name)}
	x.Name = x.folder + " stems.zip"
	for i, tr := range t.Tracks {
		if len(tr.Clips) == 0 {
			continue
		}
		one := tr
		one.Bus, one.Mute, one.Solo = BusA, false, false
		m := NewMix(State{Tracks: []Track{one}}, e.pool, sr) // no loop: one pass, start to end
		if m.end > x.frames {
			x.frames = m.end
		}
		name := fmt.Sprintf("%d", i+1)
		if tr.Name != "" {
			name += " " + safeName(tr.Name)
		}
		x.stems = append(x.stems, stem{name: name, mix: m})
	}
	if len(x.stems) == 0 {
		return nil, fmt.Errorf("%w: there's nothing on the tape to export", ErrBadParameter)
	}
	if t.Grid != nil {
		x.mid = tempoMap(t, x.frames)
	}
	return x, nil
}

// tempoMap is a .mid with the tape's tempo, 4/4, and its loop as markers.
func tempoMap(t *Tape, frames int64) []byte {
	bpm := t.Grid.BPM(t.SampleRate)
	tick := func(f int64) uint64 {
		return uint64(math.Round(float64(f) / float64(t.SampleRate) * bpm / 60 * exportPPQ))
	}
	tr := smf.Track{Events: []smf.Event{
		smf.TrackName(0, t.Name),
		smf.Tempo(0, smf.USPerQuarter(bpm)),
		smf.TimeSignature(0, BeatsPerBar, 4),
	}}
	if l := t.Loop; l.Out > l.In {
		tr.Events = append(tr.Events, smf.Marker(tick(l.In), "In"), smf.Marker(tick(l.Out), "Out"))
	}
	tr.Events = append(tr.Events, smf.EndOfTrack(tick(frames)))
	f := &smf.File{PPQ: exportPPQ, Tracks: []smf.Track{tr}}
	return f.Encode()
}

// WriteZip renders the stems into a zip on w. A failure part way through
// leaves w with a truncated zip: check what can be checked before calling.
func (x *Export) WriteZip(w io.Writer) error {
	defer exportMu.Unlock()
	zw := zip.NewWriter(w)
	now := time.Now()
	for _, s := range x.stems {
		f, err := zw.CreateHeader(&zip.FileHeader{Name: x.folder + "/" + s.name + ".wav", Method: zip.Store, Modified: now})
		if err != nil {
			return err
		}
		if err := x.writeStem(f, s.mix); err != nil {
			return err
		}
	}
	if x.mid != nil {
		f, err := zw.CreateHeader(&zip.FileHeader{Name: x.folder + "/" + x.folder + ".mid", Method: zip.Deflate, Modified: now})
		if err != nil {
			return err
		}
		if _, err := f.Write(x.mid); err != nil {
			return err
		}
	}
	return zw.Close()
}

// writeStem renders one track to a 24-bit stereo WAV.
func (x *Export) writeStem(w io.Writer, m *Mix) error {
	bw := bufio.NewWriterSize(w, 1<<16)
	data := uint32(x.frames * 2 * 3)
	if err := writeWAV24Header(bw, data, 2, x.sr); err != nil {
		return err
	}
	const block = 4096
	buf := make([]float32, block*OutChannels)
	out := make([]byte, block*2*3)
	for pos := int64(0); pos < x.frames; pos += block {
		n := int(min64(block, x.frames-pos))
		clear(buf[:n*OutChannels])
		m.renderTape(buf, pos, n, false)
		for i := 0; i < n; i++ {
			put24(out[i*6:], buf[i*OutChannels])
			put24(out[i*6+3:], buf[i*OutChannels+1])
		}
		if _, err := bw.Write(out[:n*6]); err != nil {
			return err
		}
	}
	return bw.Flush()
}

// put24 writes a sample as 24-bit little-endian, saturated.
func put24(b []byte, v float32) {
	x := int32(math.Round(float64(v) * 8388607))
	if v >= 1 {
		x = 8388607
	} else if v <= -1 {
		x = -8388608
	}
	b[0], b[1], b[2] = byte(x), byte(x>>8), byte(x>>16)
}

func writeWAV24Header(w io.Writer, dataBytes uint32, channels, sampleRate int) error {
	le := binary.LittleEndian
	var b [44]byte
	copy(b[0:4], "RIFF")
	le.PutUint32(b[4:8], dataBytes+36)
	copy(b[8:12], "WAVE")
	copy(b[12:16], "fmt ")
	le.PutUint32(b[16:20], 16)
	le.PutUint16(b[20:22], 1) // PCM
	le.PutUint16(b[22:24], uint16(channels))
	le.PutUint32(b[24:28], uint32(sampleRate))
	le.PutUint32(b[28:32], uint32(sampleRate*channels*3))
	le.PutUint16(b[32:34], uint16(channels*3))
	le.PutUint16(b[34:36], 24)
	copy(b[36:40], "data")
	le.PutUint32(b[40:44], dataBytes)
	_, err := w.Write(b[:])
	return err
}

// safeName is a name fit for a file in a zip: no path separators or
// characters a desktop refuses.
func safeName(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "tape"
	}
	r := strings.NewReplacer("/", "-", "\\", "-", ":", "-", "*", "-", "?", "", "\"", "", "<", "", ">", "", "|", "-")
	s = r.Replace(s)
	s = strings.Trim(s, ". ")
	if s == "" {
		return "tape"
	}
	return s
}
