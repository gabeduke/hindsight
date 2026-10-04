package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// The per-flag endpoints. Each names one flag, by id, so two devices editing a
// take's flags no longer replace each other's lists: the old whole-array PATCH
// let a page that had been open a while silently undo a flag added from
// another device. The whole-array PATCH still works for scripts; the UI uses
// these.
//
//	POST   /api/take/flags?file=        {"id"?: "r…", "frame": N, "label": "..."}
//	PATCH  /api/take/flags?file=&id=    {"frame"?: N, "label"?: "..."}
//	DELETE /api/take/flags?file=&id=
//
// Every one runs under the take's lock, from the read through the cue
// rewrite, and answers {"flag": ..., "flags": [...], "cue_error"?: "..."}.
//
// A POST may carry the new flag's id, made by the client, so the page can
// label or delete a flag before the POST has answered. Sending the same id
// twice adds the flag once: a retried POST is harmless.

type flagResponse struct {
	Flag     *audio.Flag    `json:"flag,omitempty"`
	Flags    []audio.Flag   `json:"flags"`
	CueError string         `json:"cue_error,omitempty"`
	Undo     audio.UndoInfo `json:"undo"`
}

// takeResponse is a take as /api/jams describes it, plus what its Undo would
// do.
type takeResponse struct {
	audio.Take
	Undo audio.UndoInfo `json:"undo"`
}

// handleTakeGet describes one take, in the same shape as an entry of
// /api/jams, so the take page no longer loads the whole list to find it.
func (a *API) handleTakeGet(w http.ResponseWriter, r *http.Request) {
	name, err := a.safeTakeName(r.URL.Query().Get("file"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	t, err := audio.ReadTake(a.cfg.OutputDir, name)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, http.StatusOK, takeResponse{Take: t, Undo: audio.HistoryInfo(filepath.Join(a.cfg.OutputDir, name))})
}

// takeForWrite validates ?file= and returns the take's path, or writes the
// error and returns false.
func (a *API) takeForWrite(w http.ResponseWriter, r *http.Request) (name, wav string, ok bool) {
	name, err := a.safeTakeName(r.URL.Query().Get("file"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return "", "", false
	}
	wav = filepath.Join(a.cfg.OutputDir, name)
	fi, err := os.Stat(wav)
	if err != nil || !fi.Mode().IsRegular() {
		writeErr(w, http.StatusNotFound, "not found")
		return "", "", false
	}
	return name, wav, true
}

// takeFrameCount is how many frames a take holds, or -1 when its header can't
// be read -- in which case frames are not range-checked, as with the PATCH.
func takeFrameCount(wav string) int64 {
	info, err := audio.ReadWAVInfo(wav)
	if err != nil {
		return -1
	}
	bpf := int64(info.Channels * info.BitsPerSample / 8)
	if bpf <= 0 {
		return -1
	}
	return info.DataBytes / bpf
}

// flagBody is what POST and PATCH accept. Pointers tell "absent" from zero.
// ID is read only by POST.
type flagBody struct {
	ID    *string `json:"id"`
	Frame *int64  `json:"frame"`
	Label *string `json:"label"`
}

// stillThere reports whether the take survived until its lock was taken. A
// delete can land between the existence check and the lock; writing the
// sidecar then would leave a .meta.json for a take that is gone.
func stillThere(w http.ResponseWriter, wav string) bool {
	if _, err := os.Stat(wav); err != nil {
		writeErr(w, http.StatusNotFound, "not found")
		return false
	}
	return true
}

func decodeFlagBody(w http.ResponseWriter, r *http.Request) (flagBody, bool) {
	var b flagBody
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10))
	if err := dec.Decode(&b); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body")
		return b, false
	}
	if dec.More() {
		writeErr(w, http.StatusBadRequest, "unexpected trailing content in body")
		return b, false
	}
	return b, true
}

// checkFrame validates a flag frame against the take's length.
func checkFrame(w http.ResponseWriter, frame, frames int64) bool {
	if frame < 0 {
		writeErr(w, http.StatusBadRequest, "flag frames must not be negative")
		return false
	}
	if frames >= 0 && frame >= frames {
		writeErr(w, http.StatusBadRequest, "flag frame is past the end of the take")
		return false
	}
	return true
}

// commitFlags writes the take's sidecar with flags, records the change for
// Undo, mirrors the flags into the cue chunk and answers. before is the
// sidecar as it was read. The caller holds the take's lock.
func (a *API) commitFlags(w http.ResponseWriter, name, wav string, before, m audio.Meta, changed *audio.Flag) {
	m.Flags = audio.EnsureFlagIDs(audio.NormalizeFlags(m.Flags))
	if err := audio.WriteMeta(wav, m); err != nil {
		writeMetaErr(w, name, err)
		return
	}
	resp := flagResponse{Flag: changed, Flags: m.Flags, Undo: recordUndo(wav, before, m)}
	if resp.Flags == nil {
		resp.Flags = []audio.Flag{}
	}
	if err := audio.WriteCuePoints(wav, m.Flags); err != nil {
		log.Printf("cue points for %s: %v", name, err)
		resp.CueError = "flags saved, but the take's cue points could not be updated"
	}
	writeJSON(w, http.StatusOK, resp)
}

// writeMetaErr maps a sidecar write failure to a status, keeping paths off the
// wire.
func writeMetaErr(w http.ResponseWriter, name string, err error) {
	switch {
	case errors.Is(err, audio.ErrNewerSidecar):
		writeErr(w, http.StatusConflict, "this take was edited by a newer version")
	case errors.Is(err, syscall.ENOSPC):
		writeErr(w, http.StatusInsufficientStorage, "disk full")
	default:
		log.Printf("take sidecar %s: %v", name, err)
		writeErr(w, http.StatusInternalServerError, "could not save")
	}
}

func (a *API) handleTakeFlagPost(w http.ResponseWriter, r *http.Request) {
	name, wav, ok := a.takeForWrite(w, r)
	if !ok {
		return
	}
	b, ok := decodeFlagBody(w, r)
	if !ok {
		return
	}
	if b.Frame == nil {
		writeErr(w, http.StatusBadRequest, "frame is required")
		return
	}
	if !checkFrame(w, *b.Frame, takeFrameCount(wav)) {
		return
	}
	id := audio.NewFlagID()
	if b.ID != nil {
		if len(*b.ID) != 9 || (*b.ID)[0] != 'r' || !audio.ValidFlagID(*b.ID) {
			writeErr(w, http.StatusBadRequest, "a new flag's id is r and eight hex digits")
			return
		}
		id = *b.ID
	}

	unlock := audio.LockTake(wav)
	defer unlock()
	if !stillThere(w, wav) {
		return
	}
	before := audio.ReadMeta(wav)
	m := before
	m.Flags = audio.EnsureFlagIDs(m.Flags) // a copy: before keeps its own
	if i := indexOfFlag(m.Flags, id); i >= 0 {
		// Already added: a retry, or a double send. Answer as if it were new.
		f := m.Flags[i]
		writeJSON(w, http.StatusOK, flagResponse{Flag: &f, Flags: m.Flags, Undo: audio.HistoryInfo(wav)})
		return
	}
	if len(m.Flags) >= maxTakeFlags {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("a take may carry at most %d flags", maxTakeFlags))
		return
	}
	f := audio.Flag{ID: id, Frame: *b.Frame}
	if b.Label != nil {
		f.Label = sanitizeLabel(*b.Label)
	}
	m.Flags = append(m.Flags, f)
	a.commitFlags(w, name, wav, before, m, &f)
}

func (a *API) handleTakeFlagPatch(w http.ResponseWriter, r *http.Request) {
	name, wav, ok := a.takeForWrite(w, r)
	if !ok {
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id is required")
		return
	}
	b, ok := decodeFlagBody(w, r)
	if !ok {
		return
	}
	if b.Frame != nil && !checkFrame(w, *b.Frame, takeFrameCount(wav)) {
		return
	}

	unlock := audio.LockTake(wav)
	defer unlock()
	if !stillThere(w, wav) {
		return
	}
	before := audio.ReadMeta(wav)
	m := before
	m.Flags = audio.EnsureFlagIDs(m.Flags) // a copy: before keeps its own
	i := indexOfFlag(m.Flags, id)
	if i < 0 {
		writeErr(w, http.StatusNotFound, "no such flag")
		return
	}
	if b.Frame != nil {
		m.Flags[i].Frame = *b.Frame
	}
	if b.Label != nil {
		m.Flags[i].Label = sanitizeLabel(*b.Label)
	}
	f := m.Flags[i]
	a.commitFlags(w, name, wav, before, m, &f)
}

func (a *API) handleTakeFlagDelete(w http.ResponseWriter, r *http.Request) {
	name, wav, ok := a.takeForWrite(w, r)
	if !ok {
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id is required")
		return
	}

	unlock := audio.LockTake(wav)
	defer unlock()
	if !stillThere(w, wav) {
		return
	}
	before := audio.ReadMeta(wav)
	m := before
	m.Flags = audio.EnsureFlagIDs(m.Flags) // a copy: before keeps its own
	i := indexOfFlag(m.Flags, id)
	if i < 0 {
		writeErr(w, http.StatusNotFound, "no such flag")
		return
	}
	removed := m.Flags[i]
	m.Flags = append(m.Flags[:i], m.Flags[i+1:]...)
	a.commitFlags(w, name, wav, before, m, &removed)
}

func indexOfFlag(flags []audio.Flag, id string) int {
	for i, f := range flags {
		if f.ID == id {
			return i
		}
	}
	return -1
}

// recordUndo logs what changed between before and after for Undo, and
// answers with the take's undo state and the operation just recorded. A
// failure to log is not the edit's failure: the edit is saved.
func recordUndo(wav string, before, after audio.Meta) audio.UndoInfo {
	op, err := audio.RecordHistory(wav, before, after, time.Now())
	if err != nil {
		log.Printf("history for %s: %v", filepath.Base(wav), err)
	}
	info := audio.HistoryInfo(wav)
	info.Op = op
	return info
}

// handleTakeUndo undoes one change to a take: the newest, or with ?op= the
// one a toast's Undo names. A change made since by someone else is not
// overwritten: the step is skipped and the answer says so.
//
//	POST /api/take/undo?file=[&op=]
//	-> {"undone"|"skipped": "rename", "take": {...}, "undo": {...}, "cue_error"?}
func (a *API) handleTakeUndo(w http.ResponseWriter, r *http.Request) {
	name, wav, ok := a.takeForWrite(w, r)
	if !ok {
		return
	}
	opID := r.URL.Query().Get("op")
	unlock := audio.LockTake(wav)
	defer unlock()
	if !stillThere(w, wav) {
		return
	}
	m := audio.ReadMeta(wav)
	op, err := audio.Undo(wav, &m, opID)
	resp := struct {
		Undone   string         `json:"undone,omitempty"`
		Skipped  string         `json:"skipped,omitempty"`
		Take     *audio.Take    `json:"take,omitempty"`
		Undo     audio.UndoInfo `json:"undo"`
		CueError string         `json:"cue_error,omitempty"`
	}{}
	switch {
	case errors.Is(err, audio.ErrNothingToUndo):
		writeErr(w, http.StatusConflict, "nothing to undo")
		return
	case errors.Is(err, audio.ErrUndoClash):
		resp.Skipped = op.What
	case err != nil:
		log.Printf("undo %s: %v", name, err)
		writeErr(w, http.StatusInternalServerError, "could not undo")
		return
	default:
		if err := audio.WriteMeta(wav, m); err != nil {
			writeMetaErr(w, name, err)
			return
		}
		resp.Undone = op.What
		if op.Field == "flag" {
			if err := audio.WriteCuePoints(wav, audio.EnsureFlagIDs(audio.NormalizeFlags(m.Flags))); err != nil {
				log.Printf("cue points for %s: %v", name, err)
				resp.CueError = "flags saved, but the take's cue points could not be updated"
			}
		}
	}
	if t, err := audio.ReadTake(a.cfg.OutputDir, name); err == nil {
		resp.Take = &t
	}
	resp.Undo = audio.HistoryInfo(wav)
	writeJSON(w, http.StatusOK, resp)
}
