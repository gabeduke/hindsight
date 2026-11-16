package api

import (
	"encoding/json"
	"net/http"
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

// grabBody is what /api/tapes/cue/grab answers of the clip it made.
type grabBody struct {
	Edit struct {
		CueClip *struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Frames int64  `json:"frames"`
			Lanes  []struct {
				Source string `json:"source"`
			} `json:"lanes"`
			Grab *struct {
				Sources []string `json:"sources"`
				Wall    bool     `json:"wall"`
				Why     string   `json:"why"`
				In      int64    `json:"in"`
				Out     int64    `json:"out"`
				Before  int64    `json:"before"`
				After   int64    `json:"after"`
				Frames  int64    `json:"frames"`
				Take    string   `json:"take"`
			} `json:"grab"`
		} `json:"cue_clip"`
	} `json:"edit"`
}

func grabOf(t *testing.T, w interface{ Bytes() []byte }) grabBody {
	t.Helper()
	var b grabBody
	if err := json.Unmarshal(w.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	if b.Edit.CueClip == nil || b.Edit.CueClip.Grab == nil {
		t.Fatalf("no grabbed cue clip in %s", w.Bytes())
	}
	return b
}

func TestGrabOverTheAPI(t *testing.T) {
	r, _ := newBufferAPI(t)
	id := makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodPatch, "/api/tapes?id="+id, `{"tempo":{"bpm":120,"bars":4}}`), http.StatusOK, "a tempo")

	// GRAB the last 2 bars, from two inputs: the tape isn't playing, so
	// it's two bars of wall-clock time, and it says why.
	w := send(t, r, http.MethodPost, "/api/tapes/cue/grab", `{"bars":2,"sources":["aux","ch1"]}`)
	want(t, w, http.StatusOK, "grab")
	c := grabOf(t, w.Body).Edit.CueClip
	if !c.Grab.Wall || c.Grab.Why != "the tape isn't playing" || len(c.Lanes) != 2 || c.Frames != 192000 ||
		c.Lanes[0].Source != "ch1" || c.Lanes[1].Source != "aux" || c.Name != "ch1 + aux" {
		t.Fatalf("grab = %s", w.Body.String())
	}
	// Its handle before is a bar; the one after is what the ring had: none.
	if c.Grab.Before != 96000 || c.Grab.In != 0 || c.Grab.Out != 192000 {
		t.Fatalf("grab = %+v", c.Grab)
	}

	// A span of the feed, its inputs named.
	w = send(t, r, http.MethodPost, "/api/tapes/cue/grab", `{"ring_from":240000,"ring_to":288000,"sources":["ch2"]}`)
	want(t, w, http.StatusOK, "grab a span")
	if c := grabOf(t, w.Body).Edit.CueClip; c.Grab.Frames != 48000 || c.Grab.Sources[0] != "ch2" {
		t.Fatalf("grab a span = %s", w.Body.String())
	}

	// Refusals: an input there isn't, nothing named, too many seconds.
	want(t, send(t, r, http.MethodPost, "/api/tapes/cue/grab", `{"bars":2,"sources":["ch9"]}`), http.StatusBadRequest, "no such source")
	want(t, send(t, r, http.MethodPost, "/api/tapes/cue/grab", `{"sources":[]}`), http.StatusBadRequest, "grab what?")
	want(t, send(t, r, http.MethodPost, "/api/tapes/cue/grab", `{"seconds":600,"sources":["main"]}`), http.StatusBadRequest, "ten minutes")

	// The clipboard's route no longer GRABs: what the Studio's buffer sent
	// there is refused, and fills nothing.
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"bars":2,"sources":["aux"]}`), http.StatusBadRequest, "a GRAB at the clipboard")
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"seconds":2,"sources":["aux"]}`), http.StatusBadRequest, "a GRAB at the clipboard")
	if !strings.Contains(send(t, r, http.MethodGet, "/api/clipboard", "").Body.String(), `"clipboard":null`) {
		t.Fatal("a GRAB at the clipboard filled it")
	}
}

func TestGrabbingBarsNeedsATempo(t *testing.T) {
	r, _ := newBufferAPI(t)
	makeLoadedTape(t, r)
	w := send(t, r, http.MethodPost, "/api/tapes/cue/grab", `{"bars":4,"sources":["main"]}`)
	want(t, w, http.StatusBadRequest, "bars with no tempo")
	if !strings.Contains(w.Body.String(), "no tempo") {
		t.Fatalf("says %s", w.Body.String())
	}
	// Seconds instead: what the page's GRAB 8 s sends.
	want(t, send(t, r, http.MethodPost, "/api/tapes/cue/grab", `{"seconds":8,"sources":["main"]}`), http.StatusOK, "seconds")
}

func TestGrabNeedsACapture(t *testing.T) {
	r, _ := newTapeAPI(t)
	makeLoadedTape(t, r)
	want(t, send(t, r, http.MethodPost, "/api/tapes/cue/grab", `{"seconds":8,"sources":["main"]}`), http.StatusConflict, "no capture")
}

// The Listening Room's "to the studio": a note's span of a take, onto the
// cue lane with handles -- and the take page's Copy, a copy as ever.
func TestATakesSpanGrabbedOntoTheCueLane(t *testing.T) {
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
	var copied struct {
		Clipboard *struct {
			From string          `json:"from"`
			Grab json.RawMessage `json:"grab"`
		} `json:"clipboard"`
	}
	json.Unmarshal(w.Body.Bytes(), &copied)
	if copied.Clipboard == nil || copied.Clipboard.Grab != nil || copied.Clipboard.From != "jam_2026-10-15_09-00-00.wav" {
		t.Fatalf("a plain take copy = %s", w.Body.String())
	}

	// GRAB'd onto the lane: handles of a bar at the take's tempo.
	w = send(t, r, http.MethodPost, "/api/tapes/cue/grab", `{"take":"jam_2026-10-15_09-00-00.wav","from":192000,"to":384000}`)
	want(t, w, http.StatusOK, "grab a take's span")
	c := grabOf(t, w.Body).Edit.CueClip
	g := c.Grab
	if g.Take != "jam_2026-10-15_09-00-00.wav" || g.Before != 96000 || g.After != 96000 ||
		len(g.Sources) != 1 || g.Sources[0] != "Tuesday jam" || c.Frames != 192000 {
		t.Fatalf("a take's grab = %s", w.Body.String())
	}
	// Its sources are the take's own: they can't change.
	w = send(t, r, http.MethodPost, "/api/tapes/cue/grab", `{"clip":"`+c.ID+`","sources":["ch1"]}`)
	want(t, w, http.StatusBadRequest, "other sources for a take's grab")
	if !strings.Contains(w.Body.String(), "take") {
		t.Fatalf("says %s", w.Body.String())
	}
}
