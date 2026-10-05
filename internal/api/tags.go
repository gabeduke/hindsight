package api

// Tags: named colors the owner sorts takes by. The list is server-wide, in
// OUTPUT_DIR/tags.json, so a rename or a recolor shows on every device; each
// take names at most one tag by id in its sidecar (audio.Meta.Tag).
//
//	GET /api/tags            {"tags":[{"id","name","color"}]}
//	PUT /api/tags            {"tags":[...]} replaces the whole list
//
// A tag with no id gets one. Dropping a tag from the list leaves its id in
// the sidecars that held it; a take whose tag isn't in the list reads as
// untagged, so there is no sweep over every take to get wrong.

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	maxTags       = 24
	maxTagName    = 24
	tagColorCount = 8 // the stripe palette in styles.css: --stripe-1 .. --stripe-8
	tagsFile      = "tags.json"
)

// Tag is one entry in the list. Color is a slot in the stripe palette.
type Tag struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color int    `json:"color"`
}

var tagIDRE = regexp.MustCompile(`^t[0-9a-f]{6}$`)

func (a *API) tagsPath() string { return filepath.Join(a.cfg.OutputDir, tagsFile) }

// readTags loads the list; a missing or unreadable file is an empty list.
func (a *API) readTags() []Tag {
	b, err := os.ReadFile(a.tagsPath())
	if err != nil {
		return []Tag{}
	}
	var f struct {
		Tags []Tag `json:"tags"`
	}
	if json.Unmarshal(b, &f) != nil || f.Tags == nil {
		return []Tag{}
	}
	return f.Tags
}

func (a *API) hasTag(id string) bool {
	for _, t := range a.readTags() {
		if t.ID == id {
			return true
		}
	}
	return false
}

func newTagID(taken map[string]bool) string {
	for {
		var b [3]byte
		_, _ = rand.Read(b[:])
		id := "t" + hex.EncodeToString(b[:])
		if !taken[id] {
			return id
		}
	}
}

// cleanTags validates a submitted list and fills in ids.
func cleanTags(in []Tag) ([]Tag, error) {
	if len(in) > maxTags {
		return nil, fmt.Errorf("at most %d tags", maxTags)
	}
	out := make([]Tag, 0, len(in))
	ids := map[string]bool{}
	names := map[string]bool{}
	for _, t := range in {
		t.Name = sanitizeLabel(t.Name)
		if t.Name == "" {
			return nil, fmt.Errorf("a tag needs a name")
		}
		if len([]rune(t.Name)) > maxTagName {
			return nil, fmt.Errorf("a tag name may be at most %d characters", maxTagName)
		}
		key := strings.ToLower(t.Name)
		if names[key] {
			return nil, fmt.Errorf("two tags are called %q", t.Name)
		}
		names[key] = true
		if t.Color < 1 || t.Color > tagColorCount {
			return nil, fmt.Errorf("color must be 1 to %d", tagColorCount)
		}
		if t.ID != "" && !tagIDRE.MatchString(t.ID) {
			t.ID = "" // an id this code couldn't have made is replaced
		}
		if t.ID != "" && ids[t.ID] {
			return nil, fmt.Errorf("two tags share the id %s", t.ID)
		}
		if t.ID != "" {
			ids[t.ID] = true
		}
		out = append(out, t)
	}
	for i := range out {
		if out[i].ID == "" {
			out[i].ID = newTagID(ids)
			ids[out[i].ID] = true
		}
	}
	return out, nil
}

func (a *API) handleTagsGet(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, http.StatusOK, map[string][]Tag{"tags": a.readTags()})
}

func (a *API) handleTagsPut(w http.ResponseWriter, r *http.Request) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	var body struct {
		Tags []Tag `json:"tags"`
	}
	if err := dec.Decode(&body); err != nil || body.Tags == nil {
		writeErr(w, http.StatusBadRequest, "body must be {\"tags\":[...]}")
		return
	}
	clean, err := cleanTags(body.Tags)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	b, _ := json.MarshalIndent(map[string][]Tag{"tags": clean}, "", "  ")

	a.tagsMu.Lock()
	defer a.tagsMu.Unlock()
	// Temp file and rename, like the sidecars: a poll never sees half a file.
	tmp, err := os.CreateTemp(a.cfg.OutputDir, ".tags-*.tmp")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save tags")
		return
	}
	_, werr := tmp.Write(b)
	cerr := tmp.Close()
	if werr != nil || cerr != nil || os.Rename(tmp.Name(), a.tagsPath()) != nil {
		_ = os.Remove(tmp.Name())
		writeErr(w, http.StatusInternalServerError, "could not save tags")
		return
	}
	writeJSON(w, http.StatusOK, map[string][]Tag{"tags": clean})
}
