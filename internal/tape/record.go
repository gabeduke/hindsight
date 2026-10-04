package tape

import (
	"errors"
	"fmt"
)

// Recording: arm and punch, as on the OP-1 -- except that nothing is
// recorded specially. The ring is always recording; a punch only notes when
// it was asked for, and when it ends, the span it covers is caught like any
// other.
//
//   - Rec while stopped arms a track. ▶ then counts in a bar and plays from
//     the playhead's bar.
//   - Rec while playing punches in at the next bar line.
//   - Rec again, or ■, ends it. With the loop on, it keeps the last full
//     pass it covered (the others are passes, still catchable); otherwise,
//     or if no pass was full, the bars from its first bar line to the last
//     complete one.

// Recording is a punch in progress, or an armed track waiting for ▶.
type Recording struct {
	Tape   string `json:"tape"`
	Track  int    `json:"track"`
	Source string `json:"source"`
	// Replace clears what's under the punch instead of layering on it.
	Replace bool   `json:"replace,omitempty"`
	State   string `json:"state"` // armed or on
	// From is the output frame it was asked for at, less a quarter second
	// for the tap and Wi-Fi: the punch starts at the first bar line the
	// tape plays from there.
	From uint64 `json:"from"`
}

// Kept is what ending a punch kept: its first clip (the part played first,
// if it was split where the loop wrapped) and how many frames in all.
type Kept struct {
	Clip   Clip  `json:"clip"`
	Frames int64 `json:"frames"`
	Track  int   `json:"track"`
}

// recLate is how long after a bar line a Rec still means that bar.
const recLate = 0.25

var (
	ErrRecording    = errors.New("a track is already recording; end it first")
	ErrNotRecording = errors.New("nothing is recording")
	// errNothingYet: a punch that ended before the tape reached a bar line
	// (in its count-in, say) kept nothing, which isn't a failure.
	errNothingYet = errors.New("nothing played yet")
)

// Record arms a track, or punches in if the tape is playing.
func (e *Engine) Record(id string, track int, source string, replace bool) (Recording, error) {
	if e.capture == nil {
		return Recording{}, ErrNoCapture
	}
	t := e.Loaded()
	if t == nil {
		return Recording{}, ErrNoTape
	}
	if t.ID != id {
		return Recording{}, ErrWrongTape
	}
	if t.Grid == nil {
		return Recording{}, fmt.Errorf("%w: a punch needs bars; set a tempo or make the first loop", ErrNoGrid)
	}
	if _, err := t.Track(track); err != nil {
		return Recording{}, err
	}
	if _, ok := e.source(source); !ok {
		return Recording{}, fmt.Errorf("%w: no source %q", ErrBadParameter, source)
	}
	e.recMu.Lock()
	defer e.recMu.Unlock()
	if e.mixdownBusy() { // under recMu, the order StartMixdown takes them in
		return Recording{}, ErrMixingDown
	}
	// Under the lock a load clears recordings under: the tape must still be
	// this one.
	if e.LoadedID() != id {
		return Recording{}, ErrWrongTape
	}
	if e.rec != nil {
		return *e.rec, ErrRecording
	}
	r := Recording{Tape: id, Track: track, Source: source, Replace: replace, State: "armed"}
	if st := e.tr.Status(); st.Playing || st.CountIn > 0 {
		r.State, r.From = "on", e.lateFrom()
	}
	e.rec = &r
	return r, nil
}

// lateFrom is the output frame heard now, less recLate.
func (e *Engine) lateFrom() uint64 {
	d := e.delivered.Load()
	late := uint64(recLate * float64(e.store.SampleRate()))
	if d < late {
		return 0
	}
	return d - late
}

// Recording reports the punch or armed track, if any.
func (e *Engine) Recording() *Recording {
	e.recMu.Lock()
	defer e.recMu.Unlock()
	if e.rec == nil {
		return nil
	}
	r := *e.rec
	return &r
}

// Transport carries out a transport action, minding a recording: ▶ with a
// track armed counts in and starts it; ■ during a punch stops the tape, then
// keeps what the punch covered, which it answers.
func (e *Engine) Transport(id string, a Action) (*Kept, error) {
	if e.LoadedID() != id {
		return nil, ErrWrongTape
	}
	switch a.Kind {
	case "play":
		e.recMu.Lock()
		if e.rec != nil && e.rec.State == "armed" && e.rec.Tape == id {
			a.CountIn = true
			e.rec.State, e.rec.From = "on", e.delivered.Load()
		}
		e.recMu.Unlock()
	case "stop":
		if r := e.Recording(); r != nil && r.State == "on" {
			// Stop first -- the position map remembers what played -- then
			// catch: the tape mustn't play on while the catch is written.
			end := e.delivered.Load()
			e.Do(a)
			return e.endRecordingAt(id, false, end)
		}
	}
	e.Do(a)
	return nil, nil
}

// EndRecording ends a punch, keeping what it covered unless cancel; an
// armed track is simply disarmed. A punch that kept nothing -- ended in its
// count-in -- answers nil.
func (e *Engine) EndRecording(id string, cancel bool) (*Kept, error) {
	return e.endRecordingAt(id, cancel, e.delivered.Load())
}

func (e *Engine) endRecordingAt(id string, cancel bool, end uint64) (*Kept, error) {
	e.recMu.Lock()
	r := e.rec
	e.rec = nil
	e.recMu.Unlock()
	if r == nil {
		return nil, ErrNotRecording
	}
	if cancel || r.State != "on" {
		return nil, nil
	}
	t := e.Loaded()
	if t == nil || t.ID != id || r.Tape != id {
		return nil, ErrWrongTape
	}
	src, ok := e.source(r.Source)
	if !ok {
		return nil, fmt.Errorf("%w: no source %q", ErrBadParameter, r.Source)
	}
	ps, err := e.recordedSpan(t, r.From, end)
	if errors.Is(err, errNothingYet) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var frames int64
	for _, p := range ps {
		frames += p.Len
	}
	// One file, placed piece by piece where each was played.
	placed, err := e.catchSpan(t, src, ps[0].Out, frames, ps[0].Pos, func(s *State, c Clip) ([]Clip, error) {
		var parts []Clip
		var off int64
		for _, p := range ps {
			part := c
			part.ID = ""
			part.At, part.Src, part.Frames = p.Pos, c.Src+off, p.Len
			off += p.Len
			parts = append(parts, part)
		}
		return s.PlaceTogether(r.Track, parts, r.Replace)
	})
	if err != nil {
		return nil, err
	}
	return &Kept{Clip: placed[0], Frames: frames, Track: r.Track}, nil
}

// recordedSpan is what a punch from output frame from to end covered, as
// the pieces of the position map it's placed by: the last full pass of the
// loop inside it; or else from the first bar line the tape played to the
// last complete bar before it stopped, moved or the punch ended -- carrying
// on through the loop's wraps, as they were then.
func (e *Engine) recordedSpan(t *Tape, from, end uint64) ([]piece, error) {
	if t.Loop.On {
		var best *Cycle
		for _, c := range e.tr.Cycles() {
			if c.Out >= from && c.Out+uint64(c.Len) <= end {
				c := c
				best = &c
			}
		}
		if best != nil {
			// A pass never wraps.
			return []piece{{Out: best.Out, Pos: best.In, Len: best.Len, Playing: true}}, nil
		}
	}
	start, _, ok := e.tr.firstBarLine(from, end, t.Grid)
	if !ok {
		return nil, errNothingYet
	}
	// Unbroken from there: playing, and every break a wrap.
	var keep []piece
	for i, p := range e.tr.pieces(start, end) {
		if !p.Playing || (i > 0 && !p.Wrap) {
			break
		}
		keep = append(keep, p)
	}
	// Back to the last bar line: inside the last piece, or the wrap it
	// began at.
	for len(keep) > 0 {
		last := &keep[len(keep)-1]
		pEnd := last.Pos + last.Len
		line := pEnd
		if t.Grid != nil {
			line = t.Grid.BarStart(t.Grid.BarAt(pEnd))
		}
		if line >= last.Pos {
			last.Len = line - last.Pos
			if last.Len == 0 {
				keep = keep[:len(keep)-1]
			}
			break
		}
		keep = keep[:len(keep)-1]
	}
	if len(keep) == 0 {
		return nil, fmt.Errorf("%w: not a whole bar was recorded", ErrNotPlayed)
	}
	return keep, nil
}
