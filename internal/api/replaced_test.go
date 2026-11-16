package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"

	"github.com/gorilla/mux"
)

// F3 of the flow spec, since GRAB went to the cue lane: the buffer a copy
// replaces before anyone used it is held, one, and
// `restore?replaced=1&by=` is the Undo. A range's Cut and Copy answer it as
// `replaced` (replaced_more_test.go); a copy off the ribbon or a take holds
// it all the same.

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
	clips, err := bufferEngines[r].CrateList("", "")
	if err != nil {
		t.Fatal(err)
	}
	return len(clips)
}

// ribbonCopy copies ring frames [from, to) of ch2 onto the clipboard and
// answers the clipboard it made.
func ribbonCopy(t *testing.T, r *mux.Router, from, to int) replacedBody {
	t.Helper()
	w := send(t, r, http.MethodPost, "/api/clipboard", fmt.Sprintf(`{"ring_from":%d,"ring_to":%d,"source":"ch2"}`, from, to))
	want(t, w, http.StatusOK, "a copy off the ribbon")
	b := replacedOf(t, w.Body.Bytes())
	if b.Clipboard == nil {
		t.Fatalf("copy = %s", w.Body.String())
	}
	return b
}

func TestACopysUndoOverTheClipboardRoutes(t *testing.T) {
	r, _ := newBufferAPI(t)
	makeLoadedTape(t, r)
	first := ribbonCopy(t, r, 240000, 288000)
	// A second, the first never dropped: the crate stays empty.
	second := ribbonCopy(t, r, 250000, 298000)
	if crateCount(t, r) != 0 {
		t.Fatalf("the crate has %d", crateCount(t, r))
	}

	// Undo for the wrong copy does nothing; for this one it brings back the
	// first, and the copy undone is not the clipboard any more.
	q := url.Values{"replaced": {"1"}, "by": {first.Clipboard.Created}}
	want(t, send(t, r, http.MethodPost, "/api/clipboard/restore?"+q.Encode(), ""), http.StatusConflict, "an Undo for another copy")
	q.Set("by", second.Clipboard.Created)
	w := send(t, r, http.MethodPost, "/api/clipboard/restore?"+q.Encode(), "")
	want(t, w, http.StatusOK, "Undo")
	if got := replacedOf(t, w.Body.Bytes()); got.Clipboard == nil || got.Clipboard.Created != first.Clipboard.Created || got.Clipboard.Frames != 48000 {
		t.Fatalf("Undo = %s", w.Body.String())
	}
	if cur := replacedOf(t, send(t, r, http.MethodGet, "/api/clipboard", "").Body.Bytes()); cur.Clipboard == nil || cur.Clipboard.Created != first.Clipboard.Created {
		t.Fatalf("the clipboard after Undo = %+v", cur.Clipboard)
	}
	want(t, send(t, r, http.MethodPost, "/api/clipboard/restore?"+q.Encode(), ""), http.StatusConflict, "a second Undo")
}

func TestATakesCopyUndoToo(t *testing.T) {
	r, dir := newBufferAPI(t)
	makeLoadedTape(t, r)
	writeRealTake(t, dir, "jam_2026-10-15_09-00-00.wav", 48000*20)
	first := ribbonCopy(t, r, 240000, 288000)
	w := send(t, r, http.MethodPost, "/api/clipboard", `{"take":"jam_2026-10-15_09-00-00.wav","from":192000,"to":384000}`)
	want(t, w, http.StatusOK, "a take's copy")
	b := replacedOf(t, w.Body.Bytes())
	q := url.Values{"replaced": {"1"}, "by": {b.Clipboard.Created}}
	w = send(t, r, http.MethodPost, "/api/clipboard/restore?"+q.Encode(), "")
	want(t, w, http.StatusOK, "Undo the take's copy")
	if got := replacedOf(t, w.Body.Bytes()); got.Clipboard == nil || got.Clipboard.Created != first.Clipboard.Created || crateCount(t, r) != 0 {
		t.Fatalf("Undo = %s, the crate has %d", w.Body.String(), crateCount(t, r))
	}
}
