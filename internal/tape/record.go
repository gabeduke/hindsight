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
	Track  int    `json:"track"`
	Source string `json:"source"`
	State  string `json:"state"` // armed or on
	// From is the output frame it was asked for at: the punch starts at the
	// first bar line the tape plays from there.
	From uint64 `json:"from"`
}

var (
	ErrRecording    = errors.New("a track is already recording; end it first")
	ErrNotRecording = errors.New("nothing is recording")
)

// Record arms a track, or punches in if the tape is playing.
func (e *Engine) Record(id string, track int, source string) (Recording, error) {
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
	if _, err := t.Track(track); err != nil {
		return Recording{}, err
	}
	if _, ok := e.source(source); !ok {
		return Recording{}, fmt.Errorf("%w: no source %q", ErrBadParameter, source)
	}
	e.recMu.Lock()
	defer e.recMu.Unlock()
	if e.rec != nil {
		return *e.rec, ErrRecording
	}
	r := Recording{Track: track, Source: source, State: "armed"}
	if st := e.tr.Status(); st.Playing || st.CountIn > 0 {
		r.State, r.From = "on", e.delivered.Load()
	}
	e.rec = &r
	return r, nil
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
// track armed counts in and starts it; ■ during a punch ends it, keeping
// what it covered, which it answers.
func (e *Engine) Transport(id string, a Action) (*Clip, error) {
	if e.LoadedID() != id {
		return nil, ErrWrongTape
	}
	switch a.Kind {
	case "play":
		e.recMu.Lock()
		if e.rec != nil && e.rec.State == "armed" {
			a.CountIn = true
			e.rec.State, e.rec.From = "on", e.delivered.Load()
		}
		e.recMu.Unlock()
	case "stop":
		if r := e.Recording(); r != nil && r.State == "on" {
			clip, err := e.EndRecording(id, false)
			e.Do(a)
			return clip, err
		}
	}
	e.Do(a)
	return nil, nil
}

// EndRecording ends a punch, keeping what it covered unless cancel; an
// armed track is simply disarmed.
func (e *Engine) EndRecording(id string, cancel bool) (*Clip, error) {
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
	if t == nil || t.ID != id {
		return nil, ErrWrongTape
	}
	src, ok := e.source(r.Source)
	if !ok {
		return nil, fmt.Errorf("%w: no source %q", ErrBadParameter, r.Source)
	}
	outFrom, frames, at, err := e.recordedSpan(t, r.From, e.delivered.Load())
	if err != nil {
		return nil, err
	}
	clip, err := e.catchSpan(t, r.Track, src, outFrom, frames, at, false)
	if err != nil {
		return nil, err
	}
	return &clip, nil
}

// recordedSpan is what a punch from output frame from to end covered: the
// last full pass of the loop inside it, or else the bars from the first
// bar line the tape played to the last complete one, unbroken.
func (e *Engine) recordedSpan(t *Tape, from, end uint64) (uint64, int64, int64, error) {
	if t.Loop.On {
		var best *Cycle
		for _, c := range e.tr.Cycles() {
			if c.Out >= from && c.Out+uint64(c.Len) <= end {
				c := c
				best = &c
			}
		}
		if best != nil {
			return best.Out, best.Len, best.In, nil
		}
	}
	start, pos, ok := e.tr.firstBarLine(from, end, t.Grid)
	if !ok {
		return 0, 0, 0, fmt.Errorf("%w: the tape didn't reach a bar line while recording", ErrNotPlayed)
	}
	// Back from the end to the last bar line it played.
	p, playing := e.tr.PosAt(end)
	if !playing {
		return 0, 0, 0, fmt.Errorf("%w: it stopped while recording", ErrNotPlayed)
	}
	line := p
	if t.Grid != nil {
		line = t.Grid.BarStart(t.Grid.BarAt(p))
	}
	if t.Loop.On && p >= t.Loop.In && line < t.Loop.In {
		line = t.Loop.In // a wrap is a bar line too
	}
	stop := end - uint64(p-line)
	if stop <= start {
		return 0, 0, 0, fmt.Errorf("%w: not a whole bar was recorded", ErrNotPlayed)
	}
	if p0, ok := e.tr.continuous(start, stop, t.Loop); !ok || p0 != pos {
		return 0, 0, 0, fmt.Errorf("%w: it stopped or moved while recording", ErrNotPlayed)
	}
	frames := int64(stop - start)
	if t.Loop.On && frames > t.Loop.Len() {
		return 0, 0, 0, fmt.Errorf("%w: longer than the loop, and no full pass in it", ErrNotPlayed)
	}
	return start, frames, pos, nil
}
