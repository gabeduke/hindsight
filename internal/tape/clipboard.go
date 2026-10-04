package tape

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// The clipboard: the app's one, shared by takes, the ribbon and tapes
// (editing model). It holds clips in the pool, laid out from frame 0 -- one
// track's worth, or more -- and persists in TAPE_DIR, as the OP-1 Field's
// does. Copying from a take or the ring writes the pool first (a take's WAV
// is never referenced: flag edits rewrite it in place); the pool's
// clean-up treats it as a root.

// Clipboard is what was copied.
type Clipboard struct {
	Tracks  [][]Clip  `json:"tracks"`
	Frames  int64     `json:"frames"`
	From    string    `json:"from"` // where it came from, in words
	Created time.Time `json:"created"`
}

var ErrEmptyClipboard = errors.New("the clipboard is empty: copy something first")

// Empty reports whether there's nothing to drop.
func (c *Clipboard) Empty() bool { return c == nil || c.Frames <= 0 || len(c.Tracks) == 0 }

func (c *Clipboard) files(into map[string]bool) {
	if c == nil {
		return
	}
	for _, tr := range c.Tracks {
		for _, cl := range tr {
			into[cl.File] = true
		}
	}
}

func (s *Store) clipboardPath() string { return filepath.Join(s.dir, "clipboard.json") }

// LoadClipboard reads the clipboard; nil when there's none.
func (s *Store) LoadClipboard() (*Clipboard, error) {
	b, err := os.ReadFile(s.clipboardPath())
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var c Clipboard
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("clipboard: %w", err)
	}
	return &c, nil
}

// SaveClipboard replaces the clipboard (nil clears it).
func (s *Store) SaveClipboard(c *Clipboard) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c == nil {
		err := os.Remove(s.clipboardPath())
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return writeSynced(s.clipboardPath(), b)
}

// Clipboard is what's on the clipboard, or nil.
func (e *Engine) Clipboard() *Clipboard {
	c, err := e.store.LoadClipboard()
	if err != nil {
		return nil
	}
	return c
}

// ClearClipboard empties it.
func (e *Engine) ClearClipboard() error { return e.store.SaveClipboard(nil) }

// CopyTake puts frames [from, to) of a take onto the clipboard: its pair
// written into the pool, with the overhang the crossfades need.
func (e *Engine) CopyTake(take, name string, from, to int64, pick []int) (*Clipboard, error) {
	info, err := audio.ReadWAVInfo(take)
	if err != nil {
		return nil, err
	}
	if info.SampleRate != e.store.SampleRate() {
		return nil, fmt.Errorf("%w: the take is at %d Hz, tapes at %d", ErrBadParameter, info.SampleRate, e.store.SampleRate())
	}
	if from < 0 || to <= from || to > info.Frames() {
		return nil, fmt.Errorf("%w: that span isn't in the take", ErrBadParameter)
	}
	if err := e.diskOK(); err != nil {
		return nil, err
	}
	over := int64(OverhangSeconds * float64(info.SampleRate))
	fileFrom, fileTo := max64(0, from-over), min64(info.Frames(), to+over)
	rel, path, err := e.store.NewPoolFile("copy", time.Now())
	if err != nil {
		return nil, err
	}
	if err := audio.CopyWAVSpan(take, fileFrom, fileTo, pick, path); err != nil {
		return nil, err
	}
	c := &Clipboard{
		Tracks:  [][]Clip{{{File: rel, Src: from - fileFrom, Frames: to - from, Source: "take"}}},
		Frames:  to - from,
		From:    name,
		Created: time.Now(),
	}
	return c, e.store.SaveClipboard(c)
}

// CopyRing puts ring frames [from, to) of a source onto the clipboard.
func (e *Engine) CopyRing(from, to int64, source string) (*Clipboard, error) {
	if e.capture == nil {
		return nil, ErrNoCapture
	}
	src, ok := e.source(source)
	if !ok {
		return nil, fmt.Errorf("%w: no source %q", ErrBadParameter, source)
	}
	if to <= from {
		return nil, fmt.Errorf("%w: an empty span", ErrBadParameter)
	}
	if err := e.diskOK(); err != nil {
		return nil, err
	}
	sr := int64(e.store.SampleRate())
	over := int64(OverhangSeconds * float64(sr))
	r := e.capture.Ring()
	oldest, total := r.Window()
	lo, hi := max64(int64(oldest), from-over), min64(int64(total), to+over)
	if from < int64(oldest) {
		return nil, ErrGone
	}
	if to > int64(total) {
		return nil, ErrNotYet
	}
	rel, path, err := e.store.NewPoolFile("copy", time.Now())
	if err != nil {
		return nil, err
	}
	if err := audio.WriteSpan(r, uint64(lo), uint64(hi), src.Pair[:], path, int(sr)); err != nil {
		return nil, err
	}
	c := &Clipboard{
		Tracks:  [][]Clip{{{File: rel, Src: from - lo, Frames: to - from, Source: src.Name}}},
		Frames:  to - from,
		From:    "the ribbon (" + src.Name + ")",
		Created: time.Now(),
	}
	return c, e.store.SaveClipboard(c)
}

func (e *Engine) diskOK() error {
	if e.minFreeGB > 0 {
		if free, _ := audio.FreeGB(e.store.Dir()); free < e.minFreeGB {
			return fmt.Errorf("%w: %.2f GB free where the tapes are, need %.2f GB", audio.ErrLowDisk, free, e.minFreeGB)
		}
	}
	return nil
}

// Dropped is what a drop placed: its first clip, on the first of its tracks,
// and where the playhead was left.
type Dropped struct {
	Clip   Clip  `json:"clip"`
	Tracks int   `json:"tracks"`
	End    int64 `json:"end"` // the tape frame after it
}

// DropClipboard places the clipboard on the loaded tape from track on (one
// track per clipboard track), replacing what's under it: at the playhead,
// or -- on an empty tape with no tempo -- as its first loop. Stopped, the
// playhead moves to the drop's end, so drop, drop, drop lays copies end to
// end.
func (e *Engine) DropClipboard(id string, track int) (Dropped, error) {
	c := e.Clipboard()
	if c.Empty() {
		return Dropped{}, ErrEmptyClipboard
	}
	t := e.Loaded()
	if t == nil {
		return Dropped{}, ErrNoTape
	}
	if t.ID != id {
		return Dropped{}, ErrWrongTape
	}
	if track < 1 || track+len(c.Tracks)-1 > len(t.Tracks) {
		return Dropped{}, fmt.Errorf("%w: %d track%s from track %d don't fit", ErrNoSuchTrack, len(c.Tracks), plural(len(c.Tracks)), track)
	}
	st := e.tr.Status()
	at := st.Pos
	if st.Playing {
		at = e.Live().Heard
	}
	sr := e.store.SampleRate()
	var out Dropped
	err := e.Edit(id, "", func(tp *Tape, s *State) error {
		if tp.Empty() && s.Grid == nil {
			bars := guessBarsNear(c.Frames, sr, e.lastBPM(id))
			g := Grid{Frames: c.Frames, Bars: bars}
			if bpm := g.BPM(sr); bpm < 20 || bpm > 400 {
				return fmt.Errorf("%w: %.2f s doesn't make a tempo of 20–400 BPM", ErrBadParameter, float64(c.Frames)/float64(sr))
			}
			s.Grid = &g
			s.Loop = Loop{In: 0, Out: c.Frames, On: true}
			at = 0
		}
		if tp.Empty() {
			tp.Click = false
		}
		if at+c.Frames > tp.Length {
			return fmt.Errorf("%w: %.1f s of room is left after the playhead", ErrPastTheEnd, float64(tp.Length-at)/float64(sr))
		}
		// Clear the span on each track, then lay the clipboard's clips in.
		for i, clips := range c.Tracks {
			tr := &s.Tracks[track-1+i]
			for l := 0; l < 64; l++ {
				tr.Clips = cutRange(tr.Clips, l, at, at+c.Frames)
			}
			for _, cl := range clips {
				cl.ID = ""
				cl.At += at
				placed, err := s.Place(track+i, cl, false)
				if err != nil {
					return err
				}
				if out.Clip.ID == "" {
					out.Clip = placed
				}
			}
		}
		return nil
	})
	if err != nil {
		return Dropped{}, err
	}
	out.Tracks, out.End = len(c.Tracks), at+c.Frames
	if !st.Playing {
		e.Do(Action{Kind: "locate", Pos: out.End})
	}
	return out, nil
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// ClipboardAudio renders the clipboard, its tracks summed, for auditioning:
// emit gets interleaved stereo float32 blocks.
func (e *Engine) ClipboardAudio(emit func([]float32) error) (int64, error) {
	c := e.Clipboard()
	if c.Empty() {
		return 0, ErrEmptyClipboard
	}
	st := State{Tracks: make([]Track, len(c.Tracks))}
	for i, clips := range c.Tracks {
		st.Tracks[i] = Track{N: i + 1, Bus: BusA, Clips: clips}
	}
	m := NewMix(st, e.pool, e.store.SampleRate())
	buf := make([]float32, BlockFrames*OutChannels)
	out := make([]float32, BlockFrames*2)
	for pos := int64(0); pos < c.Frames; pos += BlockFrames {
		n := int(min64(BlockFrames, c.Frames-pos))
		clear(buf)
		m.Render(buf, pos, n)
		for i := 0; i < n; i++ {
			out[2*i], out[2*i+1] = buf[i*OutChannels], buf[i*OutChannels+1]
		}
		if err := emit(out[:2*n]); err != nil {
			return 0, err
		}
	}
	return c.Frames, nil
}
