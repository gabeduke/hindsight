package tape

import (
	"fmt"
	"time"
)

var (
	ErrNoSuchCueClip = fmt.Errorf("%w: no such cue clip", ErrBadParameter)
)

// cueAdd adds a clip to the cue lane in state.
func (s *State) cueAdd(clip CueClip) (CueClip, error) {
	if clip.ID == "" {
		clip.ID = NewClipID()
	}
	if clip.Frames <= 0 {
		return CueClip{}, fmt.Errorf("%w: clip frames must be greater than zero", ErrBadParameter)
	}
	if s.Cue == nil {
		s.Cue = &CueLane{Clips: []CueClip{}}
	}
	s.Cue.Clips = append(s.Cue.Clips, clip)
	return clip, nil
}

// cueRemove removes a clip from the cue lane in state.
func (s *State) cueRemove(clipID string) error {
	if s.Cue == nil || len(s.Cue.Clips) == 0 {
		return ErrNoSuchCueClip
	}
	idx := -1
	for i, c := range s.Cue.Clips {
		if c.ID == clipID {
			idx = i
			break
		}
	}
	if idx == -1 {
		return ErrNoSuchCueClip
	}
	s.Cue.Clips = append(s.Cue.Clips[:idx], s.Cue.Clips[idx+1:]...)
	return nil
}

// cueSet updates a clip on the cue lane in state.
func (s *State) cueSet(clip CueClip) (CueClip, error) {
	if s.Cue == nil || len(s.Cue.Clips) == 0 {
		return CueClip{}, ErrNoSuchCueClip
	}
	idx := -1
	for i, c := range s.Cue.Clips {
		if c.ID == clip.ID {
			idx = i
			break
		}
	}
	if idx == -1 {
		return CueClip{}, ErrNoSuchCueClip
	}
	target := s.Cue.Clips[idx]
	if clip.Name != "" {
		target.Name = clip.Name
	}
	// A grabbed clip's span is its window, which only CueTrim moves: its
	// lanes read it together.
	if clip.Frames > 0 && len(target.Lanes) == 0 {
		target.Frames = clip.Frames
	}
	if clip.Src >= 0 && len(target.Lanes) == 0 {
		target.Src = clip.Src
	}
	target.Loop = clip.Loop
	target.GainDB = clip.GainDB
	target.FadeIn = clip.FadeIn
	target.FadeOut = clip.FadeOut
	target.Touched = true
	s.Cue.Clips[idx] = target
	return target, nil
}

// cueSetSolo sets the cue solo flag in state.
func (s *State) cueSetSolo(solo bool) {
	if s.Cue == nil {
		s.Cue = &CueLane{Clips: []CueClip{}}
	}
	s.Cue.Solo = solo
}

// cueToTrack copies a cue clip from the cue lane onto trackNum at frame at.
func (s *State) cueToTrack(clipID string, trackNum int, at int64) (Clip, error) {
	if trackNum < 1 || trackNum > len(s.Tracks) {
		return Clip{}, ErrNoSuchTrack
	}
	if s.Cue == nil {
		return Clip{}, ErrNoSuchCueClip
	}
	var cueClip *CueClip
	for _, c := range s.Cue.Clips {
		if c.ID == clipID {
			cueClip = &c
			break
		}
	}
	if cueClip == nil {
		return Clip{}, ErrNoSuchCueClip
	}
	placed := Clip{
		ID:      NewClipID(),
		File:    cueClip.File,
		Src:     cueClip.Src,
		Frames:  cueClip.Frames,
		At:      at,
		GainDB:  cueClip.GainDB,
		Source:  cueClip.Source,
		FadeIn:  cueClip.FadeIn,
		FadeOut: cueClip.FadeOut,
	}
	trackIdx := trackNum - 1
	s.Tracks[trackIdx].Clips = append(s.Tracks[trackIdx].Clips, placed)
	return placed, nil
}

// CueAdd appends a clip to the cue lane as an undoable change on Tape.
func (t *Tape) CueAdd(now time.Time, clip CueClip) (CueClip, error) {
	var added CueClip
	err := t.Change("cue:add", now, func(s *State) error {
		var err error
		added, err = s.cueAdd(clip)
		return err
	})
	return added, err
}

// CueRemove removes a clip from the cue lane by ID as an undoable change on Tape.
func (t *Tape) CueRemove(now time.Time, clipID string) error {
	return t.Change("cue:remove", now, func(s *State) error {
		return s.cueRemove(clipID)
	})
}

// CueSet updates parameters of an existing cue clip as an undoable change on Tape.
func (t *Tape) CueSet(now time.Time, clip CueClip) (CueClip, error) {
	var updated CueClip
	err := t.Change("cue:set", now, func(s *State) error {
		var err error
		updated, err = s.cueSet(clip)
		return err
	})
	return updated, err
}

// CueSetSolo sets the solo state of the cue lane as an undoable change on Tape.
func (t *Tape) CueSetSolo(now time.Time, solo bool) error {
	return t.Change("cue:solo", now, func(s *State) error {
		s.cueSetSolo(solo)
		return nil
	})
}

// CueToTrack copies a cue clip to a tape track at position at as an undoable change on Tape.
func (t *Tape) CueToTrack(now time.Time, clipID string, trackNum int, at int64) (Clip, error) {
	var placed Clip
	err := t.Change("cue:to-track", now, func(s *State) error {
		var err error
		placed, err = s.cueToTrack(clipID, trackNum, at)
		return err
	})
	return placed, err
}
