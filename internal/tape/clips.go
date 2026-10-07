package tape

import (
	"fmt"
	"sort"
	"time"
)

// Several clips at once (step A4): a selection on the tape page is moved,
// removed, copied or duplicated as one edit, so one undo step. Reverse takes
// several too (reverseClips).

// clip finds a clip in a state by id.
func (s *State) clip(id string) (*Clip, error) {
	for ti := range s.Tracks {
		for ci := range s.Tracks[ti].Clips {
			if s.Tracks[ti].Clips[ci].ID == id {
				return &s.Tracks[ti].Clips[ci], nil
			}
		}
	}
	return nil, ErrNoSuchClip
}

// picked is a clip of a selection, with the track (from 1) it's on.
type picked struct {
	c     Clip
	track int
}

// pick finds every clip named, in track and layer order; with take, it also
// takes them off their tracks. A name that isn't there, or none at all, is
// refused, and nothing is taken.
func (s *State) pick(ids []string, take bool) ([]picked, error) {
	if len(ids) == 0 {
		return nil, fmt.Errorf("%w: no clips picked", ErrBadParameter)
	}
	want := make(map[string]bool, len(ids))
	for _, id := range ids {
		want[id] = true
	}
	var out []picked
	for ti := range s.Tracks {
		for _, c := range s.Tracks[ti].Clips {
			if want[c.ID] {
				out = append(out, picked{c, ti + 1})
				delete(want, c.ID)
			}
		}
	}
	if len(want) > 0 {
		return nil, ErrNoSuchClip
	}
	sort.SliceStable(out, func(a, b int) bool {
		if out[a].c.Layer != out[b].c.Layer {
			return out[a].c.Layer < out[b].c.Layer
		}
		return out[a].c.At < out[b].c.At
	})
	if take {
		gone := make(map[string]bool, len(out))
		for _, p := range out {
			gone[p.c.ID] = true
		}
		for ti := range s.Tracks {
			kept := make([]Clip, 0, len(s.Tracks[ti].Clips))
			for _, c := range s.Tracks[ti].Clips {
				if !gone[c.ID] {
					kept = append(kept, c)
				}
			}
			s.Tracks[ti].Clips = kept
		}
	}
	return out, nil
}

// span is where a selection starts and ends on the tape.
func span(ps []picked) (from, to int64) {
	from, to = ps[0].c.At, ps[0].c.End()
	for _, p := range ps {
		from, to = min64(from, p.c.At), max64(to, p.c.End())
	}
	return from, to
}

// moveClips moves clips dt frames later and dtrack tracks down, together:
// each lands on the lowest layer free where it goes, the lowest of them
// first, so parts stacked on one another stay stacked. A move that would
// take any of them off the tracks or either end of the tape is refused
// whole: the page holds a drag inside the tape before it sends it.
func (s *State) moveClips(ids []string, dt int64, dtrack int, length int64) (int, error) {
	ps, err := s.pick(ids, true)
	if err != nil {
		return 0, err
	}
	for _, p := range ps {
		to := p.track + dtrack
		if to < 1 || to > len(s.Tracks) {
			return 0, fmt.Errorf("%w: that moves a clip off the tracks", ErrBadParameter)
		}
		if p.c.At+dt < 0 {
			return 0, fmt.Errorf("%w: that moves a clip before the tape's start", ErrBadParameter)
		}
		if p.c.End()+dt > length {
			return 0, ErrPastTheEnd
		}
	}
	for _, p := range ps {
		c := p.c
		c.At += dt
		if _, err := s.Place(p.track+dtrack, c, false); err != nil {
			return 0, err
		}
	}
	return len(ps), nil
}

// removeClips takes clips off the tape.
func (s *State) removeClips(ids []string) error {
	_, err := s.pick(ids, true)
	return err
}

// duplicateClips lays a copy of the clips right after them -- the earliest
// copy where the last of them ends -- each on its own track, on the lowest
// layer free there. It answers how many it made.
func (s *State) duplicateClips(ids []string, length int64) (int, error) {
	ps, err := s.pick(ids, false)
	if err != nil {
		return 0, err
	}
	from, to := span(ps)
	if to+(to-from) > length {
		return 0, fmt.Errorf("%w: a copy after them would run past the end of the tape", ErrPastTheEnd)
	}
	for _, p := range ps {
		c := p.c
		c.ID, c.At = "", c.At+(to-from)
		if _, err := s.Place(p.track, c, false); err != nil {
			return 0, err
		}
	}
	return len(ps), nil
}

// copyClips puts clips on the clipboard as they lie: a track of the
// clipboard for each track from the highest of them to the lowest, each clip
// as far from the first as it is on the tape, so a drop lays them out again
// the same.
func (e *Engine) copyClips(t *Tape, ids []string) (EditResult, error) {
	st := t.State.clone()
	ps, err := st.pick(ids, false)
	if err != nil {
		return EditResult{}, err
	}
	from, to := span(ps)
	top, bottom := ps[0].track, ps[0].track
	for _, p := range ps {
		top, bottom = min(top, p.track), max(bottom, p.track)
	}
	c := &Clipboard{Frames: to - from, Created: time.Now(),
		From: fmt.Sprintf("%s, %d clip%s", t.Name, len(ps), plural(len(ps)))}
	for n := top; n <= bottom; n++ {
		lane := []Clip{}
		for _, p := range ps {
			if p.track == n {
				cl := p.c
				cl.ID, cl.At = "", cl.At-from
				lane = append(lane, cl)
			}
		}
		c.Tracks = append(c.Tracks, lane)
	}
	if err := e.store.SaveClipboard(c); err != nil {
		return EditResult{}, err
	}
	return EditResult{Op: "copy", Clips: len(ps), Frames: c.Frames, Board: c}, nil
}
