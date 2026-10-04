package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
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
//	POST   /api/tapes/catch?id=        {track, source, pass | bars, replace}
//	POST   /api/tapes/drop?id=         {take, from, to, track, bars}: a take's span onto the tape
//	POST   /api/tapes/undo?id=         and /redo
//	POST   /api/tapes/clone?id=        {name}: a new tape sharing this one's audio
//	POST   /api/tapes/cleanup          remove pool audio nothing uses
//	GET    /api/tapes/peaks?file=      a pool file's peaks

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
	case errors.Is(err, tape.ErrNoSuchTape):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, audio.ErrLowDisk):
		writeErr(w, http.StatusInsufficientStorage, err.Error())
	case errors.Is(err, tape.ErrNoTape), errors.Is(err, tape.ErrWrongTape), errors.Is(err, tape.ErrNotYet),
		errors.Is(err, tape.ErrGone), errors.Is(err, tape.ErrNoPass), errors.Is(err, tape.ErrNothingToDo),
		errors.Is(err, tape.ErrNoCapture), errors.Is(err, tape.ErrNotLined), errors.Is(err, tape.ErrNotPlayed):
		writeErr(w, http.StatusConflict, err.Error())
	case errors.Is(err, tape.ErrBadParameter), errors.Is(err, tape.ErrPastTheEnd), errors.Is(err, tape.ErrBadLoop),
		errors.Is(err, tape.ErrNoSuchTrack), errors.Is(err, tape.ErrNoSuchClip), errors.Is(err, tape.ErrNoGrid):
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
}

func (a *API) handleTapeState(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	id := r.URL.Query().Get("id")
	resp := tapeStateResponse{Sources: a.tape.Sources()}
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
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, resp)
}

func (a *API) handleTapePatch(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	id := r.URL.Query().Get("id")
	var b struct {
		Name  *string `json:"name"`
		Click *bool   `json:"click"`
		Bars  *int    `json:"bars"`
		Tempo *struct {
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
		} `json:"clip"`
	}
	if !decodeBody(w, r, &b) {
		return
	}
	if b.Name != nil || b.Click != nil {
		err := a.tape.SetMeta(id, func(t *tape.Tape) error {
			if b.Name != nil {
				if n := sanitizeLabel(*b.Name); n != "" {
					t.Name = n
				}
			}
			if b.Click != nil {
				t.Click = *b.Click
			}
			return nil
		})
		if err != nil {
			tapeErr(w, err)
			return
		}
	}
	edit := func(kind string, fn func(s *tape.State) error) bool {
		if err := a.tape.Edit(id, kind, func(_ *tape.Tape, s *tape.State) error { return fn(s) }); err != nil {
			tapeErr(w, err)
			return false
		}
		return true
	}
	if tm := b.Tempo; tm != nil {
		// Only while the tape is empty: once it has audio its tempo is fixed,
		// since nothing is ever stretched. Bars relabel it instead.
		if !edit("tempo", func(s *tape.State) error {
			for _, tr := range s.Tracks {
				if len(tr.Clips) > 0 {
					return fmt.Errorf("%w: the tempo is fixed once the tape has audio; change its bars instead", tape.ErrBadParameter)
				}
			}
			if tm.BPM < 20 || tm.BPM > 400 || tm.Bars < 1 || tm.Bars > 64 {
				return fmt.Errorf("%w: tempo 20–400 BPM, 1 to 64 bars", tape.ErrBadParameter)
			}
			g := tape.GridFor(tm.BPM, tm.Bars, a.tape.Store().SampleRate())
			s.Grid = &g
			s.Loop = tape.Loop{In: 0, Out: g.Frames, On: true}
			return nil
		}) {
			return
		}
	}
	if b.Bars != nil {
		if !edit("bars", func(s *tape.State) error {
			if s.Grid == nil {
				return tape.ErrNoGrid
			}
			if *b.Bars < 1 || *b.Bars > 64 {
				return fmt.Errorf("%w: 1 to 64 bars", tape.ErrBadParameter)
			}
			s.Grid.Bars = *b.Bars
			return nil
		}) {
			return
		}
	}
	if l := b.Loop; l != nil {
		if !edit("loop", func(s *tape.State) error {
			if l.In != nil {
				s.Loop.In = *l.In
			}
			if l.Out != nil {
				s.Loop.Out = *l.Out
			}
			if l.On != nil {
				s.Loop.On = *l.On
			}
			return nil
		}) {
			return
		}
	}
	if tr := b.Track; tr != nil {
		kind := fmt.Sprintf("track:%d", tr.N)
		if tr.GainDB != nil {
			kind = fmt.Sprintf("gain:%d", tr.N)
		} else if tr.Pan != nil {
			kind = fmt.Sprintf("pan:%d", tr.N)
		}
		if !edit(kind, func(s *tape.State) error {
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
			return nil
		}) {
			return
		}
	}
	if c := b.Clip; c != nil {
		kind := "clip:" + c.ID
		if !edit(kind, func(s *tape.State) error {
			for ti := range s.Tracks {
				for ci := range s.Tracks[ti].Clips {
					cl := &s.Tracks[ti].Clips[ci]
					if cl.ID != c.ID {
						continue
					}
					if c.Remove {
						s.Tracks[ti].Clips = append(s.Tracks[ti].Clips[:ci], s.Tracks[ti].Clips[ci+1:]...)
						return nil
					}
					if c.GainDB != nil {
						if *c.GainDB < -60 || *c.GainDB > 12 {
							return fmt.Errorf("%w: gain -60..12 dB", tape.ErrBadParameter)
						}
						cl.GainDB = *c.GainDB
					}
					if c.NudgeMS != nil {
						if *c.NudgeMS < -500 || *c.NudgeMS > 500 {
							return fmt.Errorf("%w: nudge ±500 ms", tape.ErrBadParameter)
						}
						cl.NudgeMS = *c.NudgeMS
					}
					return nil
				}
			}
			return tape.ErrNoSuchClip
		}) {
			return
		}
	}
	a.writeTapeState(w, id)
}

func (a *API) writeTapeState(w http.ResponseWriter, id string) {
	r, _ := http.NewRequest(http.MethodGet, "/?id="+id, nil)
	a.handleTapeState(w, r)
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
		writeErr(w, http.StatusConflict, "nothing plays the tape yet: playback through the interface is the next step")
		return
	}
	a.tape.Do(act)
	writeJSON(w, http.StatusOK, map[string]string{"status": "queued"})
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
	if _, err := os.Stat(path); err != nil {
		writeErr(w, http.StatusNotFound, "no such take")
		return
	}
	if b.Track == 0 {
		b.Track = 1
	}
	// The take's configured pair, as previews and slices use: a stereo take
	// is its own pair, a multichannel one gives SAVE_CHANNELS'.
	pick := []int{0, 1}
	if info, err := audio.ReadWAVInfo(path); err == nil && info.Channels > 2 && len(a.cfg.SaveChannels) > 0 {
		pick = []int{a.cfg.SaveChannels[0], a.cfg.SaveChannels[len(a.cfg.SaveChannels)-1]}
	}
	clip, err := a.tape.DropTake(r.URL.Query().Get("id"), path, b.From, b.To, b.Track, b.Bars, pick)
	if err != nil {
		tapeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clip": clip})
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
// for takes. Pool files never change, so it's cached for good.
func (a *API) handleTapePeaks(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	p := a.tape.Store().AudioPath(r.URL.Query().Get("file"))
	if p == "" {
		writeErr(w, http.StatusBadRequest, "not a pool file")
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
