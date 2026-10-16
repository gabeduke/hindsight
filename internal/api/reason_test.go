package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gabeduke/hindsight/internal/tape"
)

func reasonOf(t *testing.T, err error) (int, map[string]string) {
	t.Helper()
	rec := httptest.NewRecorder()
	tapeErr(rec, err)
	var o map[string]string
	json.Unmarshal(rec.Body.Bytes(), &o)
	return rec.Code, o
}

// A page tells a refused EDIT (it waits for Rec) from every other 409 by its
// reason, so it can say "Waiting for rec to finish" and nothing else.
func TestARefusedEditWhileRecordingCarriesItsReason(t *testing.T) {
	r, a := newTapeAPIWithAPI(t)
	id := makeLoadedTape(t, r)
	a.recordingHook = func() *tape.Recording {
		return &tape.Recording{Tape: id, Track: 2, Source: "ch1", State: "on", Pairs: []tape.Pair{{Track: 2, Source: "ch1"}}}
	}
	for name, body := range map[string]string{
		"arm another":  `{"rec_tracks":[2,3]}`,
		"move a input": `{"input":{"n":2,"source":"aux"}}`,
	} {
		w := send(t, r, http.MethodPatch, "/api/tapes?id="+id, body)
		want(t, w, http.StatusConflict, name)
		var b map[string]string
		json.Unmarshal(w.Body.Bytes(), &b)
		if b["reason"] != "recording" || b["error"] == "" {
			t.Fatalf("%s: the 409 body is %v, want a reason of recording and the error text", name, b)
		}
	}
}

// The same sentinel comes back from a mixdown and from starting a record that
// is already running. Those are not edits: they keep the Pi's own words and
// carry no reason, so a page never says "Waiting for rec to finish" for them.
func TestOtherRecordingRefusalsCarryNoReason(t *testing.T) {
	for name, err := range map[string]error{
		"mixdown while recording":   tape.ErrRecording,
		"record while recording":    fmt.Errorf("%w", tape.ErrRecording),
		"another 409 (mixing down)": tape.ErrMixingDown,
	} {
		code, o := reasonOf(t, err)
		if code != http.StatusConflict || o["reason"] != "" || o["error"] == "" {
			t.Fatalf("%s: %d %v", name, code, o)
		}
	}
	if _, o := reasonOf(t, tape.ErrRecording); o["error"] != tape.ErrRecording.Error() {
		t.Fatalf("the Pi's own text is kept, got %q", o["error"])
	}
}

// Switching the output to the phone while recording is an edit that waits.
func TestSwitchingOutputWhileRecordingWaitsToo(t *testing.T) {
	if _, o := reasonOf(t, tape.WaitsForRecording(tape.ErrRecording)); o["reason"] != "recording" {
		t.Fatalf("got %v", o)
	}
}
