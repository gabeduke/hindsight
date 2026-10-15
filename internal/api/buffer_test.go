package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
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
	return r, dir
}

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
	r, dir := newBufferAPI(t)
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

	// The window, in frames from the grab's start.
	w = send(t, r, http.MethodPatch, "/api/clipboard", `{"in":-48000,"out":96000}`)
	want(t, w, http.StatusOK, "trim")
	if c := boardOf(t, w.Body).Clipboard; c.Frames != 144000 || c.Grab.In != -48000 || c.Tracks[0][0].Src != 48000 || c.Tracks[0][0].Frames != 144000 {
		t.Fatalf("trim = %s", w.Body.String())
	}
	want(t, send(t, r, http.MethodPatch, "/api/clipboard", `{"in":0}`), http.StatusBadRequest, "half a window")
	want(t, send(t, r, http.MethodPatch, "/api/clipboard", `{}`), http.StatusBadRequest, "nothing to change")
	w = send(t, r, http.MethodPatch, "/api/clipboard", `{"gain_db":-3}`)
	want(t, w, http.StatusOK, "gain")
	if c := boardOf(t, w.Body).Clipboard; c.Tracks[1][0].GainDB != -3 {
		t.Fatalf("gain = %s", w.Body.String())
	}

	// KEEP AS TAKE: a take on the shelf, its two lanes summed.
	w = send(t, r, http.MethodPost, "/api/clipboard/keep", "")
	want(t, w, http.StatusOK, "keep")
	var k struct {
		Name    string  `json:"name"`
		Label   string  `json:"label"`
		Seconds float64 `json:"seconds"`
	}
	json.Unmarshal(w.Body.Bytes(), &k)
	if k.Label != "Buffer · ch1 + aux" || k.Seconds != 3 {
		t.Fatalf("keep = %s", w.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, k.Name)); err != nil {
		t.Fatalf("the take isn't on the shelf: %v", err)
	}
	if m := audio.ReadMeta(filepath.Join(dir, k.Name)); m.Origin != "buffer" || m.BPM == nil || *m.BPM != 120 {
		t.Fatalf("meta = %+v", m)
	}

	// TOSS, and its Undo.
	want(t, send(t, r, http.MethodDelete, "/api/clipboard?toss=1", ""), http.StatusOK, "toss")
	if !strings.Contains(send(t, r, http.MethodGet, "/api/clipboard", "").Body.String(), `"clipboard":null`) {
		t.Fatal("tossed, the clipboard isn't empty")
	}
	w = send(t, r, http.MethodPost, "/api/clipboard/restore", "")
	want(t, w, http.StatusOK, "restore")
	if c := boardOf(t, w.Body).Clipboard; c == nil || c.Grab == nil || c.Frames != 144000 {
		t.Fatalf("restored = %s", w.Body.String())
	}
	want(t, send(t, r, http.MethodPost, "/api/clipboard/restore", ""), http.StatusConflict, "nothing tossed")

	// A span of the feed, its sources named. The last grab was kept as a
	// take, so replacing it keeps nothing in the crate.
	w = send(t, r, http.MethodPost, "/api/clipboard", `{"ring_from":240000,"ring_to":288000,"sources":["ch2"]}`)
	want(t, w, http.StatusOK, "grab a span")
	if b := boardOf(t, w.Body); len(b.Crated) != 0 || b.Clipboard.Grab.Frames != 48000 || b.Clipboard.Grab.Sources[0] != "ch2" {
		t.Fatalf("grab a span = %s", w.Body.String())
	}
	// That one wasn't used: Copy on the tape page puts it in the crate.
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"ring_from":240000,"ring_to":288000,"source":"main"}`), http.StatusOK, "copy")
	var crate struct {
		Clips []struct {
			Name string `json:"name"`
		} `json:"clips"`
	}
	json.Unmarshal(send(t, r, http.MethodGet, "/api/crate", "").Body.Bytes(), &crate)
	if len(crate.Clips) != 1 || crate.Clips[0].Name != "The feed (ch2) · 0:01" {
		t.Fatalf("the crate = %+v", crate.Clips)
	}
	// A copy is not a grab: no window to trim.
	want(t, send(t, r, http.MethodPatch, "/api/clipboard", `{"in":0,"out":100}`), http.StatusBadRequest, "trim a copy")

	// Several lanes kept on the crate, a clip each.
	want(t, send(t, r, http.MethodPost, "/api/clipboard", `{"seconds":2,"sources":["ch1","ch2"]}`), http.StatusOK, "grab seconds")
	w = send(t, r, http.MethodPost, "/api/crate", `{"clipboard":true}`)
	want(t, w, http.StatusOK, "keep the lanes")
	var kept struct {
		Clip  json.RawMessage   `json:"clip"`
		Clips []json.RawMessage `json:"clips"`
	}
	json.Unmarshal(w.Body.Bytes(), &kept)
	if len(kept.Clips) != 2 || len(kept.Clip) == 0 {
		t.Fatalf("kept = %s", w.Body.String())
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
	want(t, send(t, r, http.MethodPatch, "/api/clipboard", `{"gain_db":1}`), http.StatusConflict, "nothing in the buffer")
	want(t, send(t, r, http.MethodPost, "/api/clipboard/keep", ""), http.StatusConflict, "nothing to keep")
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
	want(t, send(t, r, http.MethodPatch, "/api/clipboard", `{"in":0,"out":1000}`), http.StatusBadRequest, "trim a plain copy")

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
	// It trims inside those handles.
	w = send(t, r, http.MethodPatch, "/api/clipboard", `{"in":-96000,"out":288000}`)
	want(t, w, http.StatusOK, "trim a take's grab")
	if c := boardOf(t, w.Body).Clipboard; c.Grab.In != -96000+480 || c.Frames != 288000+96000-480*2 {
		t.Fatalf("trimmed = %s", w.Body.String())
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
