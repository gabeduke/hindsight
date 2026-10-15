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

// The review of F3: a range's Cut and Copy, and the toss's Undo, take the same
// option as GRAB, and say what they replaced.
func TestARangeCopyOverAnUnusedGrabIsUndoneNotCrated(t *testing.T) {
	r, _ := newBufferAPI(t)
	id := makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"tempo":{"bpm":120,"bars":4}}`), http.StatusOK, "a tempo")
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"seconds":4,"sources":["main"],"crate":false}`), http.StatusOK, "a grab")
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"track":1}`), http.StatusOK, "drop it, so there is something to copy")
	w := send(t, r, http.MethodPost, "/api/clipboard", `{"seconds":4,"sources":["main"],"crate":false}`)
	want(t, w, http.StatusOK, "an unused grab")
	grab := replacedOf(t, w.Body.Bytes())
	crate := crateCount(t, r)

	w = send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"copy","track":1,"no_crate":true}`)
	want(t, w, http.StatusOK, "copy")
	var e editBody
	json.Unmarshal(w.Body.Bytes(), &e)
	if e.Edit.Replaced == nil || e.Edit.Replaced.Created != grab.Clipboard.Created || e.Edit.Clipboard == nil {
		t.Fatalf("the copy's answer = %s", w.Body.String())
	}
	if crateCount(t, r) != crate {
		t.Fatalf("the crate grew from %d to %d", crate, crateCount(t, r))
	}
	q := url.Values{"replaced": {"1"}, "by": {e.Edit.Clipboard.Created}}
	w = send(t, r, http.MethodPost, "/api/clipboard/restore?"+q.Encode(), "")
	want(t, w, http.StatusOK, "Undo the copy")
	if got := replacedOf(t, w.Body.Bytes()); got.Clipboard == nil || got.Clipboard.Created != grab.Clipboard.Created {
		t.Fatalf("Undo = %s", w.Body.String())
	}

	// Without the option the crate takes it, as it always did.
	want(t, send(t, r, http.MethodPost, "/api/tapes/edit?id="+id, `{"op":"copy","track":1}`), http.StatusOK, "copy, flag off")
	if crateCount(t, r) != crate+1 {
		t.Fatalf("without no_crate the crate has %d, want %d", crateCount(t, r), crate+1)
	}
}

func TestUndoingATossReplacesLikeAGrabDoes(t *testing.T) {
	r, _ := newBufferAPI(t)
	makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"seconds":2,"sources":["main"],"crate":false}`), http.StatusOK, "a grab")
	want(t, send(t, r, http.MethodDelete, "/api/clipboard?toss=1", ""), http.StatusOK, "toss")
	w := send(t, r, http.MethodPost, "/api/clipboard", `{"seconds":2,"sources":["main"],"crate":false}`)
	later := replacedOf(t, w.Body.Bytes())
	crate := crateCount(t, r)
	w = send(t, r, http.MethodPost, "/api/clipboard/restore?crate=0", "")
	want(t, w, http.StatusOK, "undo the toss")
	b := replacedOf(t, w.Body.Bytes())
	if b.Replaced == nil || b.Replaced.Created != later.Clipboard.Created || len(b.Crated) != 0 || crateCount(t, r) != crate {
		t.Fatalf("undo toss = %s, the crate has %d", w.Body.String(), crateCount(t, r))
	}
}

func TestTheReplacedOptionIsStrict(t *testing.T) {
	r, _ := newBufferAPI(t)
	makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"seconds":2,"sources":["main"]}`), http.StatusOK, "a grab")
	want(t, send(t, r, http.MethodDelete, "/api/clipboard?toss=1", ""), http.StatusOK, "toss")
	for _, v := range []string{"true", "0", "", "yes"} {
		want(t, send(t, r, http.MethodPost, "/api/clipboard/restore?replaced="+v, ""), http.StatusBadRequest, "replaced="+v)
	}
	if !strings.Contains(send(t, r, http.MethodGet, "/api/clipboard", "").Body.String(), `"clipboard":null`) {
		t.Fatal("a malformed Undo fell through to the toss's restore")
	}
}

func TestUndoAfterADropSaysSoPlainly(t *testing.T) {
	r, _ := newBufferAPI(t)
	id := makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"tempo":{"bpm":120,"bars":4}}`), http.StatusOK, "a tempo")
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"seconds":2,"sources":["main"],"crate":false}`), http.StatusOK, "a")
	w := send(t, r, http.MethodPost, "/api/clipboard", `{"seconds":2,"sources":["main"],"crate":false}`)
	b := replacedOf(t, w.Body.Bytes())
	want(t, send(t, r, http.MethodPost, "/api/tapes/drop?id="+id, `{"track":1}`), http.StatusOK, "drop")
	w = send(t, r, http.MethodPost, "/api/clipboard/restore?replaced=1&by="+url.QueryEscape(b.Clipboard.Created), "")
	want(t, w, http.StatusConflict, "Undo after a drop")
	if !strings.Contains(w.Body.String(), "Already dropped or kept — undo the drop instead") {
		t.Fatalf("says %s", w.Body.String())
	}
}
