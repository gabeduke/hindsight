package tape

import (
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// The buffer on the cue lane (docs/architecture/tape.md, *The cue lane*):
// GRAB lands on the lane as a cue clip that keeps what the buffer kept --
// one lane per input it was grabbed from, each with a bar of handles either
// side -- so the clip's drawer can trim it into its handles, change its
// inputs, shape it, audition it, drop it on a track, keep it as a take or
// toss it. Unlike the buffer, every one of those but KEEP and the audition
// is an edit of the tape: one Undo takes it back, a GRAB's replacement
// included.

// ErrCueChanged refuses a change worked out on a cue clip that someone else
// changed meanwhile.
var ErrCueChanged = errors.New("that cue clip changed meanwhile; try again")

// useCue notes that a cue clip was launched or kept, under e.mu.
func (e *Engine) useCue(clip string) {
	if e.cueUsed == nil {
		e.cueUsed = map[string]bool{}
	}
	e.cueUsed[clip] = true
}

// boardOf is a cue clip as a board: one track per lane, each with the clip's
// level and fades, so what works on the buffer -- a drop, KEEP, Normalize,
// Reverse, the audition -- works on it. A clip with no lanes is one, its
// file. It shares nothing with the clip.
func (c CueClip) boardOf() *Clipboard {
	b := &Clipboard{Frames: c.Frames, BPM: c.BPM, From: c.Name}
	if c.Grab != nil {
		g := *c.Grab
		b.Grab = &g
	}
	lanes := c.Lanes
	if len(lanes) == 0 {
		lanes = []Clip{{File: c.File, Src: c.Src, Source: c.Source}}
	}
	for _, l := range lanes {
		l.ID, l.At, l.Frames = "", 0, c.Frames
		l.GainDB, l.FadeIn, l.FadeOut = c.GainDB, c.FadeIn, c.FadeOut
		l.FadeInShape, l.FadeOutShape = c.FadeInShape, c.FadeOutShape
		b.Tracks = append(b.Tracks, []Clip{l})
	}
	return b
}

// take sets the clip's lanes, window, shape and tempo from a grab's board
// (one clip per track, its first track's level and fades the clip's).
func (c *CueClip) take(b *Clipboard) {
	c.Lanes = nil
	for _, tr := range b.Tracks {
		for _, l := range tr {
			l.ID, l.At = "", 0
			l.GainDB, l.FadeIn, l.FadeOut, l.FadeInShape, l.FadeOutShape = 0, 0, 0, "", ""
			c.Lanes = append(c.Lanes, l)
		}
	}
	if f := firstClip(b); f != nil {
		c.GainDB, c.FadeIn, c.FadeOut = f.GainDB, f.FadeIn, f.FadeOut
		c.FadeInShape, c.FadeOutShape = f.FadeInShape, f.FadeOutShape
	}
	c.Grab = nil
	if b.Grab != nil {
		g := *b.Grab
		g.Stale = false // worked out as it's read, never kept
		c.Grab = &g
	}
	c.BPM, c.Frames = b.BPM, b.Frames
	c.File, c.Src = "", 0
	if len(c.Lanes) > 0 {
		c.File, c.Src = c.Lanes[0].File, c.Lanes[0].Src
	}
}

// cueName names a grabbed cue clip: a take's title, or the inputs it was
// grabbed from.
func cueName(b *Clipboard) string {
	if g := b.Grab; g != nil {
		return strings.Join(g.Sources, " + ")
	}
	return b.From
}

// cueClip is the loaded tape's cue clip, a copy.
func (e *Engine) cueClip(id, clip string) (CueClip, error) {
	t := e.Loaded()
	if t == nil {
		return CueClip{}, ErrNoTape
	}
	if t.ID != id {
		return CueClip{}, ErrWrongTape
	}
	if t.State.Cue != nil {
		for _, c := range t.State.Cue.Clips {
			if c.ID == clip {
				return c.clone(), nil
			}
		}
	}
	return CueClip{}, ErrNoSuchCueClip
}

// cueAt is the index of a clip on the lane in s, or ErrNoSuchCueClip.
func (s *State) cueAt(clip string) (int, error) {
	if s.Cue != nil {
		if i := slices.IndexFunc(s.Cue.Clips, func(c CueClip) bool { return c.ID == clip }); i >= 0 {
			return i, nil
		}
	}
	return -1, ErrNoSuchCueClip
}

// CueGrabbed is a GRAB on the cue lane: the clip it made, and the untouched
// clip it took the place of, if it did. Undo is the tape's.
type CueGrabbed struct {
	Clip     CueClip  `json:"cue_clip"`
	Replaced *CueClip `json:"replaced,omitempty"`
}

// GrabToCue is the Studio's GRAB onto the loaded tape's cue lane: the span
// GrabRequest asks for, off the ring, from its sources, as a looping clip.
// It takes the place of the lane's newest clip while that one is an untouched
// grab -- never launched, dropped, kept, trimmed, shaped or renamed -- so a
// run of presses doesn't fill the lane; otherwise it is added. With again,
// the id of a grabbed clip, it takes that clip's span once more from other
// sources, its window and shape carrying on (req.Again is implied).
func (e *Engine) GrabToCue(id string, req GrabRequest, again string) (CueGrabbed, error) {
	var keep *Clipboard
	var was *CueClip
	if again != "" {
		c, err := e.cueClip(id, again)
		if err != nil {
			return CueGrabbed{}, err
		}
		keep, req.Again, was = c.boardOf(), true, &c
	} else if t := e.Loaded(); t == nil {
		return CueGrabbed{}, ErrNoTape
	} else if t.ID != id {
		return CueGrabbed{}, ErrWrongTape
	}
	b, made, err := e.grabRing(req, keep)
	if err != nil {
		return CueGrabbed{}, err
	}
	g, err := e.placeGrab(id, b, again, was, "grab")
	if err != nil {
		for _, rel := range made {
			e.store.removePoolFile(rel)
		}
	}
	return g, err
}

// GrabTakeToCue is GrabToCue from a take's span (GrabTake): the Listening
// Room's "to the studio", onto the lane.
func (e *Engine) GrabTakeToCue(id, take, file, title string, from, to int64, pick []int) (CueGrabbed, error) {
	if t := e.Loaded(); t == nil {
		return CueGrabbed{}, ErrNoTape
	} else if t.ID != id {
		return CueGrabbed{}, ErrWrongTape
	}
	b, rel, err := e.grabTake(take, file, title, from, to, pick)
	if err != nil {
		return CueGrabbed{}, err
	}
	g, err := e.placeGrab(id, b, "", nil, "take")
	if err != nil {
		e.store.removePoolFile(rel)
	}
	return g, err
}

// placeGrab puts a grab's board on the lane, as GrabToCue says: in again's
// place (refused if that clip changed while the ring was copied: was is it
// as it was read), in the place of the newest clip if it is an untouched
// GRAB, or at the end. One edit, never run together with another (kind ""),
// so one Undo takes back one GRAB.
func (e *Engine) placeGrab(id string, b *Clipboard, again string, was *CueClip, source string) (CueGrabbed, error) {
	var out CueGrabbed
	err := e.Edit(id, "", func(_ *Tape, s *State) error {
		if again != "" {
			i, err := s.cueAt(again)
			if err != nil {
				return err
			}
			c := &s.Cue.Clips[i]
			if was != nil && !sameLanes(*c, *was) {
				return ErrCueChanged
			}
			if c.Name == cueName(c.boardOf()) { // never renamed: it names its inputs
				c.Name = cueName(b)
			}
			c.take(b)
			c.Touched = true // its inputs changed: an edit
			out.Clip = *c
			return nil
		}
		c := CueClip{ID: NewClipID(), Name: cueName(b), Loop: true, Source: source}
		c.take(b)
		if s.Cue != nil {
			if n := len(s.Cue.Clips); n > 0 {
				last := s.Cue.Clips[n-1]
				if last.Source == "grab" && !last.Touched && !e.cueUsed[last.ID] {
					old := last.clone()
					out.Replaced = &old
					s.Cue.Clips[n-1] = c
					out.Clip = c
					return nil
				}
			}
		}
		added, err := s.cueAdd(c)
		out.Clip = added
		return err
	})
	return out, err
}

// CueTrim moves a grabbed cue clip's window to [in, out), in frames from its
// grab's start, inside its handles as the buffer's is (TrimClipboard): every
// lane reads the new window, and the files stay as they are. Edits in a run
// come together into one Undo, as a drag of the window sends many.
func (e *Engine) CueTrim(id, clip string, in, out int64) (CueClip, error) {
	var trimmed CueClip
	over := int64(OverhangSeconds * float64(e.store.SampleRate()))
	err := e.Edit(id, "cue:trim:"+clip, func(_ *Tape, s *State) error {
		i, err := s.cueAt(clip)
		if err != nil {
			return err
		}
		c := s.Cue.Clips[i].clone()
		if c.Grab == nil {
			return fmt.Errorf("%w: this clip went on the lane before clips kept their handles; trim it on a track", ErrBadParameter)
		}
		if err := c.Grab.trim(in, out, over); err != nil {
			return err
		}
		for j := range c.Lanes {
			c.Grab.window(&c.Lanes[j])
		}
		c.Frames = c.Grab.Out - c.Grab.In
		c.FadeIn, c.FadeOut = min64(c.FadeIn, c.Frames), min64(c.FadeOut, c.Frames)
		c.File, c.Src = c.Lanes[0].File, c.Lanes[0].Src
		c.Touched = true
		s.Cue.Clips[i] = c
		trimmed = c
		return nil
	})
	return trimmed, err
}

// CueShape changes a cue clip as the buffer's keys change it
// (ShapeClipboard): its level, its fades and their curves, Normalize (the
// lanes summed to audio.NormalizePeakDB at their loudest), and Reverse
// (every lane's file and handles written backwards once; again plays the
// originals). Normalize and Reverse read and write the pool before the
// edit, and are refused if the clip changed meanwhile.
func (e *Engine) CueShape(id, clip string, sh BoardShape) (CueClip, error) {
	if sh.FadeInShape != nil && !ValidFadeShape(*sh.FadeInShape) || sh.FadeOutShape != nil && !ValidFadeShape(*sh.FadeOutShape) {
		return CueClip{}, fmt.Errorf("%w: a fade's curve is equal power (\"\"), linear, s or exp", ErrBadParameter)
	}
	before, err := e.cueClip(id, clip)
	if err != nil {
		return CueClip{}, err
	}
	gain := sh.GainDB
	if sh.Normalize {
		db, err := e.normalizeGain(before.boardOf())
		if err != nil {
			return CueClip{}, err
		}
		gain = &db
	}
	var turned *Clipboard
	var made []string
	if sh.Reverse {
		if before.Grab == nil {
			return CueClip{}, fmt.Errorf("%w: this clip went on the lane before clips kept their handles; reverse it on a track", ErrBadParameter)
		}
		turned = before.boardOf()
		if err := e.turnBoard(turned, true); err != nil {
			return CueClip{}, err
		}
		if turned.Grab.Reversed { // turned back, it wrote nothing
			for _, tr := range turned.Tracks {
				made = append(made, tr[0].File)
			}
		}
	}
	kind := "cue:shape:" + clip // a drag of the level is one Undo
	if sh.Reverse || sh.Normalize {
		kind = ""
	}
	var shaped CueClip
	err = e.Edit(id, kind, func(_ *Tape, s *State) error {
		i, err := s.cueAt(clip)
		if err != nil {
			return err
		}
		c := s.Cue.Clips[i].clone()
		if (turned != nil || sh.Normalize) && !sameLanes(c, before) {
			return ErrCueChanged
		}
		if turned != nil {
			c.take(turned) // its fades went round with the audio (turnBoard's swap)
		}
		if gain != nil {
			c.GainDB = math.Round(math.Max(-60, math.Min(audio.MaxNormalizeGainDB, *gain))*10) / 10
		}
		if sh.FadeIn != nil {
			c.FadeIn = min64(max64(0, *sh.FadeIn), c.Frames)
		}
		if sh.FadeOut != nil {
			c.FadeOut = min64(max64(0, *sh.FadeOut), c.Frames)
		}
		if sh.FadeInShape != nil {
			c.FadeInShape = *sh.FadeInShape
		}
		if sh.FadeOutShape != nil {
			c.FadeOutShape = *sh.FadeOutShape
		}
		c.Touched = true
		s.Cue.Clips[i] = c
		shaped = c
		return nil
	})
	if err != nil {
		for _, rel := range made {
			e.store.removePoolFile(rel)
		}
	}
	return shaped, err
}

// sameLanes says whether two copies of a cue clip play the same files over
// the same window.
func sameLanes(a, b CueClip) bool {
	if a.Frames != b.Frames || a.File != b.File || a.Src != b.Src || len(a.Lanes) != len(b.Lanes) {
		return false
	}
	for i := range a.Lanes {
		if a.Lanes[i].File != b.Lanes[i].File || a.Lanes[i].Src != b.Lanes[i].Src {
			return false
		}
	}
	return true
}

// CueDrop lays a cue clip on the tape as a drop lays the clipboard
// (DropClipboardAt): from track on, a lane a track (merge: every lane on the
// one track), at the playhead or at *at, replacing what's under it, with its
// handles, so the clips on the tape trim back out as far as the grab had.
// The clip stays on the lane, touched, in the same edit: one Undo takes
// back both.
func (e *Engine) CueDrop(id, clip string, track int, merge bool, at *int64) (Dropped, error) {
	c, err := e.cueClip(id, clip)
	if err != nil {
		return Dropped{}, err
	}
	return e.dropBoardWith(c.boardOf(), id, track, merge, at, func(s *State) error {
		i, err := s.cueAt(clip)
		if err != nil {
			return err
		}
		if !sameLanes(s.Cue.Clips[i], c) {
			return ErrCueChanged
		}
		s.Cue.Clips[i].Touched = true
		return nil
	})
}

// CueKeep is a cue clip's KEEP: it saved as a take in dir, from its own
// audio, as KeepClipboardTake keeps the buffer. Not an edit of the tape:
// the take's own Undo puts it in the trash.
func (e *Engine) CueKeep(id, clip, dir string, now time.Time) (KeptTake, error) {
	c, err := e.cueClip(id, clip)
	if err != nil {
		return KeptTake{}, err
	}
	label := "Cue · " + c.Name
	if c.Grab != nil && c.Grab.Take == "" {
		label = "Grab · " + strings.Join(c.Grab.Sources, " + ")
	}
	k, err := e.keepTake(c.boardOf(), label, dir, now)
	if err != nil {
		return KeptTake{}, err
	}
	e.mu.Lock()
	e.useCue(clip)
	e.mu.Unlock()
	return k, nil
}

// CueAudio is a cue clip's first minute, its lanes summed, as ClipboardAudio
// is the buffer's: what its Audition plays on this device.
func (e *Engine) CueAudio(id, clip string) ([]float32, error) {
	c, err := e.cueClip(id, clip)
	if err != nil {
		return nil, err
	}
	return e.boardAudio(c.boardOf())
}
