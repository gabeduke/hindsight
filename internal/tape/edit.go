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
	Op    string `json:"op"`    // lift, copy, split, join, slide, multiply, reverse, trim, repeat, move, remove, duplicate, section-add, section-set, section-remove
	Track int    `json:"track"` // the selected track
	All   bool   `json:"all"`   // lift and copy: all four tracks, kept apart
	Clip  string `json:"clip"`  // join, slide, reverse, trim, repeat: the clip
	Pos   *int64 `json:"pos"`   // split, insert: where (default: the playhead)
	At    *int64 `json:"at"`    // slide: where its start goes; trim: where the edge goes
	Edge  string `json:"edge"`  // trim: "in" (its start) or "out" (its end)
	// To is the track a slide moves the clip onto (0: its own). Not Track,
	// which every edit sends as the selected track.
	To int `json:"to"`
	// Count is how many copies a repeat lays.
	Count int `json:"count"`
	// Clips are several clips at once: move, remove, reverse, copy and
	// duplicate act on them together, as one undo step. Move moves them all
	// DT frames later and DTrack tracks down.
	Clips  []string `json:"clips"`
	DT     int64    `json:"dt"`
	DTrack int      `json:"dtrack"`
	// A section: section-add takes Name, Color, At and End; section-set
	// takes Section and any of them; section-remove takes Section.
	Section string  `json:"section"`
	Name    *string `json:"name"`
	Color   *string `json:"color"`
	End     *int64  `json:"end"`
	// Crate is a kept clip to insert, instead of the clipboard.
	Crate string `json:"crate"`
}

// EditResult says what an edit did, for the page's toast.
type EditResult struct {
	Op      string     `json:"op"`
	Clips   int        `json:"clips"`            // clips lifted, copied, made or moved
	Frames  int64      `json:"frames,omitempty"` // how long, for lift, copy, multiply
	Board   *Clipboard `json:"clipboard,omitempty"`
	Clip    *Clip      `json:"clip,omitempty"`    // trim: the clip as it is now
	Section *Section   `json:"section,omitempty"` // a section edit: the section as it is now
	IDs     []string   `json:"ids,omitempty"`     // duplicate: the copies' ids
	At      int64      `json:"at"`                // insert, delete time, duplicate section: where (0 is a place)
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
	case "copy":
		if len(req.Clips) > 0 {
			return e.copyClips(t, req.Clips)
		}
		return e.liftCopy(t, req)
	case "lift":
		return e.liftCopy(t, req)
	case "move":
		var n int
		err := e.Edit(id, "", func(tp *Tape, s *State) error {
			var err error
			n, err = s.moveClips(req.Clips, req.DT, req.DTrack, tp.Length)
			return err
		})
		return EditResult{Op: "move", Clips: n}, err
	case "remove":
		var n int
		err := e.Edit(id, "", func(_ *Tape, s *State) error {
			var err error
			n, err = s.removeClips(req.Clips)
			return err
		})
		return EditResult{Op: "remove", Clips: n}, err
	case "duplicate":
		var made []string
		err := e.Edit(id, "", func(tp *Tape, s *State) error {
			var err error
			made, err = s.duplicateClips(req.Clips, tp.Length)
			return err
		})
		return EditResult{Op: "duplicate", Clips: len(made), IDs: made}, err
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
		if len(req.Clips) > 0 {
			return e.reverseClips(t, req.Clips)
		}
		return e.reverseClips(t, []string{req.Clip})
	case "trim":
		return e.trimClip(t, req)
	case "section-add", "section-set", "section-remove":
		return e.sectionEdit(id, req)
	case "insert", "delete-time", "duplicate-section":
		return e.timeEdit(t, req)
	case "repeat":
		err := e.Edit(id, "", func(tp *Tape, s *State) error { return s.repeat(req.Clip, req.Count, tp.Length) })
		return EditResult{Op: "repeat", Clips: req.Count}, err
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
		// An edge the window cuts through has no fade.
		if lo > c.At {
			part.FadeIn = 0
		}
		if hi < c.End() {
			part.FadeOut = 0
		}
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
			head.FadeOut = 0 // each half keeps its outer fade
			tail.ID = NewClipID()
			tail.At, tail.Src, tail.Frames = at, c.Src+(at-c.At), c.End()-at
			tail.FadeIn = 0
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
			tr.Clips[first].FadeOut, tr.Clips[first].FadeOutShape = b.FadeOut, b.FadeOutShape // the outer fades: a's in, b's out
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

// MaxRepeat is the most copies one repeat lays.
const MaxRepeat = 64

// repeat lays count copies of a clip end to end after it, on its track, all
// on one layer, so each meets the next on its layer and crossfades into it
// (the renderer joins only clips on the same layer; across layers both
// edges declick, a dip every time round). They go on the clip's own layer
// if it's free for all of them, so the first meets the clip itself; else on
// the lowest layer free for all of them. A copy is a new clip of the same
// audio, not linked to the first: editing one leaves the others. The
// PATCH's tile, Repeat to the loop's end, is the older form: it fills the
// loop's free room on the clip's own layer.
func (s *State) repeat(id string, count int, length int64) error {
	if count < 1 || count > MaxRepeat {
		return fmt.Errorf("%w: repeat 1 to %d times", ErrBadParameter, MaxRepeat)
	}
	for ti := range s.Tracks {
		tr := &s.Tracks[ti]
		for _, c := range tr.Clips {
			if c.ID != id {
				continue
			}
			if c.End()+int64(count)*c.Frames > length {
				return fmt.Errorf("%w: %d copies would run past the end of the tape", ErrPastTheEnd, count)
			}
			copies := make([]Clip, count)
			for k := range copies {
				cp := c
				cp.ID, cp.At = "", c.At+int64(k+1)*c.Frames
				copies[k] = cp
			}
			own := true
			for _, o := range tr.Clips {
				if o.Layer == c.Layer && o.At < c.End()+int64(count)*c.Frames && c.End() < o.End() {
					own = false
					break
				}
			}
			if !own {
				_, err := s.PlaceTogether(ti+1, copies, false)
				return err
			}
			for _, cp := range copies {
				cp.ID = NewClipID()
				tr.Clips = append(tr.Clips, cp)
			}
			return nil
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

// turn is how one clip plays turned round (reverseClips).
type turn struct {
	was  Clip
	file string
	src  int64
	rev  *Reversal
}

// reverseClips turns clips round, as one undo step. Each clip's audio, with
// handles either side, is written backwards to a new pool file, and the
// clip plays that -- so every edit still reads a clip forwards. Reversing one
// again plays its original file the right way round, with no new file.
func (e *Engine) reverseClips(t *Tape, ids []string) (EditResult, error) {
	var turns []turn
	var made []string // reversed files written for this, to remove if they aren't used
	seen := map[string]bool{}
	forget := func() {
		// Nothing plays them: don't leave them for a clean-up to find.
		for _, m := range made {
			os.Remove(m)
			os.Remove(strings.TrimSuffix(m, ".wav") + ".peaks.json")
		}
	}
	for _, id := range ids {
		if seen[id] { // a clip named twice is turned once
			continue
		}
		seen[id] = true
		_, c, err := t.Clip(id)
		if err != nil {
			forget()
			return EditResult{}, err
		}
		tn, dst, err := e.reversal(*c)
		if err != nil {
			forget()
			return EditResult{}, err
		}
		if dst != "" {
			made = append(made, dst)
		}
		turns = append(turns, tn)
	}
	err := e.Edit(t.ID, "", func(_ *Tape, s *State) error {
		for _, tn := range turns {
			c, err := s.clip(tn.was.ID)
			if err != nil {
				return err
			}
			if c.File != tn.was.File || c.Src != tn.was.Src || c.Frames != tn.was.Frames {
				return fmt.Errorf("%w: the clip changed meanwhile; try again", ErrBadParameter)
			}
			c.File, c.Src, c.Reversed = tn.file, tn.src, tn.rev
			c.FadeIn, c.FadeOut = c.FadeOut, c.FadeIn // backwards, its end is its start
			c.FadeInShape, c.FadeOutShape = c.FadeOutShape, c.FadeInShape
		}
		return nil
	})
	if err != nil {
		forget()
	}
	return EditResult{Op: "reverse", Clips: len(turns)}, err
}

// reversal works out how a clip plays turned round: its original file again,
// for one already reversed, or a new reversed copy of its audio and handles,
// whose path it answers so that a failed edit can remove it.
func (e *Engine) reversal(was Clip) (turn, string, error) {
	tn := turn{was: was}
	if was.Reversed != nil {
		tn.file, tn.src = was.Reversed.File, was.Reversed.End-was.Src-was.Frames
		info, err := audio.ReadWAVInfo(e.store.AudioPath(tn.file))
		if err != nil {
			return tn, "", fmt.Errorf("the audio it was reversed from can't be read: %w", err)
		}
		if tn.src < 0 || tn.src+was.Frames > info.Frames() {
			return tn, "", fmt.Errorf("%w: the audio it was reversed from is shorter than the clip", ErrBadParameter)
		}
		return tn, "", nil
	}
	path := e.store.AudioPath(was.File)
	info, err := audio.ReadWAVInfo(path)
	if err != nil {
		return tn, "", err
	}
	if was.Src < 0 || was.Src+was.Frames > info.Frames() {
		return tn, "", fmt.Errorf("%w: the clip runs past its audio", ErrBadParameter)
	}
	if err := e.diskOK(); err != nil {
		return tn, "", err
	}
	hd := e.handle(int64(e.store.SampleRate()))
	lo, hi := max64(0, was.Src-hd), min64(info.Frames(), was.Src+was.Frames+hd)
	rel, dst, err := e.store.NewPoolFile("rev", time.Now())
	if err != nil {
		return tn, "", err
	}
	if err := audio.ReverseWAVSpan(path, lo, hi, dst); err != nil {
		os.Remove(dst)
		return tn, "", err
	}
	tn.file, tn.src, tn.rev = rel, hi-(was.Src+was.Frames), &Reversal{File: was.File, End: hi}
	return tn, dst, nil
}
