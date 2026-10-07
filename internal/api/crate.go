package api

import (
	"fmt"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/tape"
)

// The crate (step B1, docs/superpowers/specs/2026-10-07-crate-design.md): the
// clips kept from takes, the ring and the tape.
//
//	GET    /api/crate?q=&take=   the kept clips, newest first: by name, or kept from a take
//	POST   /api/crate            {take, from, to} | {ring_from, ring_to, source} | {tape, clip} | {clipboard: true}
//	PATCH  /api/crate?id=        {name} | {restore: true}
//	DELETE /api/crate?id=        to the trash, for CrateTrashDays
//	GET    /api/crate/audio?id=  one as a 16-bit WAV, to play or share
//	POST   /api/crate/split      {take, at}: Split here, two clips either side of at
//
// A clip is dropped onto a tape with POST /api/tapes/drop {crate, track}.

func (a *API) handleCrate(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	q := r.URL.Query()
	l, err := a.tape.CrateList(q.Get("q"), q.Get("take"))
	if err != nil {
		tapeErr(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"clips": l, "sample_rate": a.tape.Store().SampleRate()})
}

// takeTitle is a take as the page names it: its label, else when it was made.
func takeTitle(name, path string) string {
	m := audio.ReadMeta(path)
	if l := strings.TrimSpace(m.Label); l != "" {
		return l
	}
	var mod time.Time
	if fi, err := os.Stat(path); err == nil {
		mod = fi.ModTime()
	}
	return audio.TakeCreated(name, m, mod).Format("Mon 2 Jan 15:04") // as its cassette says it
}

func (a *API) handleCrateKeep(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var b struct {
		Take      string `json:"take"`
		From      int64  `json:"from"`
		To        int64  `json:"to"`
		RingFrom  *int64 `json:"ring_from"`
		RingTo    *int64 `json:"ring_to"`
		Source    string `json:"source"`
		Tape      string `json:"tape"`
		Clip      string `json:"clip"`
		Clipboard bool   `json:"clipboard"`
	}
	if !decodeBody(w, r, &b) {
		return
	}
	var k tape.CrateClip
	var err error
	clamped := false
	switch {
	case b.Take != "":
		name, nerr := a.safeTakeName(b.Take)
		if nerr != nil {
			writeErr(w, http.StatusBadRequest, nerr.Error())
			return
		}
		path := filepath.Join(a.cfg.OutputDir, name)
		info, serr := audio.ReadWAVInfo(path)
		if serr != nil {
			writeErr(w, http.StatusNotFound, "no such take")
			return
		}
		k, err = a.tape.KeepTake(path, name, takeTitle(name, path), b.From, b.To, a.takePair(info.Channels))
	case b.RingFrom != nil:
		to := int64(-1) // up to now
		if b.RingTo != nil {
			to = *b.RingTo
		}
		k, clamped, err = a.tape.KeepRing(*b.RingFrom, to, b.Source)
	case b.Clip != "":
		k, err = a.tape.KeepTapeClip(b.Tape, b.Clip)
	case b.Clipboard:
		k, err = a.tape.KeepClipboard()
	default:
		writeErr(w, http.StatusBadRequest, "keep a take's {take, from, to}, the ring's {ring_from, ring_to, source}, a tape's {tape, clip} or {clipboard: true}")
		return
	}
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clip": k, "clamped": clamped})
}

// handleCrateSplit is a take's Split here: two kept clips, the take before
// frame at and from it on. The take isn't changed.
func (a *API) handleCrateSplit(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var b struct {
		Take string `json:"take"`
		At   int64  `json:"at"`
	}
	if !decodeBody(w, r, &b) {
		return
	}
	name, err := a.safeTakeName(b.Take)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	path := filepath.Join(a.cfg.OutputDir, name)
	info, err := audio.ReadWAVInfo(path)
	if err != nil {
		writeErr(w, http.StatusNotFound, "no such take")
		return
	}
	ks, err := a.tape.SplitTake(path, name, takeTitle(name, path), b.At, a.takePair(info.Channels))
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clips": ks})
}

func (a *API) handleCratePatch(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var b struct {
		Name    *string `json:"name"`
		Restore bool    `json:"restore"`
	}
	if !decodeBody(w, r, &b) {
		return
	}
	id := r.URL.Query().Get("id")
	var k tape.CrateClip
	var err error
	switch {
	case b.Restore:
		k, err = a.tape.RestoreCrateClip(id)
	case b.Name != nil:
		k, err = a.tape.RenameCrateClip(id, *b.Name)
	default:
		writeErr(w, http.StatusBadRequest, "rename with {name}, or bring back with {restore: true}")
		return
	}
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clip": k})
}

func (a *API) handleCrateDelete(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	k, err := a.tape.DeleteCrateClip(r.URL.Query().Get("id"))
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clip": k})
}

func (a *API) handleCrateAudio(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	c, err := a.tape.CrateWAV(r.URL.Query().Get("id"))
	if err != nil {
		tapeErr(w, err)
		return
	}
	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Content-Length", fmt.Sprint(c.Bytes()))
	disp := "inline"
	if r.URL.Query().Get("download") != "" {
		disp = "attachment"
	}
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disp, map[string]string{"filename": c.Name}))
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodHead {
		return
	}
	if _, err := c.WriteTo(&stallWriter{w: w, rc: http.NewResponseController(w)}); err != nil {
		log.Printf("[!] crate audio: %v", err)
	}
}
