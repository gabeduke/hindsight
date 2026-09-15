package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/smf"
)

// midiFixture is one track, "bento ch1", four short notes on four pads at
// 120 BPM: the classifier calls it drums.
func midiFixture() []byte {
	f := &smf.File{PPQ: 480}
	f.Tracks = append(f.Tracks, smf.Track{Events: []smf.Event{
		smf.TrackName(0, "Hindsight tempo"),
		smf.Tempo(0, smf.USPerQuarter(120)),
		smf.EndOfTrack(1920),
	}})
	tr := smf.Track{Events: []smf.Event{smf.TrackName(0, "bento ch1")}}
	for i := 0; i < 4; i++ {
		tick := uint64(i) * 480
		tr.Events = append(tr.Events,
			smf.Channel(tick, 0x90, byte(36+i), 100),
			smf.Channel(tick+48, 0x80, byte(36+i), 0))
	}
	tr.Events = append(tr.Events, smf.EndOfTrack(1920))
	f.Tracks = append(f.Tracks, tr)
	return f.Encode()
}

func TestMIDIReturnsNotesInFrames(t *testing.T) {
	r, dir := newTestAPI(t)
	wav := writeRealTake(t, dir, "a.wav", 48000*2)
	os.WriteFile(audio.MIDIPath(wav), midiFixture(), 0o644)

	w := do(t, r, http.MethodGet, "/api/midi?file=a.wav")
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if cc := w.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", cc)
	}
	var body struct {
		SampleRate int `json:"sample_rate"`
		Tracks     []struct {
			Name  string `json:"name"`
			Kind  string `json:"kind"`
			Notes []struct {
				S, E int64
				P, V int
			} `json:"notes"`
		} `json:"tracks"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.SampleRate != 48000 || len(body.Tracks) != 1 || body.Tracks[0].Kind != "drums" {
		t.Fatalf("body = %s", w.Body)
	}
	n := body.Tracks[0].Notes
	if len(n) != 4 || n[1].S != 24000 || n[1].E != 26400 || n[1].P != 37 {
		t.Errorf("notes = %+v", n)
	}
}

func TestMIDIAppliesTheSidecarOverride(t *testing.T) {
	r, dir := newTestAPI(t)
	wav := writeRealTake(t, dir, "a.wav", 48000*2)
	os.WriteFile(audio.MIDIPath(wav), midiFixture(), 0o644)
	if w := patch(t, r, "a.wav", `{"lane_kinds":{"bento ch1":"notes"}}`); w.Code != http.StatusOK {
		t.Fatalf("patch: %d %s", w.Code, w.Body)
	}
	w := do(t, r, http.MethodGet, "/api/midi?file=a.wav")
	var body struct {
		Tracks []struct{ Kind string } `json:"tracks"`
	}
	json.Unmarshal(w.Body.Bytes(), &body)
	if len(body.Tracks) != 1 || body.Tracks[0].Kind != "notes" {
		t.Errorf("override not applied: %s", w.Body)
	}
}

func TestMIDIStatuses(t *testing.T) {
	r, dir := newTestAPI(t)
	if w := do(t, r, http.MethodGet, "/api/midi?file=../a.wav"); w.Code != http.StatusBadRequest {
		t.Errorf("traversal: %d", w.Code)
	}
	if w := do(t, r, http.MethodGet, "/api/midi?file=missing.wav"); w.Code != http.StatusNotFound {
		t.Errorf("missing take: %d", w.Code)
	}
	wav := writeRealTake(t, dir, "nomidi.wav", 48000)
	if w := do(t, r, http.MethodGet, "/api/midi?file=nomidi.wav"); w.Code != http.StatusNotFound {
		t.Errorf("no .mid: %d", w.Code)
	}
	os.WriteFile(audio.MIDIPath(wav), []byte("MThd nope"), 0o644)
	if w := do(t, r, http.MethodGet, "/api/midi?file=nomidi.wav"); w.Code != http.StatusUnprocessableEntity {
		t.Errorf("corrupt .mid: %d", w.Code)
	}
	_ = filepath.Base
}
