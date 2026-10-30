package api

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/config"
	"github.com/gabeduke/hindsight/internal/tape"
	"github.com/gorilla/mux"
)

// ringCapture is a capture that is only its ring: eight channels, every
// frame f holding f×1000 on each, for ten seconds.
type ringCapture struct{ r *audio.Ring }

func (c ringCapture) Ring() *audio.Ring { return c.r }

// newBufferAPI is newTapeAPI with a ring to grab from (and nothing playing).
func newBufferAPI(t *testing.T) (*mux.Router, string) {
	t.Helper()
	dir := t.TempDir()
	cfg := &config.Config{OutputDir: dir, SampleRate: 48000, SaveChannels: []int{0, 1}}
	store, err := tape.OpenStore(t.TempDir(), 48000, 4, 60)
	if err != nil {
		t.Fatal(err)
	}
	ring := audio.NewRing(48000*20, 8)
	block := make([]int32, 4800*8)
	for f := 0; f < 480000; f += 4800 {
		for i := 0; i < 4800; i++ {
			for ch := 0; ch < 8; ch++ {
				block[i*8+ch] = int32((f + i) * 1000)
			}
		}
		ring.WriteFrames(block)
	}
	eng := tape.NewEngine(tape.Options{Store: store, Capture: ringCapture{ring}})
	if err := eng.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(eng.Stop)
	a := New(cfg, nil, nil, nil, nil)
	a.SetTape(eng)
	t.Cleanup(a.WaitBackground)
	r := mux.NewRouter()
	a.SetupRoutes(r)
	bufferEngines[r] = eng
	bufferAPIs[r] = a
	t.Cleanup(func() { delete(bufferEngines, r); delete(bufferAPIs, r) })
	return r, dir
}

// bufferEngines is each newBufferAPI router's tape engine, for reading what
// the HTTP API no longer shows (the crate).
var bufferEngines = map[*mux.Router]*tape.Engine{}

// bufferAPIs is each newBufferAPI router's API, for the verbs a controller runs.
var bufferAPIs = map[*mux.Router]*API{}

type boardBody struct {
	Clipboard *struct {
		Frames int64  `json:"frames"`
		From   string `json:"from"`
		Tracks [][]struct {
			Src    int64   `json:"src"`
			Frames int64   `json:"frames"`
			Source string  `json:"source"`
			GainDB float64 `json:"gain_db"`
		} `json:"tracks"`
		Grab *struct {
			Sources []string `json:"sources"`
			Wall    bool     `json:"wall"`
			In      int64    `json:"in"`
			Out     int64    `json:"out"`
			Before  int64    `json:"before"`
			Frames  int64    `json:"frames"`
		} `json:"grab"`
	} `json:"clipboard"`
	Wall   bool              `json:"wall"`
	Why    string            `json:"why"`
	Crated []json.RawMessage `json:"crated"`
}

func boardOf(t *testing.T, w interface{ Bytes() []byte }) boardBody {
	t.Helper()
	var b boardBody
	if err := json.Unmarshal(w.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	return b
}

func TestTheBufferOverTheAPI(t *testing.T) {
	r, _ := newBufferAPI(t)
	id := makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"tempo":{"bpm":120,"bars":4}}`), http.StatusOK, "a tempo")

	// GRAB the last 2 bars, from two sources: the tape isn't playing, so
	// it's two bars of wall-clock time, and it says why.
	w := send(t, r, http.MethodPost, "/api/clipboard", `{"bars":2,"sources":["aux","ch1"]}`)
	want(t, w, http.StatusOK, "grab")
	b := boardOf(t, w.Body)
	c := b.Clipboard
	if c == nil || c.Grab == nil || !b.Wall || b.Why != "the tape isn't playing" || len(c.Tracks) != 2 || c.Frames != 192000 ||
		c.Tracks[0][0].Source != "ch1" || c.Tracks[1][0].Source != "aux" || c.From != "the feed, last 2 bars (ch1 + aux)" {
		t.Fatalf("grab = %s", w.Body.String())
	}
	// Its handle before is a bar; the one after is what the ring had: none.
	if c.Grab.Before != 96000 || c.Grab.In != 0 || c.Grab.Out != 192000 {
		t.Fatalf("grab = %+v", c.Grab)
	}

	// TOSS, and its Undo.
	want(t, send(t, r, http.MethodDelete, "/api/clipboard?toss=1", ""), http.StatusOK, "toss")
	if !strings.Contains(send(t, r, http.MethodGet, "/api/clipboard", "").Body.String(), `"clipboard":null`) {
		t.Fatal("tossed, the clipboard isn't empty")
	}
	w = send(t, r, http.MethodPost, "/api/clipboard/restore", "")
	want(t, w, http.StatusOK, "restore")
	if c := boardOf(t, w.Body).Clipboard; c == nil || c.Grab == nil || c.Frames != 192000 {
		t.Fatalf("restored = %s", w.Body.String())
	}
	want(t, send(t, r, http.MethodPost, "/api/clipboard/restore", ""), http.StatusConflict, "nothing tossed")

	// A span of the feed, its sources named. The last grab was never used,
	// so replacing it puts it in the crate, a clip a lane.
	w = send(t, r, http.MethodPost, "/api/clipboard", `{"ring_from":240000,"ring_to":288000,"sources":["ch2"]}`)
	want(t, w, http.StatusOK, "grab a span")
	if b := boardOf(t, w.Body); len(b.Crated) != 2 || b.Clipboard.Grab.Frames != 48000 || b.Clipboard.Grab.Sources[0] != "ch2" {
		t.Fatalf("grab a span = %s", w.Body.String())
	}
	// That one wasn't used: Copy on the tape page puts it in the crate.
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"ring_from":240000,"ring_to":288000,"source":"main"}`), http.StatusOK, "copy")
	clips, err := bufferEngines[r].CrateList("", "")
	if err != nil || len(clips) != 3 || !slices.ContainsFunc(clips, func(k tape.CrateClip) bool { return k.Name == "The feed (ch2) · 0:01" }) {
		t.Fatalf("the crate = %+v (%v)", clips, err)
	}

	// Refusals: a source there isn't, nothing named, too many seconds.
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"bars":2,"sources":["ch9"]}`), http.StatusBadRequest, "no such source")
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"sources":[]}`), http.StatusBadRequest, "grab what?")
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"seconds":600,"sources":["main"]}`), http.StatusBadRequest, "ten minutes")
}

func TestGrabbingBarsNeedsATempo(t *testing.T) {
	r, _ := newBufferAPI(t)
	makeLoadedTape(t, r)
	w := send(t, r, http.MethodPost, "/api/clipboard", `{"bars":4,"sources":["main"]}`)
	want(t, w, http.StatusBadRequest, "bars with no tempo")
	if !strings.Contains(w.Body.String(), "no tempo") {
		t.Fatalf("says %s", w.Body.String())
	}
	// Seconds instead: what the page's GRAB 8 s sends.
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"seconds":8,"sources":["main"]}`), http.StatusOK, "seconds")
}

func TestTheBufferNeedsACapture(t *testing.T) {
	r, _ := newTapeAPI(t)
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"seconds":8,"sources":["main"]}`), http.StatusConflict, "no capture")
}

// The Listening Room's "to the studio": a note's span of a take, copied as
// the Studio's buffer with grab: true -- and without it, a copy as ever.
func TestATakesSpanCopiedAsAGrab(t *testing.T) {
	r, dir := newBufferAPI(t)
	makeLoadedTape(t, r)
	take := writeRealTake(t, dir, "jam_2026-10-15_09-00-00.wav", 48000*20)
	bpm := 120.0 // a bar is 2 s
	if err := audio.WriteMeta(take, audio.Meta{Label: "Tuesday jam", BPM: &bpm}); err != nil {
		t.Fatal(err)
	}

	// A plain copy from the take page, as it always was: no grab.
	w := send(t, r, http.MethodPost, "/api/clipboard", `{"take":"jam_2026-10-15_09-00-00.wav","from":192000,"to":384000}`)
	want(t, w, http.StatusOK, "copy")
	if b := boardOf(t, w.Body); b.Clipboard.Grab != nil || strings.Contains(w.Body.String(), `"grab"`) || b.Clipboard.From != "jam_2026-10-15_09-00-00.wav" {
		t.Fatalf("a plain take copy = %s", w.Body.String())
	}

	// With grab: true, it's the buffer: handles of a bar at the take's tempo.
	w = send(t, r, http.MethodPost, "/api/clipboard", `{"take":"jam_2026-10-15_09-00-00.wav","from":192000,"to":384000,"grab":true}`)
	want(t, w, http.StatusOK, "grab a take's span")
	var got struct {
		Clipboard struct {
			Frames int64  `json:"frames"`
			From   string `json:"from"`
			Grab   *struct {
				Take    string   `json:"take"`
				Sources []string `json:"sources"`
				Before  int64    `json:"before"`
				After   int64    `json:"after"`
				Stale   bool     `json:"stale"`
				Used    bool     `json:"used"`
			} `json:"grab"`
		} `json:"clipboard"`
	}
	json.Unmarshal(w.Body.Bytes(), &got)
	g := got.Clipboard.Grab
	if g == nil || g.Take != "jam_2026-10-15_09-00-00.wav" || g.Before != 96000 || g.After != 96000 || g.Stale || g.Used ||
		len(g.Sources) != 1 || g.Sources[0] != "Tuesday jam" || got.Clipboard.Frames != 192000 {
		t.Fatalf("a take's grab = %s", w.Body.String())
	}
	// Its sources are the take's own: they can't change.
	w = send(t, r, http.MethodPost, "/api/clipboard", `{"again":true,"sources":["ch1"]}`)
	want(t, w, http.StatusBadRequest, "other sources for a take's grab")
	if !strings.Contains(w.Body.String(), "take") {
		t.Fatalf("says %s", w.Body.String())
	}
	// Never dropped or kept, the next grab puts it in the crate.
	w = send(t, r, http.MethodPost, "/api/clipboard", `{"seconds":2,"sources":["aux"]}`)
	want(t, w, http.StatusOK, "replace it")
	if b := boardOf(t, w.Body); len(b.Crated) != 1 {
		t.Fatalf("crated = %s", w.Body.String())
	}
}
