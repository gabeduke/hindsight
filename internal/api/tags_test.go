package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gorilla/mux"
)

func putTags(t *testing.T, r *mux.Router, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/tags", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func getTags(t *testing.T, r *mux.Router) []Tag {
	t.Helper()
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/tags", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/tags = %d (%s)", w.Code, w.Body.String())
	}
	var got struct {
		Tags []Tag `json:"tags"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return got.Tags
}

func TestTagsStartEmptyAndRoundTrip(t *testing.T) {
	r, dir := newTestAPI(t)
	if got := getTags(t, r); got == nil || len(got) != 0 {
		t.Fatalf("tags = %#v, want an empty list (not null)", got)
	}

	w := putTags(t, r, `{"tags":[{"name":" Ideas ","color":6},{"name":"Keepers","color":7}]}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT = %d (%s)", w.Code, w.Body.String())
	}
	got := getTags(t, r)
	if len(got) != 2 || got[0].Name != "Ideas" || got[0].Color != 6 || got[1].Name != "Keepers" {
		t.Fatalf("tags = %#v", got)
	}
	for _, g := range got {
		if !tagIDRE.MatchString(g.ID) {
			t.Errorf("id %q was not made by this code", g.ID)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "tags.json")); err != nil {
		t.Errorf("tags.json not written: %v", err)
	}

	// Saving the list back keeps the ids: a rename must not orphan the takes.
	body, _ := json.Marshal(map[string][]Tag{"tags": {{ID: got[0].ID, Name: "Sketches", Color: 6}, got[1]}})
	if w := putTags(t, r, string(body)); w.Code != http.StatusOK {
		t.Fatalf("PUT rename = %d (%s)", w.Code, w.Body.String())
	}
	again := getTags(t, r)
	if again[0].ID != got[0].ID || again[0].Name != "Sketches" {
		t.Errorf("after a rename tags = %#v, want the same id under the new name", again)
	}
}

func TestTagsRejectBadLists(t *testing.T) {
	r, _ := newTestAPI(t)
	if w := putTags(t, r, `{"tags":[{"name":"Keep","color":1}]}`); w.Code != http.StatusOK {
		t.Fatalf("setup PUT = %d", w.Code)
	}
	many := make([]string, maxTags+1)
	for i := range many {
		many[i] = `{"name":"t` + strings.Repeat("x", i%5) + string(rune('a'+i)) + `","color":1}`
	}
	for name, body := range map[string]string{
		"not an object":  `[]`,
		"no list":        `{}`,
		"empty name":     `{"tags":[{"name":"  ","color":1}]}`,
		"duplicate name": `{"tags":[{"name":"Ideas","color":1},{"name":"ideas","color":2}]}`,
		"color too low":  `{"tags":[{"name":"A","color":0}]}`,
		"color too high": `{"tags":[{"name":"A","color":9}]}`,
		"name too long":  `{"tags":[{"name":"` + strings.Repeat("n", maxTagName+1) + `","color":1}]}`,
		"too many":       `{"tags":[` + strings.Join(many, ",") + `]}`,
		"duplicate id":   `{"tags":[{"id":"t000001","name":"A","color":1},{"id":"t000001","name":"B","color":2}]}`,
	} {
		w := putTags(t, r, body)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: PUT = %d, want 400", name, w.Code)
		}
	}
	if got := getTags(t, r); len(got) != 1 || got[0].Name != "Keep" {
		t.Errorf("a rejected PUT changed the list: %#v", got)
	}
}

func TestPatchTakeTag(t *testing.T) {
	r, dir := newTestAPI(t)
	wav := writeTake(t, dir, "jam_tagged.wav")
	if w := putTags(t, r, `{"tags":[{"name":"Ideas","color":6}]}`); w.Code != http.StatusOK {
		t.Fatalf("PUT = %d", w.Code)
	}
	id := getTags(t, r)[0].ID

	if w := patch(t, r, "jam_tagged.wav", `{"tag":"t0nope0"}`); w.Code != http.StatusBadRequest {
		t.Errorf("an unknown tag = %d, want 400", w.Code)
	}
	if got := audio.ReadMeta(wav).Tag; got != "" {
		t.Errorf("a rejected tag was stored: %q", got)
	}

	w := patch(t, r, "jam_tagged.wav", `{"tag":"`+id+`"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH tag = %d (%s)", w.Code, w.Body.String())
	}
	var resp struct {
		Tag string `json:"tag"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Tag != id || audio.ReadMeta(wav).Tag != id {
		t.Errorf("tag = response %q, sidecar %q, want %q", resp.Tag, audio.ReadMeta(wav).Tag, id)
	}

	// Another field's patch leaves the tag alone.
	if w := patch(t, r, "jam_tagged.wav", `{"label":"hello"}`); w.Code != http.StatusOK {
		t.Fatalf("PATCH label = %d", w.Code)
	}
	if got := audio.ReadMeta(wav).Tag; got != id {
		t.Errorf("a label patch changed the tag to %q", got)
	}

	// Dropping the tag from the list leaves the id on the take (it reads as
	// untagged); clearing it is "".
	if w := putTags(t, r, `{"tags":[]}`); w.Code != http.StatusOK {
		t.Fatalf("PUT empty = %d", w.Code)
	}
	if got := audio.ReadMeta(wav).Tag; got != id {
		t.Errorf("deleting a tag rewrote the take: %q", got)
	}
	if w := patch(t, r, "jam_tagged.wav", `{"tag":""}`); w.Code != http.StatusOK {
		t.Fatalf("PATCH clear = %d (%s)", w.Code, w.Body.String())
	}
	if got := audio.ReadMeta(wav).Tag; got != "" {
		t.Errorf("tag after clearing = %q", got)
	}
}
