package audio

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func takeNames(t *testing.T, dir string) []string {
	t.Helper()
	takes, err := ListTakes(dir)
	if err != nil {
		t.Fatalf("ListTakes: %v", err)
	}
	var out []string
	for _, tk := range takes {
		out = append(out, tk.Name)
	}
	return out
}

// Editing a flag rewrites the WAV's cue chunk, which moves its modification
// time to now. The list must not care: an old take stays where it was.
func TestRewritingAnOldTakeDoesNotMoveItInTheList(t *testing.T) {
	dir := t.TempDir()
	old := writeFakeTake(t, dir, "jam_2026-09-01_120000.wav", 0)
	writeFakeTake(t, dir, "jam_2026-09-02_120000.wav", 0)
	// The old one was touched last, as a cue rewrite would.
	now := time.Now()
	if err := os.Chtimes(old, now, now); err != nil {
		t.Fatal(err)
	}
	got := takeNames(t, dir)
	if len(got) != 2 || got[0] != "jam_2026-09-02_120000.wav" {
		t.Errorf("order = %v, want the 09-02 take first whatever the file times say", got)
	}
}

func TestCreatedInTheSidecarWins(t *testing.T) {
	dir := t.TempDir()
	a := writeFakeTake(t, dir, "jam_a.wav", 0)
	writeFakeTake(t, dir, "jam_b.wav", time.Hour)
	long := time.Now().Add(-48 * time.Hour)
	if err := WriteMeta(a, Meta{Created: &long}); err != nil {
		t.Fatal(err)
	}
	if got := takeNames(t, dir); got[0] != "jam_b.wav" {
		t.Errorf("order = %v, want jam_b first: jam_a's sidecar says it is two days old", got)
	}
}

func TestTakeCreatedFromName(t *testing.T) {
	mod := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	got := TakeCreated("jam_2026-09-14_201342.wav", Meta{}, mod)
	want := time.Date(2026, 9, 14, 20, 13, 42, 0, time.Local)
	if !got.Equal(want) {
		t.Errorf("got %v, want %v", got, want)
	}
	second := TakeCreated("jam_2026-09-14_201342_2.wav", Meta{}, mod)
	if !second.After(got) {
		t.Errorf("the _2 take (%v) must sort after its first (%v)", second, got)
	}
	if other := TakeCreated("imported.wav", Meta{}, mod); !other.Equal(mod) {
		t.Errorf("a name with no timestamp should fall back to the file time, got %v", other)
	}
	if bad := TakeCreated("jam_2026-09-14_201342_x.wav", Meta{}, mod); !bad.Equal(mod) {
		t.Errorf("a malformed suffix should fall back to the file time, got %v", bad)
	}
}

func TestListTakesIgnoresUnfinishedTakes(t *testing.T) {
	dir := t.TempDir()
	writeFakeTake(t, dir, "jam_done.wav", 0)
	if err := os.WriteFile(PartPath(filepath.Join(dir, "jam_writing.wav")), []byte("RIFF"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := takeNames(t, dir)
	if len(got) != 1 || got[0] != "jam_done.wav" {
		t.Errorf("takes = %v, want only the finished one", got)
	}
}

func TestSweepPartialsClearsACrashedSave(t *testing.T) {
	dir := t.TempDir()
	// A finished take with sidecars must be left alone.
	done := writeFakeTake(t, dir, "jam_done.wav", 0)
	if err := WriteMeta(done, Meta{Label: "keep"}); err != nil {
		t.Fatal(err)
	}
	// A save that died before its rename: a .part and an orphan sidecar.
	crashed := filepath.Join(dir, "jam_crashed.wav")
	if err := os.WriteFile(PartPath(crashed), []byte("RIFF"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := WriteMeta(crashed, Meta{Label: "orphan"}); err != nil {
		t.Fatal(err)
	}

	SweepPartials(dir)

	if exists(PartPath(crashed)) || exists(metaPath(crashed)) {
		t.Error("the crashed save's .part and sidecar should be gone")
	}
	if ReadMeta(done).Label != "keep" {
		t.Error("a finished take's sidecar was touched")
	}
}

func TestSaveStampsCreatedAndLeavesNoPartFile(t *testing.T) {
	cfg, cap, saver := newSaveFixture(t)
	cap.Ring().WriteFrames(make([]int32, 4800*2))
	before := time.Now().Add(-time.Second)
	name, err := saver.Save(0)
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	wav := filepath.Join(cfg.OutputDir, name)
	m := ReadMeta(wav)
	if m.Created == nil || m.Created.Before(before) {
		t.Errorf("Created = %v, want the save time", m.Created)
	}
	entries, _ := os.ReadDir(cfg.OutputDir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".part") {
			t.Errorf("left behind %s", e.Name())
		}
	}
	if _, err := ReadWAVInfo(wav); err != nil {
		t.Errorf("the finished take is not a readable WAV: %v", err)
	}
}

func TestCutStampsCreatedAndLeavesNoPartFile(t *testing.T) {
	dir := t.TempDir()
	writeTestTake(t, dir, "jam_src.wav", 48000)
	now := time.Date(2026, 9, 10, 22, 14, 41, 0, time.UTC)
	name, err := Cut(dir, CutRequest{Source: "jam_src.wav", StartFrame: 1000, EndFrame: 9000}, now)
	if err != nil {
		t.Fatal(err)
	}
	m := ReadMeta(filepath.Join(dir, name))
	if m.Created == nil || !m.Created.Equal(now) {
		t.Errorf("Created = %v, want %v", m.Created, now)
	}
	if exists(PartPath(filepath.Join(dir, name))) {
		t.Error("left the .part file behind")
	}
}

func TestAFailedCutLeavesNothing(t *testing.T) {
	dir := t.TempDir()
	writeTestTake(t, dir, "jam_src.wav", 48000)
	before := takeNames(t, dir)
	if _, err := Cut(dir, CutRequest{Source: "jam_src.wav", StartFrame: 0, EndFrame: 999999}, time.Now()); err == nil {
		t.Fatal("want a range error")
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") {
			t.Errorf("left %s behind", e.Name())
		}
	}
	if after := takeNames(t, dir); len(after) != len(before) {
		t.Errorf("takes = %v, want %v", after, before)
	}
}
