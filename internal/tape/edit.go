package tape

import (
	"fmt"
	"time"
)

// The OP-1's editing (tape phase 2): lift, copy, split, join, slide and
// multiply (merge drop is a drop: DropClipboard). Nothing is cut out of a file: a clip is a window onto
// an immutable WAV, so every edit only changes tape.json, and each is one
// undo step. Where an edit leaves audio meeting audio the renderer
// crossfades it; next to silence, it declicks.

// EditRequest is one edit. The selection is the loop's In and Out.
type EditRequest struct {
	Op    string `json:"op"`    // lift, copy, split, join, slide, multiply
	Track int    `json:"track"` // the selected track
	All   bool   `json:"all"`   // lift and copy: all four tracks, kept apart
	Clip  string `json:"clip"`  // join, slide: the clip
	Pos   *int64 `json:"pos"`   // split: where (default: the playhead)
	At    *int64 `json:"at"`    // slide: where its start goes
}

// EditResult says what an edit did, for the page's toast.
type EditResult struct {
	Op     string     `json:"op"`
	Clips  int        `json:"clips"`            // clips lifted, copied, made or moved
	Frames int64      `json:"frames,omitempty"` // how long, for lift, copy, multiply
	Board  *Clipboard `json:"clipboard,omitempty"`
}

// Edit carries out an edit on the loaded tape.
func (e *Engine) EditOp(id string, req EditRequest) (EditResult, error) {
	t := e.Loaded()
	if t == nil {
		return EditResult{}, ErrNoTape
	}
	if t.ID != id {
		return EditResult{}, ErrWrongTape
	}
	switch req.Op {
	case "lift", "copy":
		return e.liftCopy(t, req)
	case "split":
		pos := e.playhead()
		if req.Pos != nil {
			pos = *req.Pos
		}
		var made int
		err := e.Edit(id, "", func(_ *Tape, s *State) error {
			var err error
			made, err = s.split(req.Track, pos)
			return err
		})
		return EditResult{Op: "split", Clips: made}, err
	case "join":
		err := e.Edit(id, "", func(_ *Tape, s *State) error { return s.join(req.Clip) })
		return EditResult{Op: "join", Clips: 1}, err
	case "slide":
		if req.At == nil {
			return EditResult{}, fmt.Errorf("%w: slide needs at", ErrBadParameter)
		}
		err := e.Edit(id, "", func(_ *Tape, s *State) error { return s.slide(req.Clip, *req.At) })
		return EditResult{Op: "slide", Clips: 1}, err
	case "multiply":
		var n int
		var frames int64
		err := e.Edit(id, "", func(tp *Tape, s *State) error {
			var err error
			n, frames, err = s.multiply(tp.Length)
			return err
		})
		return EditResult{Op: "multiply", Clips: n, Frames: frames}, err
	}
	return EditResult{}, fmt.Errorf("%w: no edit %q", ErrBadParameter, req.Op)
}

// playhead is where edits act: what's heard while playing, else where the
// tape stands.
func (e *Engine) playhead() int64 {
	st := e.tr.Status()
	if st.Playing {
		return e.Live().Heard
	}
	return st.Pos
}

// window returns the parts of clips inside [from, to), every layer, moved
// to start from 0 -- what lift and copy take.
func window(clips []Clip, from, to int64) []Clip {
	out := []Clip{} // [] in JSON, not null, for a track with nothing there
	for _, c := range clips {
		lo, hi := max64(c.At, from), min64(c.End(), to)
		if hi <= lo {
			continue
		}
		part := c
		part.ID = ""
		part.Src = c.Src + (lo - c.At)
		part.Frames = hi - lo
		part.At = lo - from
		out = append(out, part)
	}
	return out
}

// liftCopy puts the selection -- the loop's In to Out, on the selected track
// or all of them -- on the clipboard; lift also leaves silence there.
func (e *Engine) liftCopy(t *Tape, req EditRequest) (EditResult, error) {
	tracks := []int{req.Track}
	if req.All {
		tracks = tracks[:0]
		for i := range t.Tracks {
			tracks = append(tracks, i+1)
		}
	} else if _, err := t.Track(req.Track); err != nil {
		return EditResult{}, err
	}
	// take reads the selection from a state -- for a lift, the one being
	// edited, so what's lifted is exactly what's taken out.
	var c *Clipboard
	n := 0
	take := func(tp *Tape, s *State) error {
		l := s.Loop
		if l.Out <= l.In {
			return fmt.Errorf("%w: select some bars first: hold and drag on the ruler", ErrBadParameter)
		}
		c = &Clipboard{Frames: l.Len(), Created: time.Now(), From: tp.Name + ", " + barsText(s.Grid, tp.SampleRate, l.In, l.Out)}
		for _, tn := range tracks {
			w := window(s.Tracks[tn-1].Clips, l.In, l.Out)
			n += len(w)
			c.Tracks = append(c.Tracks, w)
		}
		if n == 0 {
			return fmt.Errorf("%w: there's nothing there to %s", ErrBadParameter, req.Op)
		}
		return nil
	}
	if req.Op == "copy" {
		if err := take(t, &t.State); err != nil {
			return EditResult{}, err
		}
		if err := e.store.SaveClipboard(c); err != nil {
			return EditResult{}, err
		}
		return EditResult{Op: req.Op, Clips: n, Frames: c.Frames, Board: c}, nil
	}
	err := e.Edit(t.ID, "", func(tp *Tape, s *State) error {
		if err := take(tp, s); err != nil {
			return err
		}
		for _, tn := range tracks {
			s.Tracks[tn-1].Clips = clearRange(s.Tracks[tn-1].Clips, s.Loop.In, s.Loop.Out)
		}
		return nil
	})
	if err != nil {
		return EditResult{}, err
	}
	// The tape first, so a lift that can't be made takes nothing; if the
	// clipboard then can't be written, the lift is undone rather than lose
	// what it took.
	if err := e.store.SaveClipboard(c); err != nil {
		if uerr := e.Undo(t.ID, false); uerr != nil {
			return EditResult{}, fmt.Errorf("%w (and undo it to get the audio back: %v)", err, uerr)
		}
		return EditResult{}, err
	}
	return EditResult{Op: req.Op, Clips: n, Frames: c.Frames, Board: c}, nil
}

// barsText reads a span of a tape as bars: "bars 5–8".
func barsText(g *Grid, sampleRate int, from, to int64) string {
	if g == nil {
		return fmt.Sprintf("%.1f s", float64(to-from)/float64(sampleRate))
	}
	a, b := g.BarAt(from)+1, g.BarAt(to-1)+1
	if a == b {
		return fmt.Sprintf("bar %d", a)
	}
	return fmt.Sprintf("bars %d–%d", a, b)
}

// split cuts the clips on a track that run across pos in two there, on
// every layer. It answers how many it split.
func (s *State) split(track int, pos int64) (int, error) {
	if track < 1 || track > len(s.Tracks) {
		return 0, ErrNoSuchTrack
	}
	tr := &s.Tracks[track-1]
	var out []Clip
	n := 0
	for _, c := range tr.Clips {
		if c.At < pos && pos < c.End() {
			head, tail := c, c
			head.Frames = pos - c.At
			tail.ID = NewClipID()
			tail.At, tail.Src, tail.Frames = pos, c.Src+(pos-c.At), c.End()-pos
			out = append(out, head, tail)
			n++
			continue
		}
		out = append(out, c)
	}
	if n == 0 {
		return 0, fmt.Errorf("%w: no clip on track %d runs across the playhead", ErrBadParameter, track)
	}
	tr.Clips = out
	return n, nil
}

// join merges a clip with the next one on its layer, if that one carries
// straight on from it in the same recording -- what a split made.
func (s *State) join(id string) error {
	for ti := range s.Tracks {
		tr := &s.Tracks[ti]
		for i, c := range tr.Clips {
			if c.ID != id {
				continue
			}
			for j, n := range tr.Clips {
				if n.Layer != c.Layer || n.At != c.End() {
					continue
				}
				if n.File != c.File || n.Src != c.Src+c.Frames {
					return fmt.Errorf("%w: the next clip is a different recording; only a split can be joined", ErrBadParameter)
				}
				if n.GainDB != c.GainDB || n.NudgeMS != c.NudgeMS {
					return fmt.Errorf("%w: the two halves have a different level or nudge; set them the same first", ErrBadParameter)
				}
				tr.Clips[i].Frames += n.Frames
				tr.Clips = append(tr.Clips[:j], tr.Clips[j+1:]...)
				return nil
			}
			return fmt.Errorf("%w: nothing follows this clip to join", ErrBadParameter)
		}
	}
	return ErrNoSuchClip
}

// slide moves a clip along its track to start at at, on the lowest layer
// free there.
func (s *State) slide(id string, at int64) error {
	if at < 0 {
		return fmt.Errorf("%w: before the tape's start", ErrBadParameter)
	}
	for ti := range s.Tracks {
		tr := &s.Tracks[ti]
		for i, c := range tr.Clips {
			if c.ID != id {
				continue
			}
			tr.Clips = append(tr.Clips[:i], tr.Clips[i+1:]...)
			c.At = at
			_, err := s.Place(ti+1, c, false)
			return err
		}
	}
	return ErrNoSuchClip
}

// multiply doubles the loop, copying everything inside it into the new
// half. It answers the clips copied and the loop's new length.
func (s *State) multiply(length int64) (int, int64, error) {
	l := s.Loop
	n := l.Len()
	if l.Out <= l.In {
		return 0, 0, fmt.Errorf("%w: there's no loop to double", ErrBadParameter)
	}
	if l.Out+n > length {
		return 0, 0, fmt.Errorf("%w: doubled, the loop would run past the end of the tape", ErrPastTheEnd)
	}
	copied := 0
	for ti := range s.Tracks {
		tr := &s.Tracks[ti]
		w := window(tr.Clips, l.In, l.Out)
		tr.Clips = clearRange(tr.Clips, l.Out, l.Out+n)
		for _, c := range w {
			c.ID = NewClipID()
			c.At += l.Out
			tr.Clips = append(tr.Clips, c)
			copied++
		}
	}
	s.Loop.Out += n
	return copied, s.Loop.Len(), nil
}
