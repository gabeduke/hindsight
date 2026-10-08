package api

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/mono"
	"github.com/gabeduke/hindsight/internal/tape"
)

// The tape (docs/superpowers/specs/2026-10-03-tape-design.md), under
// /api/tapes, clear of /api/take. One tape is loaded -- the one the
// transport plays -- and every action names its tape and is refused for any
// other.
//
//	GET    /api/tapes                  the tapes, and which is loaded
//	POST   /api/tapes                  a new tape: {name, bpm?, bars?}
//	GET    /api/tapes/state?id=        one tape, with the transport if it's loaded
//	PATCH  /api/tapes?id=              name, click, loop, a track, a clip
//	DELETE /api/tapes?id=              delete one (not the loaded one), and free its audio
//	POST   /api/tapes/load?id=         make it the loaded tape
//	POST   /api/tapes/transport?id=    {action: play|stop|locate, quantum, pos}
//	POST   /api/tapes/catch?id=        {track, source, pass | out | bars, replace}
//	POST   /api/tapes/record?id=       {track, source}: arm, or punch in
//	DELETE /api/tapes/record?id=       end the punch and keep it (?cancel=1: don't)
//	POST   /api/tapes/tap?id=          {track, source}: a free-loop tap
//	DELETE /api/tapes/tap?id=          forget a first tap
//	POST   /api/tapes/drop?id=         {crate, track}: a kept clip, as the clipboard drops;
//	                                   {take, from, to, track, bars}: a take's span onto the tape;
//	                                   {..., at, loop, replace, source}: at that tape frame;
//	                                   {track, merge}: the clipboard, at the playhead
//	POST   /api/tapes/send?id=         {take, from?, to?, track}: a take onto the tape by its tempo and downbeat
//	POST   /api/tapes/edit?id=         {op: lift|copy|split|join|slide|multiply|reverse|trim|repeat|move|remove|duplicate|section-add|section-set|section-remove, track, all, clip, clips, pos, at, edge, to, count, dt, dtrack, section, name, color, end}
//	GET    /api/tapes/clip?id=&clip=   one clip as a 16-bit WAV, to share
//	GET    /api/tapes/listen?id=       the loop as a 16-bit WAV, to overdub on a phone
//	POST   /api/tapes/mixdown?id=      {all}: play In to Out (all: the whole tape) once, save it as a take
//	GET    /api/tapes/export?id=       the loaded tape as stems and a tempo map, in a zip
//	POST   /api/tapes/undo?id=         and /redo
//	POST   /api/tapes/clone?id=        {name}: a new tape sharing this one's audio
//	POST   /api/tapes/cleanup          remove pool audio nothing uses
//	GET    /api/tapes/peaks?file=      a pool file's peaks (&from=&to=&buckets=: just that range)
//	GET    /api/tapes/slice?file=&from=&to=  a 16-bit WAV of [from, to) of a pool file

// SetTape attaches the tape engine; without it the tape routes answer 404.
func (a *API) SetTape(e *tape.Engine) { a.tape = e }

func (a *API) tapeOff(w http.ResponseWriter) bool {
	if a.tape == nil {
		writeErr(w, http.StatusNotFound, "the tape is off (set TAPE=true)")
		return true
	}
	return false
}

// tapeErr maps an engine error to a status.
func tapeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, tape.ErrNoSuchTape), errors.Is(err, tape.ErrNoSuchCrateClip):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, audio.ErrRangeGone):
		writeErr(w, http.StatusConflict, tape.ErrGone.Error())
	case errors.Is(err, audio.ErrLowDisk):
		writeErr(w, http.StatusInsufficientStorage, err.Error())
	case errors.Is(err, tape.ErrNoTape), errors.Is(err, tape.ErrWrongTape), errors.Is(err, tape.ErrNotYet),
		errors.Is(err, tape.ErrGone), errors.Is(err, tape.ErrNoPass), errors.Is(err, tape.ErrNothingToDo),
		errors.Is(err, tape.ErrNoCapture), errors.Is(err, tape.ErrNotLined), errors.Is(err, tape.ErrNotPlayed),
		errors.Is(err, tape.ErrSlipped), errors.Is(err, tape.ErrRecording), errors.Is(err, tape.ErrNotRecording),
		errors.Is(err, tape.ErrEmptyClipboard), errors.Is(err, tape.ErrNoOutput), errors.Is(err, tape.ErrMixingDown),
		errors.Is(err, tape.ErrNoSaver), errors.Is(err, tape.ErrExporting), errors.Is(err, tape.ErrLoopMoved),
		errors.Is(err, tape.ErrNeedsJamRoom), errors.Is(err, tape.ErrNoStream):
		writeErr(w, http.StatusConflict, err.Error())
	case errors.Is(err, tape.ErrBadParameter), errors.Is(err, tape.ErrPastTheEnd), errors.Is(err, tape.ErrBadLoop),
		errors.Is(err, tape.ErrNoSuchTrack), errors.Is(err, tape.ErrNoSuchClip), errors.Is(err, tape.ErrNoGrid),
		errors.Is(err, tape.ErrNoSuchSection):
		writeErr(w, http.StatusBadRequest, err.Error())
	default:
		writeErr(w, http.StatusInternalServerError, err.Error())
	}
}

func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	if err := dec.Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

func (a *API) handleTapes(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	list, err := a.tape.Store().List()
	if err != nil {
		tapeErr(w, err)
		return
	}
	if list == nil {
		list = []tape.Summary{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"loaded": a.tape.LoadedID(), "tapes": list})
}

func (a *API) handleTapeCreate(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var b struct {
		Name string  `json:"name"`
		BPM  float64 `json:"bpm"`
		Bars int     `json:"bars"`
	}
	if !decodeBody(w, r, &b) {
		return
	}
	t, err := a.tape.Store().Create(sanitizeLabel(b.Name), b.BPM, b.Bars, time.Now())
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

type tapeStateResponse struct {
	Tape    *tape.Tape         `json:"tape"`
	Loaded  bool               `json:"loaded"`
	Live    *tape.Live         `json:"live,omitempty"`
	Undo    int                `json:"undo"`
	Redo    int                `json:"redo"`
	Sources []tape.SourceState `json:"sources"`
	BPM     float64            `json:"bpm,omitempty"`
	Edit    *tape.EditResult   `json:"edit,omitempty"` // what an edit did

	SuggestBPM float64 `json:"suggest_bpm,omitempty"` // where an empty tape's tempo form starts
}

func (a *API) handleTapeState(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	a.writeTapeStateWith(w, r.URL.Query().Get("id"), nil, r.URL.Query().Get("suggest") == "1")
}

// writeTapeStateWith answers a tape's state, and what an edit did to it.
// The tempo suggestion is opt-in (suggest=1): it reads the takes and every
// tape, and the page polls the state several times a second.
func (a *API) writeTapeStateWith(w http.ResponseWriter, id string, edit *tape.EditResult, suggest bool) {
	resp := tapeStateResponse{Sources: a.tape.Sources(), Edit: edit}
	if id != "" && id == a.tape.LoadedID() {
		resp.Tape = a.tape.Loaded()
		resp.Loaded = true
		l := a.tape.Live()
		resp.Live = &l
		resp.Undo, resp.Redo = a.tape.UndoDepth()
	} else {
		t, err := a.tape.Store().Load(id)
		if err != nil {
			tapeErr(w, err)
			return
		}
		t.History, t.Future = nil, nil
		resp.Tape = t
	}
	if resp.Tape.Grid != nil {
		resp.BPM = resp.Tape.Grid.BPM(resp.Tape.SampleRate)
	}
	if suggest && resp.Tape.Grid == nil && resp.Tape.Empty() {
		resp.SuggestBPM = a.suggestBPM(resp.Tape.ID)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, resp)
}

// suggestBPM is where an empty tape's tempo form starts: the tempo of the
// newer of the clipboard and the newest take that has one, else the last
// tape's, else 90. A clipboard copied long ago doesn't beat a take played
// since.
func (a *API) suggestBPM(id string) float64 {
	var newest *audio.Take
	if takes, _, err := a.takes.List(); err == nil {
		for i := range takes {
			if takes[i].BPM != nil && *takes[i].BPM > 0 && (newest == nil || takes[i].Created.After(newest.Created)) {
				newest = &takes[i]
			}
		}
	}
	if c, err := a.tape.Clipboard(); err == nil && c != nil && c.BPM > 0 && (newest == nil || !c.Created.Before(newest.Created)) {
		return c.BPM
	}
	if newest != nil {
		return *newest.BPM
	}
	if bpm, ok := a.tape.LastTapeBPM(id); ok {
		return bpm
	}
	return 90
}

// trackIn is a track's input, as PATCH /api/tapes sets it.
type trackIn struct {
	N      int    `json:"n"`
	Source string `json:"source"`
}

func (a *API) handleTapePatch(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	id := r.URL.Query().Get("id")
	var b struct {
		Name  *string `json:"name"`
		Click *bool   `json:"click"`
		// RecTrack arms a track, the one catches and punches go onto; Input
		// sets a track's input, and Inputs several at once. Neither is a
		// step of undo.
		RecTrack *int      `json:"rec_track"`
		Input    *trackIn  `json:"input"`
		Inputs   []trackIn `json:"inputs"`
		Bars     *int      `json:"bars"`
		Tempo    *struct {
			BPM  float64 `json:"bpm"`
			Bars int     `json:"bars"`
		} `json:"tempo"`
		Loop *struct {
			In  *int64 `json:"in"`
			Out *int64 `json:"out"`
			On  *bool  `json:"on"`
		} `json:"loop"`
		Track *struct {
			N      int      `json:"n"`
			Name   *string  `json:"name"`
			Bus    *string  `json:"bus"`
			GainDB *float64 `json:"gain_db"`
			Pan    *float64 `json:"pan"`
			Mute   *bool    `json:"mute"`
			Solo   *bool    `json:"solo"`
		} `json:"track"`
		Clip *struct {
			ID      string   `json:"id"`
			GainDB  *float64 `json:"gain_db"`
			NudgeMS *float64 `json:"nudge_ms"`
			Remove  bool     `json:"remove"`
			Tile    bool     `json:"tile"`
			// FadeIn and FadeOut set its fades, in frames (0: none), and
			// FadeInShape and FadeOutShape their curves ("", "linear", "s",
			// "exp").
			FadeIn       *int64  `json:"fade_in"`
			FadeOut      *int64  `json:"fade_out"`
			FadeInShape  *string `json:"fade_in_shape"`
			FadeOutShape *string `json:"fade_out_shape"`
		} `json:"clip"`
	}
	if !decodeBody(w, r, &b) {
		return
	}
	// Everything undoable is one edit, so a field that's refused leaves the
	// tape as it was. Quick changes to one level or nudge are one undo step;
	// a toggle or a removal is always its own.
	kind := ""
	switch {
	case b.Track != nil && b.Track.GainDB != nil:
		kind = fmt.Sprintf("gain:%d", b.Track.N)
	case b.Track != nil && b.Track.Pan != nil:
		kind = fmt.Sprintf("pan:%d", b.Track.N)
	case b.Clip != nil && (b.Clip.FadeIn != nil || b.Clip.FadeOut != nil || b.Clip.FadeInShape != nil || b.Clip.FadeOutShape != nil):
		// A fade is a step of its own, never merged into a level change.
	case b.Clip != nil && b.Clip.GainDB != nil && !b.Clip.Remove:
		kind = "clip-gain:" + b.Clip.ID
	case b.Clip != nil && b.Clip.NudgeMS != nil && !b.Clip.Remove:
		kind = "clip-nudge:" + b.Clip.ID
	}
	// The inputs there are, read before the tape is locked to change it.
	var inputs []tape.SourceState
	set := b.Inputs
	if b.Input != nil {
		set = append(set, *b.Input)
	}
	if len(set) > 0 {
		inputs = a.tape.Sources()
	}
	meta := func(t *tape.Tape) error {
		if b.Name != nil {
			if n := sanitizeLabel(*b.Name); n != "" {
				t.Name = n
			}
		}
		if b.Click != nil {
			t.Click = *b.Click
		}
		if b.RecTrack != nil {
			if *b.RecTrack < 1 || *b.RecTrack > len(t.Tracks) {
				return tape.ErrNoSuchTrack
			}
			t.RecTrack = *b.RecTrack
		}
		for _, in := range set {
			known := false
			for _, s := range inputs {
				known = known || s.Name == in.Source
			}
			if !known {
				return fmt.Errorf("%w: no input called %q", tape.ErrBadParameter, in.Source)
			}
			if err := t.SetInput(in.N, in.Source); err != nil {
				return err
			}
		}
		return nil
	}
	undoable := b.Tempo != nil || b.Bars != nil || b.Loop != nil || b.Track != nil || b.Clip != nil
	if undoable {
		sr := a.tape.Store().SampleRate()
		err := a.tape.Edit(id, kind, func(t *tape.Tape, s *tape.State) error {
			if err := meta(t); err != nil { // the name and click ride along, outside undo
				return err
			}
			if tm := b.Tempo; tm != nil {
				// Only while the tape is empty: once it has audio its tempo is
				// fixed, since nothing is ever stretched. Bars relabel it instead.
				for _, tr := range s.Tracks {
					if len(tr.Clips) > 0 {
						return fmt.Errorf("%w: the tempo is fixed once the tape has audio; change its bars instead", tape.ErrBadParameter)
					}
				}
				if tm.BPM < 20 || tm.BPM > 400 || tm.Bars < 1 || tm.Bars > 64 {
					return fmt.Errorf("%w: tempo 20–400 BPM, 1 to 64 bars", tape.ErrBadParameter)
				}
				g := tape.GridFor(tm.BPM, tm.Bars, sr)
				s.Grid = &g
				s.Loop = tape.Loop{In: 0, Out: g.Frames, On: true}
			}
			if b.Bars != nil {
				if s.Grid == nil {
					return tape.ErrNoGrid
				}
				if *b.Bars < 1 || *b.Bars > 64 {
					return fmt.Errorf("%w: 1 to 64 bars", tape.ErrBadParameter)
				}
				s.Grid.Bars = *b.Bars
			}
			if l := b.Loop; l != nil {
				if l.In != nil {
					s.Loop.In = *l.In
				}
				if l.Out != nil {
					s.Loop.Out = *l.Out
				}
				if l.On != nil {
					s.Loop.On = *l.On
				}
			}
			if tr := b.Track; tr != nil {
				if tr.N < 1 || tr.N > len(s.Tracks) {
					return tape.ErrNoSuchTrack
				}
				t := &s.Tracks[tr.N-1]
				if tr.Name != nil {
					t.Name = sanitizeLabel(*tr.Name)
				}
				if tr.Bus != nil {
					t.Bus = strings.ToUpper(*tr.Bus)
				}
				if tr.GainDB != nil {
					if *tr.GainDB < -60 || *tr.GainDB > 12 {
						return fmt.Errorf("%w: gain -60..12 dB", tape.ErrBadParameter)
					}
					t.GainDB = *tr.GainDB
				}
				if tr.Pan != nil {
					t.Pan = *tr.Pan
				}
				if tr.Mute != nil {
					t.Mute = *tr.Mute
				}
				if tr.Solo != nil {
					t.Solo = *tr.Solo
				}
			}
			if c := b.Clip; c != nil {
				if err := patchFades(s, c.ID, c.FadeIn, c.FadeOut, c.FadeInShape, c.FadeOutShape, t.SampleRate); err != nil {
					return err
				}
				return patchClip(s, c.ID, c.GainDB, c.NudgeMS, c.Remove, c.Tile)
			}
			return nil
		})
		if err != nil {
			tapeErr(w, err)
			return
		}
	} else if b.Name != nil || b.Click != nil || b.RecTrack != nil || len(set) > 0 {
		err := a.tape.SetMeta(id, meta)
		if err != nil {
			tapeErr(w, err)
			return
		}
	}
	a.writeTapeState(w, id)
}

// patchFades sets a clip's fades: whole frames, none longer than the clip,
// and none shorter than the 3 ms declick, which one only a few frames long
// would end in a click; and their curves, by name.
func patchFades(s *tape.State, id string, in, out *int64, inShape, outShape *string, sampleRate int) error {
	least := int64(math.Round(0.003 * float64(sampleRate)))
	if in == nil && out == nil && inShape == nil && outShape == nil {
		return nil
	}
	for _, sh := range []*string{inShape, outShape} {
		if sh != nil && !tape.ValidFadeShape(*sh) {
			return fmt.Errorf("%w: a fade's curve is \"\" (equal power), \"linear\", \"s\" or \"exp\"", tape.ErrBadParameter)
		}
	}
	for ti := range s.Tracks {
		for ci := range s.Tracks[ti].Clips {
			cl := &s.Tracks[ti].Clips[ci]
			if cl.ID != id {
				continue
			}
			for _, f := range []*int64{in, out} {
				if f != nil && (*f < 0 || *f > cl.Frames || (*f > 0 && *f < least)) {
					return fmt.Errorf("%w: a fade of 0, or %d to %d frames (3 ms to the clip's length)", tape.ErrBadParameter, least, cl.Frames)
				}
			}
			if in != nil {
				cl.FadeIn = *in
			}
			if out != nil {
				cl.FadeOut = *out
			}
			if inShape != nil {
				cl.FadeInShape = *inShape
			}
			if outShape != nil {
				cl.FadeOutShape = *outShape
			}
			return nil
		}
	}
	return tape.ErrNoSuchClip
}

// patchClip changes, tiles or removes one clip of a state.
func patchClip(s *tape.State, id string, gainDB, nudgeMS *float64, remove, tile bool) error {
	for ti := range s.Tracks {
		for ci := range s.Tracks[ti].Clips {
			cl := &s.Tracks[ti].Clips[ci]
			if cl.ID != id {
				continue
			}
			if remove {
				s.Tracks[ti].Clips = append(s.Tracks[ti].Clips[:ci], s.Tracks[ti].Clips[ci+1:]...)
				return nil
			}
			if gainDB != nil {
				if *gainDB < -60 || *gainDB > 12 {
					return fmt.Errorf("%w: gain -60..12 dB", tape.ErrBadParameter)
				}
				cl.GainDB = *gainDB
			}
			if nudgeMS != nil {
				if *nudgeMS < -500 || *nudgeMS > 500 {
					return fmt.Errorf("%w: nudge ±500 ms", tape.ErrBadParameter)
				}
				cl.NudgeMS = *nudgeMS
			}
			if tile && !s.Loop.On {
				return fmt.Errorf("%w: the loop is off, so there's no loop's end to repeat to", tape.ErrBadParameter)
			}
			if tile {
				// Copies end to end on its own layer, to the loop's end --
				// one bar through four -- wherever that layer is free.
				c := *cl
				n := 0
				for at := c.End(); s.Loop.On && at+c.Frames <= s.Loop.Out; at += c.Frames {
					free := true
					for _, o := range s.Tracks[ti].Clips {
						if o.Layer == c.Layer && o.At < at+c.Frames && at < o.End() {
							free = false
							break
						}
					}
					if !free {
						continue
					}
					cp := c
					cp.ID, cp.At = tape.NewClipID(), at
					s.Tracks[ti].Clips = append(s.Tracks[ti].Clips, cp)
					n++
				}
				if n == 0 {
					return fmt.Errorf("%w: there's no free room in the loop after it for a copy", tape.ErrBadParameter)
				}
			}
			return nil
		}
	}
	return tape.ErrNoSuchClip
}

func (a *API) writeTapeState(w http.ResponseWriter, id string) {
	a.writeTapeStateWith(w, id, nil, false)
}

func (a *API) handleTapeDelete(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	id := r.URL.Query().Get("id")
	if id == a.tape.LoadedID() {
		writeErr(w, http.StatusConflict, "load another tape before deleting this one")
		return
	}
	if err := a.tape.Store().Delete(id); err != nil {
		tapeErr(w, err)
		return
	}
	// Free the audio only it used. Clones share audio, and every tape's undo
	// history counts, so this never takes what another tape can still play.
	store := a.tape.Store()
	a.background(func() {
		if n, mb, err := store.Cleanup(nil); err != nil {
			log.Printf("[!] tape cleanup: %v", err)
		} else if n > 0 {
			log.Printf("[*] tape cleanup: %d files, %.1f MB", n, mb)
		}
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted", "id": id})
}

func (a *API) handleTapeLoad(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	id := r.URL.Query().Get("id")
	if _, err := a.tape.Load(id); err != nil {
		tapeErr(w, err)
		return
	}
	a.writeTapeState(w, id)
}

func (a *API) handleTapeTransport(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	id := r.URL.Query().Get("id")
	if id != a.tape.LoadedID() {
		tapeErr(w, tape.ErrWrongTape)
		return
	}
	var act tape.Action
	if !decodeBody(w, r, &act) {
		return
	}
	switch act.Kind {
	case "play", "stop", "locate":
	default:
		writeErr(w, http.StatusBadRequest, "action is play, stop or locate")
		return
	}
	switch act.Quantum {
	case "", tape.QuantumNow, tape.QuantumBeat, tape.QuantumBar, tape.QuantumLoop:
	default:
		writeErr(w, http.StatusBadRequest, "quantum is now, beat, bar or loop")
		return
	}
	if act.Kind == "play" && !a.tape.HasOutput() {
		writeErr(w, http.StatusConflict, "nothing plays the tape: this build has no audio output")
		return
	}
	// ▶ with a track armed counts in and records; ■ during a punch keeps it.
	kept, err := a.tape.Transport(id, act)
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "queued", "kept": kept})
}

// handleTapeRecord arms a track (stopped) or punches in (playing).
func (a *API) handleTapeRecord(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var b struct {
		Track   int    `json:"track"`
		Source  string `json:"source"`
		Replace bool   `json:"replace"`
	}
	if !decodeBody(w, r, &b) {
		return
	}
	rec, err := a.tape.Record(r.URL.Query().Get("id"), b.Track, b.Source, b.Replace)
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"record": rec})
}

// handleTapeRecordEnd ends a punch, keeping what it covered (?cancel=1:
// nothing), or disarms a track.
func (a *API) handleTapeRecordEnd(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	kept, err := a.tape.EndRecording(r.URL.Query().Get("id"), r.URL.Query().Get("cancel") == "1")
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"kept": kept})
}

// handleTapeTap takes a free-loop tap. It's stamped the moment it arrives:
// the phone's clock isn't trusted.
func (a *API) handleTapeTap(w http.ResponseWriter, r *http.Request) {
	at := mono.Now()
	if a.tapeOff(w) {
		return
	}
	var b struct {
		Track  int    `json:"track"`
		Source string `json:"source"`
	}
	if !decodeBody(w, r, &b) {
		return
	}
	res, err := a.tape.Tap(r.URL.Query().Get("id"), b.Track, b.Source, at)
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *API) handleTapeTapCancel(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	a.tape.CancelTap()
	writeJSON(w, http.StatusOK, map[string]string{"status": "forgotten"})
}

func (a *API) handleTapeCatch(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var req tape.CatchRequest
	if !decodeBody(w, r, &req) {
		return
	}
	clip, err := a.tape.Catch(r.URL.Query().Get("id"), req)
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clip": clip})
}

func (a *API) handleTapeDrop(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var b struct {
		Take  string `json:"take"`
		From  int64  `json:"from"`
		To    int64  `json:"to"`
		Track int    `json:"track"`
		Bars  int    `json:"bars"`
		Merge bool   `json:"merge"` // the clipboard's tracks all onto this one
		// At places a take's span at that tape frame, layered unless
		// Replace, and wrapped from Out to In with the loop on: a part
		// recorded over the loop on a phone. Without it, the playhead.
		At      *int64 `json:"at"`
		Replace bool   `json:"replace"`
		// Played over the loop going round: this loop, which must still
		// be the tape's.
		Loop   *struct{ In, Out int64 } `json:"loop"`
		Source string                   `json:"source"`
		// Crate drops a kept clip from the crate, as the clipboard drops.
		Crate string `json:"crate"`
	}
	if !decodeBody(w, r, &b) {
		return
	}
	if b.Track == 0 {
		b.Track = 1
	}
	if b.Crate != "" {
		d, err := a.tape.DropCrate(r.URL.Query().Get("id"), b.Crate, b.Track)
		if err != nil {
			tapeErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, d)
		return
	}
	if b.Take == "" {
		// The clipboard, at the playhead.
		d, err := a.tape.DropClipboard(r.URL.Query().Get("id"), b.Track, b.Merge)
		if err != nil {
			tapeErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, d)
		return
	}
	name, err := a.safeTakeName(b.Take)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	path := filepath.Join(a.cfg.OutputDir, name)
	if _, err := os.Stat(path); err != nil {
		writeErr(w, http.StatusNotFound, "no such take")
		return
	}
	if b.Track == 0 {
		b.Track = 1
	}
	pick := []int{0, 1}
	if info, err := audio.ReadWAVInfo(path); err == nil {
		pick = a.takePair(info.Channels)
	}
	if b.At != nil {
		src := b.Source
		if src != "phone" {
			src = "take"
		}
		var played *tape.Loop
		if b.Loop != nil {
			played = &tape.Loop{In: b.Loop.In, Out: b.Loop.Out, On: true}
		}
		clips, err := a.tape.PlaceTake(r.URL.Query().Get("id"), path, b.From, b.To, b.Track, *b.At, b.Replace, played, src, pick)
		if err != nil {
			tapeErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"clip": clips[0], "clips": clips})
		return
	}
	clip, err := a.tape.DropTake(r.URL.Query().Get("id"), path, b.From, b.To, b.Track, b.Bars, pick)
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clip": clip})
}

// handleTapeSend is the take page's Send to tape: a take, or a span of it,
// onto a track of the loaded tape, placed by what the take knows -- its
// tempo and downbeat, read from its sidecar here so the page can't send a
// stale one. See internal/tape/send.go for where it lands.
func (a *API) handleTapeSend(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var b struct {
		Take  string `json:"take"`
		From  *int64 `json:"from"` // the selection; both or neither
		To    *int64 `json:"to"`
		Track int    `json:"track"`
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
	req := tape.SendRequest{Take: path, From: 0, To: info.Frames(), Track: b.Track, Pick: a.takePair(info.Channels)}
	if req.Track == 0 {
		req.Track = 1
	}
	if (b.From == nil) != (b.To == nil) {
		writeErr(w, http.StatusBadRequest, "send the whole take, or a selection with both from and to")
		return
	}
	if b.From != nil {
		req.From, req.To = *b.From, *b.To
	}
	if req.From < 0 || req.To <= req.From || req.To > info.Frames() {
		writeErr(w, http.StatusBadRequest, "that span isn't in the take")
		return
	}
	meta := audio.ReadMeta(path)
	if meta.BPM != nil {
		req.BPM = *meta.BPM
	}
	if meta.DownbeatFrame != nil && *meta.DownbeatFrame >= 0 && *meta.DownbeatFrame < info.Frames() {
		req.Downbeat = *meta.DownbeatFrame
	}
	sent, err := a.tape.SendTake(r.URL.Query().Get("id"), req)
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sent)
}

// handleTapeListen serves the loaded tape's mix -- the loop, or the whole
// tape with all=1 -- as a WAV a phone plays while recording over it.
// click=1 adds the click. The headers say where it sits on the tape.
func (a *API) handleTapeListen(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	q := r.URL.Query()
	l, err := a.tape.Listen(q.Get("id"), q.Get("all") == "1", q.Get("click") == "1")
	if err != nil {
		tapeErr(w, err)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "audio/wav")
	h.Set("Content-Length", fmt.Sprint(l.Bytes()))
	h.Set("Cache-Control", "no-store")
	h.Set("X-Tape-From", fmt.Sprint(l.From))
	h.Set("X-Tape-Frames", fmt.Sprint(l.Frames))
	h.Set("X-Tape-Loop", fmt.Sprint(l.Loop))
	if r.Method == http.MethodHead {
		return
	}
	if _, err := l.WriteTo(&stallWriter{w: w, rc: http.NewResponseController(w)}); err != nil {
		log.Printf("[!] tape listen: %v", err)
	}
}

// handleTapeEdit is the tape's editing: lift and copy to the clipboard,
// split, join, slide and multiply. It answers what the edit did, and the
// tape after it.
func (a *API) handleTapeEdit(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var req tape.EditRequest
	if !decodeBody(w, r, &req) {
		return
	}
	if req.Track == 0 {
		req.Track = 1
	}
	id := r.URL.Query().Get("id")
	res, err := a.tape.EditOp(id, req)
	if err != nil {
		tapeErr(w, err)
		return
	}
	a.writeTapeStateWith(w, id, &res, false)
}

// handleTapeMixdown starts a mixdown and answers at once; the state's
// live.mixdown follows it to its take.
func (a *API) handleTapeMixdown(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var b struct {
		All bool `json:"all"` // the whole tape, not the loop
	}
	if r.ContentLength != 0 && !decodeBody(w, r, &b) {
		return
	}
	m, err := a.tape.StartMixdown(r.URL.Query().Get("id"), b.All)
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mixdown": m})
}

// handleTapeClip is one clip as a WAV file, to share.
func (a *API) handleTapeClip(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	q := r.URL.Query()
	c, err := a.tape.ShareClip(q.Get("id"), q.Get("clip"))
	if err != nil {
		tapeErr(w, err)
		return
	}
	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Content-Length", fmt.Sprint(c.Bytes()))
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": c.Name}))
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodHead {
		return
	}
	// A phone that stops reading lets go of the file after a while.
	if _, err := c.WriteTo(&stallWriter{w: w, rc: http.NewResponseController(w)}); err != nil {
		log.Printf("[!] tape clip: %v", err)
	}
}

// stallWriter moves the write deadline on with each write: a client may be
// slow, but not stopped for exportStall.
type stallWriter struct {
	w  http.ResponseWriter
	rc *http.ResponseController
}

func (s *stallWriter) Write(b []byte) (int, error) {
	_ = s.rc.SetWriteDeadline(time.Now().Add(exportStall))
	return s.w.Write(b)
}

// exportStall is how long an export waits on a client that stopped
// reading before giving up the one export slot.
const exportStall = 30 * time.Second

// handleTapeExport streams the loaded tape's stems and tempo map as a zip.
// HEAD answers whether a GET would start, without rendering: the page asks
// first, so a refusal is a toast, not a page of JSON.
func (a *API) handleTapeExport(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	id := r.URL.Query().Get("id")
	if r.Method == http.MethodHead {
		if err := a.tape.CheckExport(id); err != nil {
			tapeErr(w, err)
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	}
	x, err := a.tape.Export(id)
	if err != nil {
		tapeErr(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": x.Name}))
	w.Header().Set("Cache-Control", "no-store")
	// A client that stops reading -- a phone locked mid-download -- fails
	// the write once the deadline passes, and frees the slot.
	rc := http.NewResponseController(w)
	beat := func() { _ = rc.SetWriteDeadline(time.Now().Add(exportStall)) }
	if err := x.WriteZip(w, beat); err != nil {
		// Headers are gone: the client sees a truncated zip.
		log.Printf("[!] tape export: %v", err)
	}
}

func (a *API) handleTapeUndo(redo bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.tapeOff(w) {
			return
		}
		id := r.URL.Query().Get("id")
		if err := a.tape.Undo(id, redo); err != nil {
			tapeErr(w, err)
			return
		}
		a.writeTapeState(w, id)
	}
}

func (a *API) handleTapeClone(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var b struct {
		Name string `json:"name"`
	}
	if r.ContentLength != 0 && !decodeBody(w, r, &b) {
		return
	}
	t, err := a.tape.Store().Clone(r.URL.Query().Get("id"), sanitizeLabel(b.Name), time.Now())
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (a *API) handleTapeCleanup(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	n, mb, err := a.tape.Store().Cleanup(nil)
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"removed": n, "freed_mb": mb})
}

// handleTapePeaks serves a pool file's whole-file peaks, as /api/peaks does
// for takes, or with from, to and buckets the peaks of just that range.
// Pool files never change, so it's cached for good.
func (a *API) handleTapePeaks(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	p := a.tape.Store().AudioPath(r.URL.Query().Get("file"))
	if p == "" {
		writeErr(w, http.StatusBadRequest, "not a pool file")
		return
	}
	q := r.URL.Query()
	if q.Has("from") || q.Has("to") || q.Has("buckets") {
		writeRangePeaks(w, r, p, "pool file")
		return
	}
	b, err := os.ReadFile(strings.TrimSuffix(p, ".wav") + ".peaks.json")
	if err != nil {
		writeErr(w, http.StatusNotFound, "no peaks")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Write(b)
}

// handleTapeSlice streams a 16-bit WAV of [from, to) of a pool file, both
// channels: the audio round a point that the tape's clip editor reads for
// Attack. A pool file is immutable, so it caches like a take's slice.
func (a *API) handleTapeSlice(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	p := a.tape.Store().AudioPath(r.URL.Query().Get("file"))
	if p == "" {
		writeErr(w, http.StatusBadRequest, "not a pool file")
		return
	}
	writeSlice(w, r, p, func(audio.WAVInfo) []int { return nil }, "pool file")
}

// takePair is the pair of a take that goes onto tape, as previews and slices
// use: a stereo take is its own pair, a multichannel one gives
// SAVE_CHANNELS', and a mono one both sides.
func (a *API) takePair(channels int) []int {
	switch {
	case channels == 1:
		return []int{0, 0}
	case channels > 2 && len(a.cfg.SaveChannels) > 0:
		return []int{a.cfg.SaveChannels[0], a.cfg.SaveChannels[len(a.cfg.SaveChannels)-1]}
	}
	return []int{0, 1}
}

// --- the clipboard -----------------------------------------------------------

//	GET    /api/clipboard        what's on it
//	GET    /api/clipboard/audio  its tracks summed, as a WAV, to audition
//	POST   /api/clipboard        copy {take, from, to} or {ring_from, ring_to, source}
//	DELETE /api/clipboard        clear it

func (a *API) handleClipboard(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	c, err := a.tape.Clipboard()
	resp := map[string]any{"clipboard": nil}
	switch {
	case err != nil:
		// Only clearing it mends it; the page offers ×.
		resp["error"] = "the clipboard can't be read: " + err.Error()
	case !c.Empty():
		resp = map[string]any{"clipboard": c, "seconds": float64(c.Frames) / float64(a.tape.Store().SampleRate())}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, resp)
}

func (a *API) handleClipboardCopy(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	var b struct {
		Take     string `json:"take"`
		From     int64  `json:"from"`
		To       int64  `json:"to"`
		RingFrom *int64 `json:"ring_from"`
		RingTo   *int64 `json:"ring_to"`
		Source   string `json:"source"`
	}
	if !decodeBody(w, r, &b) {
		return
	}
	var c *tape.Clipboard
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
		c, err = a.tape.CopyTake(path, name, b.From, b.To, a.takePair(info.Channels))
	case b.RingFrom != nil:
		to := int64(-1) // up to now
		if b.RingTo != nil {
			to = *b.RingTo
		}
		c, clamped, err = a.tape.CopyRing(*b.RingFrom, to, b.Source)
	default:
		writeErr(w, http.StatusBadRequest, "copy a take's {take, from, to} or the ring's {ring_from, ring_to, source}")
		return
	}
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clipboard": c, "seconds": float64(c.Frames) / float64(a.tape.Store().SampleRate()), "clamped": clamped})
}

func (a *API) handleClipboardClear(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	if err := a.tape.ClearClipboard(); err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clipboard": nil})
}

// handleClipboardAudio serves the clipboard's first minute, its tracks
// summed, as a 16-bit WAV, with ranges and HEAD, as a phone's audio element
// wants.
func (a *API) handleClipboardAudio(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	pcm, err := a.tape.ClipboardAudio()
	if errors.Is(err, tape.ErrEmptyClipboard) {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		tapeErr(w, err)
		return
	}
	b := wav16Header(len(pcm)/2, 2, a.tape.Store().SampleRate())
	for _, v := range pcm {
		x := int32(math.Round(float64(v) * 32767))
		x = max(-32768, min(32767, x))
		b = append(b, byte(x), byte(x>>8))
	}
	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, "clipboard.wav", time.Time{}, bytes.NewReader(b))
}

// wav16Header is a 44-byte RIFF header for 16-bit PCM.
func wav16Header(frames, channels, sampleRate int) []byte {
	data := frames * channels * 2
	h := make([]byte, 44)
	copy(h[0:], "RIFF")
	binary.LittleEndian.PutUint32(h[4:], uint32(36+data))
	copy(h[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(h[16:], 16)
	binary.LittleEndian.PutUint16(h[20:], 1)
	binary.LittleEndian.PutUint16(h[22:], uint16(channels))
	binary.LittleEndian.PutUint32(h[24:], uint32(sampleRate))
	binary.LittleEndian.PutUint32(h[28:], uint32(sampleRate*channels*2))
	binary.LittleEndian.PutUint16(h[32:], uint16(channels*2))
	binary.LittleEndian.PutUint16(h[34:], 16)
	copy(h[36:], "data")
	binary.LittleEndian.PutUint32(h[40:], uint32(data))
	return h
}
