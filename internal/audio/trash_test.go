package audio

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
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
	if _, err := RecordHistory(wav, Meta{}, Meta{Label: "keeper"}, time.Now(), ""); err != nil {
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
	if HistoryInfo(wav, "").Count != 1 {
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
	saved := diskFreeGB
	defer func() { diskFreeGB = saved }()
	diskFreeGB = func(string) (float64, bool) {
		tr, _ := ListTrash(dir)
		return 0.5 + float64(3-len(tr)), true
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

func TestADiskThatCantBeReadEmptiesNothing(t *testing.T) {
	dir := t.TempDir()
	takeWithSidecars(t, dir, "jam_e.wav")
	TrashTake(dir, "jam_e.wav", TrashDeleted, time.Now())
	saved := diskFreeGB
	defer func() { diskFreeGB = saved }()
	diskFreeGB = func(string) (float64, bool) { return 0, false }
	EnsureFree(dir, 100)
	if tr, _ := ListTrash(dir); len(tr) != 1 {
		t.Fatal("an unreadable disk was taken for a full one and the trash emptied")
	}
}

// Emptying the trash while takes are going into it -- the janitor's tick, or
// Empty, during a delete or a prune -- must never lose a take or leave one
// "deleted" in place. Found by an independent review.
func TestEmptyingRacesNoDelete(t *testing.T) {
	dir := t.TempDir()
	const n = 400
	for i := 0; i < n; i++ {
		os.WriteFile(filepath.Join(dir, fmt.Sprintf("jam_%05d.wav", i)), []byte("RIFF"), 0o644)
	}
	var stop atomic.Bool
	done := make(chan struct{})
	go func() {
		for !stop.Load() {
			EmptyTrash(dir, time.Now().Add(-TrashKeep))
		}
		close(done)
	}()
	bad := 0
	for i := 0; i < n; i++ {
		name := fmt.Sprintf("jam_%05d.wav", i)
		if err := TrashTake(dir, name, TrashDeleted, time.Now()); err != nil {
			t.Fatal(err)
		}
		if exists(filepath.Join(dir, name)) || !exists(filepath.Join(trashSlot(dir, name), name)) {
			bad++
		}
	}
	stop.Store(true)
	<-done
	if bad > 0 {
		t.Fatalf("%d of %d deletes lost the take or left it in place", bad, n)
	}
}

func TestANewTakeNeverGetsATrashedName(t *testing.T) {
	dir := t.TempDir()
	at := time.Date(2026, 10, 4, 12, 0, 0, 0, time.Local)
	name, _, err := freeTakeName(dir, at)
	if err != nil {
		t.Fatal(err)
	}
	os.Remove(PartPath(filepath.Join(dir, name)))
	writeFakeTake(t, dir, name, 0)
	TrashTake(dir, name, TrashDeleted, time.Now())
	// The clock repeats the second (a Pi with no RTC after a power cut).
	again, _, err := freeTakeName(dir, at)
	if err != nil {
		t.Fatal(err)
	}
	if again == name {
		t.Fatalf("got %s again, which is in the trash", again)
	}
	// And a delete never replaces a trashed take of the same name.
	writeFakeTake(t, dir, name, 0)
	if err := TrashTake(dir, name, TrashDeleted, time.Now()); !errors.Is(err, ErrNameTaken) {
		t.Fatalf("trash over a trashed name = %v, want ErrNameTaken", err)
	}
	if !exists(filepath.Join(dir, name)) {
		t.Fatal("a refused delete moved the take anyway")
	}
}

func TestSweepPutsAStrandedSidecarBackWithItsTrashedTake(t *testing.T) {
	dir := t.TempDir()
	wav := takeWithSidecars(t, dir, "jam_s.wav")
	TrashTake(dir, "jam_s.wav", TrashDeleted, time.Now())
	// A crash between moving the WAV and its sidecars: put two back live.
	slot := trashSlot(dir, "jam_s.wav")
	os.Rename(filepath.Join(slot, filepath.Base(metaPath(wav))), metaPath(wav))
	os.Rename(filepath.Join(slot, filepath.Base(MIDIPath(wav))), MIDIPath(wav))
	SweepPartials(dir)
	if exists(metaPath(wav)) || exists(MIDIPath(wav)) {
		t.Fatal("stranded sidecars still beside a take that isn't there")
	}
	if err := RestoreTake(dir, "jam_s.wav"); err != nil {
		t.Fatal(err)
	}
	if m := ReadMeta(wav); m.Label != "keeper" || !exists(MIDIPath(wav)) {
		t.Fatalf("restored take lost its sidecars: %+v", m)
	}
}
