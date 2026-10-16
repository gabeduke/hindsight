package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gabeduke/hindsight/internal/tape"
)

// A page tells a refusal that waits for Rec from every other 409 by its
// reason, so it can say "Waiting for rec to finish" and nothing else.
func TestARefusalForRecordingCarriesItsReason(t *testing.T) {
	r, a := newTapeAPIWithAPI(t)
	id := makeLoadedTape(t, r)
	a.recordingHook = func() *tape.Recording {
		return &tape.Recording{Tape: id, Track: 2, Source: "ch1", State: "on", Pairs: []tape.Pair{{Track: 2, Source: "ch1"}}}
	}
	w := send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"rec_tracks":[2,3]}`)
	want(t, w, http.StatusConflict, "arm another mid-punch")
	var b map[string]string
	json.Unmarshal(w.Body.Bytes(), &b)
	if b["reason"] != "recording" || b["error"] == "" {
		t.Fatalf("the 409 body is %v, want a reason of recording and the error text", b)
	}
	// Another 409 has no reason: the page shows the Pi's own words for it.
	rec := httptest.NewRecorder()
	tapeErr(rec, tape.ErrMixingDown)
	var o map[string]string
	json.Unmarshal(rec.Body.Bytes(), &o)
	if rec.Code != http.StatusConflict || o["reason"] != "" || o["error"] == "" {
		t.Fatalf("another 409: %d %v", rec.Code, o)
	}
}
