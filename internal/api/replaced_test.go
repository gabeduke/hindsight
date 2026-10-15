package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gorilla/mux"
)

// F3 of the flow spec: GRAB's Undo, over the existing clipboard routes. A
// grab that replaces a buffer nobody dropped or kept answers `replaced`;
// `crate: false` (every rooms GRAB sends it) keeps the old buffer as the one
// replaced grab and puts nothing in the crate; `restore?replaced=1&by=` is the
// Undo. Without the option the crate is as it always was.

type replacedBody struct {
	Clipboard *struct {
		Created string `json:"created"`
		Frames  int64  `json:"frames"`
	} `json:"clipboard"`
	Replaced *struct {
		Created string `json:"created"`
		Frames  int64  `json:"frames"`
	} `json:"replaced"`
	ReplacedSeconds float64           `json:"replaced_seconds"`
	Crated          []json.RawMessage `json:"crated"`
}

func replacedOf(t *testing.T, body []byte) replacedBody {
	t.Helper()
	var b replacedBody
	if err := json.Unmarshal(body, &b); err != nil {
		t.Fatal(err)
	}
	return b
}

func crateCount(t *testing.T, r *mux.Router) int {
	t.Helper()
	var c struct {
		Clips []json.RawMessage `json:"clips"`
	}
	w := send(t, r, http.MethodGet, "/api/crate", "")
	json.Unmarshal(w.Body.Bytes(), &c)
	return len(c.Clips)
}

func TestGrabsUndoOverTheClipboardRoutes(t *testing.T) {
	r, _ := newBufferAPI(t)
	makeLoadedTape(t, r)

	w := send(t, r, http.MethodPost, "/api/clipboard", `{"ring_from":240000,"ring_to":288000,"sources":["ch2"],"crate":false}`)
	want(t, w, http.StatusOK, "the first grab")
	first := replacedOf(t, w.Body.Bytes())
	if first.Replaced != nil || strings.Contains(w.Body.String(), `"replaced"`) {
		t.Fatalf("a grab over nothing says it replaced something: %s", w.Body.String())
	}

	// A second, the first never dropped or kept: it says what it replaced,
	// and the crate stays empty.
	w = send(t, r, http.MethodPost, "/api/clipboard", `{"ring_from":250000,"ring_to":298000,"sources":["ch2"],"crate":false}`)
	want(t, w, http.StatusOK, "the second grab")
	second := replacedOf(t, w.Body.Bytes())
	if second.Replaced == nil || second.Replaced.Created != first.Clipboard.Created || second.Replaced.Frames != 48000 || second.ReplacedSeconds != 1 {
		t.Fatalf("the second grab = %s", w.Body.String())
	}
	if len(second.Crated) != 0 || crateCount(t, r) != 0 {
		t.Fatalf("crate: false still crated: %s, the crate has %d", w.Body.String(), crateCount(t, r))
	}

	// Undo for the wrong grab does nothing; for this one it brings back the
	// first, and the grab undone is not the clipboard any more.
	q := url.Values{"replaced": {"1"}, "by": {first.Clipboard.Created}}
	want(t, send(t, r, http.MethodPost, "/api/clipboard/restore?"+q.Encode(), ""), http.StatusConflict, "an Undo for another grab")
	q.Set("by", second.Clipboard.Created)
	w = send(t, r, http.MethodPost, "/api/clipboard/restore?"+q.Encode(), "")
	want(t, w, http.StatusOK, "Undo")
	if got := replacedOf(t, w.Body.Bytes()); got.Clipboard == nil || got.Clipboard.Created != first.Clipboard.Created {
		t.Fatalf("Undo = %s", w.Body.String())
	}
	if cur := replacedOf(t, send(t, r, http.MethodGet, "/api/clipboard", "").Body.Bytes()); cur.Clipboard == nil || cur.Clipboard.Created != first.Clipboard.Created {
		t.Fatalf("the clipboard after Undo = %+v", cur.Clipboard)
	}
	want(t, send(t, r, http.MethodPost, "/api/clipboard/restore?"+q.Encode(), ""), http.StatusConflict, "a second Undo")

	// Without `crate: false` the crate is as it always was, and the answer
	// says what was replaced all the same.
	w = send(t, r, http.MethodPost, "/api/clipboard", `{"ring_from":260000,"ring_to":308000,"sources":["ch2"]}`)
	want(t, w, http.StatusOK, "a grab without the option")
	if b := replacedOf(t, w.Body.Bytes()); len(b.Crated) != 1 || b.Replaced == nil || crateCount(t, r) != 1 {
		t.Fatalf("a flag-off grab = %s, the crate has %d", w.Body.String(), crateCount(t, r))
	}

	// The plain restore is still a toss's Undo, and says so when nothing was tossed.
	want(t, send(t, r, http.MethodPost, "/api/clipboard/restore", ""), http.StatusConflict, "nothing tossed")
}

func TestATakesGrabUndoToo(t *testing.T) {
	r, dir := newBufferAPI(t)
	makeLoadedTape(t, r)
	take := writeRealTake(t, dir, "jam_2026-10-15_09-00-00.wav", 48000*20)
	bpm := 120.0
	if err := audio.WriteMeta(take, audio.Meta{Label: "Tuesday jam", BPM: &bpm}); err != nil {
		t.Fatal(err)
	}
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"ring_from":240000,"ring_to":288000,"sources":["ch2"],"crate":false}`), http.StatusOK, "a grab")
	w := send(t, r, http.MethodPost, "/api/clipboard", `{"take":"jam_2026-10-15_09-00-00.wav","from":192000,"to":384000,"grab":true,"crate":false}`)
	want(t, w, http.StatusOK, "a take's grab")
	b := replacedOf(t, w.Body.Bytes())
	if b.Replaced == nil || b.ReplacedSeconds != 1 || len(b.Crated) != 0 || crateCount(t, r) != 0 {
		t.Fatalf("a take's grab = %s", w.Body.String())
	}
}
