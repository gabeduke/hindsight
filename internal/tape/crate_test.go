package tape

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

func poolNames(t *testing.T, e *Engine) map[string]bool {
	t.Helper()
	es, err := os.ReadDir(filepath.Join(e.store.Dir(), "audio"))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	for _, f := range es {
		if filepath.Ext(f.Name()) == ".wav" {
			out["audio/"+f.Name()] = true
		}
	}
	return out
}

func TestKeepingASpanOfATake(t *testing.T) {
	e, _, _ := newEngine(t)
	e.handleS = 1
	take := takeWAV(t, 400000, func(i int) float64 { return float64(i) / 1e6 })
	takes := filepath.Dir(take)
	before, _ := os.ReadDir(takes)
	k, err := e.KeepTake(take, "jam_take.wav", "Tuesday jam", 96000, 192000, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	if k.ID == "" || k.Frames != 96000 || k.Src != 48000 || k.Name != "Tuesday jam · 0:02" {
		t.Fatalf("kept = %+v", k)
	}
	if k.Source.Kind != "take" || k.Source.Take != "jam_take.wav" || k.Source.From != 96000 || k.Source.To != 192000 || k.Source.What != "Tuesday jam, 0:02–0:04" {
		t.Fatalf("source = %+v", k.Source)
	}
	if !poolNames(t, e)[k.File] {
		t.Fatalf("its audio %s isn't in the pool", k.File)
	}
	// The takes list is as it was.
	if after, _ := os.ReadDir(takes); len(after) != len(before) {
		t.Fatalf("%d files in the takes' folder, were %d", len(after), len(before))
	}
	// It's on the crate, and after a restart too.
	e2 := NewEngine(Options{Store: e.store})
	if l, err := e2.CrateList("", ""); err != nil || len(l) != 1 || l[0].ID != k.ID {
		t.Fatalf("the crate after a restart = %+v %v", l, err)
	}
}

func TestCleanupKeepsTheCrateUntilItsTrashEmpties(t *testing.T) {
	e, _, _ := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.25 })
	k, _ := e.KeepTake(take, "jam_take.wav", "jam", 0, 48000, []int{0, 1})
	path := e.store.AudioPath(k.File)
	old := time.Now().Add(-time.Hour)
	if err := osChtimes(path, old); err != nil {
		t.Fatal(err)
	}
	clean := func() {
		t.Helper()
		if _, _, err := e.store.Cleanup(nil); err != nil {
			t.Fatal(err)
		}
	}
	clean()
	if _, err := audio.ReadWAVInfo(path); err != nil {
		t.Fatalf("clean-up took a kept clip's audio: %v", err)
	}
	// Deleted, it's still kept while it can be brought back.
	e.changeCrate(func(c *Crate) error {
		now := time.Now()
		c.Clips[0].Deleted = &now
		return nil
	})
	clean()
	if _, err := audio.ReadWAVInfo(path); err != nil {
		t.Fatalf("clean-up took a deleted clip's audio within the week: %v", err)
	}
	// After the week, the list lets go of it and clean-up frees the audio.
	e.changeCrate(func(c *Crate) error {
		long := time.Now().Add(-(CrateTrashDays*24 + 1) * time.Hour)
		c.Clips[0].Deleted = &long
		return nil
	})
	if l, _ := e.CrateList("", ""); len(l) != 0 {
		t.Fatalf("the list = %+v", l)
	}
	if _, err := e.CrateClip(k.ID); !errors.Is(err, ErrNoSuchCrateClip) {
		t.Fatalf("a clip deleted a week ago is still there: %v", err)
	}
	clean()
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("its audio is still there: %v", err)
	}
	// A crate that can't be read stops clean-up altogether.
	os.WriteFile(e.store.cratePath(), []byte("{"), 0o644)
	if _, _, err := e.store.Cleanup(nil); err == nil {
		t.Fatal("clean-up ran with an unreadable crate")
	}
}

func TestTheCrateListFindsByNameAndTake(t *testing.T) {
	e, _, _ := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.25 })
	a, _ := e.KeepTake(take, "jam_a.wav", "Verse", 0, 48000, []int{0, 1})
	time.Sleep(2 * time.Millisecond)
	b, _ := e.KeepTake(take, "jam_b.wav", "Chorus", 0, 48000, []int{0, 1})
	if l, _ := e.CrateList("", ""); len(l) != 2 || l[0].ID != b.ID {
		t.Fatalf("newest first: %+v", l)
	}
	if l, _ := e.CrateList("vERSE", ""); len(l) != 1 || l[0].ID != a.ID {
		t.Fatalf("by name: %+v", l)
	}
	if l, _ := e.CrateList("", "jam_b.wav"); len(l) != 1 || l[0].ID != b.ID {
		t.Fatalf("by take: %+v", l)
	}
}

func TestKeepingMoreThanATrackIsRefused(t *testing.T) {
	e, _, _ := newEngine(t)
	// The test store's tracks are 60 s.
	take := takeWAV(t, 48000*61, func(i int) float64 { return 0.1 })
	if _, err := e.KeepTake(take, "jam_take.wav", "jam", 0, 48000*61, []int{0, 1}); err == nil {
		t.Fatal("a keep longer than a track was let through: it could never be dropped")
	}
}
