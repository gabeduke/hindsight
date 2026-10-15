package api

import (
	"encoding/json"
	"net/http"
	"slices"
	"testing"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/tape"
	"github.com/gorilla/mux"
)

// newTapeAPIWithAPI is newTapeAPI, with the API itself to reach into.
func newTapeAPIWithAPI(t *testing.T) (*mux.Router, *API) {
	t.Helper()
	cfg := &config.Config{OutputDir: t.TempDir(), SampleRate: 48000, SaveChannels: []int{0, 1}}
	store, err := tape.OpenStore(t.TempDir(), 48000, 4, 60)
	if err != nil {
		t.Fatal(err)
	}
	eng := tape.NewEngine(tape.Options{Store: store})
	if err := eng.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(eng.Stop)
	a := New(cfg, nil, nil, nil, nil)
	a.SetTape(eng)
	t.Cleanup(a.WaitBackground)
	r := mux.NewRouter()
	a.SetupRoutes(r)
	return r, a
}

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

// Review: while ● Rec is armed or a punch runs, what's armed and the
// punch's inputs stay as they began -- on the Pi, so the rig and every
// page get the refusal the tape page has always made for itself.
func TestArmingAndAPunchsInputsWaitWhileItRecords(t *testing.T) {
	r, a := newTapeAPIWithAPI(t)
	id := makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_tracks":[2,3],"inputs":[{"n":2,"source":"ch1"},{"n":3,"source":"ch2"}]}`), http.StatusOK, "arm 2 and 3")
	a.recordingHook = func() *tape.Recording {
		return &tape.Recording{Tape: id, Track: 2, Source: "ch1", State: "on", Pairs: []tape.Pair{{Track: 2, Source: "ch1"}, {Track: 3, Source: "ch2"}}}
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_tracks":[2,3,4]}`), http.StatusConflict, "arm another mid-punch")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_track":2}`), http.StatusConflict, "an older page's rec_track mid-punch")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"input":{"n":3,"source":"aux"}}`), http.StatusConflict, "move the punch's input")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"input":{"n":4,"source":"aux"}}`), http.StatusOK, "another track's input")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_tracks":[3,2]}`), http.StatusOK, "the same tracks again")
	var m struct {
		Tape struct {
			RecTracks []int    `json:"rec_tracks"`
			Inputs    []string `json:"inputs"`
		} `json:"tape"`
	}
	json.Unmarshal(send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "").Body.Bytes(), &m)
	if !slices.Equal(m.Tape.RecTracks, []int{2, 3}) || m.Tape.Inputs[2] != "ch2" {
		t.Fatalf("after the refusals: %+v", m.Tape)
	}
	// Once it's over, they move again.
	a.recordingHook = func() *tape.Recording { return nil }
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_tracks":[4]}`), http.StatusOK, "after the punch")
}
