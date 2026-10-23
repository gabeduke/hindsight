package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/tape"
	"github.com/gorilla/mux"
)

// newTapeAPI builds an API with a tape engine that has no output and no
// capture: tapes can be made, edited and dropped onto, but nothing plays and
// nothing can be caught.
func newTapeAPI(t *testing.T) (*mux.Router, string) {
	t.Helper()
	dir := t.TempDir()
	cfg := &config.Config{OutputDir: dir, SampleRate: 48000, SaveChannels: []int{0, 1}}
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
	return r, dir
}

func want(t *testing.T, w *httptest.ResponseRecorder, code int, what string) {
	t.Helper()
	if w.Code != code {
		t.Fatalf("%s: status %d, want %d (%s)", what, w.Code, code, w.Body.String())
	}
}

type tapeStateBody struct {
	Tape struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Grid *struct {
			Frames int64 `json:"frames"`
			Bars   int   `json:"bars"`
		} `json:"grid"`
		Tracks []struct {
			Bus   string `json:"bus"`
			Mute  bool   `json:"mute"`
			Clips []struct {
				ID     string `json:"id"`
				File   string `json:"file"`
				Src    int64  `json:"src"`
				Frames int64  `json:"frames"`
				At     int64  `json:"at"`
			} `json:"clips"`
		} `json:"tracks"`
	} `json:"tape"`
	Loaded bool    `json:"loaded"`
	Undo   int     `json:"undo"`
	Redo   int     `json:"redo"`
	BPM    float64 `json:"bpm"`
}

func stateOf(t *testing.T, w *httptest.ResponseRecorder) tapeStateBody {
	t.Helper()
	var s tapeStateBody
	if err := json.Unmarshal(w.Body.Bytes(), &s); err != nil {
		t.Fatalf("state: %v (%s)", err, w.Body.String())
	}
	return s
}

// makeLoadedTape creates a tape and loads it, returning its id.
func makeLoadedTape(t *testing.T, r *mux.Router) string {
	t.Helper()
	w := send(t, r, http.MethodPost, "/api/tapes", `{"name":"Song one"}`)
	want(t, w, http.StatusOK, "create")
	var made struct {
		ID string `json:"id"`
	}
	json.Unmarshal(w.Body.Bytes(), &made)
	want(t, send(t, r, http.MethodPost, "/api/tapes/load?id="+made.ID, ""), http.StatusOK, "load")
	return made.ID
}

// The tape page's Rename sheet sends only a name. It must stick, be kept out
// of undo (the guide says a rename isn't a step), and an empty or blank name
// must leave the old one alone.
func TestARenamedTapeKeepsItsNameAndStaysOutOfUndo(t *testing.T) {
	r, _ := newTapeAPI(t)
	id := makeLoadedTape(t, r)

	w := send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"name":"  Bedtime loops  "}`)
	want(t, w, http.StatusOK, "rename")
	s := stateOf(t, w)
	if s.Tape.Name != "Bedtime loops" {
		t.Fatalf("name %q, want %q", s.Tape.Name, "Bedtime loops")
	}
	if s.Undo != 0 {
		t.Fatalf("a rename took an undo step: %d", s.Undo)
	}

	w = send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"name":"   "}`)
	want(t, w, http.StatusOK, "blank rename")
	if got := stateOf(t, w).Tape.Name; got != "Bedtime loops" {
		t.Fatalf("a blank name changed it to %q", got)
	}
}

// The record track and the tracks' inputs: set from any device, kept with
// the tape and its clones, never a step of undo, and only real tracks and
// inputs.
func TestTheRecordTrackAndInputsStickAndStayOutOfUndo(t *testing.T) {
	r, _ := newTapeAPI(t)
	id := makeLoadedTape(t, r)
	type meta struct {
		Tape struct {
			RecTrack int      `json:"rec_track"`
			Inputs   []string `json:"inputs"`
		} `json:"tape"`
	}
	read := func() meta {
		var m meta
		json.Unmarshal(send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "").Body.Bytes(), &m)
		return m
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_track":3}`), http.StatusOK, "arm track 3")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"input":{"n":3,"source":"ch1"}}`), http.StatusOK, "track 3 from ch1")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"input":{"n":1,"source":"aux"}}`), http.StatusOK, "track 1 from aux")
	if m := read(); m.Tape.RecTrack != 3 || len(m.Tape.Inputs) != 3 || m.Tape.Inputs[0] != "aux" || m.Tape.Inputs[1] != "" || m.Tape.Inputs[2] != "ch1" {
		t.Fatalf("after setting: %+v", m.Tape)
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_track":9}`), http.StatusBadRequest, "a track there isn't")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_track":0}`), http.StatusBadRequest, "track 0")
	// -1 disarms them all, and a track arms again.
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_track":-1}`), http.StatusOK, "disarm")
	if m := read(); m.Tape.RecTrack != -1 {
		t.Fatalf("disarmed: %+v", m.Tape)
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_track":3}`), http.StatusOK, "arm track 3 again")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"input":{"n":2,"source":"guitar"}}`), http.StatusBadRequest, "an input there isn't")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"input":{"n":7,"source":"aux"}}`), http.StatusBadRequest, "a track there isn't, for an input")
	// Several at once, all or none.
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"inputs":[{"n":2,"source":"ch2"},{"n":4,"source":"main"}]}`), http.StatusOK, "two at once")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"inputs":[{"n":2,"source":"aux"},{"n":4,"source":"guitar"}]}`), http.StatusBadRequest, "one there isn't")
	if m := read(); len(m.Tape.Inputs) != 4 || m.Tape.Inputs[1] != "ch2" || m.Tape.Inputs[3] != "main" {
		t.Fatalf("several at once: %+v", m.Tape.Inputs)
	}
	// "" leaves a track with none of its own.
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"input":{"n":4,"source":""}}`), http.StatusOK, "clear track 4's")
	if m := read(); m.Tape.Inputs[3] != "" {
		t.Fatalf("cleared: %+v", m.Tape.Inputs)
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"input":{"n":4,"source":"main"}}`), http.StatusOK, "track 4 from main again")
	// An undoable change, then undo: the record track and inputs stay.
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"track":{"n":2,"mute":true}}`), http.StatusOK, "mute")
	want(t, send(t, r, http.MethodPost, "/api/tapes/undo?id="+id, ""), http.StatusOK, "undo")
	if m := read(); m.Tape.RecTrack != 3 || m.Tape.Inputs[2] != "ch1" {
		t.Fatalf("undo took them back: %+v", m.Tape)
	}
	// A clone keeps them.
	w := send(t, r, http.MethodPost, "/api/tapes/clone?id="+id, "")
	want(t, w, http.StatusOK, "clone")
	var c struct {
		RecTrack int      `json:"rec_track"`
		Inputs   []string `json:"inputs"`
	}
	json.Unmarshal(w.Body.Bytes(), &c)
	if c.RecTrack != 3 || len(c.Inputs) != 4 || c.Inputs[2] != "ch1" {
		t.Fatalf("the clone: %s", w.Body.String())
	}
}

func TestTapeRoutesAnswer404WhenTheTapeIsOff(t *testing.T) {
	r, _ := newTestAPI(t)
	want(t, send(t, r, http.MethodGet, "/api/tapes", ""), http.StatusNotFound, "list")
	want(t, send(t, r, http.MethodPost, "/api/tapes", `{}`), http.StatusNotFound, "create")
}

func TestATapesTempoTracksAndUndo(t *testing.T) {
	r, _ := newTapeAPI(t)
	id := makeLoadedTape(t, r)

	var list struct {
		Loaded string `json:"loaded"`
		Tapes  []struct {
			ID string `json:"id"`
		} `json:"tapes"`
	}
	w := send(t, r, http.MethodGet, "/api/tapes", "")
	json.Unmarshal(w.Body.Bytes(), &list)
	if list.Loaded != id || len(list.Tapes) != 1 {
		t.Fatalf("list = %+v, want the one tape loaded", list)
	}

	// An empty tape takes a tempo: 120 BPM, 2 bars is 4 s.
	w = send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"tempo":{"bpm":120,"bars":2}}`)
	want(t, w, http.StatusOK, "tempo")
	if s := stateOf(t, w); s.Tape.Grid == nil || s.Tape.Grid.Frames != 192000 || s.Tape.Grid.Bars != 2 || s.BPM != 120 {
		t.Fatalf("grid = %+v bpm %v", s.Tape.Grid, s.BPM)
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"tempo":{"bpm":2,"bars":2}}`), http.StatusBadRequest, "silly tempo")

	// A track: mute it, then undo and redo.
	w = send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"track":{"n":2,"mute":true}}`)
	want(t, w, http.StatusOK, "mute")
	if s := stateOf(t, w); !s.Tape.Tracks[1].Mute || s.Undo != 2 {
		t.Fatalf("track 2 = %+v, undo %d", s.Tape.Tracks[1], s.Undo)
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"track":{"n":2,"bus":"C"}}`), http.StatusBadRequest, "bus C")
	// A PATCH is all or nothing: a bad clip leaves the mute alone.
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"track":{"n":3,"mute":true},"clip":{"id":"nope","gain_db":0}}`), http.StatusBadRequest, "half bad")
	if s := stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "")); s.Tape.Tracks[2].Mute {
		t.Fatal("half a refused PATCH was applied")
	}
	// Edits go to the loaded tape only.
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id=2026-01-01_other", `{"track":{"n":1,"mute":true}}`), http.StatusConflict, "other tape")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"track":{"n":9,"mute":true}}`), http.StatusBadRequest, "track 9")
	w = send(t, r, http.MethodPost, "/api/tapes/undo?id="+id, "")
	want(t, w, http.StatusOK, "undo")
	if s := stateOf(t, w); s.Tape.Tracks[1].Mute || s.Redo != 1 {
		t.Fatalf("after undo: muted %v redo %d", s.Tape.Tracks[1].Mute, s.Redo)
	}
	w = send(t, r, http.MethodPost, "/api/tapes/redo?id="+id, "")
	want(t, w, http.StatusOK, "redo")
	if !stateOf(t, w).Tape.Tracks[1].Mute {
		t.Fatal("redo should mute track 2 again")
	}
	want(t, send(t, r, http.MethodPost, "/api/tapes/redo?id="+id, ""), http.StatusConflict, "nothing to redo")

	// The loaded tape can't be deleted; a clone can.
	want(t, send(t, r, http.MethodDelete, "/api/tapes?id="+id, ""), http.StatusConflict, "delete loaded")
	w = send(t, r, http.MethodPost, "/api/tapes/clone?id="+id, "")
	want(t, w, http.StatusOK, "clone")
	var clone struct {
		ID string `json:"id"`
	}
	json.Unmarshal(w.Body.Bytes(), &clone)
	if clone.ID == "" || clone.ID == id {
		t.Fatalf("clone id %q", clone.ID)
	}
	want(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+clone.ID, ""), http.StatusOK, "clone state")
	want(t, send(t, r, http.MethodDelete, "/api/tapes?id="+clone.ID, ""), http.StatusOK, "delete clone")
	want(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+clone.ID, ""), http.StatusNotFound, "deleted clone")
}

func TestTheTransportAndCatchesRefuseWhatTheyCant(t *testing.T) {
	r, _ := newTapeAPI(t)
	id := makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodPost, "/api/tapes/transport?id="+id, `{"action":"fly"}`), http.StatusBadRequest, "bad action")
	want(t, send(t, r, http.MethodPost, "/api/tapes/transport?id="+id, `{"action":"play","quantum":"week"}`), http.StatusBadRequest, "bad quantum")
	want(t, send(t, r, http.MethodPost, "/api/tapes/transport?id=2026-01-01_other", `{"action":"play"}`), http.StatusConflict, "another tape")
	// No output here: play is refused, and locate still moves the tape.
	want(t, send(t, r, http.MethodPost, "/api/tapes/transport?id="+id, `{"action":"play"}`), http.StatusConflict, "play")
	want(t, send(t, r, http.MethodPost, "/api/tapes/transport?id="+id, `{"action":"locate","pos":4800}`), http.StatusOK, "locate")
	var live struct {
		Live struct {
			Playing bool  `json:"playing"`
			Pos     int64 `json:"pos"`
		} `json:"live"`
	}
	for i := 0; i < 100; i++ {
		json.Unmarshal(send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "").Body.Bytes(), &live)
		if live.Live.Pos == 4800 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if live.Live.Pos != 4800 || live.Live.Playing {
		t.Fatalf("after locate: %+v", live.Live)
	}
	// No capture here: a catch is refused, not an error.
	want(t, send(t, r, http.MethodPost, "/api/tapes/catch?id="+id, `{"track":1,"source":"aux","pass":1}`), http.StatusConflict, "catch")
	want(t, send(t, r, http.MethodPost, "/api/tapes/record?id="+id, `{"track":1,"source":"aux"}`), http.StatusConflict, "record")
	// With or without `pairs` the body decodes the same way: the old pages send
	// only {track, source}; multi-arm adds the pairs.
	want(t, send(t, r, http.MethodPost, "/api/tapes/record?id="+id, `{"track":1,"source":"aux","replace":false,"pairs":[{"track":1,"source":"aux"}]}`), http.StatusConflict, "record with pairs")
	want(t, send(t, r, http.MethodDelete, "/api/tapes/record?id="+id, ""), http.StatusConflict, "end a recording that isn't")
	want(t, send(t, r, http.MethodPost, "/api/tapes/tap?id="+id, `{"track":1,"source":"aux"}`), http.StatusConflict, "tap")
	want(t, send(t, r, http.MethodDelete, "/api/tapes/tap?id="+id, ""), http.StatusOK, "forget a tap")
}

func TestDroppingATakesSpanOntoAnEmptyTapeMakesTheFirstLoop(t *testing.T) {
	r, dir := newTapeAPI(t)
	writeRealTake(t, dir, "jam_2026-10-04_10-00-00.wav", 96000)
	id := makeLoadedTape(t, r)

	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"take":"../etc/passwd","from":0,"to":48000}`), http.StatusBadRequest, "bad name")
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"take":"jam_nope.wav","from":0,"to":48000}`), http.StatusNotFound, "no take")
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"take":"jam_2026-10-04_10-00-00.wav","from":0,"to":960000}`), http.StatusBadRequest, "past the take")

	w := send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"take":"jam_2026-10-04_10-00-00.wav","from":24000,"to":72000,"track":1,"bars":1}`)
	want(t, w, http.StatusOK, "drop")
	var dropped struct {
		Clip struct {
			ID   string `json:"id"`
			File string `json:"file"`
		} `json:"clip"`
	}
	json.Unmarshal(w.Body.Bytes(), &dropped)

	s := stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, ""))
	if s.Tape.Grid == nil || s.Tape.Grid.Frames != 48000 || len(s.Tape.Tracks[0].Clips) != 1 {
		t.Fatalf("after the drop: grid %+v, track 1 %+v", s.Tape.Grid, s.Tape.Tracks[0])
	}
	// The tempo is fixed now that the tape has audio.
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"tempo":{"bpm":90,"bars":4}}`), http.StatusBadRequest, "tempo with audio")
	// The clip's peaks are served; a path out of the pool isn't.
	want(t, send(t, r, http.MethodGet, "/api/tapes/peaks?file="+dropped.Clip.File, ""), http.StatusOK, "peaks")
	want(t, send(t, r, http.MethodGet, "/api/tapes/peaks?file=../tape.json", ""), http.StatusBadRequest, "peaks escape")

	// Remove the clip, and undo brings it back.
	w = send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"clip":{"id":"`+dropped.Clip.ID+`","remove":true}}`)
	want(t, w, http.StatusOK, "remove")
	if n := len(stateOf(t, w).Tape.Tracks[0].Clips); n != 0 {
		t.Fatalf("%d clips after remove", n)
	}
	w = send(t, r, http.MethodPost, "/api/tapes/undo?id="+id, "")
	if n := len(stateOf(t, w).Tape.Tracks[0].Clips); n != 1 {
		t.Fatalf("%d clips after undo", n)
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"clip":{"id":"nope","gain_db":0}}`), http.StatusBadRequest, "no clip")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"clip":{"id":"`+dropped.Clip.ID+`","gain_db":40}}`), http.StatusBadRequest, "loud clip")
}

func TestAPoolFileServesRangePeaksAndASlice(t *testing.T) {
	r, dir := newTapeAPI(t)
	writeRealTake(t, dir, "jam_2026-10-04_10-00-00.wav", 96000)
	id := makeLoadedTape(t, r)
	w := send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"take":"jam_2026-10-04_10-00-00.wav","from":24000,"to":72000,"track":1,"bars":1}`)
	want(t, w, http.StatusOK, "drop")
	file := stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "")).Tape.Tracks[0].Clips[0].File
	if file == "" {
		t.Fatal("the clip has no file")
	}

	// Range peaks.
	w = send(t, r, http.MethodGet, "/api/tapes/peaks?file="+file+"&from=0&to=4800&buckets=16", "")
	want(t, w, http.StatusOK, "range peaks")
	var pd struct {
		Buckets int `json:"buckets"`
	}
	json.Unmarshal(w.Body.Bytes(), &pd)
	if pd.Buckets != 16 {
		t.Fatalf("range peaks = %s", w.Body.String())
	}
	if cc := w.Header().Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Fatalf("range peaks Cache-Control = %q", cc)
	}
	want(t, send(t, r, http.MethodGet, "/api/tapes/peaks?file="+file+"&from=0&to=9600000&buckets=16", ""), http.StatusBadRequest, "past the end")
	want(t, send(t, r, http.MethodGet, "/api/tapes/peaks?file="+file+"&from=0&to=4800&buckets=0", ""), http.StatusBadRequest, "no buckets")
	want(t, send(t, r, http.MethodGet, "/api/tapes/peaks?file="+file+"&from=0", ""), http.StatusBadRequest, "only from")
	want(t, send(t, r, http.MethodGet, "/api/tapes/peaks?file=audio/copy_2000-01-01_000000.wav&from=0&to=10&buckets=4", ""), http.StatusNotFound, "missing pool file peaks")
	want(t, send(t, r, http.MethodGet, "/api/tapes/peaks?file="+file, ""), http.StatusOK, "whole-file peaks")

	// Slice.
	w = send(t, r, http.MethodGet, "/api/tapes/slice?file="+file+"&from=0&to=4800", "")
	want(t, w, http.StatusOK, "slice")
	if ct := w.Header().Get("Content-Type"); ct != "audio/wav" {
		t.Fatalf("slice Content-Type = %q", ct)
	}
	if n := w.Body.Len(); n != 44+4800*2*2 {
		t.Fatalf("slice is %d bytes, want %d", n, 44+4800*2*2)
	}
	w = send(t, r, http.MethodHead, "/api/tapes/slice?file="+file+"&from=0&to=4800", "")
	want(t, w, http.StatusOK, "slice HEAD")
	if w.Body.Len() != 0 || w.Header().Get("Content-Length") != strconv.Itoa(44+4800*2*2) {
		t.Fatalf("HEAD: %d body bytes, Content-Length %q", w.Body.Len(), w.Header().Get("Content-Length"))
	}
	want(t, send(t, r, http.MethodGet, "/api/tapes/slice?file=../etc/passwd&from=0&to=10", ""), http.StatusBadRequest, "slice escape")
	want(t, send(t, r, http.MethodGet, "/api/tapes/slice?file=audio/copy_2000-01-01_000000.wav&from=0&to=10", ""), http.StatusNotFound, "missing pool file")
	want(t, send(t, r, http.MethodGet, "/api/tapes/slice?file="+file+"&from=0&to=9600000", ""), http.StatusBadRequest, "slice too long")
}

func TestTheClipboardCopiesATakeAndDropsItOnATape(t *testing.T) {
	r, dir := newTapeAPI(t)
	writeRealTake(t, dir, "jam_2026-10-04_11-00-00.wav", 192000)
	id := makeLoadedTape(t, r)

	w := send(t, r, http.MethodGet, "/api/clipboard", "")
	want(t, w, http.StatusOK, "empty clipboard")
	if !strings.Contains(w.Body.String(), `"clipboard":null`) {
		t.Fatalf("empty clipboard = %s", w.Body.String())
	}
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"track":1}`), http.StatusConflict, "drop nothing")
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"take":"../x.wav","from":0,"to":10}`), http.StatusBadRequest, "bad take")
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{}`), http.StatusBadRequest, "nothing named")

	w = send(t, r, http.MethodPost, "/api/clipboard", `{"take":"jam_2026-10-04_11-00-00.wav","from":0,"to":48000}`)
	want(t, w, http.StatusOK, "copy")
	if !strings.Contains(w.Body.String(), `"seconds":1`) {
		t.Fatalf("copy = %s", w.Body.String())
	}
	w = send(t, r, http.MethodGet, "/api/clipboard/audio", "")
	want(t, w, http.StatusOK, "audition")
	if b := w.Body.Bytes(); len(b) != 44+48000*4 || string(b[:4]) != "RIFF" {
		t.Fatalf("audition: %d bytes", len(b))
	}

	// Dropped on the empty tape, it's the first loop; tile a copy through a
	// four-bar loop.
	w = send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"track":2}`)
	want(t, w, http.StatusOK, "drop")
	s := stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, ""))
	if s.Tape.Grid == nil || s.Tape.Grid.Frames != 48000 || len(s.Tape.Tracks[1].Clips) != 1 {
		t.Fatalf("after the drop: %+v", s.Tape)
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"bars":1}`), http.StatusOK, "relabel")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"loop":{"out":192000}}`), http.StatusOK, "longer loop")
	clip := s.Tape.Tracks[1].Clips[0].ID
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"clip":{"id":"`+clip+`","tile":true}}`), http.StatusOK, "tile")
	if n := len(stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "")).Tape.Tracks[1].Clips); n != 4 {
		t.Fatalf("tiled into %d clips, want 4", n)
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"clip":{"id":"`+clip+`","tile":true}}`), http.StatusBadRequest, "no room to tile")
	// Fades: in frames, none longer than the clip.
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"clip":{"id":"`+clip+`","fade_in":480,"fade_out":4800}}`), http.StatusOK, "fades")
	var faded struct {
		Tape struct {
			Tracks []struct {
				Clips []struct {
					ID      string `json:"id"`
					FadeIn  int64  `json:"fade_in"`
					FadeOut int64  `json:"fade_out"`
				} `json:"clips"`
			} `json:"tracks"`
		} `json:"tape"`
	}
	json.Unmarshal(send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "").Body.Bytes(), &faded)
	if c := faded.Tape.Tracks[1].Clips[0]; c.ID != clip || c.FadeIn != 480 || c.FadeOut != 4800 {
		t.Fatalf("fades = %+v", c)
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"clip":{"id":"`+clip+`","fade_in":-1}}`), http.StatusBadRequest, "a fade below 0")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"clip":{"id":"`+clip+`","fade_in":1}}`), http.StatusBadRequest, "a fade shorter than the declick")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"clip":{"id":"`+clip+`","fade_out":99999999}}`), http.StatusBadRequest, "a fade past the clip")
	// Their curves, by name.
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"clip":{"id":"`+clip+`","fade_in_shape":"linear","fade_out_shape":"exp"}}`), http.StatusOK, "curves")
	var curved struct {
		Tape struct {
			Tracks []struct {
				Clips []struct {
					FadeInShape  string `json:"fade_in_shape"`
					FadeOutShape string `json:"fade_out_shape"`
				} `json:"clips"`
			} `json:"tracks"`
		} `json:"tape"`
	}
	json.Unmarshal(send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "").Body.Bytes(), &curved)
	if c := curved.Tape.Tracks[1].Clips[0]; c.FadeInShape != "linear" || c.FadeOutShape != "exp" {
		t.Fatalf("curves = %+v", c)
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"clip":{"id":"`+clip+`","fade_in_shape":"log"}}`), http.StatusBadRequest, "a curve there isn't")
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"clip":{"id":"`+clip+`","fade_out_shape":""}}`), http.StatusOK, "back to equal power")

	want(t, send(t, r, http.MethodDelete, "/api/clipboard", ""), http.StatusOK, "clear")
	want(t, send(t, r, http.MethodGet, "/api/clipboard/audio", ""), http.StatusNotFound, "audition nothing")
}

func TestTheTapesEditsLiftSplitAndMultiply(t *testing.T) {
	r, dir := newTapeAPI(t)
	writeRealTake(t, dir, "jam_2026-10-04_11-00-00.wav", 192000)
	id := makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"take":"jam_2026-10-04_11-00-00.wav","from":0,"to":96000}`), http.StatusOK, "copy")
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"track":1}`), http.StatusOK, "drop")

	edit := func(body string, code int, what string) map[string]any {
		t.Helper()
		w := send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, body)
		want(t, w, code, what)
		var out map[string]any
		json.Unmarshal(w.Body.Bytes(), &out)
		return out
	}
	// Split the loop in two at 1 s, then join it back.
	edit(`{"op":"split","track":1,"pos":48000}`, http.StatusOK, "split")
	s := stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, ""))
	if n := len(s.Tape.Tracks[0].Clips); n != 2 {
		t.Fatalf("split into %d", n)
	}
	edit(`{"op":"join","clip":"`+s.Tape.Tracks[0].Clips[0].ID+`"}`, http.StatusOK, "join")
	// Slid onto track 2 and back: "to" is the track it goes to, "track" the
	// selected one, which a slide leaves alone.
	joined := s.Tape.Tracks[0].Clips[0].ID
	edit(`{"op":"slide","track":1,"clip":"`+joined+`","at":0,"to":2}`, http.StatusOK, "slide to track 2")
	if s := stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "")); len(s.Tape.Tracks[0].Clips) != 0 || len(s.Tape.Tracks[1].Clips) != 1 {
		t.Fatalf("after sliding to track 2: %+v", s.Tape.Tracks)
	}
	edit(`{"op":"slide","track":3,"clip":"`+joined+`","at":0,"to":1}`, http.StatusOK, "slide back")
	// With no "to", a slide stays on the clip's own track, whatever track
	// is selected.
	edit(`{"op":"slide","track":2,"clip":"`+joined+`","at":0}`, http.StatusOK, "slide with track 2 selected")
	if s := stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "")); len(s.Tape.Tracks[0].Clips) != 1 || len(s.Tape.Tracks[1].Clips) != 0 {
		t.Fatalf("a slide with no to left track 1: %+v", s.Tape.Tracks)
	}
	// Repeated twice, end to end, then undone in one step.
	if out := edit(`{"op":"repeat","clip":"`+joined+`","count":2}`, http.StatusOK, "repeat"); out["edit"].(map[string]any)["clips"] != float64(2) {
		t.Fatalf("repeat = %v", out["edit"])
	}
	if n := len(stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "")).Tape.Tracks[0].Clips); n != 3 {
		t.Fatalf("repeated into %d clips, want 3", n)
	}
	want(t, send(t, r, http.MethodPost, "/api/tapes/undo?id="+id, ""), http.StatusOK, "undo the repeat")
	edit(`{"op":"repeat","clip":"`+joined+`","count":0}`, http.StatusBadRequest, "repeat no times")
	// Several at once: duplicated after itself, then both moved a track
	// down, then both removed; each one step.
	edit(`{"op":"duplicate","clips":["`+joined+`"]}`, http.StatusOK, "duplicate")
	cl := stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "")).Tape.Tracks[0].Clips
	if len(cl) != 2 {
		t.Fatalf("duplicated into %d clips", len(cl))
	}
	both := `["` + cl[0].ID + `","` + cl[1].ID + `"]`
	edit(`{"op":"move","clips":`+both+`,"dt":0,"dtrack":1}`, http.StatusOK, "move both")
	if s := stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "")); len(s.Tape.Tracks[1].Clips) != 2 {
		t.Fatalf("after the move track 2 has %d clips", len(s.Tape.Tracks[1].Clips))
	}
	edit(`{"op":"move","clips":`+both+`,"dtrack":-2}`, http.StatusBadRequest, "move off the tracks")
	out := edit(`{"op":"copy","clips":`+both+`}`, http.StatusOK, "copy both")
	if e, _ := out["edit"].(map[string]any); e["clips"] != float64(2) || e["clipboard"] == nil {
		t.Fatalf("copy both = %v", out["edit"])
	}
	edit(`{"op":"remove","clips":`+both+`}`, http.StatusOK, "remove both")
	if s := stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "")); len(s.Tape.Tracks[1].Clips) != 0 {
		t.Fatal("remove left clips")
	}
	edit(`{"op":"remove","clips":[]}`, http.StatusBadRequest, "remove nothing")
	for _, what := range []string{"undo the remove", "undo the move", "undo the duplicate"} {
		want(t, send(t, r, http.MethodPost, "/api/tapes/undo?id="+id, ""), http.StatusOK, what)
	}
	if s := stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "")); len(s.Tape.Tracks[0].Clips) != 1 {
		t.Fatalf("after three undos track 1 has %d clips", len(s.Tape.Tracks[0].Clips))
	}
	// Double the loop, then lift all four tracks: the tape is left empty.
	out = edit(`{"op":"multiply"}`, http.StatusOK, "multiply")
	if e, _ := out["edit"].(map[string]any); e["frames"] != float64(192000) {
		t.Fatalf("multiply = %v", out["edit"])
	}
	out = edit(`{"op":"lift","all":true}`, http.StatusOK, "lift")
	if e, _ := out["edit"].(map[string]any); e["clips"] != float64(2) || e["clipboard"] == nil {
		t.Fatalf("lift = %v", out["edit"])
	}
	s = stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, ""))
	if n := len(s.Tape.Tracks[0].Clips); n != 0 || s.Undo == 0 {
		t.Fatalf("after lifting everything: %d clips, undo %d", n, s.Undo)
	}
	// Merged onto track 3: the four-track clipboard becomes one.
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"track":3,"merge":true}`), http.StatusOK, "merge drop")
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"track":3}`), http.StatusBadRequest, "four tracks from 3")
	edit(`{"op":"lift","track":2}`, http.StatusBadRequest, "nothing to lift")
	edit(`{"op":"slide","clip":"x"}`, http.StatusBadRequest, "slide with no at")
	edit(`{"op":"slide","clip":"`+stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "")).Tape.Tracks[2].Clips[0].ID+`","at":0,"to":9}`, http.StatusBadRequest, "slide onto no such track")
	edit(`{"op":"nope"}`, http.StatusBadRequest, "no such edit")
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id=other", `{"op":"multiply"}`), http.StatusConflict, "another tape")
}

func TestATapeExportsAsStemsAndRefusesAMixdownWithNothingToPlayIt(t *testing.T) {
	r, dir := newTapeAPI(t)
	writeRealTake(t, dir, "jam_2026-10-04_11-00-00.wav", 192000)
	id := makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodGet, "/api/tapes/export?id="+id, ""), http.StatusBadRequest, "export an empty tape")
	want(t, send(t, r, http.MethodHead, "/api/tapes/export?id="+id, ""), http.StatusBadRequest, "ask to export an empty tape")
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"take":"jam_2026-10-04_11-00-00.wav","from":0,"to":96000}`), http.StatusOK, "copy")
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"track":2}`), http.StatusOK, "drop")

	want(t, send(t, r, http.MethodHead, "/api/tapes/export?id="+id, ""), http.StatusOK, "ask to export")
	w := send(t, r, http.MethodGet, "/api/tapes/export?id="+id, "")
	want(t, w, http.StatusOK, "export")
	if ct := w.Header().Get("Content-Type"); ct != "application/zip" || !strings.Contains(w.Header().Get("Content-Disposition"), "Song one stems.zip") {
		t.Fatalf("export headers: %v", w.Header())
	}
	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	if strings.Join(names, ",") != "Song one/2.wav,Song one/Song one.mid" {
		t.Fatalf("zip = %v", names)
	}
	want(t, send(t, r, http.MethodGet, "/api/tapes/export?id=other", ""), http.StatusConflict, "another tape")

	// A clip: reversed, then shared as a WAV.
	s := stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, ""))
	clip := s.Tape.Tracks[1].Clips[0].ID
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"reverse","clip":"`+clip+`"}`), http.StatusOK, "reverse")
	w = send(t, r, http.MethodGet, "/api/tapes/clip?id="+id+"&clip="+clip, "")
	want(t, w, http.StatusOK, "share a clip")
	if w.Header().Get("Content-Type") != "audio/wav" || w.Body.Len() != 44+96000*4 || !strings.Contains(w.Header().Get("Content-Disposition"), "reversed") {
		t.Fatalf("clip: %v, %d bytes", w.Header(), w.Body.Len())
	}
	want(t, send(t, r, http.MethodGet, "/api/tapes/clip?id="+id+"&clip=nope", ""), http.StatusBadRequest, "no such clip")

	// This engine has no output and no recorder: a mixdown can't run.
	want(t, send(t, r, http.MethodPost, "/api/tapes/mixdown?id="+id, `{}`), http.StatusConflict, "mixdown")
	want(t, send(t, r, http.MethodPost, "/api/tapes/mixdown?id="+id, ""), http.StatusConflict, "mixdown, no body")
	// Cut a record: a record it couldn't mark is refused before anything plays.
	want(t, send(t, r, http.MethodPost, "/api/tapes/mixdown?id="+id, `{"all":true,"record":{"side":"C"}}`), http.StatusBadRequest, "mixdown, a bad record")
	want(t, send(t, r, http.MethodPost, "/api/tapes/mixdown?id="+id, `{"all":true,"record":{"cover":3}}`), http.StatusConflict, "mixdown, a good record")
}

// Away from the rig: the loop to listen to, and a phone's part placed back
// where it was played.
func TestTheLoopToListenToAndAPhonePartPlacedBack(t *testing.T) {
	r, dir := newTapeAPI(t)
	writeRealTake(t, dir, "jam_2026-10-04_12-00-00.wav", 192000)
	id := makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodGet, "/api/tapes/listen?id="+id, ""), http.StatusBadRequest, "listen to an empty tape")
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"take":"jam_2026-10-04_12-00-00.wav","from":0,"to":96000,"track":1,"bars":1}`), http.StatusOK, "first loop")

	w := send(t, r, http.MethodHead, "/api/tapes/listen?id="+id, "")
	want(t, w, http.StatusOK, "ask for the loop")
	if h := w.Header(); h.Get("Content-Type") != "audio/wav" || h.Get("X-Tape-From") != "0" || h.Get("X-Tape-Frames") != "96000" || h.Get("X-Tape-Loop") != "true" || h.Get("Content-Length") != fmt.Sprint(44+96000*4) {
		t.Fatalf("listen headers: %v", h)
	}
	w = send(t, r, http.MethodGet, "/api/tapes/listen?id="+id+"&click=1", "")
	want(t, w, http.StatusOK, "the loop")
	if w.Body.Len() != 44+96000*4 {
		t.Fatalf("listen body: %d bytes", w.Body.Len())
	}
	want(t, send(t, r, http.MethodGet, "/api/tapes/listen?id=other", ""), http.StatusConflict, "another tape")

	// The part: half a bar from the take, placed three quarters through the
	// loop on track 2, so it wraps to bar 1's start.
	w = send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"take":"jam_2026-10-04_12-00-00.wav","from":96000,"to":144000,"track":2,"at":72000,"loop":{"in":0,"out":96000},"source":"phone"}`)
	want(t, w, http.StatusOK, "place")
	var placed struct {
		Clips []struct {
			At     int64  `json:"at"`
			Frames int64  `json:"frames"`
			Source string `json:"source"`
		} `json:"clips"`
	}
	json.Unmarshal(w.Body.Bytes(), &placed)
	if len(placed.Clips) != 2 || placed.Clips[0].At != 72000 || placed.Clips[0].Frames != 24000 || placed.Clips[1].At != 0 || placed.Clips[1].Source != "phone" {
		t.Fatalf("placed: %+v", placed)
	}
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"take":"jam_2026-10-04_12-00-00.wav","from":0,"to":96001,"track":2,"at":0,"loop":{"in":0,"out":96000}}`), http.StatusBadRequest, "longer than the loop")
	// Played over a loop that isn't the tape's any more.
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"take":"jam_2026-10-04_12-00-00.wav","from":0,"to":1000,"track":2,"at":0,"loop":{"in":0,"out":48000}}`), http.StatusConflict, "the loop moved")
}

// Share the mix: the whole tape as an MP3 named after it and the day, with
// no output and no recorder, which a bounce would need.
func TestTheMixIsSharedAsAnMP3(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("no ffmpeg")
	}
	r, dir := newTapeAPI(t)
	writeRealTake(t, dir, "jam_2026-10-04_12-00-00.wav", 192000)
	id := makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodGet, "/api/tapes/listen?id="+id+"&all=1&format=mp3", ""), http.StatusBadRequest, "share an empty tape")
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"take":"jam_2026-10-04_12-00-00.wav","from":0,"to":96000,"track":1,"bars":1}`), http.StatusOK, "a part")
	// This engine has no output: Bounce is refused, and the mix isn't.
	want(t, send(t, r, http.MethodPost, "/api/tapes/mixdown?id="+id, `{"all":true}`), http.StatusConflict, "bounce")

	w := send(t, r, http.MethodHead, "/api/tapes/listen?id="+id+"&all=1&format=mp3", "")
	want(t, w, http.StatusOK, "ask for the mix")
	if w.Body.Len() != 0 {
		t.Fatalf("HEAD rendered %d bytes", w.Body.Len())
	}
	w = send(t, r, http.MethodGet, "/api/tapes/listen?id="+id+"&all=1&format=mp3", "")
	want(t, w, http.StatusOK, "share the mix")
	h := w.Header()
	day := time.Now().Format("2006-01-02")
	if h.Get("Content-Type") != "audio/mpeg" || !strings.Contains(h.Get("Content-Disposition"), `filename="Song one `+day+`.mp3"`) {
		t.Fatalf("the mix's headers: %v", h)
	}
	b := w.Body.Bytes()
	mp3 := len(b) > 1024 && (string(b[:3]) == "ID3" || (b[0] == 0xff && b[1]&0xe0 == 0xe0))
	if !mp3 {
		t.Fatalf("the mix isn't an MP3: %d bytes, starting % x", len(b), b[:min(len(b), 8)])
	}
	// Two seconds at 128 kbps is about 32 kB; a WAV of them would be 384 kB.
	if len(b) > 64<<10 {
		t.Fatalf("the mix is %d bytes: not encoded", len(b))
	}
}

func TestAnEmptyTapeSuggestsTheTempoYouWerePlaying(t *testing.T) {
	r, dir := newTapeAPI(t)
	write := func(name string, bpm float64) {
		p := filepath.Join(dir, name)
		if _, err := audio.WriteWAV(p, make([]int32, 2*96000), 2, []int{0, 1}, 48000); err != nil {
			t.Fatal(err)
		}
		if err := audio.WriteMeta(p, audio.Meta{BPM: &bpm}); err != nil {
			t.Fatal(err)
		}
	}
	write("jam_2026-10-04_10-00-00.wav", 100)
	write("jam_2026-10-04_11-00-00.wav", 125.25) // the newest
	var made struct {
		ID string `json:"id"`
	}
	w := send(t, r, http.MethodPost, "/api/tapes", `{"name":"s"}`)
	want(t, w, http.StatusOK, "create")
	json.Unmarshal(w.Body.Bytes(), &made)
	suggest := func() float64 {
		var b struct {
			Suggest float64 `json:"suggest_bpm"`
		}
		w := send(t, r, http.MethodGet, "/api/tapes/state?id="+made.ID+"&suggest=1", "")
		want(t, w, http.StatusOK, "state")
		json.Unmarshal(w.Body.Bytes(), &b)
		return b.Suggest
	}
	if got := suggest(); got != 125.25 {
		t.Fatalf("suggest_bpm %v, want the newest take's 125.25", got)
	}
	w = send(t, r, http.MethodGet, "/api/tapes/state?id="+made.ID, "")
	want(t, w, http.StatusOK, "state without suggest")
	if strings.Contains(w.Body.String(), "suggest_bpm") {
		t.Fatalf("a state request without suggest=1 carries suggest_bpm: %s", w.Body.String())
	}
	w = send(t, r, http.MethodPost, "/api/clipboard", `{"take":"jam_2026-10-04_10-00-00.wav","from":0,"to":48000}`)
	want(t, w, http.StatusOK, "copy")
	if got := suggest(); got != 100 {
		t.Fatalf("suggest_bpm %v, want the clipboard's 100", got)
	}
	// A take played after the copy is newer than the clipboard.
	newer := filepath.Join(dir, "jam_2026-10-04_12-00-00.wav")
	write("jam_2026-10-04_12-00-00.wav", 110)
	later := time.Now().Add(time.Hour)
	bpm := 110.0
	if err := audio.WriteMeta(newer, audio.Meta{BPM: &bpm, Created: &later}); err != nil {
		t.Fatal(err)
	}
	if got := suggest(); got != 110 {
		t.Fatalf("suggest_bpm %v, want the newer take's 110", got)
	}
}

// Send to tape places a take by what its sidecar says: its tempo and its
// downbeat. The tape takes the tempo, nothing loops, and a count-in goes in
// the bar before the downbeat.
func TestSendingATempoTakeToTheTapeLaysItDownOnTheGrid(t *testing.T) {
	r, dir := newTapeAPI(t)
	name := "jam_2026-10-07_10-00-00.wav"
	writeRealTake(t, dir, name, 20*48000) // ten bars at 120
	bpm, down := 120.0, int64(24000)      // half a bar of count-in
	if err := audio.WriteMeta(filepath.Join(dir, name), audio.Meta{BPM: &bpm, DownbeatFrame: &down}); err != nil {
		t.Fatal(err)
	}
	id := makeLoadedTape(t, r)
	type loopBody struct {
		Tape struct {
			Loop struct {
				In  int64 `json:"in"`
				Out int64 `json:"out"`
				On  bool  `json:"on"`
			} `json:"loop"`
			Tracks []struct {
				Clips []struct {
					At     int64 `json:"at"`
					Frames int64 `json:"frames"`
				} `json:"clips"`
			} `json:"tracks"`
		} `json:"tape"`
		BPM float64 `json:"bpm"`
	}

	w := send(t, r, http.MethodPost, "/api/tapes/send?id="+id, `{"take":"`+name+`"}`)
	want(t, w, http.StatusOK, "send the whole take")
	var sent struct {
		Mode     string  `json:"mode"`
		BPM      float64 `json:"bpm"`
		TempoSet bool    `json:"tempo_set"`
		Bar      int64   `json:"bar"`
		End      int64   `json:"end"`
	}
	json.Unmarshal(w.Body.Bytes(), &sent)
	if sent.Mode != "grid" || !sent.TempoSet || sent.Bar != 2 || sent.BPM < 119.99 || sent.BPM > 120.01 {
		t.Fatalf("sent = %+v", sent)
	}
	var s loopBody
	json.Unmarshal(send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "").Body.Bytes(), &s)
	c := s.Tape.Tracks[0].Clips
	if len(c) != 1 || c[0].At != 96000-24000 || c[0].Frames != 20*48000 || s.Tape.Loop.On {
		t.Fatalf("after the send: clips %+v loop %+v", c, s.Tape.Loop)
	}
	if sent.End != c[0].At+c[0].Frames {
		t.Fatalf("end %d", sent.End)
	}

	// A selection keeps its place in the take's bar: 100,000 is 76,000 frames
	// after the downbeat, 76,000 into the take's first bar, so it goes 76,000
	// after a tape bar line -- on bar 1, the playhead being at the first clip.
	w = send(t, r, http.MethodPost, "/api/tapes/send?id="+id, `{"take":"`+name+`","from":100000,"to":150000,"track":2}`)
	want(t, w, http.StatusOK, "send a selection")
	json.Unmarshal(send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "").Body.Bytes(), &s)
	if c := s.Tape.Tracks[1].Clips; len(c) != 1 || c[0].Frames != 50000 || c[0].At%96000 != 76000 {
		t.Fatalf("selection clips %+v: want 76,000 frames after a bar line", c)
	}

	want(t, send(t, r, http.MethodPost, "/api/tapes/send?id="+id, `{"take":"`+name+`","from":100}`), http.StatusBadRequest, "from without to")
	want(t, send(t, r, http.MethodPost, "/api/tapes/send?id="+id, `{"take":"`+name+`","from":100,"to":99}`), http.StatusBadRequest, "backwards")
	want(t, send(t, r, http.MethodPost, "/api/tapes/send?id="+id, `{"take":"`+name+`","from":0,"to":9999999}`), http.StatusBadRequest, "past the take")
	want(t, send(t, r, http.MethodPost, "/api/tapes/send?id="+id, `{"take":"../etc/passwd"}`), http.StatusBadRequest, "bad name")
	want(t, send(t, r, http.MethodPost, "/api/tapes/send?id="+id, `{"take":"jam_nope.wav"}`), http.StatusNotFound, "no take")
	want(t, send(t, r, http.MethodPost, "/api/tapes/send?id=other", `{"take":"`+name+`"}`), http.StatusConflict, "not the loaded tape")
}

func TestSendingATakeLongerThanATrackNamesTheLimitAndTheSetting(t *testing.T) {
	r, dir := newTapeAPI(t) // tracks are 60 s here
	name := "jam_2026-10-07_11-00-00.wav"
	writeRealTake(t, dir, name, 70*48000)
	id := makeLoadedTape(t, r)
	w := send(t, r, http.MethodPost, "/api/tapes/send?id="+id, `{"take":"`+name+`"}`)
	want(t, w, http.StatusBadRequest, "too long")
	for _, s := range []string{"1:10", "1 minute", "TAPE_LENGTH_S"} {
		if !strings.Contains(w.Body.String(), s) {
			t.Errorf("%s should say %q", w.Body.String(), s)
		}
	}
	// The clipboard's copy says the same.
	w = send(t, r, http.MethodPost, "/api/clipboard", `{"take":"`+name+`","from":0,"to":3360000}`)
	want(t, w, http.StatusBadRequest, "copy too long")
	if !strings.Contains(w.Body.String(), "TAPE_LENGTH_S") {
		t.Errorf("copy: %s", w.Body.String())
	}
}

func TestSendingATakeWithNoTempoKeepsTheFirstLoop(t *testing.T) {
	r, dir := newTapeAPI(t)
	name := "jam_2026-10-07_12-00-00.wav"
	writeRealTake(t, dir, name, 4*48000)
	id := makeLoadedTape(t, r)
	w := send(t, r, http.MethodPost, "/api/tapes/send?id="+id, `{"take":"`+name+`"}`)
	want(t, w, http.StatusOK, "send")
	var sent struct {
		Mode string `json:"mode"`
	}
	json.Unmarshal(w.Body.Bytes(), &sent)
	s := stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, ""))
	if sent.Mode != "first-loop" || s.Tape.Grid == nil || s.Tape.Grid.Frames != 4*48000 {
		t.Fatalf("mode %q grid %+v: want the first loop", sent.Mode, s.Tape.Grid)
	}
}

func TestTrimOverTheAPI(t *testing.T) {
	r, dir := newTapeAPI(t)
	writeRealTake(t, dir, "jam_2026-10-04_11-00-00.wav", 192000)
	id := makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"take":"jam_2026-10-04_11-00-00.wav","from":0,"to":96000}`), http.StatusOK, "copy")
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"track":1}`), http.StatusOK, "drop")
	clip := stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "")).Tape.Tracks[0].Clips[0]

	w := send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"trim","clip":"`+clip.ID+`","edge":"in","at":24000}`)
	want(t, w, http.StatusOK, "trim in")
	var out struct {
		Edit struct {
			Clip struct {
				At, Src, Frames int64
			}
		}
	}
	json.Unmarshal(w.Body.Bytes(), &out)
	if c := out.Edit.Clip; c.At != 24000 || c.Src != clip.Src+24000 || c.Frames != 72000 {
		t.Fatalf("trim in answered %+v", c)
	}
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"trim","clip":"`+clip.ID+`","edge":"out","at":48000}`), http.StatusOK, "trim out")
	got := stateOf(t, send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "")).Tape.Tracks[0].Clips[0]
	if got.At != 24000 || got.At+got.Frames != 48000 {
		t.Fatalf("after both trims: %+v", got)
	}
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"trim","clip":"`+clip.ID+`","edge":"in"}`), http.StatusBadRequest, "trim with no at")
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"trim","clip":"`+clip.ID+`","edge":"both","at":0}`), http.StatusBadRequest, "trim a middle")
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"trim","clip":"nope","edge":"in","at":0}`), http.StatusBadRequest, "trim no clip")
}
func TestSectionsOverTheAPI(t *testing.T) {
	r, _ := newTapeAPI(t)
	id := makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"tempo":{"bpm":120,"bars":4}}`), http.StatusOK, "tempo")
	w := send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"section-add","name":"Verse","color":"red","at":10,"end":100000}`)
	want(t, w, http.StatusOK, "add")
	var out struct {
		Edit struct {
			Section struct {
				ID, Name, Color string
				At, End         int64
			}
		}
		Tape struct {
			Sections []struct{ ID string } `json:"sections"`
		}
	}
	json.Unmarshal(w.Body.Bytes(), &out)
	if s := out.Edit.Section; s.Name != "Verse" || s.Color != "red" || s.At != 0 || s.End != 96000 || len(out.Tape.Sections) != 1 {
		t.Fatalf("added = %+v, %d in the state", s, len(out.Tape.Sections))
	}
	sid := out.Edit.Section.ID
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"section-set","section":"`+sid+`","name":"Chorus"}`), http.StatusOK, "rename")
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"section-add","name":"Over","at":0,"end":96000}`), http.StatusBadRequest, "overlap")
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"section-remove","section":"`+sid+`"}`), http.StatusOK, "remove")
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"section-remove","section":"`+sid+`"}`), http.StatusBadRequest, "remove twice")
}

func TestInsertAndDeleteTimeOverTheAPI(t *testing.T) {
	r, dir := newTapeAPI(t)
	writeRealTake(t, dir, "jam_2026-10-04_11-00-00.wav", 192000)
	id := makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"take":"jam_2026-10-04_11-00-00.wav","from":0,"to":96000}`), http.StatusOK, "copy")
	// On an empty tape there's nothing to push: Drop it.
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"insert","track":1}`), http.StatusBadRequest, "insert on an empty tape")
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"track":1}`), http.StatusOK, "drop")
	w := send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"insert","track":2}`)
	want(t, w, http.StatusOK, "insert")
	var out struct {
		Edit struct {
			Frames, At int64
			Clips      int
		}
	}
	json.Unmarshal(w.Body.Bytes(), &out)
	if out.Edit.Frames != 96000 || out.Edit.Clips != 1 {
		t.Fatalf("insert = %+v", out.Edit)
	}
	// At the tape's start, where the page previewed it: the answer still
	// says where, 0 being a place.
	w = send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"insert","track":1,"pos":0}`)
	want(t, w, http.StatusOK, "insert at 0")
	var raw struct {
		Edit map[string]any `json:"edit"`
	}
	json.Unmarshal(w.Body.Bytes(), &raw)
	if at, ok := raw.Edit["at"]; !ok || at != float64(0) {
		t.Fatalf("insert at 0 answers at = %v (%v)", at, ok)
	}
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"insert","track":5}`), http.StatusBadRequest, "insert off the tracks")
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"insert","track":1,"pos":-1}`), http.StatusBadRequest, "insert before the start")
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"delete-time"}`), http.StatusOK, "delete time")
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"section-add","name":"Verse","at":0,"end":96000}`), http.StatusOK, "a section")
	var st struct {
		Tape struct {
			Sections []struct{ ID string } `json:"sections"`
		}
	}
	json.Unmarshal(send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "").Body.Bytes(), &st)
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"duplicate-section","section":"`+st.Tape.Sections[0].ID+`"}`), http.StatusOK, "duplicate section")
	json.Unmarshal(send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "").Body.Bytes(), &st)
	if len(st.Tape.Sections) != 2 {
		t.Fatalf("after duplicating: %d sections", len(st.Tape.Sections))
	}
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"duplicate-section","section":"nope"}`), http.StatusBadRequest, "duplicate no section")
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"insert","crate":"nope"}`), http.StatusNotFound, "insert no kept clip")
}

// The tape's mods: a PATCH of its style is one step of undo, saved with it,
// and refused when out of range.
func TestATapesModsSaveWithItAndUndo(t *testing.T) {
	r, _ := newTapeAPI(t)
	id := makeLoadedTape(t, r)
	type styled struct {
		Tape struct {
			Style *tape.Style `json:"style"`
		} `json:"tape"`
		Undo int `json:"undo"`
	}
	read := func(w *httptest.ResponseRecorder) styled {
		t.Helper()
		var s styled
		if err := json.Unmarshal(w.Body.Bytes(), &s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	w := send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"style":{"formula":"worn"}}`)
	want(t, w, http.StatusOK, "a formula")
	if s := read(w); s.Undo != 1 || s.Tape.Style == nil || *s.Tape.Style != (tape.Style{Formula: "worn", Wow: .5, Flutter: .4, Drive: .4, Age: .6}) {
		t.Fatalf("after worn: %+v", s)
	}
	w = send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"style":{"age":0.1}}`)
	want(t, w, http.StatusOK, "a knob")
	if s := read(w); s.Undo != 2 || s.Tape.Style.Formula != "custom" || s.Tape.Style.Age != 0.1 || s.Tape.Style.Wow != .5 {
		t.Fatalf("after a knob: %+v", s)
	}
	for _, bad := range []string{`{"style":{"drive":2}}`, `{"style":{"formula":"vhs"}}`, `{"style":{"wow":-1}}`} {
		want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, bad), http.StatusBadRequest, bad)
	}
	w = send(t, r, http.MethodPost, "/api/tapes/undo?id="+id, "")
	want(t, w, http.StatusOK, "undo")
	if s := read(w); s.Tape.Style == nil || s.Tape.Style.Formula != "worn" {
		t.Fatalf("after undo: %+v", s.Tape.Style)
	}
}

func TestTapeCueAPI(t *testing.T) {
	r, _ := newTapeAPI(t)
	id := makeLoadedTape(t, r)

	type cueState struct {
		Tape struct {
			Cue    *tape.CueLane `json:"cue"`
			Tracks []struct {
				Clips []struct {
					ID     string `json:"id"`
					File   string `json:"file"`
					Src    int64  `json:"src"`
					Frames int64  `json:"frames"`
					At     int64  `json:"at"`
				} `json:"clips"`
			} `json:"tracks"`
		} `json:"tape"`
		Undo int `json:"undo"`
	}
	readState := func() cueState {
		t.Helper()
		w := send(t, r, http.MethodGet, "/api/tapes/state?id="+id, "")
		want(t, w, http.StatusOK, "state")
		var s cueState
		if err := json.Unmarshal(w.Body.Bytes(), &s); err != nil {
			t.Fatal(err)
		}
		return s
	}

	// 1. Add cue clip
	clipJSON := `{"op":"cue-add","cue_clip":{"id":"cue1","file":"audio/cue1.wav","name":"Drum loop","frames":48000}}`
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, clipJSON), http.StatusOK, "cue-add")

	s := readState()
	if s.Tape.Cue == nil || len(s.Tape.Cue.Clips) != 1 || s.Tape.Cue.Clips[0].ID != "cue1" {
		t.Fatalf("after cue-add: %+v", s.Tape.Cue)
	}

	// 2. Solo the cue lane
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"cue-solo","solo":true}`), http.StatusOK, "cue-solo")
	s = readState()
	if !s.Tape.Cue.Solo {
		t.Fatalf("after cue-solo: solo = false")
	}

	// 3. Promote cue clip to Track 2 at frame 24000
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"cue-to-track","clip":"cue1","track":2,"at":24000}`), http.StatusOK, "cue-to-track")
	s = readState()
	if len(s.Tape.Tracks[1].Clips) != 1 {
		t.Fatalf("track 2 clips: %d, want 1", len(s.Tape.Tracks[1].Clips))
	}
	trClip := s.Tape.Tracks[1].Clips[0]
	if trClip.At != 24000 || trClip.Frames != 48000 || trClip.File != "audio/cue1.wav" {
		t.Fatalf("track 2 clip mismatch: %+v", trClip)
	}
	// Cue clip remains on CueLane
	if len(s.Tape.Cue.Clips) != 1 {
		t.Fatalf("cue clips after to-track: %d, want 1", len(s.Tape.Cue.Clips))
	}

	// 4. Remove cue clip
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"cue-remove","clip":"cue1"}`), http.StatusOK, "cue-remove")
	s = readState()
	if len(s.Tape.Cue.Clips) != 0 {
		t.Fatalf("cue clips after remove: %d, want 0", len(s.Tape.Cue.Clips))
	}

	// 5. Undo restores cue clip
	want(t, send(t, r, http.MethodPost, "/api/tapes/undo?id="+id, ""), http.StatusOK, "undo remove")
	s = readState()
	if len(s.Tape.Cue.Clips) != 1 || s.Tape.Cue.Clips[0].ID != "cue1" {
		t.Fatalf("cue clips after undo: %+v", s.Tape.Cue)
	}
}

func TestTapeCueAddFromATakeAndLaunch(t *testing.T) {
	r, dir := newTapeAPI(t)
	id := makeLoadedTape(t, r)
	if _, err := audio.WriteWAV(filepath.Join(dir, "jam_cue.wav"), make([]int32, 2*96000), 2, []int{0, 1}, 48000); err != nil {
		t.Fatal(err)
	}

	// The buffer is empty: nothing to cue.
	want(t, send(t, r, http.MethodPost, "/api/tapes/cue/add?id="+id, ""), http.StatusConflict, "cue an empty buffer")

	w := send(t, r, http.MethodPost, "/api/tapes/cue/add?id="+id, `{"take":"jam_cue.wav","from":0,"to":48000}`)
	want(t, w, http.StatusOK, "cue a take")
	var s struct {
		Tape struct {
			Cue *tape.CueLane `json:"cue"`
		} `json:"tape"`
		Edit struct {
			CueClip *tape.CueClip `json:"cue_clip"`
		} `json:"edit"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &s); err != nil {
		t.Fatal(err)
	}
	c := s.Edit.CueClip
	if c == nil || c.Frames != 48000 || !c.Loop || s.Tape.Cue == nil || len(s.Tape.Cue.Clips) != 1 {
		t.Fatalf("after cue/add: edit %+v, lane %+v", c, s.Tape.Cue)
	}

	want(t, send(t, r, http.MethodPost, "/api/tapes/cue?id="+id, `{"clip":"`+c.ID+`"}`), http.StatusOK, "launch")
	want(t, send(t, r, http.MethodPost, "/api/tapes/cue?id="+id, `{"clip":"nope"}`), http.StatusBadRequest, "launch a clip not on the lane")
	want(t, send(t, r, http.MethodPost, "/api/tapes/cue?id="+id, `{"clip":"`+c.ID+`","op":"juggle"}`), http.StatusBadRequest, "an op that isn't one")
	want(t, send(t, r, http.MethodPost, "/api/tapes/cue?id=other", `{"clip":"`+c.ID+`"}`), http.StatusConflict, "launch on a tape not loaded")
}
