package bundle

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/smf"
)

// fixtureMIDI is a two-track file at 120 BPM for its first two beats and
// 60 BPM after: a quarter is 0.5 s, then 1 s. PPQ 480.
func fixtureMIDI(t *testing.T) []byte {
	t.Helper()
	f := &smf.File{PPQ: 480}
	f.Tracks = append(f.Tracks, smf.Track{Events: []smf.Event{
		smf.TrackName(0, "Hindsight tempo"),
		smf.TimeSignature(0, 4, 4),
		smf.Tempo(0, smf.USPerQuarter(120)),
		smf.Tempo(960, smf.USPerQuarter(60)),
		smf.EndOfTrack(4*960),
	}})
	// bento ch1: a note on beat 1 and a note on beat 3 (after the tempo change).
	f.Tracks = append(f.Tracks, smf.Track{Events: []smf.Event{
		smf.TrackName(0, "bento ch1"),
		smf.Channel(0, 0x90, 60, 100),
		smf.Channel(240, 0x80, 60, 0),
		smf.Channel(960, 0x90, 64, 64),
		smf.Channel(1440, 0x80, 64, 0),
		// A note-on with no note-off: must end at the take's last frame.
		smf.Channel(1920, 0x90, 67, 10),
		smf.EndOfTrack(4 * 960),
	}})
	return f.Encode()
}

func writeTakeWithMIDI(t *testing.T, mid []byte) string {
	t.Helper()
	dir := t.TempDir()
	wav := filepath.Join(dir, "jam_test.wav")
	writeWAVHeader(t, wav, rate) // 2 s of stereo at 48k, from exporter_test.go
	if mid != nil {
		if err := os.WriteFile(audio.MIDIPath(wav), mid, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return wav
}

func TestNotesConvertsTicksToFramesAcrossATempoChange(t *testing.T) {
	wav := writeTakeWithMIDI(t, fixtureMIDI(t))
	n, err := Notes(wav)
	if err != nil {
		t.Fatal(err)
	}
	if n.PPQ != 480 || n.SampleRate != rate || n.Frames != 2*rate {
		t.Fatalf("header = %+v", n)
	}
	if len(n.Tracks) != 1 || n.Tracks[0].Name != "bento ch1" || n.Tracks[0].Device != "bento" || n.Tracks[0].Channel != 1 {
		t.Fatalf("tracks = %+v", n.Tracks)
	}
	got := n.Tracks[0].Notes
	// beat 1 at 120: 0 .. 0.25 s; beat 3 at 120: 1.0 .. 1.5 s; tempo then changes to 60 BPM
	want := []Note{
		{S: 0, E: rate / 4, P: 60, V: 100},
		{S: rate, E: 2 * rate, P: 64, V: 64},
		{S: 2 * rate, E: 2 * rate, P: 67, V: 10}, // tick 1920 = 2.0 s; hanging, closed at the end
	}
	if len(got) != len(want) {
		t.Fatalf("notes = %+v\nwant %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("note %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	if len(n.Tempo) != 2 || n.Tempo[0] != (TempoPoint{0, 120}) || n.Tempo[1].Frame != rate || n.Tempo[1].BPM != 60 {
		t.Errorf("tempo = %+v", n.Tempo)
	}
}

func TestNotesWithoutAMIDIFileIsErrNoMIDI(t *testing.T) {
	wav := writeTakeWithMIDI(t, nil)
	if _, err := Notes(wav); !errors.Is(err, ErrNoMIDI) {
		t.Fatalf("err = %v, want ErrNoMIDI", err)
	}
}

func TestNotesWithACorruptMIDIFileIsErrBadMIDI(t *testing.T) {
	wav := writeTakeWithMIDI(t, []byte("MThd garbage"))
	if _, err := Notes(wav); !errors.Is(err, ErrBadMIDI) {
		t.Fatalf("err = %v, want ErrBadMIDI", err)
	}
}

func TestNotesReadsTheDownbeatFromTheManifest(t *testing.T) {
	wav := writeTakeWithMIDI(t, fixtureMIDI(t))
	os.WriteFile(audio.ManifestPath(wav), []byte(`{"version":1,"downbeat":{"seconds":0.5,"tick":240,"source":"midi-start"}}`), 0o644)
	n, err := Notes(wav)
	if err != nil {
		t.Fatal(err)
	}
	if n.DownbeatFrame != rate/2 {
		t.Errorf("downbeat_frame = %d, want %d", n.DownbeatFrame, rate/2)
	}
}

func TestClassify(t *testing.T) {
	fpb := 24000.0 // frames per beat at 120 BPM, 48k
	short := func(p, n int) []Note {
		out := make([]Note, n)
		for i := range out {
			out[i] = Note{S: int64(i) * 4800, E: int64(i)*4800 + 2400, P: 36 + (i % p), V: 100} // a tenth of a beat
		}
		return out
	}
	long := func(p, n int) []Note {
		out := make([]Note, n)
		for i := range out {
			out[i] = Note{S: int64(i) * 48000, E: int64(i)*48000 + 24000, P: 36 + (i % p), V: 100} // a whole beat
		}
		return out
	}
	cases := []struct {
		name  string
		ch    int
		notes []Note
		want  string
	}{
		{"channel 10 is drums whatever it plays", 10, long(30, 40), "drums"},
		{"few pitches, short notes", 1, short(4, 40), "drums"},
		{"few pitches, long notes: a bass line", 2, long(4, 40), "notes"},
		{"many pitches, short notes: an arpeggio", 3, short(24, 40), "notes"},
		{"exactly sixteen pitches still counts as drums", 1, short(16, 64), "drums"},
		{"empty track is notes", 1, nil, "notes"},
	}
	for _, c := range cases {
		if got := classify(c.ch, c.notes, fpb); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}
