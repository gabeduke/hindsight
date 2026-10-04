package audio

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// takeWithSidecars writes a fake take and one of each sidecar.
func takeWithSidecars(t *testing.T, dir, name string) string {
	t.Helper()
	wav := writeFakeTake(t, dir, name, time.Minute)
	if err := WriteMeta(wav, Meta{Label: "keeper", Flags: []Flag{{ID: "r00000001", Frame: 3}}}); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{previewPath(wav), peaksPath(wav), pyramidPath(wav), MIDIPath(wav), ManifestPath(wav)} {
		os.WriteFile(p, []byte("x"), 0o644)
	}
	if _, err := RecordHistory(wav, Meta{}, Meta{Label: "keeper"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	return wav
}

func TestTrashThenRestoreKeepsEverything(t *testing.T) {
	dir := t.TempDir()
	wav := takeWithSidecars(t, dir, "jam_t.wav")
	if err := TrashTake(dir, "jam_t.wav", TrashDeleted, time.Now()); err != nil {
		t.Fatal(err)
	}
	for _, f := range takeFiles(wav) {
		if exists(f) {
			t.Errorf("%s still in the takes folder", filepath.Base(f))
		}
	}
	if takes, _ := ListTakes(dir); len(takes) != 0 {
		t.Fatalf("list = %v, want the take gone from it", takes)
	}
	tr, err := ListTrash(dir)
	if err != nil || len(tr) != 1 || tr[0].Name != "jam_t.wav" || tr[0].Reason != TrashDeleted || tr[0].Label != "keeper" {
		t.Fatalf("trash = %+v %v", tr, err)
	}

	if err := RestoreTake(dir, "jam_t.wav"); err != nil {
		t.Fatal(err)
	}
	for _, f := range takeFiles(wav) {
		if !exists(f) {
			t.Errorf("%s not restored", filepath.Base(f))
		}
	}
	m := ReadMeta(wav)
	if !m.Starred || m.Label != "keeper" || len(m.Flags) != 1 {
		t.Fatalf("restored meta = %+v, want starred with its label and flag", m)
	}
	if HistoryInfo(wav).Count != 1 {
		t.Error("the history should come back with the take")
	}
	if tr, _ := ListTrash(dir); len(tr) != 0 {
		t.Fatalf("trash = %+v after restore", tr)
	}
}

func TestRestoreRefusesATakenName(t *testing.T) {
	dir := t.TempDir()
	takeWithSidecars(t, dir, "jam_n.wav")
	TrashTake(dir, "jam_n.wav", TrashDeleted, time.Now())
	writeFakeTake(t, dir, "jam_n.wav", 0)
	if err := RestoreTake(dir, "jam_n.wav"); !errors.Is(err, ErrNameTaken) {
		t.Fatalf("restore = %v, want ErrNameTaken", err)
	}
	if err := RestoreTake(dir, "jam_missing.wav"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("restore missing = %v", err)
	}
}

func TestTheTrashEmptiesAfterAWeek(t *testing.T) {
	dir := t.TempDir()
	takeWithSidecars(t, dir, "jam_old.wav")
	takeWithSidecars(t, dir, "jam_new.wav")
	now := time.Now()
	TrashTake(dir, "jam_old.wav", TrashPruned, now.Add(-8*24*time.Hour))
	TrashTake(dir, "jam_new.wav", TrashDeleted, now.Add(-time.Hour))
	if n := EmptyTrash(dir, now.Add(-TrashKeep)); n != 1 {
		t.Fatalf("emptied %d, want 1", n)
	}
	tr, _ := ListTrash(dir)
	if len(tr) != 1 || tr[0].Name != "jam_new.wav" {
		t.Fatalf("trash = %+v, want only the recent one", tr)
	}
}

func TestLowDiskEmptiesTheOldestTrashFirst(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	for i, n := range []string{"jam_1.wav", "jam_2.wav", "jam_3.wav"} {
		takeWithSidecars(t, dir, n)
		TrashTake(dir, n, TrashDeleted, now.Add(time.Duration(i)*time.Minute))
	}
	// Each trashed take removed frees 1 GB; start 1.5 GB short of 2.
	saved := freeGBFunc
	defer func() { freeGBFunc = saved }()
	freeGBFunc = func(string) float64 {
		tr, _ := ListTrash(dir)
		return 0.5 + float64(3-len(tr))
	}
	if free := EnsureFree(dir, 2); free < 2 {
		t.Fatalf("free = %v, want at least 2", free)
	}
	tr, _ := ListTrash(dir)
	if len(tr) != 1 || tr[0].Name != "jam_3.wav" {
		t.Fatalf("trash = %+v, want only the newest deletion left", tr)
	}
}

func TestPruningGoesToTheTrash(t *testing.T) {
	cfg, _, s := newSaveFixture(t)
	cfg.MaxSaves = 1
	dir := cfg.OutputDir
	writeFakeTake(t, dir, "jam_2026-01-01_000000.wav", 2*time.Hour)
	writeFakeTake(t, dir, "jam_2026-01-02_000000.wav", time.Hour)
	s.Prune()
	takes, _ := ListTakes(dir)
	if len(takes) != 1 {
		t.Fatalf("takes = %d, want 1", len(takes))
	}
	tr, _ := ListTrash(dir)
	if len(tr) != 1 || tr[0].Reason != TrashPruned {
		t.Fatalf("trash = %+v, want the pruned take, marked pruned", tr)
	}
}

func TestATrashNameCannotAddressTheTrashItself(t *testing.T) {
	dir := t.TempDir()
	takeWithSidecars(t, dir, "jam_k.wav")
	TrashTake(dir, "jam_k.wav", TrashDeleted, time.Now())
	for _, bad := range []string{"..wav", ".wav", "../x.wav"} {
		PurgeTrashed(dir, bad)
	}
	if tr, _ := ListTrash(dir); len(tr) != 1 {
		t.Fatal("a crafted name emptied the trash")
	}
}

func TestSweepRemovesAnOrphanHistory(t *testing.T) {
	dir := t.TempDir()
	orphan := filepath.Join(dir, "jam_gone.history.json")
	os.WriteFile(orphan, []byte("[]"), 0o644)
	SweepPartials(dir)
	if exists(orphan) {
		t.Error("an orphan history should be swept")
	}
}
