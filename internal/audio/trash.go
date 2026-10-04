package audio

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// The trash. Deleting a take, or pruning it for MAX_SAVES, moves it here
// instead of removing it, so nothing is permanent by accident:
//
//	OUTPUT_DIR/.trash/<stem>/        the take's WAV and every sidecar
//	OUTPUT_DIR/.trash/<stem>/trashed.json   when, and why
//
// Files are moved with rename, inside one filesystem, so trashing costs no
// space and no time; nothing is hard-linked, so emptying frees what it says.
// The trash empties after TrashKeep, and sooner, oldest first, whenever free
// space falls under MIN_FREE_GB (EnsureFree), so it never stops a capture.

// TrashDirName is the trash's folder inside OUTPUT_DIR. The leading dot keeps
// it out of the takes list, which lists files, not folders, anyway.
const TrashDirName = ".trash"

// TrashKeep is how long a deleted take waits before it's gone for good.
const TrashKeep = 7 * 24 * time.Hour

const trashRecord = "trashed.json"

// Why a take is in the trash.
const (
	TrashDeleted = "deleted"
	TrashPruned  = "pruned"
)

// ErrNameTaken reports a restore whose name a live take now has.
var ErrNameTaken = errors.New("a take with that name exists")

// TrashedTake is a take in the trash, described as the list describes a take.
type TrashedTake struct {
	Take
	DeletedAt time.Time `json:"deleted_at"`
	Reason    string    `json:"reason"`
}

type trashMeta struct {
	DeletedAt time.Time `json:"deleted_at"`
	Reason    string    `json:"reason"`
}

// TrashDir is the trash folder for a takes directory.
func TrashDir(dir string) string { return filepath.Join(dir, TrashDirName) }

// trashSlot is a trashed take's folder. A name that would make it the trash
// itself, or anything outside it ("..wav", ".wav"), gets a slot that can't
// exist, so no caller can be talked into removing the whole trash.
func trashSlot(dir, name string) string {
	stem := strings.TrimSuffix(filepath.Base(name), ".wav")
	if stem == "" || strings.HasPrefix(stem, ".") || strings.ContainsAny(stem, `/\`) {
		stem = "\x00invalid"
	}
	return filepath.Join(TrashDir(dir), stem)
}

// takeFiles lists every file that belongs to a take: the WAV first, then its
// sidecars. Removing, trashing and restoring all use this one list.
func takeFiles(wav string) []string {
	return []string{
		wav,
		previewPath(wav),
		peaksPath(wav),
		pyramidPath(wav),
		metaPath(wav),
		historyPath(wav),
		MIDIPath(wav),
		ManifestPath(wav),
	}
}

// TrashTake moves a take and its sidecars into the trash. It holds the take's
// lock, so a sidecar write in flight can't recreate a file behind it. A take
// already gone is not an error. An earlier trashed take of the same name is
// replaced.
func TrashTake(dir, name, reason string, now time.Time) error {
	base := filepath.Join(dir, filepath.Base(name))
	unlock := LockTake(base)
	defer unlock()
	if !exists(base) {
		return nil
	}
	slot := trashSlot(dir, name)
	if err := os.RemoveAll(slot); err != nil {
		return err
	}
	if err := os.MkdirAll(slot, 0o755); err != nil {
		return err
	}
	rec, _ := json.Marshal(trashMeta{DeletedAt: now, Reason: reason})
	if err := os.WriteFile(filepath.Join(slot, trashRecord), rec, 0o644); err != nil {
		return err
	}
	// The WAV first: once it has moved, the take is out of the list, and a
	// failure on a sidecar leaves at worst an orphan the startup sweep tidies.
	for i, f := range takeFiles(base) {
		err := os.Rename(f, filepath.Join(slot, filepath.Base(f)))
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			if i == 0 {
				os.RemoveAll(slot)
				return err
			}
			log.Printf("[!] trash %s: %v", filepath.Base(f), err)
		}
	}
	return nil
}

// RestoreTake moves a trashed take back, starred so the next prune doesn't
// take it straight back. It refuses if a live take has the name now.
func RestoreTake(dir, name string) error {
	base := filepath.Join(dir, filepath.Base(name))
	slot := trashSlot(dir, name)
	unlock := LockTake(base)
	defer unlock()
	if !exists(filepath.Join(slot, filepath.Base(base))) {
		return os.ErrNotExist
	}
	if exists(base) || exists(PartPath(base)) {
		return ErrNameTaken
	}
	// Sidecars first and the WAV last, so the take appears in the list whole.
	files := takeFiles(base)
	for _, f := range append(files[1:], files[0]) {
		err := os.Rename(filepath.Join(slot, filepath.Base(f)), f)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	os.RemoveAll(slot)
	if _, err := updateMetaLocked(base, func(m *Meta) error { m.Starred = true; return nil }); err != nil {
		log.Printf("[!] star restored %s: %v", filepath.Base(base), err)
	}
	return nil
}

// ListTrash describes what's in the trash, most recently deleted first.
func ListTrash(dir string) ([]TrashedTake, error) {
	entries, err := os.ReadDir(TrashDir(dir))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []TrashedTake
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		slot := filepath.Join(TrashDir(dir), e.Name())
		name := e.Name() + ".wav"
		info, err := os.Stat(filepath.Join(slot, name))
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		t := TrashedTake{Take: takeFromFile(slot, name, info), Reason: TrashDeleted}
		var rec trashMeta
		if b, err := os.ReadFile(filepath.Join(slot, trashRecord)); err == nil && json.Unmarshal(b, &rec) == nil {
			t.DeletedAt, t.Reason = rec.DeletedAt, rec.Reason
		} else {
			t.DeletedAt = info.ModTime()
		}
		out = append(out, t)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].DeletedAt.After(out[j].DeletedAt) })
	return out, nil
}

// PurgeTrashed removes one take from the trash for good.
func PurgeTrashed(dir, name string) error {
	slot := trashSlot(dir, name)
	if !exists(slot) {
		return os.ErrNotExist
	}
	return os.RemoveAll(slot)
}

// EmptyTrash removes trashed takes deleted before cutoff, and returns how many.
func EmptyTrash(dir string, cutoff time.Time) int {
	all, err := ListTrash(dir)
	if err != nil {
		return 0
	}
	n := 0
	for _, t := range all {
		if t.DeletedAt.Before(cutoff) {
			if os.RemoveAll(trashSlot(dir, t.Name)) == nil {
				n++
			}
		}
	}
	// Folders with no take in them: a crash mid-trash.
	if entries, err := os.ReadDir(TrashDir(dir)); err == nil {
		for _, e := range entries {
			slot := filepath.Join(TrashDir(dir), e.Name())
			if e.IsDir() && !exists(filepath.Join(slot, e.Name()+".wav")) {
				os.RemoveAll(slot)
			}
		}
	}
	return n
}

// freeGBFunc is how EnsureFree measures; tests replace it.
var freeGBFunc = func(dir string) float64 { f, _ := FreeGB(dir); return f }

// EnsureFree empties the trash, oldest deletion first, until dir has minGB
// free or the trash is empty, and returns the free space it ends with. Every
// write that refuses for low disk calls it first, so the trash can never be
// why a capture fails.
func EnsureFree(dir string, minGB float64) float64 {
	free := freeGBFunc(dir)
	if free >= minGB {
		return free
	}
	all, err := ListTrash(dir)
	if err != nil {
		return free
	}
	for i := len(all) - 1; i >= 0 && free < minGB; i-- {
		t := all[i]
		if os.RemoveAll(trashSlot(dir, t.Name)) == nil {
			log.Printf("[*] low disk: emptied %s from the trash (%s %s)", t.Name, t.Reason,
				t.DeletedAt.Format("2006-01-02 15:04"))
		}
		free = freeGBFunc(dir)
	}
	return free
}

// TrashJanitor empties expired trash, and trash under disk pressure, now and
// then every interval until stop closes.
func TrashJanitor(dir string, minGB float64, interval time.Duration, stop <-chan struct{}) {
	for {
		if n := EmptyTrash(dir, time.Now().Add(-TrashKeep)); n > 0 {
			log.Printf("[*] emptied %d take(s) older than %s from the trash", n, fmtDays(TrashKeep))
		}
		EnsureFree(dir, minGB)
		select {
		case <-stop:
			return
		case <-time.After(interval):
		}
	}
}

func fmtDays(d time.Duration) string { return fmt.Sprintf("%d days", int(d.Hours()/24)) }
