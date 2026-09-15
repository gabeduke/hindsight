package bundle

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"sort"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/midi"
	"github.com/gabeduke/hindsight/internal/smf"
)

// ErrNoMIDI is a take with no .mid beside it.
var ErrNoMIDI = errors.New("take has no MIDI")

// ErrBadMIDI is a .mid that exists but does not decode.
var ErrBadMIDI = errors.New("MIDI file does not decode")

// Note is one note in the take's frames.
type Note struct {
	S int64 `json:"s"` // first frame
	E int64 `json:"e"` // frame after the last
	P int   `json:"p"` // MIDI pitch 0..127
	V int   `json:"v"` // velocity 1..127
}

// NoteTrack is one (device, channel) track of the .mid, as BuildSMF lays
// them out, with the server's drum/notes guess.
type NoteTrack struct {
	Name    string `json:"name"`
	Device  string `json:"device"`
	Channel int    `json:"channel"` // 1..16
	Kind    string `json:"kind"`    // "drums" or "notes"
	Notes   []Note `json:"notes"`
}

// TempoPoint is a tempo in force from Frame onwards.
type TempoPoint struct {
	Frame int64   `json:"frame"`
	BPM   float64 `json:"bpm"`
}

// NotesResponse is GET /api/midi.
type NotesResponse struct {
	PPQ           int          `json:"ppq"`
	SampleRate    int          `json:"sample_rate"`
	Frames        int64        `json:"frames"`
	Tempo         []TempoPoint `json:"tempo"`
	DownbeatFrame int64        `json:"downbeat_frame"`
	Tracks        []NoteTrack  `json:"tracks"`
}

// KindDrums and KindNotes are the two lane kinds.
const (
	KindDrums = "drums"
	KindNotes = "notes"
)

// maxDrumPitches is how many distinct pitches a track may use and still be
// guessed as drums: a pad grid, not a keyboard.
const maxDrumPitches = 16

// Notes decodes the take's .mid into notes on the take's frame timeline.
// Kind is the classifier's guess; the caller applies any sidecar override.
func Notes(wavPath string) (*NotesResponse, error) {
	b, err := os.ReadFile(audio.MIDIPath(wavPath))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrNoMIDI
		}
		return nil, err
	}
	f, err := smf.Decode(b)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBadMIDI, err)
	}
	info, err := audio.ReadWAVInfo(wavPath)
	if err != nil {
		return nil, err
	}
	rate := float64(info.SampleRate)
	frames := info.Frames()
	toFrame := func(sec float64) int64 {
		fr := int64(math.Round(sec * rate))
		if fr < 0 {
			return 0
		}
		if fr > frames {
			return frames
		}
		return fr
	}

	out := &NotesResponse{PPQ: int(f.PPQ), SampleRate: info.SampleRate, Frames: frames, Tempo: []TempoPoint{}, Tracks: []NoteTrack{}}
	if len(f.Tracks) == 0 {
		return out, nil
	}
	tempo := midi.FromConductor(f.Tracks[0], f.PPQ)
	for _, ev := range f.Tracks[0].Events {
		if us := ev.Tempo(); us != 0 {
			out.Tempo = append(out.Tempo, TempoPoint{Frame: toFrame(tempo.Seconds(ev.Tick)), BPM: 60e6 / float64(us)})
		}
	}

	var manifest Manifest
	if mb, err := os.ReadFile(audio.ManifestPath(wavPath)); err == nil {
		_ = json.Unmarshal(mb, &manifest)
	}
	if manifest.Downbeat != nil {
		out.DownbeatFrame = toFrame(manifest.Downbeat.Sec)
	}

	// Frames per beat at the take's middle, for the classifier.
	midBPM := tempo.BPMAt(float64(frames) / rate / 2)
	if midBPM <= 0 {
		midBPM = midi.FallbackBPM
	}
	framesPerBeat := rate * 60 / midBPM

	for _, tr := range f.Tracks[1:] {
		nt := decodeTrack(tr, tempo, toFrame, frames)
		if nt.Name == "" && len(nt.Notes) == 0 {
			continue
		}
		nt.Kind = classify(nt.Channel, nt.Notes, framesPerBeat)
		out.Tracks = append(out.Tracks, nt)
	}
	return out, nil
}

// decodeTrack pairs note-ons with note-offs. A note still sounding at the
// end of the file closes at the take's last frame.
func decodeTrack(tr smf.Track, tempo *midi.TempoMap, toFrame func(float64) int64, frames int64) NoteTrack {
	nt := NoteTrack{Notes: []Note{}, Channel: 0}
	type key struct{ ch, p int }
	open := map[key]Note{}
	for _, ev := range tr.Events {
		if ev.IsMeta() {
			if nt.Name == "" && ev.Meta == smf.MetaTrackName {
				nt.Name = ev.Text()
			}
			continue
		}
		kind := ev.Status & 0xF0
		if kind != 0x90 && kind != 0x80 {
			continue
		}
		ch := int(ev.Status&0x0F) + 1
		if nt.Channel == 0 {
			nt.Channel = ch
		}
		k := key{ch, int(ev.D1)}
		fr := toFrame(tempo.Seconds(ev.Tick))
		if kind == 0x90 && ev.D2 > 0 {
			if prev, ok := open[k]; ok { // retriggered without an off: close the first here
				prev.E = fr
				nt.Notes = append(nt.Notes, prev)
			}
			open[k] = Note{S: fr, P: int(ev.D1), V: int(ev.D2)}
			continue
		}
		if n, ok := open[k]; ok {
			n.E = fr
			nt.Notes = append(nt.Notes, n)
			delete(open, k)
		}
	}
	for _, n := range open {
		n.E = frames
		nt.Notes = append(nt.Notes, n)
	}
	sort.Slice(nt.Notes, func(i, j int) bool {
		if nt.Notes[i].S != nt.Notes[j].S {
			return nt.Notes[i].S < nt.Notes[j].S
		}
		return nt.Notes[i].P < nt.Notes[j].P
	})
	nt.Device = trackChannel.ReplaceAllString(nt.Name, "")
	return nt
}

// classify guesses a lane kind. Channel 10 is drums by convention.
// Otherwise a track is drums only when it uses few distinct pitches AND its
// notes are short: a sparse bass line has few pitches but long notes, a fast
// arpeggio has short notes but many pitches, and neither is a drum track.
func classify(channel int, notes []Note, framesPerBeat float64) string {
	if channel == 10 {
		return KindDrums
	}
	if len(notes) == 0 {
		return KindNotes
	}
	pitches := map[int]bool{}
	lens := make([]int64, 0, len(notes))
	for _, n := range notes {
		pitches[n.P] = true
		lens = append(lens, n.E-n.S)
	}
	if len(pitches) > maxDrumPitches {
		return KindNotes
	}
	sort.Slice(lens, func(i, j int) bool { return lens[i] < lens[j] })
	p90 := lens[(len(lens)*9)/10]
	if float64(p90) < framesPerBeat/4 {
		return KindDrums
	}
	return KindNotes
}
