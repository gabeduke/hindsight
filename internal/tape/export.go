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
// with, as 32-bit float so nothing a track's gain adds can clip; mutes and
// solos are left out of it, since a stem is for choosing that again.

// exportPPQ is the .mid's resolution.
const exportPPQ = 480

// exportMu lets one export render at a time: on a Pi, two at once would
// take the cores the capture shares.
var exportMu sync.Mutex

// Export is an export ready to write.
type Export struct {
	Name    string // the zip's name, from the tape's
	folder  string
	frames  int64
	sr      int
	stems   []stem
	mid     []byte
	missing []string // pool files that couldn't be read
	beat    func()
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
	held := false
	defer func() {
		if !held {
			exportMu.Unlock() // refused, or panicked: the slot is free again
		}
	}()
	x, err := e.prepareExport(t)
	if err != nil {
		return nil, err
	}
	held = true
	return x, nil
}

// CheckExport says whether Export would succeed now, without rendering:
// for the page to ask before it starts a download.
func (e *Engine) CheckExport(id string) error {
	t := e.Loaded()
	if t == nil {
		return ErrNoTape
	}
	if t.ID != id {
		return ErrWrongTape
	}
	if t.Empty() {
		return fmt.Errorf("%w: there's nothing on the tape to export", ErrBadParameter)
	}
	if !exportMu.TryLock() {
		return ErrExporting
	}
	exportMu.Unlock()
	return nil
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
	// Audio that couldn't be read plays silent in its stem; say which.
	files := map[string]bool{}
	t.State.files(files)
	for _, f := range e.pool.Failed() {
		if files[f] {
			x.missing = append(x.missing, f)
		}
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

// WriteZip renders the stems into a zip on w, calling beat before each
// block it writes (nil: don't), so a caller can keep a deadline moving. A
// failure part way through leaves w with a truncated zip.
func (x *Export) WriteZip(w io.Writer, beat func()) error {
	defer exportMu.Unlock()
	x.beat = beat
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
	if len(x.missing) > 0 {
		f, err := zw.CreateHeader(&zip.FileHeader{Name: x.folder + "/MISSING.txt", Method: zip.Deflate, Modified: now})
		if err != nil {
			return err
		}
		msg := "These recordings couldn't be read, so their clips are silent in the stems:\n\n" + strings.Join(x.missing, "\n") + "\n"
		if _, err := io.WriteString(f, msg); err != nil {
			return err
		}
	}
	return zw.Close()
}

// writeStem renders one track to a 32-bit float stereo WAV.
func (x *Export) writeStem(w io.Writer, m *Mix) error {
	bw := bufio.NewWriterSize(w, 1<<16)
	data := uint32(x.frames * 2 * 4)
	if err := writeFloatWAVHeader(bw, data, 2, x.sr); err != nil {
		return err
	}
	const block = 4096
	buf := make([]float32, block*OutChannels)
	out := make([]byte, block*2*4)
	le := binary.LittleEndian
	for pos := int64(0); pos < x.frames; pos += block {
		if x.beat != nil {
			x.beat()
		}
		n := int(min64(block, x.frames-pos))
		clear(buf[:n*OutChannels])
		m.renderTape(buf, pos, n, false)
		for i := 0; i < n; i++ {
			l, r := buf[i*OutChannels], buf[i*OutChannels+1]
			if math.IsNaN(float64(l)) {
				l = 0
			}
			if math.IsNaN(float64(r)) {
				r = 0
			}
			le.PutUint32(out[i*8:], math.Float32bits(l))
			le.PutUint32(out[i*8+4:], math.Float32bits(r))
		}
		if _, err := bw.Write(out[:n*8]); err != nil {
			return err
		}
	}
	return bw.Flush()
}

// writeFloatWAVHeader is a WAVE_FORMAT_IEEE_FLOAT header with a fact chunk,
// as the format asks of anything not PCM.
func writeFloatWAVHeader(w io.Writer, dataBytes uint32, channels, sampleRate int) error {
	le := binary.LittleEndian
	var b [58]byte
	copy(b[0:4], "RIFF")
	le.PutUint32(b[4:8], dataBytes+50)
	copy(b[8:12], "WAVE")
	copy(b[12:16], "fmt ")
	le.PutUint32(b[16:20], 18)
	le.PutUint16(b[20:22], 3) // IEEE float
	le.PutUint16(b[22:24], uint16(channels))
	le.PutUint32(b[24:28], uint32(sampleRate))
	le.PutUint32(b[28:32], uint32(sampleRate*channels*4))
	le.PutUint16(b[32:34], uint16(channels*4))
	le.PutUint16(b[34:36], 32)
	le.PutUint16(b[36:38], 0) // no extension
	copy(b[38:42], "fact")
	le.PutUint32(b[42:46], 4)
	le.PutUint32(b[46:50], dataBytes/uint32(channels*4))
	copy(b[50:54], "data")
	le.PutUint32(b[54:58], dataBytes)
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
