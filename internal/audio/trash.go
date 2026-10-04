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
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/disk"
)

// The trash. Deleting a take, or pruning it for MAX_SAVES, moves it here
// instead of removing it, so nothing is permanent by accident:
//
//	OUTPUT_DIR/.trash/<stem>/               the take's WAV and every sidecar
//	OUTPUT_DIR/.trash/<stem>/trashed.json   when, and why
//
// Files are moved with rename, inside one filesystem, so trashing costs no
// space and no time; nothing is hard-linked, so emptying frees what it says.
// The trash empties after TrashKeep, and sooner, oldest first, whenever free
// space falls under MIN_FREE_GB (EnsureFree), so it never stops a capture.
//
// Every change to the trash -- a take going in, coming out, or being emptied
// -- holds trashMu, so emptying can never catch a slot half-filled or
// half-restored. A caller that also locks the take (LockTake) takes that
// lock first.

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

// ErrNameTaken reports a restore whose name a live take now has, or a delete
// whose name an older trashed take still holds.
var ErrNameTaken = errors.New("a take with that name exists")

var trashMu sync.Mutex

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

// sidecarSuffixes are what follows a take's stem in its sidecars' names.
var sidecarSuffixes = []string{"_preview.mp3", ".peaks.json", ".peaks.bin", ".meta.json", ".history.json", ".mid", ".manifest.json"}

// sidecarStem returns the take stem of any sidecar's name.
func sidecarStem(name string) (string, bool) {
	if strings.HasPrefix(name, ".") {
		return "", false
	}
	for _, suf := range sidecarSuffixes {
		if strings.HasSuffix(name, suf) {
			return strings.TrimSuffix(name, suf), true
		}
	}
	return "", false
}

// TrashTake moves a take and its sidecars into the trash. It holds the take's
// lock, so a sidecar write in flight can't recreate a file behind it. A take
// already gone is not an error. It refuses (ErrNameTaken) rather than
// replace an older trashed take of the same name.
func TrashTake(dir, name, reason string, now time.Time) error {
	base := filepath.Join(dir, filepath.Base(name))
	unlock := LockTake(base)
	defer unlock()
	trashMu.Lock()
	defer trashMu.Unlock()
	if !exists(base) {
		return nil
	}
	slot := trashSlot(dir, name)
	if exists(slot) {
		return fmt.Errorf("%w in the trash; empty it from there first", ErrNameTaken)
	}
	if err := os.MkdirAll(slot, 0o755); err != nil {
		return err
	}
	rec, _ := json.Marshal(trashMeta{DeletedAt: now, Reason: reason})
	if err := os.WriteFile(filepath.Join(slot, trashRecord), rec, 0o644); err != nil {
		os.RemoveAll(slot)
		return err
	}
	// The WAV first: once it has moved, the take is out of the list. Its
	// existence was checked under the lock, so any failure here is real.
	files := takeFiles(base)
	if err := os.Rename(files[0], filepath.Join(slot, filepath.Base(files[0]))); err != nil {
		os.RemoveAll(slot)
		return err
	}
	// A sidecar that fails to move stays behind; the startup sweep moves it
	// into the slot (SweepPartials), since its WAV is here.
	for _, f := range files[1:] {
		if err := os.Rename(f, filepath.Join(slot, filepath.Base(f))); err != nil && !errors.Is(err, os.ErrNotExist) {
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
	trashMu.Lock()
	defer trashMu.Unlock()
	if !exists(filepath.Join(slot, filepath.Base(base))) {
		return os.ErrNotExist
	}
	if exists(base) || exists(PartPath(base)) {
		return ErrNameTaken
	}
	// Sidecars first and the WAV last, so the take appears in the list whole.
	files := takeFiles(base)
	var moved []string
	for _, f := range files[1:] {
		err := os.Rename(filepath.Join(slot, filepath.Base(f)), f)
		switch {
		case err == nil:
			moved = append(moved, f)
		case !errors.Is(err, os.ErrNotExist):
			log.Printf("[!] restore %s: %v", filepath.Base(f), err)
		}
	}
	if err := os.Rename(filepath.Join(slot, filepath.Base(base)), base); err != nil {
		// Put the sidecars back with the WAV: the take stays in the trash,
		// whole, rather than half of it appearing without its audio.
		for _, f := range moved {
			os.Rename(f, filepath.Join(slot, filepath.Base(f)))
		}
		return err
	}
	os.RemoveAll(slot)
	if _, err := updateMetaLocked(base, func(m *Meta) error { m.Starred = true; return nil }); err != nil {
		log.Printf("[!] star restored %s: %v", filepath.Base(base), err)
	}
	return nil
}

// trashSlotInfo is one slot, read without opening its WAV.
type trashSlotInfo struct {
	name      string // the take's name, jam_….wav
	deletedAt time.Time
	reason    string
	hasWAV    bool
}

// trashSlots lists the trash's slots, most recently deleted first. Cheap: a
// directory listing and each slot's small record.
func trashSlots(dir string) []trashSlotInfo {
	entries, err := os.ReadDir(TrashDir(dir))
	if err != nil {
		return nil
	}
	var out []trashSlotInfo
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		slot := filepath.Join(TrashDir(dir), e.Name())
		s := trashSlotInfo{name: e.Name() + ".wav", reason: TrashDeleted}
		s.hasWAV = exists(filepath.Join(slot, s.name))
		var rec trashMeta
		if b, err := os.ReadFile(filepath.Join(slot, trashRecord)); err == nil && json.Unmarshal(b, &rec) == nil {
			s.deletedAt, s.reason = rec.DeletedAt, rec.Reason
		} else if fi, err := e.Info(); err == nil {
			s.deletedAt = fi.ModTime()
		}
		out = append(out, s)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].deletedAt.After(out[j].deletedAt) })
	return out
}

// ListTrash describes what's in the trash, most recently deleted first.
func ListTrash(dir string) ([]TrashedTake, error) {
	if _, err := os.Stat(TrashDir(dir)); errors.Is(err, os.ErrNotExist) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	var out []TrashedTake
	for _, s := range trashSlots(dir) {
		if !s.hasWAV {
			continue
		}
		slot := trashSlot(dir, s.name)
		info, err := os.Stat(filepath.Join(slot, s.name))
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		out = append(out, TrashedTake{Take: takeFromFile(slot, s.name, info), DeletedAt: s.deletedAt, Reason: s.reason})
	}
	return out, nil
}

// PurgeTrashed removes one take from the trash for good.
func PurgeTrashed(dir, name string) error {
	trashMu.Lock()
	defer trashMu.Unlock()
	slot := trashSlot(dir, name)
	if !exists(slot) {
		return os.ErrNotExist
	}
	return os.RemoveAll(slot)
}

// EmptyTrash removes trashed takes deleted before cutoff, and slots with no
// take in them (a crash mid-trash), and returns how many takes went.
func EmptyTrash(dir string, cutoff time.Time) int {
	trashMu.Lock()
	defer trashMu.Unlock()
	n := 0
	for _, s := range trashSlots(dir) {
		if !s.hasWAV || s.deletedAt.Before(cutoff) {
			if os.RemoveAll(trashSlot(dir, s.name)) == nil && s.hasWAV {
				n++
			}
		}
	}
	return n
}

// EmptyAllTrash removes everything in the trash, whatever its clock says.
func EmptyAllTrash(dir string) int {
	trashMu.Lock()
	defer trashMu.Unlock()
	n := 0
	for _, s := range trashSlots(dir) {
		if os.RemoveAll(trashSlot(dir, s.name)) == nil && s.hasWAV {
			n++
		}
	}
	return n
}

// diskFreeGB is how EnsureFree measures; tests replace it. ok is false when
// the disk can't be read, which must never read as "full".
var diskFreeGB = func(dir string) (float64, bool) {
	u, err := disk.Usage(dir)
	if err != nil {
		return 0, false
	}
	return float64(u.Free) / (1024 * 1024 * 1024), true
}

// EnsureFree empties the trash, oldest deletion first, until dir has minGB
// free or the trash is empty, and returns the free space it ends with. Every
// write that refuses for low disk calls it first, so the trash can never be
// why a capture fails. When the disk can't be measured it empties nothing.
func EnsureFree(dir string, minGB float64) float64 {
	free, ok := diskFreeGB(dir)
	if !ok || free >= minGB {
		return free
	}
	trashMu.Lock()
	defer trashMu.Unlock()
	slots := trashSlots(dir)
	for i := len(slots) - 1; i >= 0 && free < minGB; i-- {
		s := slots[i]
		if os.RemoveAll(trashSlot(dir, s.name)) == nil && s.hasWAV {
			log.Printf("[*] low disk: emptied %s from the trash (%s %s)", s.name, s.reason,
				s.deletedAt.Format("2006-01-02 15:04"))
		}
		if free, ok = diskFreeGB(dir); !ok {
			break
		}
	}
	return free
}

// TrashJanitor empties expired trash, and trash under disk pressure, now and
// then every interval until stop closes.
func TrashJanitor(dir string, minGB float64, interval time.Duration, stop <-chan struct{}) {
	for {
		if n := EmptyTrash(dir, time.Now().Add(-TrashKeep)); n > 0 {
			log.Printf("[*] emptied %d take(s) older than %d days from the trash", n, int(TrashKeep.Hours()/24))
		}
		EnsureFree(dir, minGB)
		select {
		case <-stop:
			return
		case <-time.After(interval):
		}
	}
}

// recoverTrashSidecar moves a sidecar whose take is in the trash -- left
// behind by a crash mid-delete or mid-restore -- into the take's slot, and
// reports whether it did. Called by the startup sweep, before it would
// otherwise remove the sidecar as an orphan.
func recoverTrashSidecar(dir, name string) bool {
	stem, ok := sidecarStem(name)
	if !ok || exists(filepath.Join(dir, stem+".wav")) {
		return false
	}
	slot := trashSlot(dir, stem+".wav")
	if !exists(filepath.Join(slot, stem+".wav")) {
		return false
	}
	if err := os.Rename(filepath.Join(dir, name), filepath.Join(slot, name)); err != nil {
		log.Printf("[!] could not put %s back with its take in the trash: %v", name, err)
		return true // left where it is, rather than swept away
	}
	log.Printf("[*] put %s back with its take in the trash", name)
	return true
}
