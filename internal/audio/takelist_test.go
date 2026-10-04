package audio

import (
	"os"
	"testing"
	"time"
)

func TestTakeListETagIsStableWhenNothingChanges(t *testing.T) {
	dir := t.TempDir()
	writeFakeTake(t, dir, "jam_a.wav", time.Hour)
	l := NewTakeList(dir)
	_, e1, err := l.List()
	if err != nil {
		t.Fatal(err)
	}
	_, e2, _ := l.List()
	if e1 == "" || e1 != e2 {
		t.Errorf("etag %q then %q, want stable and non-empty", e1, e2)
	}
}

func TestTakeListSeesSidecarAndPreviewChanges(t *testing.T) {
	dir := t.TempDir()
	wav := writeFakeTake(t, dir, "jam_a.wav", time.Hour)
	l := NewTakeList(dir)
	_, e1, _ := l.List()

	if err := WriteMeta(wav, Meta{Label: "named"}); err != nil {
		t.Fatal(err)
	}
	takes, e2, _ := l.List()
	if e2 == e1 || takes[0].Label != "named" {
		t.Errorf("after a label: etag changed %v, label %q", e2 != e1, takes[0].Label)
	}

	if err := os.WriteFile(previewPath(wav), []byte("mp3"), 0o644); err != nil {
		t.Fatal(err)
	}
	takes, e3, _ := l.List()
	if e3 == e2 || !takes[0].HasPreview {
		t.Errorf("after a preview: etag changed %v, has_preview %v", e3 != e2, takes[0].HasPreview)
	}
}

func TestTakeListDropsDeletedTakes(t *testing.T) {
	dir := t.TempDir()
	writeFakeTake(t, dir, "jam_a.wav", time.Hour)
	writeFakeTake(t, dir, "jam_b.wav", 2*time.Hour)
	l := NewTakeList(dir)
	l.List()
	RemoveTake(dir, "jam_a.wav")
	takes, _, _ := l.List()
	if len(takes) != 1 || takes[0].Name != "jam_b.wav" {
		t.Errorf("takes = %+v, want only jam_b", takes)
	}
	if _, ok := l.cache["jam_a.wav"]; ok {
		t.Error("the cache still holds the deleted take")
	}
}

// The cached list must be exactly what ListTakes would say.
func TestTakeListMatchesListTakes(t *testing.T) {
	dir := t.TempDir()
	a := writeFakeTake(t, dir, "jam_2026-09-01_120000.wav", 0)
	writeFakeTake(t, dir, "jam_2026-09-02_120000.wav", 0)
	if err := WriteMeta(a, Meta{Starred: true, Flags: []Flag{{Frame: 3}}}); err != nil {
		t.Fatal(err)
	}
	want, _ := ListTakes(dir)
	got, _, _ := NewTakeList(dir).List()
	if len(got) != len(want) {
		t.Fatalf("got %d takes, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i].Name != want[i].Name || got[i].Starred != want[i].Starred || len(got[i].Flags) != len(want[i].Flags) {
			t.Errorf("take %d: got %+v, want %+v", i, got[i], want[i])
		}
	}
}
