package api

import (
	"fmt"
	"net/http"
	"path/filepath"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/tape"
)

// The buffer on the cue lane (internal/tape/cuegrab.go): GRAB onto the lane,
// and a cue clip's drawer.
//
//	POST  /api/tapes/cue/grab?id=   GRAB: {bars | seconds | ring_from, ring_to}, from sources;
//	                                {clip, sources}: that clip's span again, from those;
//	                                {take, from, to}: a take's span. The tape's state, with
//	                                edit.cue_clip, and edit.cue_replaced when it took an
//	                                untouched clip's place (the tape's Undo brings that back).
//	PATCH /api/tapes/cue/clip?id=   {clip, in, out} its window; {clip, gain_db | fade_in,
//	                                fade_out, fade_in_shape, fade_out_shape | normalize |
//	                                reverse}. The tape's state, edit.cue_clip. One Undo each,
//	                                a run of trims or of levels one together.
//	POST  /api/tapes/cue/drop?id=   {clip, track, at?, merge?}: on the tape, a lane a track,
//	                                as /api/tapes/drop answers. One Undo.
//	POST  /api/tapes/cue/keep?id=   {clip}: KEEP, as a take on the shelf: {name, label, seconds}.
//	GET   /api/tapes/cue/audio?id=&clip=  its first minute, its lanes summed: Audition.

func (a *API) handleCueGrab(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var b struct {
		Bars     int      `json:"bars"`
		Seconds  float64  `json:"seconds"`
		RingFrom *int64   `json:"ring_from"`
		RingTo   *int64   `json:"ring_to"`
		Sources  []string `json:"sources"`
		Clip     string   `json:"clip"` // again: this clip's span, from Sources
		Take     string   `json:"take"`
		From     int64    `json:"from"`
		To       int64    `json:"to"`
	}
	if !decodeBody(w, r, &b) {
		return
	}
	id := r.URL.Query().Get("id")
	var g tape.CueGrabbed
	var err error
	if b.Take != "" {
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
		g, err = a.tape.GrabTakeToCue(id, path, name, takeTitle(name, path), b.From, b.To, a.takePair(info.Channels))
	} else {
		g, err = a.tape.GrabToCue(id, tape.GrabRequest{Bars: b.Bars, Seconds: b.Seconds, RingFrom: b.RingFrom, RingTo: b.RingTo, Sources: b.Sources}, b.Clip)
	}
	if err != nil {
		tapeErr(w, err)
		return
	}
	a.writeTapeStateWith(w, id, &tape.EditResult{Op: "cue-grab", Clips: 1, CueClip: &g.Clip, CueReplaced: g.Replaced}, false)
}

func (a *API) handleCueClip(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var b struct {
		Clip string `json:"clip"`
		In   *int64 `json:"in"`
		Out  *int64 `json:"out"`
		tape.BoardShape
	}
	if !decodeBody(w, r, &b) {
		return
	}
	if b.Clip == "" {
		writeErr(w, http.StatusBadRequest, "which clip: {clip}")
		return
	}
	if (b.In == nil) != (b.Out == nil) {
		writeErr(w, http.StatusBadRequest, "a window is both its in and its out")
		return
	}
	if b.In == nil && b.BoardShape.Empty() {
		writeErr(w, http.StatusBadRequest, "change the clip's {in, out}, gain_db, fades, normalize or reverse")
		return
	}
	id := r.URL.Query().Get("id")
	var c tape.CueClip
	var err error
	if b.In != nil {
		c, err = a.tape.CueTrim(id, b.Clip, *b.In, *b.Out)
	}
	if err == nil && !b.BoardShape.Empty() {
		c, err = a.tape.CueShape(id, b.Clip, b.BoardShape)
	}
	if err != nil {
		tapeErr(w, err)
		return
	}
	a.writeTapeStateWith(w, id, &tape.EditResult{Op: "cue-clip", Clips: 1, CueClip: &c}, false)
}

func (a *API) handleCueDrop(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var b struct {
		Clip  string `json:"clip"`
		Track int    `json:"track"`
		At    *int64 `json:"at"`
		Merge bool   `json:"merge"`
	}
	if !decodeBody(w, r, &b) {
		return
	}
	if b.Track == 0 {
		b.Track = 1
	}
	d, err := a.tape.CueDrop(r.URL.Query().Get("id"), b.Clip, b.Track, b.Merge, b.At)
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

// handleCueKeep is a cue clip's KEEP, a take like the buffer's
// (handleClipboardKeep): its preview made after, and MAX_SAVES applied,
// never to it.
func (a *API) handleCueKeep(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var b struct {
		Clip string `json:"clip"`
	}
	if !decodeBody(w, r, &b) {
		return
	}
	if free := audio.EnsureFree(a.cfg.OutputDir, a.cfg.MinFreeGB); free < a.cfg.MinFreeGB {
		writeErr(w, http.StatusInsufficientStorage, fmt.Sprintf("low disk: %.2f GB free, need %.2f GB", free, a.cfg.MinFreeGB))
		return
	}
	k, err := a.tape.CueKeep(r.URL.Query().Get("id"), b.Clip, a.cfg.OutputDir, time.Now())
	if err != nil {
		tapeErr(w, err)
		return
	}
	a.background(func() { audio.MakePreview(a.cfg, filepath.Join(a.cfg.OutputDir, k.Name), 2) })
	if a.saver != nil {
		a.background(func() { a.saver.Prune(k.Name) })
	}
	writeJSON(w, http.StatusOK, k)
}

func (a *API) handleCueAudio(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	q := r.URL.Query()
	pcm, err := a.tape.CueAudio(q.Get("id"), q.Get("clip"))
	if err != nil {
		tapeErr(w, err)
		return
	}
	a.serveWAV16(w, r, "cue.wav", pcm)
}
