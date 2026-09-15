// The take page's MIDI: notes in frames, and the region bundle.
package api

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/bundle"
)

// handleMIDI serves the take's .mid decoded to notes on the take's frame
// timeline, so the page can draw lanes with the wave view's own math. The
// sidecar's lane_kinds overrides the classifier per track.
func (a *API) handleMIDI(w http.ResponseWriter, r *http.Request) {
	name, err := a.safeTakeName(r.URL.Query().Get("file"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	wav := filepath.Join(a.cfg.OutputDir, name)
	if _, err := os.Stat(wav); err != nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	notes, err := bundle.Notes(wav)
	switch {
	case errors.Is(err, bundle.ErrNoMIDI):
		writeErr(w, http.StatusNotFound, "this take has no MIDI")
		return
	case errors.Is(err, bundle.ErrBadMIDI):
		writeErr(w, http.StatusUnprocessableEntity, "the MIDI file does not decode")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "could not read MIDI")
		return
	}
	if kinds := audio.ReadMeta(wav).LaneKinds; len(kinds) > 0 {
		for i := range notes.Tracks {
			if k, ok := kinds[notes.Tracks[i].Name]; ok {
				notes.Tracks[i].Kind = k
			}
		}
	}
	// A take's .mid never changes after it is written. A lane_kinds edit is
	// applied locally by the page, so a cached kind going stale is harmless.
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	writeJSON(w, http.StatusOK, notes)
}

// handleBundle streams a zip of the region as a DAW opens it: the audio at
// its native depth with the cut's fades, the MIDI re-based to the region,
// and the manifest. Nothing is written to disk.
func (a *API) handleBundle(w http.ResponseWriter, r *http.Request) {
	name, err := a.safeTakeName(r.URL.Query().Get("file"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	q := r.URL.Query()
	from, err1 := strconv.ParseInt(q.Get("from"), 10, 64)
	to, err2 := strconv.ParseInt(q.Get("to"), 10, 64)
	if err1 != nil || err2 != nil || from < 0 || to <= from {
		writeErr(w, http.StatusBadRequest, "need integer 0 <= from < to")
		return
	}
	path := filepath.Join(a.cfg.OutputDir, name)
	info, err := audio.ReadWAVInfo(path)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if info.BitsPerSample != 32 {
		writeErr(w, http.StatusBadRequest, "only 32-bit takes can be bundled")
		return
	}
	if to > info.Frames() {
		writeErr(w, http.StatusBadRequest, "range is past the end of the take")
		return
	}
	if to-from < 2*audio.FadeFrames(info.SampleRate)+1 {
		writeErr(w, http.StatusBadRequest, "region is too short to bundle")
		return
	}
	if to-from > int64(audio.MaxRenderSeconds*info.SampleRate) {
		writeErr(w, http.StatusBadRequest, audio.ErrRenderTooLong.Error())
		return
	}

	base := audio.ReadMeta(path).Label
	if base == "" {
		base = strings.TrimSuffix(name, ".wav")
	}
	whole := from == 0 && to == info.Frames()
	// RenderFilename builds "<base> <m.ss>-<m.ss>.mp3" with a whitelisted
	// character set; the bundle is the same name with a zip suffix.
	zipName := strings.TrimSuffix(audio.RenderFilename(base, from, to, info.SampleRate, whole), ".mp3") + ".zip"
	asciiName := strings.TrimSuffix(audio.RenderFilename(asciiOnly(base), from, to, info.SampleRate, whole), ".mp3") + ".zip"
	stem := strings.TrimSuffix(audio.RenderFilename(base, 0, 0, info.SampleRate, true), ".mp3")

	// The MIDI first: it is small, and knowing whether there is any lets the
	// header say so before the first byte of audio goes out.
	mid, manifest, err := bundle.RegionMIDI(path, stem+".wav", from, to)
	if err != nil {
		log.Printf("bundle %s [%d,%d): midi: %v", name, from, to, err)
		mid, manifest = nil, nil
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(
		`attachment; filename="%s"; filename*=UTF-8''%s`, asciiName, url.PathEscape(zipName)))
	w.Header().Set("Cache-Control", "no-store")
	if mid == nil {
		w.Header().Set("X-Hindsight-Midi", "none")
	}

	zw := zip.NewWriter(w)
	// Audio is stored, not deflated: PCM does not compress and the Pi's
	// CPU is better spent elsewhere.
	wavEntry, err := zw.CreateHeader(&zip.FileHeader{Name: stem + ".wav", Method: zip.Store})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "bundle failed")
		return
	}
	if err := audio.WriteRegion32(wavEntry, path, from, to); err != nil {
		// Headers are gone; the client sees a truncated zip. Log it.
		log.Printf("bundle %s [%d,%d): wav: %v", name, from, to, err)
		return
	}
	if mid != nil {
		if e, err := zw.Create(stem + ".mid"); err == nil {
			e.Write(mid)
		}
		if mb, err := json.MarshalIndent(manifest, "", "  "); err == nil {
			if e, err := zw.Create(stem + ".manifest.json"); err == nil {
				e.Write(mb)
			}
		}
	}
	if err := zw.Close(); err != nil {
		log.Printf("bundle %s: close: %v", name, err)
	}
}
