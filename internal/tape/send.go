package tape

import (
	"fmt"
	"math"
)

// Sending a take to the tape. A take that knows its tempo goes onto the tape
// on the tape's bar lines: the take's downbeat on a bar line, a count-in
// before it in the bars ahead, laid down whole and linear -- no loop -- and,
// on an empty tape, the tape takes the take's tempo. A take with no tempo
// is the older drop: a short selection is the first loop and sets the tempo.

const (
	// firstLoopMaxSeconds is the longest span that becomes a tape's first
	// loop. Anything longer is laid down linear, loop off: a jam isn't a loop.
	firstLoopMaxSeconds = 60

	// tempoTolerance is how far a take's tempo can be from the tape's, as a
	// fraction, and still count as the same tempo: 0.1%, which drifts about a
	// quarter of a second in seven minutes. Tempos are measured, not set, so
	// two takes of one song differ by a few hundredths of a BPM.
	tempoTolerance = 0.001

	// sendGridBars is the bar count a tape given its tempo by a take starts
	// with, as a tape made from the empty-tape form does.
	sendGridBars = 4
)

// Send modes: how a send landed.
const (
	SendOnGrid    = "grid"       // on the tape's bar lines, at the take's tempo
	SendFirstLoop = "first-loop" // a short span with no tempo: the first loop
	SendLinear    = "linear"     // a long span with no tempo: loop off, no tempo
	SendAsIs      = "as-is"      // at the playhead, nothing lined up
)

// SendRequest is a send: frames [From, To) of a take.
type SendRequest struct {
	Take     string // the take's path
	From, To int64
	Track    int
	BPM      float64 // the take's tempo; 0 when it has none
	Downbeat int64   // the take's bar 1, in take frames
	Pick     []int
}

// Sent is what a send did.
type Sent struct {
	Clip Clip   `json:"clip"`
	Mode string `json:"mode"`
	// BPM is the tape's tempo afterwards; 0 when it has none.
	BPM float64 `json:"bpm,omitempty"`
	// TempoSet: the take gave the tape its tempo.
	TempoSet bool `json:"tempo_set,omitempty"`
	// Bar is the tape bar (from 1) the take's downbeat landed on, in on-grid
	// sends. Absent when the downbeat isn't in what was sent (a selection
	// that starts after it, or ends before it).
	Bar int64 `json:"bar,omitempty"`
	// Warning is something the owner should know: the tempo didn't match.
	Warning string `json:"warning,omitempty"`
	End     int64  `json:"end"`
}

func validBPM(bpm float64) bool { return bpm >= 20 && bpm <= 400 }

// SameTempo reports whether two tempos are the same, to a thousandth.
func SameTempo(a, b float64) bool {
	return a > 0 && b > 0 && math.Abs(a-b) <= tempoTolerance*math.Max(a, b)
}

// GridPlacement is where on the tape a span of a take starts, so the take's
// bar lines fall on the tape's. anchor is the tape bar line the take's bar 1
// goes on (0 on a new tape); from is where the span starts in the take,
// downbeat its bar 1, bpm its tempo. It answers the tape frame the span
// starts at and the tape bar (from 0) that bar 1 landed on.
//
// The span keeps its place in the take's bar: a span that starts in the
// pickup before the downbeat sits that far before the anchor -- in the bar
// before it -- and a span that starts after the downbeat sits as far past
// the bar line before it as it does in the take. If that would be before
// the tape's start, the whole thing moves on by whole bars, to the first bar
// line that leaves room, so nothing is cut off.
func GridPlacement(g Grid, anchor, from, downbeat int64, bpm float64, sampleRate int) (at, bar int64) {
	bar = g.BarAt(anchor)
	// The take's bar line at or before the span's start, counted from the
	// downbeat; everything before the downbeat counts as the bar before.
	line := downbeat
	if from > downbeat {
		barT := 4 * 60 * float64(sampleRate) / bpm
		line = downbeat + int64(math.Round(math.Floor(float64(from-downbeat)/barT)*barT))
		if line > from { // rounding
			line = from
		}
	}
	off := from - line // ≥ 0 after the downbeat; negative in a pickup
	at = g.BarStart(bar) + off
	if at < 0 {
		// Whole bars on: jump near, then step to the exact bar line.
		bar += int64(math.Floor(float64(-at) / g.BarFrames()))
		for at = g.BarStart(bar) + off; at < 0; at = g.BarStart(bar) + off {
			bar++
		}
	}
	return at, bar
}

// minutesText says a track's length in words: "20 minutes", "5.5 minutes".
func minutesText(frames int64, sampleRate int) string {
	m := float64(frames) / float64(sampleRate) / 60
	if m == 1 {
		return "1 minute"
	}
	if m == math.Trunc(m) {
		return fmt.Sprintf("%.0f minutes", m)
	}
	return fmt.Sprintf("%.1f minutes", m)
}

// clockText is a span as m:ss.
func clockText(frames int64, sampleRate int) string {
	s := int64(math.Round(float64(frames) / float64(sampleRate)))
	return fmt.Sprintf("%d:%02d", s/60, s%60)
}

// lengthErr is the refusal for a span that can't fit on a track: what it
// is, the limit in minutes and the setting that raises it.
func lengthErr(frames, length int64, sampleRate int) error {
	return fmt.Errorf("%w: that's %s, and a tape track holds %s. Raise TAPE_LENGTH_S (now %d) in the Pi's settings to make room",
		ErrBadParameter, clockText(frames, sampleRate), minutesText(length, sampleRate), length/int64(sampleRate))
}

// roomErr is the refusal for a span that fits a track but not from where it
// would start.
func roomErr(room, length int64, sampleRate int) error {
	if room < 0 {
		room = 0
	}
	return fmt.Errorf("%w: only %s is left from there, and a tape track holds %s (TAPE_LENGTH_S)",
		ErrPastTheEnd, clockText(room, sampleRate), minutesText(length, sampleRate))
}

// SendTake puts a take's span on a track of the loaded tape; see the top of
// this file for where. The playhead moves to the start of what was sent,
// unless the tape is playing.
func (e *Engine) SendTake(id string, req SendRequest) (Sent, error) {
	t := e.Loaded()
	if t == nil {
		return Sent{}, ErrNoTape
	}
	if t.ID != id {
		return Sent{}, ErrWrongTape
	}
	if _, err := t.Track(req.Track); err != nil {
		return Sent{}, err
	}
	frames := req.To - req.From
	if frames > t.Length {
		return Sent{}, lengthErr(frames, t.Length, t.SampleRate)
	}
	if !validBPM(req.BPM) {
		// No tempo to go by: the first-loop drop, or linear if it's long.
		clip, mode, err := e.dropTake(id, req.Take, req.From, req.To, req.Track, 0, req.Pick)
		if err != nil {
			return Sent{}, err
		}
		out := Sent{Clip: clip, Mode: mode, End: clip.End()}
		if tp := e.Loaded(); tp != nil && tp.Grid != nil {
			out.BPM = tp.Grid.BPM(tp.SampleRate)
		}
		return out, nil
	}

	clip, err := e.copyTake(req.Take, req.From, req.To, req.Pick, "drop")
	if err != nil {
		return Sent{}, err
	}
	clip.Source = "take"
	sr := e.store.SampleRate()
	// Where the playhead is, as a drop reads it.
	st := e.tr.Status()
	playing := st.Playing || st.CountIn > 0
	pos := st.Pos
	if st.Playing {
		pos = e.Live().Heard
	}

	var out Sent
	err = e.Edit(id, "", func(tp *Tape, s *State) error {
		out = Sent{} // Edit may run this once only, but be sure
		var anchor int64
		switch {
		case tp.Empty():
			// A tape with no audio has no tempo to keep: the take's gives it
			// one, unless it already has the same, which stays as it is. And
			// no loop: this is a take, not a loop.
			if s.Grid == nil || !SameTempo(s.Grid.BPM(sr), req.BPM) {
				g := GridFor(req.BPM, sendGridBars, sr)
				s.Grid = &g
				out.TempoSet = true
			}
			s.Loop = Loop{}
			tp.Click = false
			anchor = 0
		case s.Grid != nil && SameTempo(s.Grid.BPM(sr), req.BPM):
			anchor = s.Grid.NextBar(pos)
		default:
			out.Mode, clip.At = SendAsIs, pos
			if s.Grid == nil {
				out.Warning = "The tape has no tempo, so this went at the playhead, not on a bar line."
			} else {
				out.Warning = fmt.Sprintf("The take is %.2f BPM and the tape is %.2f, so this went at the playhead, not on a bar line, and runs at its own tempo.",
					req.BPM, s.Grid.BPM(sr))
			}
		}
		if out.Mode == "" {
			out.Mode = SendOnGrid
			clip.At, _ = GridPlacement(*s.Grid, anchor, req.From, req.Downbeat, req.BPM, sr)
			// The downbeat's bar, only if the downbeat is in the clip: a
			// selection after it sits on the bar lines but has no bar 1.
			if d := clip.At + req.Downbeat - req.From; d >= clip.At && d < clip.End() {
				out.Bar = int64(math.Round(float64(d)/s.Grid.BarFrames())) + 1
			}
		}
		if clip.End() > tp.Length {
			return roomErr(tp.Length-clip.At, tp.Length, sr)
		}
		placed, err := s.Place(req.Track, clip, true)
		if err != nil {
			return err
		}
		out.Clip = placed
		if s.Grid != nil {
			out.BPM = s.Grid.BPM(sr)
		}
		return nil
	})
	if err != nil {
		return Sent{}, err
	}
	out.End = out.Clip.End()
	if !playing {
		e.doWait(Action{Kind: "locate", Pos: out.Clip.At})
	}
	return out, nil
}
