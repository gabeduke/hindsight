package api

import (
	"encoding/json"
	"net/http"
	"slices"
	"testing"
)

// Multi-arm (docs/superpowers/specs/2026-10-15-rig-design.md): rec_tracks
// arms several; rec_track still reads as the first and, written, still arms
// just that one, so an older page works through the change.
func TestRecTracksArmSeveralAndRecTrackStillArmsOne(t *testing.T) {
	r, _ := newTapeAPI(t)
	id := makeLoadedTape(t, r)
	type meta struct {
		Tape struct {
			RecTrack  int   `json:"rec_track"`
			RecTracks []int `json:"rec_tracks"`
		} `json:"tape"`
		Undo int `json:"undo"`
	}
	read := func() meta {
		var m meta
		json.Unmarshal(send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "").Body.Bytes(), &m)
		return m
	}
	if m := read(); m.Tape.RecTrack != 1 || !slices.Equal(m.Tape.RecTracks, []int{1}) {
		t.Fatalf("a new tape: %+v, want track 1 armed", m.Tape)
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_tracks":[3,2]}`), http.StatusOK, "arm 2 and 3")
	if m := read(); m.Tape.RecTrack != 2 || !slices.Equal(m.Tape.RecTracks, []int{2, 3}) || m.Undo != 0 {
		t.Fatalf("armed 2 and 3: %+v, want rec_track 2 and no undo step", m)
	}
	// An older page's rec_track arms just that one.
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_track":4}`), http.StatusOK, "rec_track 4")
	if m := read(); m.Tape.RecTrack != 4 || !slices.Equal(m.Tape.RecTracks, []int{4}) {
		t.Fatalf("rec_track 4: %+v, want just 4", m.Tape)
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_tracks":[]}`), http.StatusOK, "none armed")
	if m := read(); m.Tape.RecTrack != -1 || len(m.Tape.RecTracks) != 0 {
		t.Fatalf("none armed: %+v, want rec_track -1", m.Tape)
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_tracks":[1,9]}`), http.StatusBadRequest, "a track there isn't")
	if m := read(); len(m.Tape.RecTracks) != 0 {
		t.Fatalf("a refused arming changed it: %+v", m.Tape)
	}
	// The clone keeps what's armed.
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_tracks":[1,4]}`), http.StatusOK, "arm 1 and 4")
	w := send(t, r, http.MethodPost, "/api/tapes/clone?id="+id, "")
	var c struct {
		RecTracks []int `json:"rec_tracks"`
	}
	json.Unmarshal(w.Body.Bytes(), &c)
	if !slices.Equal(c.RecTracks, []int{1, 4}) {
		t.Fatalf("the clone armed %v", c.RecTracks)
	}
}

// The rig's fix for the tape in a tap moves several tracks to the other bus
// as one undoable edit.
func TestMovingSeveralTracksToABusIsOneUndo(t *testing.T) {
	r, _ := newTapeAPI(t)
	id := makeLoadedTape(t, r)
	w := send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"buses":[{"n":1,"bus":"b"},{"n":4,"bus":"B"}]}`)
	want(t, w, http.StatusOK, "move 1 and 4")
	s := stateOf(t, w)
	if s.Tape.Tracks[0].Bus != "B" || s.Tape.Tracks[3].Bus != "B" || s.Tape.Tracks[1].Bus != "A" || s.Undo != 1 {
		t.Fatalf("buses %s %s %s, undo %d", s.Tape.Tracks[0].Bus, s.Tape.Tracks[1].Bus, s.Tape.Tracks[3].Bus, s.Undo)
	}
	w = send(t, r, http.MethodPost, "/api/tapes/undo?id="+id, "")
	want(t, w, http.StatusOK, "undo")
	if s := stateOf(t, w); s.Tape.Tracks[0].Bus != "A" || s.Tape.Tracks[3].Bus != "A" {
		t.Fatal("one undo should put both back")
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"buses":[{"n":1,"bus":"B"},{"n":7,"bus":"B"}]}`), http.StatusBadRequest, "a track there isn't")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"buses":[{"n":1,"bus":"C"}]}`), http.StatusBadRequest, "a bus there isn't")
}
