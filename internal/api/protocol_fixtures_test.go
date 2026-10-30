package api

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/gabeduke/hindsight/internal/audio"
)

// The fixtures under testdata/protocol/ are the Pi's answers, saved, that
// the pages' models are made over with no Pi (web/static/lib/models/
// fixture.js; docs/architecture/components.md, *Fixtures*). Each says only
// what the Pi says: it decodes, with no field the Pi doesn't send, into the
// type its route encodes. A field renamed or dropped here fails this test,
// and the fixture moves with it.

// fixtureShapes is the type each noun's route answers with.
var fixtureShapes = map[string]func() any{
	"takes": func() any { return &[]audio.Take{} },      // GET /api/jams
	"tape":  func() any { return &tapeStateResponse{} }, // GET /api/tapes/state
}

func TestProtocolFixturesHaveTheirRoutesShapes(t *testing.T) {
	root := filepath.Join("..", "..", "testdata", "protocol")
	nouns, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, d := range nouns {
		if !d.IsDir() {
			continue
		}
		noun := d.Name()
		seen[noun] = true
		shape, ok := fixtureShapes[noun]
		if !ok {
			t.Errorf("testdata/protocol/%s: no route's shape to check it against; name it in fixtureShapes", noun)
			continue
		}
		files, _ := filepath.Glob(filepath.Join(root, noun, "*.json"))
		sort.Strings(files)
		if len(files) == 0 {
			t.Errorf("testdata/protocol/%s holds no fixture", noun)
		}
		for _, f := range files {
			raw, err := os.ReadFile(f)
			if err != nil {
				t.Fatal(err)
			}
			dec := json.NewDecoder(bytes.NewReader(raw))
			dec.DisallowUnknownFields()
			if err := dec.Decode(shape()); err != nil {
				t.Errorf("%s: not what the Pi answers: %v", filepath.ToSlash(f), err)
			}
		}
	}
	for noun := range fixtureShapes {
		if !seen[noun] {
			t.Errorf("fixtureShapes names %s, which has no fixtures in testdata/protocol", noun)
		}
	}
}
