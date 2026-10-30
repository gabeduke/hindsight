package api

// The verbs -- KEEP, GRAB, DROP, CATCH and the transport -- as every surface
// runs them. The tablet's routes (POST /api/trigger, /api/tapes/transport,
// /api/tapes/catch, /api/tapes/cue/{grab,drop,keep}) and a controller's
// commands (piVerbs, controls.go) both call Verbs, so a press refuses for the
// same reasons, with the same errors, wherever it came from: the routes
// answer them as statuses (verbErr), the keyboard's banner names them
// (banner.go, refusals).
//
// A surface says what it wants in full -- the tablet which clip, which
// track, where -- or presses the verb bare, as a pad does, and Verbs works
// out the rest the way the Studio's own keys do (the *Armed verbs).

import (
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/tape"
)

// Verbs are the Pi's verbs; a.Verbs() hands them out.
type Verbs struct{ a *API }

// Verbs are this Pi's verbs, for any surface.
func (a *API) Verbs() Verbs { return Verbs{a} }

// badVerb is a request a verb can't make sense of: a 400, in its own words.
type badVerb string

func (e badVerb) Error() string { return string(e) }
func (e badVerb) Unwrap() error { return tape.ErrBadParameter }

// The refusals only a pressed verb has: a page asks for what it shows, and a
// pad takes what's there.
var (
	errTooManyLanes   = errors.New("more lanes than the tape has tracks")
	errLongerThanTape = errors.New("longer than the tape: trim it shorter with IN and OUT")
)

// --- KEEP ----------------------------------------------------------------------

// Keep saves the last seconds of the ring as a take (0: all of it).
func (v Verbs) Keep(seconds float64) (string, error) {
	if v.a.saver == nil {
		return "", errNothingToKeep
	}
	return v.a.saver.Save(seconds)
}

// KeepRange saves a span of the ring, absolute ring frames (to 0: now).
func (v Verbs) KeepRange(from, to uint64) (audio.SavedRange, error) {
	if v.a.saver == nil {
		return audio.SavedRange{}, errNothingToKeep
	}
	return v.a.saver.SaveRange(from, to)
}

// KeepClip is a cue clip's KEEP: a take on the shelf, from its own audio,
// its preview made after, and MAX_SAVES applied, never to it.
func (v Verbs) KeepClip(id, clip string) (tape.KeptTake, error) {
	a := v.a
	if a.tape == nil {
		return tape.KeptTake{}, errTapeOff
	}
	if free := audio.EnsureFree(a.cfg.OutputDir, a.cfg.MinFreeGB); free < a.cfg.MinFreeGB {
		return tape.KeptTake{}, fmt.Errorf("%w: %.2f GB free, need %.2f GB", audio.ErrLowDisk, free, a.cfg.MinFreeGB)
	}
	k, err := a.tape.CueKeep(id, clip, a.cfg.OutputDir, time.Now())
	if err != nil {
		return tape.KeptTake{}, err
	}
	a.background(func() { audio.MakePreview(a.cfg, filepath.Join(a.cfg.OutputDir, k.Name), 2) })
	if a.saver != nil {
		a.background(func() { a.saver.Prune(k.Name) })
	}
	return k, nil
}

// --- the transport ---------------------------------------------------------------

// Transport plays, stops or locates the loaded tape: ▶ with a track armed
// counts in and records, ■ during a punch keeps it, which it answers.
func (v Verbs) Transport(id string, act tape.Action) (*tape.Kept, error) {
	a := v.a
	if a.tape == nil {
		return nil, errTapeOff
	}
	if id != a.tape.LoadedID() {
		return nil, tape.ErrWrongTape
	}
	switch act.Kind {
	case "play", "stop", "locate":
	default:
		return nil, badVerb("action is play, stop or locate")
	}
	switch act.Quantum {
	case "", tape.QuantumNow, tape.QuantumBeat, tape.QuantumBar, tape.QuantumLoop:
	default:
		return nil, badVerb("quantum is now, beat, bar or loop")
	}
	if act.Kind == "play" && !a.tape.HasOutput() {
		return nil, errNoAudioOut
	}
	return a.tape.Transport(id, act)
}

// --- CATCH ---------------------------------------------------------------------

// Catch puts a span the tape just played onto the tracks req names, each
// from its own input. A request with no track has nowhere to put it.
func (v Verbs) Catch(id string, req tape.CatchRequest) (tape.CatchResult, error) {
	if v.a.tape == nil {
		return tape.CatchResult{}, errTapeOff
	}
	if req.Track == 0 && len(req.Pairs) == 0 {
		return tape.CatchResult{}, errNotArmed
	}
	return v.a.tape.CatchPairs(id, req)
}

// CatchArmed is CATCH pressed bare: the last pass onto every armed track,
// each from its own input, as the Studio's Catch.
func (v Verbs) CatchArmed(replace bool) (tape.CatchResult, *tape.Tape, error) {
	t, err := v.loaded()
	if err != nil {
		return tape.CatchResult{}, nil, err
	}
	res, err := v.Catch(t.ID, tape.CatchRequest{Pairs: v.armedPairs(t), Pass: 1, Replace: replace})
	return res, t, err
}

// --- GRAB ----------------------------------------------------------------------

// Grab puts the span req asks for, off the ring, on the cue lane of the
// tape id; with again, that clip's span once more.
func (v Verbs) Grab(id string, req tape.GrabRequest, again string) (tape.CueGrabbed, error) {
	if v.a.tape == nil {
		return tape.CueGrabbed{}, errTapeOff
	}
	return v.a.tape.GrabToCue(id, req, again)
}

// GrabArmed is GRAB pressed bare: the last n bars -- 2n seconds with no
// tempo -- from the first armed track's input, onto the cue lane. It
// answers whether it took bars.
func (v Verbs) GrabArmed(n int) (src string, inBars bool, err error) {
	t, err := v.loaded()
	if err != nil {
		return "", false, err
	}
	_, src, _ = v.a.armedOf(t)
	req := tape.GrabRequest{Sources: []string{src}}
	if inBars = t.Grid != nil && t.Grid.Bars > 0; inBars {
		req.Bars = n
	} else {
		req.Seconds = float64(2 * n)
	}
	_, err = v.Grab(t.ID, req, "")
	return src, inBars, err
}

// --- DROP ----------------------------------------------------------------------

// Drop lays a cue clip on the tape from track on (0: track 1), a lane a
// track, at the playhead or at *at, over what is there.
func (v Verbs) Drop(id, clip string, track int, merge bool, at *int64) (tape.Dropped, error) {
	if v.a.tape == nil {
		return tape.Dropped{}, errTapeOff
	}
	if track == 0 {
		track = 1
	}
	return v.a.tape.CueDrop(id, clip, track, merge, at)
}

// DropArmed is DROP pressed bare: the cue lane's newest clip -- the last
// GRAB, from anywhere -- on the first armed track, at the next bar line
// inside the loop (tape.DropPlace), over what is there. A clip of more lanes
// than fit from that track starts where they all do. It answers the clip
// and the track it landed on.
func (v Verbs) DropArmed() (tape.CueClip, int, error) {
	t, err := v.loaded()
	if err != nil {
		return tape.CueClip{}, 0, err
	}
	armed := t.Armed()
	if len(armed) == 0 {
		return tape.CueClip{}, 0, errNotArmed
	}
	if t.State.Cue == nil || len(t.State.Cue.Clips) == 0 {
		return tape.CueClip{}, 0, errNothingToDrop
	}
	c := t.State.Cue.Clips[len(t.State.Cue.Clips)-1]
	lanes := max(1, len(c.Lanes))
	if lanes > len(t.Tracks) {
		return tape.CueClip{}, 0, errTooManyLanes
	}
	if c.Frames > t.Length {
		return tape.CueClip{}, 0, errLongerThanTape
	}
	track := min(armed[0], len(t.Tracks)-lanes+1)
	at, _, _ := tape.DropPlace(t.State, t.Length, c.Frames, v.a.tape.Live().Heard)
	if _, err := v.Drop(t.ID, c.ID, track, false, &at); err != nil {
		return tape.CueClip{}, 0, err
	}
	return c, track, nil
}

// --- what a bare press works from ------------------------------------------------

// loaded is the loaded tape, or why there's none.
func (v Verbs) loaded() (*tape.Tape, error) {
	if v.a.tape == nil {
		return nil, errTapeOff
	}
	t := v.a.tape.Loaded()
	if t == nil {
		return nil, tape.ErrNoTape
	}
	return t, nil
}

// armedPairs are the armed tracks, each with its input -- or the first
// source, for one with none of its own -- in order.
func (v Verbs) armedPairs(t *tape.Tape) []tape.Pair {
	pairs := []tape.Pair{}
	for _, n := range t.Armed() {
		pairs = append(pairs, tape.Pair{Track: n, Source: v.a.inputOf(t, n)})
	}
	return pairs
}

// --- the verbs' refusals as statuses ---------------------------------------------

// verbErr answers a refused verb: a 409 for what the moment won't allow (the
// banner's refusals), the tape's statuses for the rest.
func verbErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errTapeOff):
		writeErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, errNotArmed), errors.Is(err, errNothingToKeep), errors.Is(err, errNoAudioOut),
		errors.Is(err, errNothingToDrop), errors.Is(err, errTooManyLanes), errors.Is(err, errLongerThanTape),
		errors.Is(err, audio.ErrNoAudio), errors.Is(err, audio.ErrRangeGone):
		writeErr(w, http.StatusConflict, err.Error())
	default:
		tapeErr(w, err)
	}
}
