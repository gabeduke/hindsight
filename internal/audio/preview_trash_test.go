package audio

import (
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/config"
)

// Capture's Undo trashes a take straight after its save, while its preview
// may still be encoding: the preview goes with the take, never into the
// takes folder on its own, and a restore makes whatever was missed.
func TestAPreviewFinishedAfterATrashGoesWithTheTake(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("no ffmpeg")
	}
	dir := t.TempDir()
	cfg := &config.Config{OutputDir: dir, SaveChannels: []int{0, 1}}
	wav := writeTestTake(t, dir, "jam_2026-10-07_120000.wav", 48000)
	previewEncoded = func() {
		if err := TrashTake(dir, filepath.Base(wav), TrashDeleted, time.Now()); err != nil {
			t.Error(err)
		}
	}
	defer func() { previewEncoded = func() {} }()
	MakePreview(cfg, wav, 2)
	if exists(previewPath(wav)) {
		t.Fatal("the preview landed in the takes folder without its take")
	}
	slot := trashSlot(dir, wav)
	if !exists(filepath.Join(slot, filepath.Base(previewPath(wav)))) {
		t.Fatal("the preview didn't follow its take into the trash")
	}
	previewEncoded = func() {}
	if err := RestoreTake(dir, filepath.Base(wav)); err != nil {
		t.Fatal(err)
	}
	if !exists(previewPath(wav)) {
		t.Fatal("the preview didn't come back with its take")
	}
}

func TestARestoreEncodesAPreviewTheTrashCutShort(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("no ffmpeg")
	}
	dir := t.TempDir()
	cfg := &config.Config{OutputDir: dir, SaveChannels: []int{0, 1}}
	wav := writeTestTake(t, dir, "jam_2026-10-07_120001.wav", 48000)
	measured := make(chan string, 1)
	measureTempo = func(p string) { measured <- p }
	defer func() { measureTempo = MeasureTempo }()
	// Trashed before its encode began: ffmpeg can't open it, and no preview
	// is made anywhere.
	if err := TrashTake(dir, filepath.Base(wav), TrashDeleted, time.Now()); err != nil {
		t.Fatal(err)
	}
	MakePreview(cfg, wav, 2)
	if err := RestoreTake(dir, filepath.Base(wav)); err != nil {
		t.Fatal(err)
	}
	if exists(previewPath(wav)) {
		t.Fatal("a preview appeared before the restore asked for one")
	}
	AfterRestore(cfg, wav)
	for i := 0; i < 100 && !exists(previewPath(wav)); i++ {
		time.Sleep(50 * time.Millisecond)
	}
	if !exists(previewPath(wav)) {
		t.Fatal("the restore didn't encode the missing preview")
	}
	// Its tempo was never measured: that runs now too.
	select {
	case p := <-measured:
		if p != wav {
			t.Fatalf("measured %s", p)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the restore didn't measure the tempo the trash cut short")
	}
}
