package api

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
)

type cueEditBody struct {
	Tape struct {
		Tracks []struct {
			Clips []struct {
				Source string `json:"source"`
				Src    int64  `json:"src"`
			} `json:"clips"`
		} `json:"tracks"`
		Cue *struct {
			Clips []cueClipBody `json:"clips"`
		} `json:"cue"`
	} `json:"tape"`
	Edit struct {
		Op          string       `json:"op"`
		CueClip     *cueClipBody `json:"cue_clip"`
		CueReplaced *cueClipBody `json:"cue_replaced"`
	} `json:"edit"`
}

type cueClipBody struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Frames int64  `json:"frames"`
	Lanes  []struct {
		Source string `json:"source"`
		Src    int64  `json:"src"`
	} `json:"lanes"`
	Grab *struct {
		In     int64 `json:"in"`
		Before int64 `json:"before"`
	} `json:"grab"`
	Touched bool    `json:"touched"`
	GainDB  float64 `json:"gain_db"`
}

func cueEditOf(t *testing.T, w interface{ Bytes() []byte }) cueEditBody {
	t.Helper()
	var b cueEditBody
	if err := json.Unmarshal(w.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	return b
}

func TestTheCueClipsDrawerOverTheAPI(t *testing.T) {
	r, dir := newBufferAPI(t)
	id := makeLoadedTape(t, r)
	q := "?id=" + id
	want(t, send(t, r, http.MethodPatch, "/api/tapes"+q, `{"tempo":{"bpm":120,"bars":4}}`), http.StatusOK, "a tempo") // handles of a bar

	// GRAB onto the lane: a clip with a lane per input, and the clipboard
	// left as it was.
	w := send(t, r, http.MethodPost, "/api/tapes/cue/grab"+q, `{"seconds":2,"sources":["aux","ch1"]}`)
	want(t, w, http.StatusOK, "grab onto the lane")
	b := cueEditOf(t, w.Body)
	c := b.Edit.CueClip
	if b.Edit.Op != "cue-grab" || c == nil || len(c.Lanes) != 2 || c.Lanes[0].Source != "ch1" || c.Frames != 96000 || c.Grab == nil || b.Edit.CueReplaced != nil {
		t.Fatalf("grab = %s", w.Body.String())
	}
	if w := send(t, r, http.MethodGet, "/api/clipboard", ""); w.Body.String() != "{\"clipboard\":null}\n" {
		t.Fatalf("the clipboard = %s", w.Body.String())
	}
	// Again, untouched: in its place. With no id, it's the loaded tape's lane.
	w = send(t, r, http.MethodPost, "/api/tapes/cue/grab", `{"seconds":1,"sources":["aux"]}`)
	want(t, w, http.StatusOK, "grab again")
	b = cueEditOf(t, w.Body)
	if b.Edit.CueReplaced == nil || b.Edit.CueReplaced.ID != c.ID || len(b.Tape.Cue.Clips) != 1 {
		t.Fatalf("second grab = %s", w.Body.String())
	}
	c = b.Edit.CueClip
	// Its inputs, changed: the same clip.
	w = send(t, r, http.MethodPost, "/api/tapes/cue/grab"+q, `{"clip":"`+c.ID+`","sources":["ch1","ch2"]}`)
	want(t, w, http.StatusOK, "other inputs")
	if got := cueEditOf(t, w.Body).Edit.CueClip; got.ID != c.ID || len(got.Lanes) != 2 || !got.Touched || got.Name != "ch1 + ch2" {
		t.Fatalf("other inputs = %s", w.Body.String())
	}

	// The drawer: its window, then its level.
	want(t, send(t, r, http.MethodPatch, "/api/tapes/cue/clip"+q, `{"clip":"`+c.ID+`","in":-24000,"out":24000,"gain_db":-2}`), http.StatusBadRequest, "a window and a shape at once")
	want(t, send(t, r, http.MethodPatch, "/api/tapes/cue/clip"+q, `{"clip":"`+c.ID+`","in":-24000,"out":24000}`), http.StatusOK, "trim")
	w = send(t, r, http.MethodPatch, "/api/tapes/cue/clip"+q, `{"clip":"`+c.ID+`","gain_db":-2}`)
	want(t, w, http.StatusOK, "level")
	if got := cueEditOf(t, w.Body).Edit.CueClip; got.Frames != 48000 || got.Grab.In != -24000 || got.GainDB != -2 || got.Lanes[0].Src != got.Grab.Before-24000 {
		t.Fatalf("trimmed = %s", w.Body.String())
	}
	want(t, send(t, r, http.MethodPatch, "/api/tapes/cue/clip"+q, `{"clip":"`+c.ID+`","in":0}`), http.StatusBadRequest, "half a window")
	want(t, send(t, r, http.MethodPatch, "/api/tapes/cue/clip"+q, `{"clip":"nope","gain_db":1}`), http.StatusBadRequest, "no such clip")

	// Audition, KEEP, DROP.
	if w := send(t, r, http.MethodGet, "/api/tapes/cue/audio"+q+"&clip="+c.ID, ""); w.Code != http.StatusOK || w.Header().Get("Content-Type") != "audio/wav" || w.Body.Len() != 44+48000*4 {
		t.Fatalf("audition = %d, %s, %d bytes", w.Code, w.Header().Get("Content-Type"), w.Body.Len())
	}
	w = send(t, r, http.MethodPost, "/api/tapes/cue/keep"+q, `{"clip":"`+c.ID+`"}`)
	want(t, w, http.StatusOK, "keep")
	var k struct {
		Name  string `json:"name"`
		Label string `json:"label"`
	}
	json.Unmarshal(w.Body.Bytes(), &k)
	if k.Label != "Grab · ch1 + ch2" || k.Name == "" {
		t.Fatalf("kept = %s", w.Body.String())
	}
	if _, err := filepath.Glob(filepath.Join(dir, k.Name)); err != nil {
		t.Fatal(err)
	}
	w = send(t, r, http.MethodPost, "/api/tapes/cue/drop"+q, `{"clip":"`+c.ID+`","track":3,"at":0}`)
	want(t, w, http.StatusOK, "drop")
	var d struct {
		Tracks int `json:"tracks"`
	}
	json.Unmarshal(w.Body.Bytes(), &d)
	if d.Tracks != 2 {
		t.Fatalf("drop = %s", w.Body.String())
	}
	want(t, send(t, r, http.MethodPost, "/api/tapes/cue/drop"+q, `{"clip":"`+c.ID+`","track":4,"at":0}`), http.StatusBadRequest, "two lanes from track 4")
}
