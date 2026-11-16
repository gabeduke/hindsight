package tape

import (
	"errors"
	"fmt"
	"math"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// Lift and Copy onto the cue lane (docs/architecture/tape.md, *The cue
// lane*): a range's tracks over its span, or the parts picked, come off the
// tape as one cue clip, a lane per track, and Lift leaves silence where they
// were, in the same edit, so the tape's one Undo puts the audio back and
// takes the clip off the lane. Each lane is written to a pool file of its
// own -- the track's parts over the span, each at its own level and with its
// fades -- with up to a bar of handle either side, taken from the files the
// parts at its edges play, wherever those run on. So the clip is a grab
// like any other: its drawer trims it into its handles, reverses it, drops
// it, inserts it and keeps it, and nothing here changes when the tape does.

// ErrTapeChanged refuses a lift worked out on parts that changed meanwhile.
var ErrTapeChanged = errors.New("the tape changed meanwhile; try again")

// liftSel is what a lift or copy takes: the tracks, in order, and the parts
// on each, placed from the span's start.
type liftSel struct {
	from, to int64
	tracks   []int
	parts    [][]Clip
	n        int
}

// liftOf reads the selection from s: req.Clips, each whole, a lane for every
// track from the highest of them to the lowest; or a range, its tracks over
// its span (spanOf, tracksOf).
func liftOf(t *Tape, s *State, req EditRequest) (liftSel, error) {
	var sel liftSel
	if len(req.Clips) > 0 {
		ps, err := s.pick(req.Clips, false)
		if err != nil {
			return sel, err
		}
		sel.from, sel.to = span(ps)
		top, bottom := ps[0].track, ps[0].track
		for _, p := range ps {
			top, bottom = min(top, p.track), max(bottom, p.track)
		}
		for n := top; n <= bottom; n++ {
			lane := []Clip{}
			for _, p := range ps {
				if p.track == n {
					cl := p.c
					cl.ID, cl.At = "", cl.At-sel.from
					lane = append(lane, cl)
				}
			}
			sel.tracks = append(sel.tracks, n)
			sel.parts = append(sel.parts, lane)
		}
		sel.n = len(ps)
		return sel, nil
	}
	if req.Span == nil {
		return sel, fmt.Errorf("%w: lift and copy take a span and its tracks, or clips", ErrBadParameter)
	}
	tracks, err := req.tracksOf(t)
	if err != nil {
		return sel, err
	}
	if sel.from, sel.to, err = req.spanOf(s, t.Length); err != nil {
		return sel, err
	}
	sel.tracks = tracks
	for _, tn := range tracks {
		w := window(s.Tracks[tn-1].Clips, sel.from, sel.to)
		sel.n += len(w)
		sel.parts = append(sel.parts, w)
	}
	return sel, nil
}

// CueLifted is a lift or copy onto the cue lane: the clip it made, and how
// many parts it took. Undo is the tape's.
type CueLifted struct {
	Op    string  `json:"op"`
	Clip  CueClip `json:"cue_clip"`
	Clips int     `json:"clips"`
}

// CueLift is a range's or the picked parts' Lift (cut) or Copy onto the
// loaded tape's cue lane, as the top of this file says. The clip is always
// added, never in another's place: what comes off the tape is never lost by
// the next press. A range over nothing but silence is refused, as there is
// nothing to hold.
func (e *Engine) CueLift(id string, req EditRequest, cut bool) (CueLifted, error) {
	op := "copy"
	if cut {
		op = "lift"
	}
	t := e.Loaded()
	if t == nil {
		return CueLifted{}, ErrNoTape
	}
	if t.ID != id {
		return CueLifted{}, ErrWrongTape
	}
	st := t.State.clone()
	sel, err := liftOf(t, &st, req)
	if err != nil {
		return CueLifted{}, err
	}
	if sel.n == 0 {
		return CueLifted{}, fmt.Errorf("%w: there's nothing there to %s", ErrBadParameter, op)
	}
	if err := e.tooLong(sel.to - sel.from); err != nil {
		return CueLifted{}, err
	}
	if err := e.diskOK(); err != nil {
		return CueLifted{}, err
	}
	c, made, err := e.liftClip(t, &st, sel, op)
	if err != nil {
		return CueLifted{}, err
	}
	err = e.Edit(id, "", func(tp *Tape, s *State) error {
		now, err := liftOf(tp, s, req)
		if err != nil {
			return err
		}
		if !reflect.DeepEqual(now, sel) || !reflect.DeepEqual(s.Grid, st.Grid) {
			return ErrTapeChanged
		}
		if cut {
			if len(req.Clips) > 0 {
				if _, err := s.pick(req.Clips, true); err != nil {
					return err
				}
			} else {
				for _, tn := range sel.tracks {
					s.Tracks[tn-1].Clips = clearRange(s.Tracks[tn-1].Clips, sel.from, sel.to)
				}
			}
		}
		c, err = s.cueAdd(c)
		return err
	})
	if err != nil {
		for _, rel := range made {
			e.store.removePoolFile(rel)
		}
		return CueLifted{}, err
	}
	return CueLifted{Op: op, Clip: c, Clips: sel.n}, nil
}

// liftClip writes sel's lanes, handles and all, and makes the cue clip that
// plays them. It answers the pool files it made, for the caller to remove if
// the edit fails.
func (e *Engine) liftClip(t *Tape, s *State, sel liftSel, op string) (CueClip, []string, error) {
	sr := e.store.SampleRate()
	frames := sel.to - sel.from
	g := Grab{Frames: frames, In: 0, Out: frames, Tape: t.ID}
	if s.Grid != nil {
		g.BarFrames = s.Grid.BarFrames()
		db := firstLine(0, g.BarFrames, sel.from) - sel.from
		g.Downbeat = &db
	}
	for _, tn := range sel.tracks {
		g.Sources = append(g.Sources, trackName(s, tn))
	}
	h := e.grabHandle(int64(sr), g.BarFrames)

	// How far every lane's file runs on either side: as far as the parts at
	// the span's edges have audio in their files, up to h. Which parts are
	// at an edge is where they lie on the tape; how far their files reach,
	// where they are heard (their nudge).
	lanes := make([][]liftPart, len(sel.parts))
	for i, parts := range sel.parts {
		lanes[i] = make([]liftPart, len(parts))
		for j, p := range parts {
			lp := liftPart{start: p.At <= 0, end: p.End() >= frames}
			p.At += nudgeFrames(p, sr)
			p.NudgeMS = 0
			lp.Clip = p
			lanes[i][j] = lp
			if lp.start { // lane frame 0 is its file's frame Src-At
				g.Before = max64(g.Before, min64(h, p.Src-p.At))
			}
			if lp.end {
				n, err := e.fileFrames(p.File)
				if err != nil {
					return CueClip{}, nil, err
				}
				g.After = max64(g.After, min64(h, n-(p.Src+frames-p.At)))
			}
		}
	}
	g.Before, g.After = max64(0, g.Before), max64(0, g.After)
	fadeIn, fadeOut := edgeFades(lanes)
	cue := CueClip{ID: NewClipID(), Loop: true, Source: op, Name: liftName(s.Grid, sr, sel), Grab: &g}
	if s.Grid != nil {
		cue.BPM = s.Grid.BPM(sr)
	}

	// Each lane, its edge parts reaching on into their files, written from
	// the handle before to the handle after.
	board := &Clipboard{Frames: frames, BPM: cue.BPM, Grab: &g}
	var made []string
	over := int64(OverhangSeconds * float64(sr))
	for _, lane := range lanes {
		var parts []Clip
		for _, lp := range lane {
			p := lp.Clip
			// An edge part reaches on into its file, unless a fade of its
			// own stays on it there: from silence, it has no handle.
			if lp.start && (fadeIn != nil || p.FadeIn <= 0) {
				k := max64(0, min64(g.Before+p.At, p.Src))
				p.Src, p.At, p.Frames = p.Src-k, p.At-k, p.Frames+k
				p.FadeIn = 0 // none, or the clip's own now
			}
			if lp.end && (fadeOut != nil || p.FadeOut <= 0) {
				n, err := e.fileFrames(p.File)
				if err != nil {
					return CueClip{}, nil, removeAll(e, made, err)
				}
				p.Frames += max64(0, min64(frames+g.After-p.End(), n-(p.Src+p.Frames)))
				p.FadeOut = 0
			}
			p.At += g.Before
			parts = append(parts, p)
		}
		rel, path, err := e.store.NewPoolFile(op, time.Now())
		if err != nil {
			return CueClip{}, nil, removeAll(e, made, err)
		}
		made = append(made, rel)
		write := &Clipboard{Tracks: [][]Clip{parts}, Frames: g.fileFrames()}
		peak, err := audio.WriteWAVMeasured(path, write.Frames, 2, sr, max64(0, g.Before-over), min64(write.Frames, g.Before+frames+over),
			func(w func([]int32) error) error { return e.writeLane(write, w) })
		if err != nil {
			return CueClip{}, nil, removeAll(e, made, err)
		}
		cl := Clip{File: rel, Source: op, PeakDB: peakDB(peak)}
		g.window(&cl)
		board.Tracks = append(board.Tracks, []Clip{cl})
	}
	cue.take(board) // its lanes carry no fades: the clip's are set after
	if fadeIn != nil {
		cue.FadeIn, cue.FadeInShape = min64(fadeIn.FadeIn, cue.Frames), fadeIn.FadeInShape
	}
	if fadeOut != nil {
		cue.FadeOut, cue.FadeOutShape = min64(fadeOut.FadeOut, cue.Frames), fadeOut.FadeOutShape
	}
	return cue, made, nil
}

// removeAll removes the pool files made, and answers err.
func removeAll(e *Engine, made []string, err error) error {
	for _, rel := range made {
		e.store.removePoolFile(rel)
	}
	return err
}

// liftPart is a part lifted, and whether it lies at the span's start or end.
type liftPart struct {
	Clip
	start, end bool
}

// edgeFades are the fades a lifted clip keeps as its own: at either edge,
// the fade every part starting (or ending) there has, when they all have the
// same one; nil when there is none, or they differ. A part's fade at an edge
// otherwise stays on the part, inside the lane's file.
func edgeFades(lanes [][]liftPart) (in, out *Clip) {
	var ins, outs []Clip
	for _, lane := range lanes {
		for _, p := range lane {
			if p.start {
				ins = append(ins, p.Clip)
			}
			if p.end {
				outs = append(outs, p.Clip)
			}
		}
	}
	same := func(ps []Clip, f func(Clip) (int64, string)) *Clip {
		if len(ps) == 0 {
			return nil
		}
		n0, s0 := f(ps[0])
		if n0 <= 0 {
			return nil
		}
		for _, p := range ps[1:] {
			if n, s := f(p); n != n0 || s != s0 {
				return nil
			}
		}
		return &ps[0]
	}
	in = same(ins, func(c Clip) (int64, string) { return c.FadeIn, c.FadeInShape })
	out = same(outs, func(c Clip) (int64, string) { return c.FadeOut, c.FadeOutShape })
	return in, out
}

// writeLane writes a lane's parts summed to stereo, each at its own level
// and with its fades (mixBoard), as 32-bit frames, held under full scale.
func (e *Engine) writeLane(c *Clipboard, write func([]int32) error) error {
	out := make([]int32, 2*(1<<15))
	return e.mixBoard(c, func(buf []float64, _, n int64) error {
		for i := int64(0); i < 2*n; i++ {
			v := math.Round(buf[i] * 2147483647)
			out[i] = int32(math.Max(-2147483648, math.Min(2147483647, v)))
		}
		return write(out[:2*n])
	})
}

// fileFrames is how long a pool file is.
func (e *Engine) fileFrames(rel string) (int64, error) {
	info, err := audio.ReadWAVInfo(e.store.AudioPath(rel))
	if err != nil {
		return 0, err
	}
	return info.Frames(), nil
}

// trackName is what a lane lifted from track n is called: the track's name,
// or "Track n".
func trackName(s *State, n int) string {
	if name := strings.TrimSpace(s.Tracks[n-1].Name); name != "" {
		return name
	}
	return "Track " + strconv.Itoa(n)
}

// liftName names a lifted clip by where it came from: "Bars 5–8", and the
// tracks when it spans more than one, "Bars 5–8 · 2–3".
func liftName(g *Grid, sr int, sel liftSel) string {
	name := barsText(g, sr, sel.from, sel.to)
	name = strings.ToUpper(name[:1]) + name[1:]
	if len(sel.tracks) < 2 {
		return name
	}
	first, last := sel.tracks[0], sel.tracks[len(sel.tracks)-1]
	if last-first == len(sel.tracks)-1 {
		return fmt.Sprintf("%s · %d–%d", name, first, last)
	}
	ns := make([]string, len(sel.tracks))
	for i, n := range sel.tracks {
		ns[i] = strconv.Itoa(n)
	}
	return name + " · " + strings.Join(ns, ", ")
}
