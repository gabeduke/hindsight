package tape

import "fmt"

// Insert and delete time (step A7,
// docs/superpowers/specs/2026-10-07-insert-delete-time-design.md). Drop puts
// the clipboard over what's there, as on the OP-1; these are a DAW's other
// two ways. Insert pushes everything from the playhead on later by the
// clipboard's length and lays the clipboard in the gap; Delete time cuts the
// selection out and closes the gap; Duplicate section lays a section again
// right after itself. All three act on every track, the sections and the
// loop together, so the parts stay in time with each other, and each is one
// undo step.

// cutAt splits every clip, on every track and layer, that runs across tape
// frame pos (as placed) in two there: a time edit then moves what's after pos
// and leaves what's before. The new edges have no fade.
func (s *State) cutAt(pos int64) {
	for ti := range s.Tracks {
		tr := &s.Tracks[ti]
		out := make([]Clip, 0, len(tr.Clips))
		for _, c := range tr.Clips {
			if c.At < pos && pos < c.End() {
				head, tail := c, c
				head.Frames, head.FadeOut = pos-c.At, 0
				tail.ID = NewClipID()
				tail.At, tail.Src, tail.Frames, tail.FadeIn = pos, c.Src+(pos-c.At), c.End()-pos, 0
				out = append(out, head, tail)
				continue
			}
			out = append(out, c)
		}
		tr.Clips = out
	}
}

// shiftFrom moves every clip that starts at or after pos, on every track, d
// frames later; a section or the loop after pos moves too, and one across
// pos stretches at its end.
func (s *State) shiftFrom(pos, d int64) {
	for ti := range s.Tracks {
		for i := range s.Tracks[ti].Clips {
			if c := &s.Tracks[ti].Clips[i]; c.At >= pos {
				c.At += d
			}
		}
	}
	for i := range s.Sections {
		sc := &s.Sections[i]
		if sc.At >= pos {
			sc.At, sc.End = sc.At+d, sc.End+d
		} else if sc.End > pos {
			sc.End += d
		}
	}
	if l := &s.Loop; l.Out > l.In {
		if l.In >= pos {
			l.In, l.Out = l.In+d, l.Out+d
		} else if l.Out > pos {
			l.Out += d
		}
	}
}

// lastFrame is where the last thing on the tape ends: a clip, a section or
// the loop.
func (s *State) lastFrame() int64 {
	var end int64
	for _, tr := range s.Tracks {
		for _, c := range tr.Clips {
			end = max(end, c.End())
		}
	}
	for _, sc := range s.Sections {
		end = max(end, sc.End)
	}
	return max(end, s.Loop.Out)
}

// roomToPush refuses pushing everything from pos on n frames later past the
// tape's end.
func (s *State) roomToPush(pos, n, length int64, sampleRate int) error {
	if end := max(s.lastFrame(), pos); end+n > length {
		return fmt.Errorf("%w: pushing it all %s later needs %s more than the %s left after the last thing on it (a track holds %s, TAPE_LENGTH_S)",
			ErrPastTheEnd, clockText(n, sampleRate), clockText(end+n-length, sampleRate), clockText(max(length-end, 0), sampleRate), minutesText(length, sampleRate))
	}
	return nil
}

// insertTime pushes everything from at on later by the board's length, on
// every track, the sections and the loop, and lays the board's clips in the
// gap from track down. It answers how many clips it laid.
func (s *State) insertTime(c *Clipboard, track int, at, length int64, sampleRate int) (int, error) {
	if c.Empty() {
		return 0, ErrEmptyClipboard
	}
	if track < 1 || track+len(c.Tracks)-1 > len(s.Tracks) {
		return 0, fmt.Errorf("%w: %d track%s from track %d don't fit", ErrNoSuchTrack, len(c.Tracks), plural(len(c.Tracks)), track)
	}
	if err := s.roomToPush(at, c.Frames, length, sampleRate); err != nil {
		return 0, err
	}
	s.cutAt(at)
	s.shiftFrom(at, c.Frames)
	n := 0
	for i, clips := range c.Tracks {
		for _, cl := range clips {
			cl.ID = ""
			cl.At += at
			if _, err := s.Place(track+i, cl, false); err != nil {
				return 0, err
			}
			n++
		}
	}
	return n, nil
}

// deleteTime cuts [from, to) out of every track and closes the gap:
// everything after moves earlier by its length. A section inside it goes; one
// across an edge loses the part inside. The loop is left where it is, so it
// now holds what followed: Delete time again takes the next as much.
func (s *State) deleteTime(from, to int64) error {
	n := to - from
	if n <= 0 {
		return fmt.Errorf("%w: select some bars first: hold and drag on the ruler", ErrBadParameter)
	}
	for ti := range s.Tracks {
		tr := &s.Tracks[ti]
		tr.Clips = clearRange(tr.Clips, from, to)
		for i := range tr.Clips {
			if c := &tr.Clips[i]; c.At >= to {
				c.At -= n
			}
		}
	}
	kept := s.Sections[:0:0]
	for _, sc := range s.Sections {
		switch {
		case sc.End <= from:
		case sc.At >= to:
			sc.At, sc.End = sc.At-n, sc.End-n
		default: // across [from, to): what's outside it stays
			a, b := min(sc.At, from), from
			if sc.End > to {
				b = sc.End - n
			}
			if b <= a {
				continue // all of it was inside
			}
			sc.At, sc.End = a, b
		}
		kept = append(kept, sc)
	}
	s.Sections = kept
	return nil
}

// duplicateSection lays a section's bars, every track, again right after it,
// pushing what follows later, and names the copy as the section: the chorus
// again. It answers the new section.
func (s *State) duplicateSection(id string, length int64, sampleRate int) (Section, error) {
	var sc Section
	found := false
	for _, x := range s.Sections {
		if x.ID == id {
			sc, found = x, true
		}
	}
	if !found {
		return Section{}, ErrNoSuchSection
	}
	n := sc.End - sc.At
	if err := s.roomToPush(sc.End, n, length, sampleRate); err != nil {
		return Section{}, err
	}
	parts := make([][]Clip, len(s.Tracks))
	for ti, tr := range s.Tracks {
		parts[ti] = window(tr.Clips, sc.At, sc.End)
	}
	s.cutAt(sc.End)
	s.shiftFrom(sc.End, n)
	for ti, ps := range parts {
		// Base layers first, so parts stacked in the section stay stacked.
		for layer := 0; ; layer++ {
			more := false
			for _, p := range ps {
				if p.Layer > layer {
					more = true
				}
				if p.Layer != layer {
					continue
				}
				p.At += sc.End
				if _, err := s.Place(ti+1, p, false); err != nil {
					return Section{}, err
				}
			}
			if !more {
				break
			}
		}
	}
	cp := Section{ID: "s" + NewClipID()[1:], Name: sc.Name, Color: sc.Color, At: sc.End, End: sc.End + n}
	s.Sections = append(s.Sections, cp)
	return cp, nil
}

// TimeEdit carries out Insert, Delete time or Duplicate section.
func (e *Engine) timeEdit(t *Tape, req EditRequest) (EditResult, error) {
	sr := e.store.SampleRate()
	switch req.Op {
	case "insert":
		var c *Clipboard
		if req.Crate != "" {
			k, err := e.CrateClip(req.Crate)
			if err != nil {
				return EditResult{}, err
			}
			if k.Deleted != nil {
				return EditResult{}, ErrNoSuchCrateClip
			}
			c = &Clipboard{Tracks: [][]Clip{{k.clip()}}, Frames: k.Frames, BPM: k.BPM, From: k.Name}
		} else {
			var err error
			if c, err = e.Clipboard(); err != nil {
				return EditResult{}, err
			}
			if c.Empty() {
				return EditResult{}, ErrEmptyClipboard
			}
		}
		st := e.tr.Status()
		moving := st.Playing || st.CountIn > 0
		at := e.playhead()
		if req.Pos != nil { // where the page previewed it
			at = *req.Pos
		}
		if at < 0 {
			return EditResult{}, fmt.Errorf("%w: pos before the tape's start", ErrBadParameter)
		}
		if t.Grid == nil && t.Empty() {
			return EditResult{}, fmt.Errorf("%w: on an empty tape, Drop it: there's nothing to push along", ErrBadParameter)
		}
		var n int
		err := e.Edit(t.ID, "", func(tp *Tape, s *State) error {
			var err error
			n, err = s.insertTime(c, req.Track, at, tp.Length, sr)
			return err
		})
		if err != nil {
			return EditResult{}, err
		}
		if !moving {
			e.doWait(Action{Kind: "locate", Pos: at + c.Frames})
		}
		return EditResult{Op: "insert", Clips: n, Frames: c.Frames, At: at}, nil
	case "delete-time":
		// The range's span, or the loop's.
		var from, to int64
		err := e.Edit(t.ID, "", func(tp *Tape, s *State) error {
			var err error
			if from, to, err = req.spanOf(s, tp.Length); err != nil {
				return err
			}
			return s.deleteTime(from, to)
		})
		return EditResult{Op: "delete-time", Frames: to - from, At: from}, err
	default: // duplicate-section
		var cp Section
		err := e.Edit(t.ID, "", func(tp *Tape, s *State) error {
			var err error
			cp, err = s.duplicateSection(req.Section, tp.Length, sr)
			return err
		})
		if err != nil {
			return EditResult{}, err
		}
		return EditResult{Op: "duplicate-section", Frames: cp.End - cp.At, At: cp.At, Section: &cp}, nil
	}
}
