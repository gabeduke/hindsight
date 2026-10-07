package tape

import (
	"fmt"
	"math"
	"os"
	"strings"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// The OP-1's editing (tape phase 2): lift, copy, split, join, slide and
// multiply (merge drop is a drop: DropClipboard), and a DAW's edge trim. Nothing is cut out of a file: a clip is a window onto
// an immutable WAV, so every edit only changes tape.json, and each is one
// undo step. Where an edit leaves audio meeting audio the renderer
// crossfades it; next to silence, it declicks.

// EditRequest is one edit. The selection is the loop's In and Out.
type EditRequest struct {
	Op    string `json:"op"`    // lift, copy, split, join, slide, multiply, reverse, trim
	Track int    `json:"track"` // the selected track
	All   bool   `json:"all"`   // lift and copy: all four tracks, kept apart
	Clip  string `json:"clip"`  // join, slide, reverse, trim: the clip
	Pos   *int64 `json:"pos"`   // split: where (default: the playhead)
	At    *int64 `json:"at"`    // slide: where its start goes; trim: where the edge goes
	Edge  string `json:"edge"`  // trim: "in" (its start) or "out" (its end)
	// To is the track a slide moves the clip onto (0: its own). Not Track,
	// which every edit sends as the selected track.
	To int `json:"to"`
}

// EditResult says what an edit did, for the page's toast.
type EditResult struct {
	Op     string     `json:"op"`
	Clips  int        `json:"clips"`            // clips lifted, copied, made or moved
	Frames int64      `json:"frames,omitempty"` // how long, for lift, copy, multiply
	Board  *Clipboard `json:"clipboard,omitempty"`
	Clip   *Clip      `json:"clip,omitempty"` // trim: the clip as it is now
}

// EditOp carries out an edit on the loaded tape.
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
		var pos int64
		if req.Pos != nil {
			pos = *req.Pos
		} else {
			pos = e.playhead()
		}
		var made int
		err := e.Edit(id, "", func(tp *Tape, s *State) error {
			var err error
			made, err = s.split(req.Track, pos, tp.SampleRate)
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
		err := e.Edit(id, "", func(tp *Tape, s *State) error { return s.slide(req.Clip, *req.At, req.To, tp.Length) })
		return EditResult{Op: "slide", Clips: 1}, err
	case "reverse":
		return e.reverseClip(t, req.Clip)
	case "trim":
		return e.trimClip(t, req)
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
	// The clipboard is written inside the edit, before the tape is saved: if
	// it can't be, nothing is lifted; if the tape then can't be saved, the
	// clipboard holds a copy, which loses nothing.
	err := e.Edit(t.ID, "", func(tp *Tape, s *State) error {
		if err := take(tp, s); err != nil {
			return err
		}
		if err := e.store.SaveClipboard(c); err != nil {
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

// split cuts the clips on a track that sound across pos in two there, on
// every layer: where it sounds, so a nudged clip is cut where it's heard,
// and both halves keep the nudge. It answers how many it split.
func (s *State) split(track int, pos int64, sampleRate int) (int, error) {
	if track < 1 || track > len(s.Tracks) {
		return 0, ErrNoSuchTrack
	}
	tr := &s.Tracks[track-1]
	var out []Clip
	n := 0
	for _, c := range tr.Clips {
		at := pos - nudgeFrames(c, sampleRate) // pos, where the clip is placed
		if c.At < at && at < c.End() {
			head, tail := c, c
			head.Frames = at - c.At
			tail.ID = NewClipID()
			tail.At, tail.Src, tail.Frames = at, c.Src+(at-c.At), c.End()-at
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

// join merges a clip with its neighbour on its layer -- the one after it,
// or else the one before -- if the second carries straight on from the
// first in the same recording, at the same level and nudge: what a split
// made, so a join never changes what's heard.
func (s *State) join(id string) error {
	for ti := range s.Tracks {
		tr := &s.Tracks[ti]
		for i, c := range tr.Clips {
			if c.ID != id {
				continue
			}
			first, second := -1, -1
			for j, o := range tr.Clips {
				if o.Layer == c.Layer && o.At == c.End() {
					first, second = i, j
					break
				}
			}
			if first < 0 {
				for j, o := range tr.Clips {
					if o.Layer == c.Layer && o.End() == c.At {
						first, second = j, i
						break
					}
				}
			}
			if first < 0 {
				return fmt.Errorf("%w: no clip meets this one to join", ErrBadParameter)
			}
			a, b := tr.Clips[first], tr.Clips[second]
			if b.File != a.File || b.Src != a.Src+a.Frames {
				return fmt.Errorf("%w: its neighbour is a different recording; only a split can be joined", ErrBadParameter)
			}
			if b.GainDB != a.GainDB || b.NudgeMS != a.NudgeMS {
				return fmt.Errorf("%w: the two halves have a different level or nudge; set them the same first", ErrBadParameter)
			}
			tr.Clips[first].Frames += b.Frames
			tr.Clips = append(tr.Clips[:second], tr.Clips[second+1:]...)
			return nil
		}
	}
	return ErrNoSuchClip
}

// nudgeFrames is a clip's nudge in frames: how far from At it sounds.
func nudgeFrames(c Clip, sampleRate int) int64 {
	return int64(math.Round(c.NudgeMS / 1000 * float64(sampleRate)))
}

// slide moves a clip to start at at, on its own track or, with to, on track
// to, on the lowest layer free there.
func (s *State) slide(id string, at int64, to int, length int64) error {
	if at < 0 {
		return fmt.Errorf("%w: before the tape's start", ErrBadParameter)
	}
	if at >= length {
		return ErrPastTheEnd
	}
	if to < 0 || to > len(s.Tracks) {
		return ErrNoSuchTrack
	}
	for ti := range s.Tracks {
		tr := &s.Tracks[ti]
		for i, c := range tr.Clips {
			if c.ID != id {
				continue
			}
			tr.Clips = append(tr.Clips[:i], tr.Clips[i+1:]...)
			c.At = at
			if to == 0 {
				to = ti + 1
			}
			_, err := s.Place(to, c, false)
			return err
		}
	}
	return ErrNoSuchClip
}

// trimClip moves one edge of a clip to tape frame at, as far as its audio
// and its neighbours allow (State.trim).
func (e *Engine) trimClip(t *Tape, req EditRequest) (EditResult, error) {
	if req.At == nil {
		return EditResult{}, fmt.Errorf("%w: trim needs at", ErrBadParameter)
	}
	if req.Edge != "in" && req.Edge != "out" {
		return EditResult{}, fmt.Errorf("%w: trim's edge is in or out", ErrBadParameter)
	}
	_, c, err := t.Clip(req.Clip)
	if err != nil {
		return EditResult{}, err
	}
	file := c.File
	info, err := audio.ReadWAVInfo(e.store.AudioPath(file))
	if err != nil {
		return EditResult{}, fmt.Errorf("the clip's audio can't be read: %w", err)
	}
	var got Clip
	err = e.Edit(t.ID, "", func(tp *Tape, s *State) error {
		var err error
		got, err = s.trim(req.Clip, req.Edge, *req.At, file, info.Frames(), tp.Length, tp.SampleRate)
		return err
	})
	if err != nil {
		return EditResult{}, err
	}
	return EditResult{Op: "trim", Clips: 1, Clip: &got}, nil
}

// trim moves a clip's In edge (its start, moving At and Src together, so the
// audio stays where it was played) or its Out edge (its end) to at, clamped:
//   - to its pool file, whose frames are fileFrames, keeping the overhang
//     either side (or what the clip already has, if less): the Out edge's
//     for a crossfade out of it, the In edge's for when it's reversed and
//     its start becomes an end;
//   - to the clips either side of it on its layer, and the tape's ends;
//   - to leave it at least the overhang's length.
//
// It answers the clip as trimmed.
func (s *State) trim(id, edge string, at int64, file string, fileFrames, length int64, sampleRate int) (Clip, error) {
	over := int64(OverhangSeconds * float64(sampleRate))
	minLen := max64(1, over)
	for ti := range s.Tracks {
		tr := &s.Tracks[ti]
		for i := range tr.Clips {
			c := &tr.Clips[i]
			if c.ID != id {
				continue
			}
			if c.File != file {
				return Clip{}, fmt.Errorf("%w: the clip changed meanwhile; try again", ErrBadParameter)
			}
			before, after := int64(0), length // the room on its layer
			for j, o := range tr.Clips {
				if j == i || o.Layer != c.Layer {
					continue
				}
				if o.End() <= c.At && o.End() > before {
					before = o.End()
				}
				if o.At >= c.End() && o.At < after {
					after = o.At
				}
			}
			var lo, hi int64
			if edge == "in" {
				lo, hi = max64(before, c.At-c.Src+min64(c.Src, over)), c.End()-minLen
			} else {
				fileEnd := max64(c.Src+c.Frames, fileFrames-over)
				lo, hi = c.At+minLen, min64(after, c.At+fileEnd-c.Src)
			}
			if hi < lo {
				return Clip{}, fmt.Errorf("%w: there's no room to trim that edge", ErrBadParameter)
			}
			x := min64(max64(at, lo), hi)
			if edge == "in" {
				d := x - c.At
				c.At, c.Src, c.Frames = x, c.Src+d, c.Frames-d
			} else {
				c.Frames = x - c.At
			}
			return *c, nil
		}
	}
	return Clip{}, ErrNoSuchClip
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

// reverseClip turns a clip round. Its audio, with handles either side, is
// written backwards to a new pool file, and the clip plays that -- so
// every edit still reads a clip forwards. Reversing it again plays its
// original file the right way round, with no new file.
func (e *Engine) reverseClip(t *Tape, id string) (EditResult, error) {
	_, c, err := t.Clip(id)
	if err != nil {
		return EditResult{}, err
	}
	was := *c
	file, src, rev := "", int64(0), (*Reversal)(nil)
	var made string // a reversed file written for this, to remove if it isn't used
	if was.Reversed != nil {
		file, src = was.Reversed.File, was.Reversed.End-was.Src-was.Frames
		info, err := audio.ReadWAVInfo(e.store.AudioPath(file))
		if err != nil {
			return EditResult{}, fmt.Errorf("the audio it was reversed from can't be read: %w", err)
		}
		if src < 0 || src+was.Frames > info.Frames() {
			return EditResult{}, fmt.Errorf("%w: the audio it was reversed from is shorter than the clip", ErrBadParameter)
		}
	} else {
		path := e.store.AudioPath(was.File)
		info, err := audio.ReadWAVInfo(path)
		if err != nil {
			return EditResult{}, err
		}
		if was.Src < 0 || was.Src+was.Frames > info.Frames() {
			return EditResult{}, fmt.Errorf("%w: the clip runs past its audio", ErrBadParameter)
		}
		if err := e.diskOK(); err != nil {
			return EditResult{}, err
		}
		hd := e.handle(int64(e.store.SampleRate()))
		lo, hi := max64(0, was.Src-hd), min64(info.Frames(), was.Src+was.Frames+hd)
		rel, dst, err := e.store.NewPoolFile("rev", time.Now())
		if err != nil {
			return EditResult{}, err
		}
		if err := audio.ReverseWAVSpan(path, lo, hi, dst); err != nil {
			os.Remove(dst)
			return EditResult{}, err
		}
		made = dst
		file, src, rev = rel, hi-(was.Src+was.Frames), &Reversal{File: was.File, End: hi}
	}
	err = e.Edit(t.ID, "", func(_ *Tape, s *State) error {
		for ti := range s.Tracks {
			for i := range s.Tracks[ti].Clips {
				c := &s.Tracks[ti].Clips[i]
				if c.ID != id {
					continue
				}
				if c.File != was.File || c.Src != was.Src || c.Frames != was.Frames {
					return fmt.Errorf("%w: the clip changed meanwhile; try again", ErrBadParameter)
				}
				c.File, c.Src, c.Reversed = file, src, rev
				return nil
			}
		}
		return ErrNoSuchClip
	})
	if err != nil && made != "" {
		// Nothing plays it: don't leave it for a clean-up to find.
		os.Remove(made)
		os.Remove(strings.TrimSuffix(made, ".wav") + ".peaks.json")
	}
	return EditResult{Op: "reverse", Clips: 1}, err
}
