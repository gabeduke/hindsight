package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

func dialChanges(t *testing.T, r *mux.Router) *websocket.Conn {
	t.Helper()
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/api/tapes/changes", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	return c
}

func readChanges(t *testing.T, c *websocket.Conn, within time.Duration) changesMsg {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(within))
	var m changesMsg
	if err := c.ReadJSON(&m); err != nil {
		t.Fatalf("no message within %v: %v", within, err)
	}
	return m
}

// A change made through the API (as a controller makes one) reaches an open
// socket as a new revision at once, well before the beat would have said it.
func TestTheChangesSocketNudgesTheMomentTheTapeChanges(t *testing.T) {
	r, a := newTapeAPIWithAPI(t)
	id := makeLoadedTape(t, r)
	c := dialChanges(t, r)

	hello := readChanges(t, c, time.Second)
	if hello.Rev != a.tape.Changes().Rev() {
		t.Fatalf("hello rev %d, the engine's is %d", hello.Rev, a.tape.Changes().Rev())
	}
	if d := time.Since(time.UnixMilli(hello.AtMS)); d < 0 || d > time.Second {
		t.Fatalf("at_ms is %v off the clock", d)
	}

	// The hello has just been sent, so the next beat is a second away: a
	// message within 300 ms is the nudge.
	start := time.Now()
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"name":"Pushed"}`), http.StatusOK, "rename")
	m := readChanges(t, c, 300*time.Millisecond)
	if m.Rev <= hello.Rev {
		t.Fatalf("rev %d after the rename, was %d", m.Rev, hello.Rev)
	}
	if took := time.Since(start); took > 300*time.Millisecond {
		t.Fatalf("the nudge took %v", took)
	}
}

// Nothing happening, the socket still says the revision once a second, the
// same one: lib/socket.js would take a silent socket for a dead one.
func TestAQuietChangesSocketBeatsOnceASecond(t *testing.T) {
	r, _ := newTapeAPIWithAPI(t)
	makeLoadedTape(t, r)
	c := dialChanges(t, r)

	hello := readChanges(t, c, time.Second)
	start := time.Now()
	beat := readChanges(t, c, changesBeat+500*time.Millisecond)
	if took := time.Since(start); took < changesBeat/2 {
		t.Fatalf("a beat after %v, want about %v", took, changesBeat)
	}
	if beat.Rev != hello.Rev {
		t.Fatalf("a quiet tape's beat moved the rev: %d after %d", beat.Rev, hello.Rev)
	}
	readChanges(t, c, changesBeat+500*time.Millisecond)
}

// With the tape off there is nothing to watch: a 404, as the rest of
// /api/tapes answers, and no socket.
func TestTheChangesSocketIsNotFoundWithTheTapeOff(t *testing.T) {
	a := New(&config.Config{OutputDir: t.TempDir(), SampleRate: 48000, SaveChannels: []int{0, 1}}, nil, nil, nil, nil)
	r := mux.NewRouter()
	a.SetupRoutes(r)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/tapes/changes", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", w.Code)
	}
}
