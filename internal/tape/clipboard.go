package tape

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"math"
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
	Tracks [][]Clip `json:"tracks"`
	Frames int64    `json:"frames"`
	// BPM is the tempo of the take it was copied from, if that take has
	// one: a drop onto an empty tape counts bars by it. 0 for a copy from
	// the ring or a tape.
	BPM     float64   `json:"bpm,omitempty"`
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
			cl.poolFiles(into)
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

// Clipboard is what's on the clipboard, or nil -- and an error if the file
// can't be read, which only clearing it mends.
func (e *Engine) Clipboard() (*Clipboard, error) { return e.store.LoadClipboard() }

// tooLong refuses a copy longer than a track: it could never be dropped.
func (e *Engine) tooLong(frames int64) error {
	if l := e.store.length; frames > l {
		return lengthErr(frames, l, e.store.SampleRate())
	}
	return nil
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
	if err := e.tooLong(to - from); err != nil {
		return nil, err
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
	if _, err := audio.CopyWAVSpan(take, fileFrom, fileTo, pick, path); err != nil {
		return nil, err
	}
	c := &Clipboard{
		Tracks:  [][]Clip{{{File: rel, Src: from - fileFrom, Frames: to - from, Source: "take"}}},
		Frames:  to - from,
		From:    name,
		Created: time.Now(),
	}
	if m := audio.ReadMeta(take); m.BPM != nil {
		c.BPM = *m.BPM
	}
	return c, e.store.SaveClipboard(c)
}

// CopyRing puts ring frames [from, to) of a source onto the clipboard (to
// < 0: up to now; source "": MAIN, or the first source there is). A start
// that has left the ring moves to the oldest audio, a second in, as a save
// from the ribbon does; it answers whether it moved.
func (e *Engine) CopyRing(from, to int64, source string) (*Clipboard, bool, error) {
	if e.capture == nil {
		return nil, false, ErrNoCapture
	}
	if source == "" {
		source = "main"
		if _, ok := e.source(source); !ok && len(e.sources) > 0 {
			source = e.sources[0].Name
		}
	}
	src, ok := e.source(source)
	if !ok {
		return nil, false, fmt.Errorf("%w: no source %q", ErrBadParameter, source)
	}
	sr := int64(e.store.SampleRate())
	over := int64(OverhangSeconds * float64(sr))
	r := e.capture.Ring()
	oldest, total := r.Window()
	if to < 0 {
		to = int64(total)
	}
	clamped := false
	if margin := int64(oldest) + sr; from < margin && oldest > 0 {
		from, clamped = margin, true
	}
	if to <= from {
		return nil, false, fmt.Errorf("%w: that span has left the buffer", ErrGone)
	}
	if to > int64(total) {
		return nil, false, ErrNotYet
	}
	if err := e.tooLong(to - from); err != nil {
		return nil, false, err
	}
	if err := e.diskOK(); err != nil {
		return nil, false, err
	}
	lo, hi := max64(int64(oldest), from-over), min64(int64(total), to+over)
	rel, path, err := e.store.NewPoolFile("copy", time.Now())
	if err != nil {
		return nil, false, err
	}
	peak, err := audio.WriteSpan(r, uint64(lo), uint64(hi), src.Pair[:], path, int(sr))
	if err != nil {
		return nil, false, err
	}
	c := &Clipboard{
		Tracks:  [][]Clip{{{File: rel, Src: from - lo, Frames: to - from, Source: src.Name, PeakDB: peakDB(peak)}}},
		Frames:  to - from,
		From:    "the ribbon (" + src.Name + ")",
		Created: time.Now(),
	}
	return c, clamped, e.store.SaveClipboard(c)
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
// end. merge drops every clipboard track onto the one track instead,
// layered, each clip at its own level: the OP-1's merge drop.
func (e *Engine) DropClipboard(id string, track int, merge bool) (Dropped, error) {
	c, err := e.Clipboard()
	if err != nil {
		return Dropped{}, err
	}
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
	spans := len(c.Tracks) // how many tracks it lands on
	if merge {
		spans = 1
	}
	if track < 1 || track+spans-1 > len(t.Tracks) {
		return Dropped{}, fmt.Errorf("%w: %d track%s from track %d don't fit", ErrNoSuchTrack, spans, plural(spans), track)
	}
	// Where the playhead is: what's heard while playing; the bar line it
	// stands at during a count-in; else where it was put.
	st := e.tr.Status()
	moving := st.Playing || st.CountIn > 0
	at := st.Pos
	if st.Playing {
		at = e.Live().Heard
	}
	sr := e.store.SampleRate()
	near := e.lastBPM(id) // before the edit: it reads every tape
	var out Dropped
	err = e.Edit(id, "", func(tp *Tape, s *State) error {
		if tp.Empty() && s.Grid == nil && c.Frames > firstLoopMaxSeconds*int64(sr) {
			// Too long to be a loop: laid down as it is, loop off. With the
			// take's tempo the tape has it; without, it has none.
			if validBPM(c.BPM) {
				g := GridFor(c.BPM, sendGridBars, sr)
				s.Grid = &g
			}
			s.Loop = Loop{}
			at = 0
		} else if tp.Empty() && s.Grid == nil {
			bars := barsFor(c.Frames, sr, c.BPM, near)
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
			return roomErr(tp.Length-at, tp.Length, sr)
		}
		// Clear the span on each track, then lay the clipboard's clips in.
		for i := 0; i < spans; i++ {
			tr := &s.Tracks[track-1+i]
			tr.Clips = clearRange(tr.Clips, at, at+c.Frames)
		}
		for i, clips := range c.Tracks {
			to := track + i
			if merge {
				to = track
			}
			for _, cl := range clips {
				cl.ID = ""
				cl.At += at
				placed, err := s.Place(to, cl, false)
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
	out.Tracks, out.End = spans, at+c.Frames
	if !moving {
		// Before answering, so a second drop right after lands after it.
		e.doWait(Action{Kind: "locate", Pos: out.End})
	}
	return out, nil
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// auditionSeconds caps an audition: enough to hear what's there.
const auditionSeconds = 60

// ClipboardAudio is the clipboard's first minute, every track summed, as
// interleaved stereo, read straight from the pool -- not through the
// engine's own, which would keep it all in memory.
func (e *Engine) ClipboardAudio() ([]float32, error) {
	c, err := e.Clipboard()
	if err != nil {
		return nil, err
	}
	if c.Empty() {
		return nil, ErrEmptyClipboard
	}
	n := min64(c.Frames, int64(auditionSeconds*e.store.SampleRate()))
	out := make([]float32, 2*n)
	for _, clips := range c.Tracks {
		for _, cl := range clips {
			from, to := max64(0, cl.At), min64(n, cl.End())
			if to <= from {
				continue
			}
			path := e.store.AudioPath(cl.File)
			info, err := audio.ReadWAVInfo(path)
			if err != nil {
				return nil, err
			}
			ch := info.Channels
			g := float32(math.Pow(10, cl.GainDB/20))
			start := cl.Src + (from - cl.At) // the file frame that plays at from
			_, err = audio.ReadFrames(path, start, start+(to-from), 1<<14, func(b []int32, first int64) error {
				for i := 0; i < len(b)/ch; i++ {
					l := float32(float64(b[i*ch]) / 2147483648.0)
					r := l
					if ch > 1 {
						r = float32(float64(b[i*ch+1]) / 2147483648.0)
					}
					k := from + (first - start) + int64(i)
					if k >= 0 && k < n {
						out[2*k] += l * g
						out[2*k+1] += r * g
					}
				}
				return nil
			})
			if err != nil {
				return nil, err
			}
		}
	}
	return out, nil
}
