package api

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// The trash, and taking several takes away at once.
//
//	GET    /api/trash                  what's in it, most recently deleted first
//	POST   /api/trash/restore?file=    put one back (starred)
//	DELETE /api/trash?file=            remove one for good
//	DELETE /api/trash?all=1            empty it
//	GET    /api/export?file=…&file=…   one zip of several takes

type trashResponse struct {
	KeepDays int                 `json:"keep_days"`
	Takes    []audio.TrashedTake `json:"takes"`
}

func (a *API) handleTrashList(w http.ResponseWriter, r *http.Request) {
	all, err := audio.ListTrash(a.cfg.OutputDir)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not read the trash")
		return
	}
	if all == nil {
		all = []audio.TrashedTake{}
	}
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, http.StatusOK, trashResponse{KeepDays: int(audio.TrashKeep.Hours() / 24), Takes: all})
}

func (a *API) handleTrashRestore(w http.ResponseWriter, r *http.Request) {
	name, err := a.safeTakeName(r.URL.Query().Get("file"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	switch err := audio.RestoreTake(a.cfg.OutputDir, name); {
	case errors.Is(err, os.ErrNotExist):
		writeErr(w, http.StatusNotFound, "not in the trash")
		return
	case errors.Is(err, audio.ErrNameTaken):
		writeErr(w, http.StatusConflict, "a take with that name exists")
		return
	case err != nil:
		log.Printf("restore %s: %v", name, err)
		writeErr(w, http.StatusInternalServerError, "could not restore")
		return
	}
	t, err := audio.ReadTake(a.cfg.OutputDir, name)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "restored, but could not be read")
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (a *API) handleTrashDelete(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("all") == "1" {
		n := audio.EmptyAllTrash(a.cfg.OutputDir)
		writeJSON(w, http.StatusOK, map[string]any{"status": "emptied", "count": n})
		return
	}
	name, err := a.safeTakeName(q.Get("file"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := audio.PurgeTrashed(a.cfg.OutputDir, name); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeErr(w, http.StatusNotFound, "not in the trash")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not delete")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted", "name": name})
}

// maxExport bounds one export: the zip is streamed, so it's the request,
// not memory, that this protects.
const maxExport = 100

// handleExport streams one zip of several takes: each one's WAV, its
// sidecar (.meta.json: name, star, selection, flags, tempo), and its MIDI and
// manifest when it has them. Audio is stored, not deflated -- PCM doesn't
// compress and the Pi's CPU is better spent elsewhere -- and nothing is
// written to disk.
func (a *API) handleExport(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query()["file"]
	if len(raw) == 0 {
		writeErr(w, http.StatusBadRequest, "file is required")
		return
	}
	if len(raw) > maxExport {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("at most %d takes at once", maxExport))
		return
	}
	var names []string
	seen := map[string]bool{}
	for _, f := range raw {
		name, err := a.safeTakeName(f)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if seen[name] {
			continue
		}
		seen[name] = true
		if fi, err := os.Stat(filepath.Join(a.cfg.OutputDir, name)); err != nil || !fi.Mode().IsRegular() {
			writeErr(w, http.StatusNotFound, name+" not found")
			return
		}
		names = append(names, name)
	}

	zipName := fmt.Sprintf("hindsight %d takes %s.zip", len(names), time.Now().Format("2006-01-02 1504"))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, zipName))
	w.Header().Set("Cache-Control", "no-store")

	zw := zip.NewWriter(w)
	for _, name := range names {
		wav := filepath.Join(a.cfg.OutputDir, name)
		stem := strings.TrimSuffix(name, ".wav")
		parts := []struct {
			path   string
			method uint16
		}{
			{wav, zip.Store},
			{filepath.Join(a.cfg.OutputDir, stem+".meta.json"), zip.Deflate},
			{audio.MIDIPath(wav), zip.Deflate},
			{audio.ManifestPath(wav), zip.Deflate},
		}
		for _, p := range parts {
			if err := addZipFile(zw, p.path, p.method); err != nil {
				if errors.Is(err, os.ErrNotExist) && p.path != wav {
					continue // a take without MIDI, or without a sidecar yet
				}
				// Headers are gone: the client sees a truncated zip.
				log.Printf("export %s: %v", filepath.Base(p.path), err)
				return
			}
		}
	}
	if err := zw.Close(); err != nil {
		log.Printf("export: %v", err)
	}
}

func addZipFile(zw *zip.Writer, path string, method uint16) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return err
	}
	hdr := &zip.FileHeader{Name: filepath.Base(path), Method: method, Modified: fi.ModTime()}
	e, err := zw.CreateHeader(hdr)
	if err != nil {
		return err
	}
	_, err = io.Copy(e, f)
	return err
}
