package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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
		Grid *struct {
			Frames int64 `json:"frames"`
			Bars   int   `json:"bars"`
		} `json:"grid"`
		Tracks []struct {
			Bus   string `json:"bus"`
			Mute  bool   `json:"mute"`
			Clips []struct {
				ID   string `json:"id"`
				File string `json:"file"`
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
	// Double the loop, then lift all four tracks: the tape is left empty.
	out := edit(`{"op":"multiply"}`, http.StatusOK, "multiply")
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

	// This engine has no output and no recorder: a mixdown can't run.
	want(t, send(t, r, http.MethodPost, "/api/tapes/mixdown?id="+id, `{}`), http.StatusConflict, "mixdown")
	want(t, send(t, r, http.MethodPost, "/api/tapes/mixdown?id="+id, ""), http.StatusConflict, "mixdown, no body")
}
