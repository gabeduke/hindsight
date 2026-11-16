package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

type editBody struct {
	Edit struct {
		Clipboard *struct {
			Created string `json:"created"`
		} `json:"clipboard"`
		Replaced *struct {
			Created string `json:"created"`
		} `json:"replaced"`
	} `json:"edit"`
}

// The review of F3: a range's Cut and Copy say what they replaced, and the
// Undo route is strict.
func TestARangeCopyOverAnUnusedCopyIsUndoneNotCrated(t *testing.T) {
	r, _ := newBufferAPI(t)
	id := makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"tempo":{"bpm":120,"bars":4}}`), http.StatusOK, "a tempo")
	ribbonCopy(t, r, 240000, 432000)
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"track":1}`), http.StatusOK, "drop it, so there is something to copy")
	unused := ribbonCopy(t, r, 240000, 432000)
	crate := crateCount(t, r)

	w := send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"copy","track":1,"no_crate":true}`)
	want(t, w, http.StatusOK, "copy")
	var e editBody
	json.Unmarshal(w.Body.Bytes(), &e)
	if e.Edit.Replaced == nil || e.Edit.Replaced.Created != unused.Clipboard.Created || e.Edit.Clipboard == nil {
		t.Fatalf("the copy's answer = %s", w.Body.String())
	}
	if crateCount(t, r) != crate {
		t.Fatalf("the crate grew from %d to %d", crate, crateCount(t, r))
	}
	q := url.Values{"replaced": {"1"}, "by": {e.Edit.Clipboard.Created}}
	w = send(t, r, http.MethodPost, "/api/clipboard/restore?"+q.Encode(), "")
	want(t, w, http.StatusOK, "Undo the copy")
	if got := replacedOf(t, w.Body.Bytes()); got.Clipboard == nil || got.Clipboard.Created != unused.Clipboard.Created {
		t.Fatalf("Undo = %s", w.Body.String())
	}
}

func TestTheReplacedOptionIsStrict(t *testing.T) {
	r, _ := newBufferAPI(t)
	makeLoadedTape(t, r)
	ribbonCopy(t, r, 240000, 288000)
	b := ribbonCopy(t, r, 250000, 298000)
	want(t, send(t, r, http.MethodPost, "/api/clipboard/restore", ""), http.StatusBadRequest, "no replaced")
	for _, v := range []string{"true", "0", "", "yes"} {
		want(t, send(t, r, http.MethodPost, "/api/clipboard/restore?replaced="+v, ""), http.StatusBadRequest, "replaced="+v)
	}
	if cur := replacedOf(t, send(t, r, http.MethodGet, "/api/clipboard", "").Body.Bytes()); cur.Clipboard == nil || cur.Clipboard.Created != b.Clipboard.Created {
		t.Fatalf("a malformed Undo changed the clipboard: %+v", cur.Clipboard)
	}
}

func TestUndoAfterADropSaysSoPlainly(t *testing.T) {
	r, _ := newBufferAPI(t)
	id := makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"tempo":{"bpm":120,"bars":4}}`), http.StatusOK, "a tempo")
	ribbonCopy(t, r, 240000, 288000)
	b := ribbonCopy(t, r, 250000, 298000)
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"track":1}`), http.StatusOK, "drop")
	w := send(t, r, http.MethodPost, "/api/clipboard/restore?replaced=1&by="+url.QueryEscape(b.Clipboard.Created), "")
	want(t, w, http.StatusConflict, "Undo after a drop")
	if !strings.Contains(w.Body.String(), "Already dropped or kept — undo the drop instead") {
		t.Fatalf("says %s", w.Body.String())
	}
}
