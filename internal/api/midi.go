// The take page's MIDI: notes in frames, and the region bundle.
package api

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"

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
