package tape

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"testing"

	"github.com/gabeduke/hindsight/internal/smf"
)

func TestAnExportIsAStemPerTrackFromBarOneAndATempoMap(t *testing.T) {
	e, _, tp, _ := firstLoop(t) // track 1: a 96000-frame ramp at 0
	e.Edit(tp.ID, "", func(_ *Tape, s *State) error {
		s.Tracks[0].Name = "chords/keys"
		s.Tracks[0].Mute = true // a stem ignores mutes
		// Track 3: the same audio a bar later, so the stems run to 192000.
		c := s.Tracks[0].Clips[0]
		c.ID, c.At = "", 96000
		_, err := s.Place(3, c, false)
		return err
	})
	x, err := e.Export(tp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Export(tp.ID); !errors.Is(err, ErrExporting) {
		t.Fatalf("a second export meanwhile = %v", err)
	}
	var buf bytes.Buffer
	beats := 0
	if err := x.WriteZip(&buf, func() { beats++ }); err != nil {
		t.Fatal(err)
	}
	if beats == 0 {
		t.Fatal("no heartbeat while it rendered")
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for _, f := range zr.File {
		r, _ := f.Open()
		b, _ := io.ReadAll(r)
		files[f.Name] = b
	}
	one, three, mid := files["test/1 chords-keys.wav"], files["test/3.wav"], files["test/test.mid"]
	if one == nil || three == nil || mid == nil || len(files) != 3 {
		t.Fatalf("zip has %d files: %v", len(files), keys(files))
	}
	// Both stems run from bar 1 to the end of the last clip: 192000 frames,
	// 32-bit float stereo.
	le := binary.LittleEndian
	for name, w := range map[string][]byte{"1": one, "3": three} {
		if got := le.Uint32(w[54:58]); got != 192000*8 || len(w) != 58+192000*8 || le.Uint16(w[20:22]) != 3 || le.Uint16(w[34:36]) != 32 {
			t.Fatalf("stem %s: %d data bytes, file %d", name, got, len(w))
		}
	}
	sample := func(w []byte, frame int) float32 {
		return math.Float32frombits(le.Uint32(w[58+frame*8:]))
	}
	// Track 1 sounds in the first bar (muted on the tape, not in its stem)
	// and is silent in the second; track 3 the other way round.
	if sample(one, 48000) == 0 || sample(one, 150000) != 0 || sample(three, 48000) != 0 || sample(three, 150000) == 0 {
		t.Fatalf("stems: 1 = %v, %v; 3 = %v, %v", sample(one, 48000), sample(one, 150000), sample(three, 48000), sample(three, 150000))
	}
	// The tempo map: the tape's tempo, and the loop as markers.
	f, err := smf.Decode(mid)
	if err != nil {
		t.Fatal(err)
	}
	var tempo uint32
	var markers []string
	for _, ev := range f.Tracks[0].Events {
		if v := ev.Tempo(); v != 0 {
			tempo = v
		}
		if ev.IsMeta() && ev.Meta == smf.MetaMarker {
			markers = append(markers, ev.Text())
		}
	}
	if want := smf.USPerQuarter(e.Loaded().Grid.BPM(48000)); tempo != want || len(markers) != 2 {
		t.Fatalf("mid: tempo %d want %d, markers %v", tempo, want, markers)
	}
	// The slot is free again.
	if x, err := e.Export(tp.ID); err != nil {
		t.Fatalf("after the first: %v", err)
	} else {
		x.WriteZip(io.Discard, nil)
	}
}

func TestAnEmptyTapeHasNothingToExport(t *testing.T) {
	e, _, tp := newEngine(t)
	if _, err := e.Export(tp.ID); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("empty = %v", err)
	}
	// And the slot wasn't kept.
	if _, err := e.Export(tp.ID); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("again = %v", err)
	}
}

func keys(m map[string][]byte) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}
