// Package tape is Hindsight's OP-1-style tape: four tracks of clips that play
// back through the Sidekick, recorded by catching spans of the ring after the
// fact. The design is docs/superpowers/specs/2026-10-03-tape-design.md.
//
// A tape is a timeline of clips; each clip is a window onto an immutable WAV
// in a shared audio pool, so every edit -- a catch, a drop, a gain -- is an
// edit of tape.json, and undo is a list of earlier versions of it.
//
// This package imports internal/audio and never internal/midi: what it needs
// from MIDI comes through small interfaces main wires, the same firewall the
// saver keeps.
package tape

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"slices"
	"sort"
	"time"
)

// Version is tape.json's schema version.
const Version = 1

// MaxHistory is how many earlier versions undo keeps.
const MaxHistory = 100

// coalesceWindow is how close two changes of the same kind must be to count
// as one undo step: dragging a gain or pan is one step, not a hundred.
const coalesceWindow = 2 * time.Second

// BeatsPerBar: the tape is in 4/4.
const BeatsPerBar = 4

// Buses: a track plays through one of the Sidekick's two strips.
const (
	BusA = "A"
	BusB = "B"
)

// DefaultTrackGainDB is where a new track starts: the strips add gain to the
// returns, and a full-scale loop sent back in would clip at the tap.
const DefaultTrackGainDB = -6

var (
	ErrNoGrid       = errors.New("the tape has no tempo yet")
	ErrPastTheEnd   = errors.New("that runs past the end of the tape")
	ErrNoSuchTrack  = errors.New("no such track")
	ErrNoSuchClip   = errors.New("no such clip")
	ErrNothingToDo  = errors.New("nothing to undo")
	ErrBadLoop      = errors.New("the loop's out must be after its in")
	ErrBadParameter = errors.New("bad parameter")
)

// Grid is the first loop that fixed the tempo: its length in frames is the
// truth, and the tempo is derived from it, because tempos don't divide into
// whole frames (a bar at 84 BPM is 137,142.857 frames).
type Grid struct {
	Frames int64 `json:"frames"` // the loop's length
	Bars   int   `json:"bars"`   // how many bars it is
}

// BarFrames is the length of a bar, in fractional frames.
func (g Grid) BarFrames() float64 { return float64(g.Frames) / float64(g.Bars) }

// BarStart is where bar n (from 0) begins: round(n × barFrames), so bar lines
// land on the same frames however they're counted.
func (g Grid) BarStart(n int64) int64 { return int64(math.Round(float64(n) * g.BarFrames())) }

// BeatStart is where beat n (from 0) begins.
func (g Grid) BeatStart(n int64) int64 {
	return int64(math.Round(float64(n) * g.BarFrames() / BeatsPerBar))
}

// BPM is the tempo the grid implies at a sample rate.
func (g Grid) BPM(sampleRate int) float64 {
	return float64(g.Bars*BeatsPerBar) * 60 * float64(sampleRate) / float64(g.Frames)
}

// BarAt is the bar a tape frame is in, and NextBar the first bar line at or
// after it.
// BarAt agrees with BarStart's rounding: a bar line belongs to the bar it
// starts.
func (g Grid) BarAt(pos int64) int64 {
	n := int64(math.Floor(float64(pos) / g.BarFrames()))
	for g.BarStart(n+1) <= pos {
		n++
	}
	for g.BarStart(n) > pos {
		n--
	}
	return n
}
func (g Grid) NextBar(pos int64) int64 {
	n := g.BarAt(pos)
	if g.BarStart(n) < pos {
		n++
	}
	return g.BarStart(n)
}

// NextBeat is the first beat line at or after pos.
func (g Grid) NextBeat(pos int64) int64 {
	n := int64(math.Floor(float64(pos) / (g.BarFrames() / BeatsPerBar)))
	for g.BeatStart(n) < pos {
		n++
	}
	return g.BeatStart(n)
}

// GridFor makes the grid a tempo implies: bars of 4/4 at bpm.
func GridFor(bpm float64, bars, sampleRate int) Grid {
	frames := int64(math.Round(float64(bars*BeatsPerBar) * 60 * float64(sampleRate) / bpm))
	return Grid{Frames: frames, Bars: bars}
}

// Loop is the selection and whether playback wraps inside it: the OP-1's In,
// Out and loop keys.
type Loop struct {
	In  int64 `json:"in"`
	Out int64 `json:"out"`
	On  bool  `json:"on"`
}

// Len is the loop's length in frames.
func (l Loop) Len() int64 { return l.Out - l.In }

// Clip is a window onto an immutable WAV in the audio pool, placed on a track.
type Clip struct {
	ID     string  `json:"id"`
	File   string  `json:"file"`   // relative to the tape store: audio/catch_….wav
	Src    int64   `json:"src"`    // the clip's first frame in the file; before it is overhang
	Frames int64   `json:"frames"` // how much of the file it plays
	At     int64   `json:"at"`     // the tape frame it starts at
	Layer  int     `json:"layer"`  // 0 is the base; catches onto audio add layers, summed
	GainDB float64 `json:"gain_db"`
	// NudgeMS moves the clip by milliseconds, for a part early or late on
	// purpose, or one caught without an exact alignment.
	NudgeMS float64 `json:"nudge_ms,omitempty"`
	Source  string  `json:"source,omitempty"`  // the capture pair it came from: aux, main, ch1, ch2, or a take
	Clean   bool    `json:"clean,omitempty"`   // no tape bus was leaking into that source
	Aligned string  `json:"aligned,omitempty"` // how the catch was lined up: exact (the demo), locked or estimated (6b); "" for a drop
	// PeakDB is the loudest sample of what was caught, overhang and all, in
	// dBFS (-120 for digital silence and below): so a catch from a source
	// with nothing in it says so. Unset for audio that came another way.
	// Never changed in place, so the halves of a split can share it.
	PeakDB *float64 `json:"peak_db,omitempty"`
	// Reversed is set on a clip playing backwards: its File is a reversed
	// copy of the one it came from, which this names. Never changed in
	// place, so a copy of a clip can share it.
	Reversed *Reversal `json:"reversed,omitempty"`
	// FadeIn and FadeOut shape the clip's ends, in frames: an equal-power
	// rise from silence over its first FadeIn frames, and a fall over its
	// last FadeOut. 0 is none; the 3 ms declick, or a crossfade where it
	// meets audio, applies under either way. A clip cut in two keeps each
	// fade on the piece with that end.
	FadeIn  int64 `json:"fade_in,omitempty"`
	FadeOut int64 `json:"fade_out,omitempty"`
}

// fades are a clip's fades as they play: no longer than the clip between
// them, the two shortened alike when they'd overlap.
func (c Clip) fades() (in, out int64) {
	in, out = max64(0, c.FadeIn), max64(0, c.FadeOut)
	if in+out > c.Frames && in+out > 0 {
		in = c.Frames * in / (in + out)
		out = c.Frames - in
	}
	return in, out
}

// fadeGain is an equal-power fade's gain local frames into a clip of frames
// frames, with in and out frames of fade (Clip.fades): sin of a quarter
// turn as it rises, the same as it falls.
func fadeGain(local, frames, in, out int64) float64 {
	// Outside the clip a faded edge has faded: the loop's wrap reads a little
	// past a clip's end, where the sine would turn negative.
	if left := frames - local; (in > 0 && local < 0) || (out > 0 && left <= 0) {
		return 0
	}
	g := 1.0
	if in > 0 && local < in {
		g *= math.Sin((float64(local) + 0.5) / float64(in) * math.Pi / 2)
	}
	if left := frames - local; out > 0 && left <= out {
		g *= math.Sin((float64(left) - 0.5) / float64(out) * math.Pi / 2)
	}
	return g
}

// Reversal says where a reversed clip's audio came from: frame i of the
// reversed file is frame End-1-i of File.
type Reversal struct {
	File string `json:"file"`
	End  int64  `json:"end"`
}

// poolFiles marks every pool file the clip needs: the one it plays, and the
// one a reversed clip turns back to. Anything that keeps pool files --
// clean-up, the clipboard, the engine's memory -- asks this.
func (c Clip) poolFiles(into map[string]bool) {
	into[c.File] = true
	if c.Reversed != nil {
		into[c.Reversed.File] = true
	}
}

// End is the tape frame after the clip's last.
func (c Clip) End() int64 { return c.At + c.Frames }

// Track is one lane: its clips and how it's mixed into its bus.
type Track struct {
	N      int     `json:"n"`
	Name   string  `json:"name,omitempty"`
	Bus    string  `json:"bus"`
	GainDB float64 `json:"gain_db"`
	Pan    float64 `json:"pan"` // -1 left .. 1 right
	Mute   bool    `json:"mute,omitempty"`
	Solo   bool    `json:"solo,omitempty"`
	Clips  []Clip  `json:"clips"`
}

// State is the undoable part of a tape.
type State struct {
	Grid   *Grid   `json:"grid"`
	Loop   Loop    `json:"loop"`
	Tracks []Track `json:"tracks"`
}

// clone is a deep copy, for undo.
func (s State) clone() State {
	out := State{Loop: s.Loop, Tracks: make([]Track, len(s.Tracks))}
	if s.Grid != nil {
		g := *s.Grid
		out.Grid = &g
	}
	for i, t := range s.Tracks {
		t.Clips = append(make([]Clip, 0, len(t.Clips)), t.Clips...) // never nil: [] in JSON
		out.Tracks[i] = t
	}
	return out
}

// Tape is one tape.json.
type Tape struct {
	Version    int       `json:"version"`
	ID         string    `json:"id"` // its folder's name
	Name       string    `json:"name"`
	SampleRate int       `json:"sample_rate"`
	Length     int64     `json:"length"` // frames a track can hold
	Created    time.Time `json:"created"`
	Click      bool      `json:"click,omitempty"`
	State
	History []State `json:"history,omitempty"` // earlier versions, oldest first
	Future  []State `json:"future,omitempty"`  // undone versions, for redo

	lastKind string    // the last change's kind, for coalescing
	lastAt   time.Time // and when it was
}

// NewTape makes an empty tape of n tracks, every one on bus A at -6 dB.
func NewTape(id, name string, sampleRate int, length int64, tracks int, now time.Time) *Tape {
	t := &Tape{Version: Version, ID: id, Name: name, SampleRate: sampleRate, Length: length, Created: now, Click: true}
	for i := 1; i <= tracks; i++ {
		t.Tracks = append(t.Tracks, Track{N: i, Bus: BusA, GainDB: DefaultTrackGainDB, Clips: []Clip{}})
	}
	return t
}

// NewClipID makes a clip id: "c" and eight hex characters.
func NewClipID() string {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("c%08x", uint32(time.Now().UnixNano()))
	}
	return "c" + hex.EncodeToString(b[:])
}

// Track returns track n (from 1).
func (t *Tape) Track(n int) (*Track, error) {
	if n < 1 || n > len(t.Tracks) {
		return nil, ErrNoSuchTrack
	}
	return &t.Tracks[n-1], nil
}

// Clip finds a clip by id.
func (t *Tape) Clip(id string) (*Track, *Clip, error) {
	for i := range t.Tracks {
		for j := range t.Tracks[i].Clips {
			if t.Tracks[i].Clips[j].ID == id {
				return &t.Tracks[i], &t.Tracks[i].Clips[j], nil
			}
		}
	}
	return nil, nil, ErrNoSuchClip
}

// Empty reports whether no track has any audio.
func (t *Tape) Empty() bool {
	for _, tr := range t.Tracks {
		if len(tr.Clips) > 0 {
			return false
		}
	}
	return true
}

// MaterialEnd is the tape frame after the last clip, or 0.
func (t *Tape) MaterialEnd() int64 {
	var end int64
	for _, tr := range t.Tracks {
		for _, c := range tr.Clips {
			if e := c.End(); e > end {
				end = e
			}
		}
	}
	return end
}

// Change applies one edit as one undo step. kind names the edit ("gain:2"),
// and an edit of the same kind within coalesceWindow of the last extends that
// step instead of adding one. If fn fails, nothing changes.
func (t *Tape) Change(kind string, now time.Time, fn func(s *State) error) error {
	before := t.State.clone()
	next := t.State.clone()
	if err := fn(&next); err != nil {
		return err
	}
	if err := next.validate(t.Length); err != nil {
		return err
	}
	gap := now.Sub(t.lastAt)
	if kind == "" || kind != t.lastKind || gap < 0 || gap >= coalesceWindow || len(t.History) == 0 {
		t.History = append(t.History, before)
		if len(t.History) > MaxHistory {
			t.History = t.History[len(t.History)-MaxHistory:]
		}
	}
	t.Future = nil
	t.State = next
	t.lastKind, t.lastAt = kind, now
	return nil
}

// draft is a copy of the tape to change: edit it, save it, and only then
// make it the tape, so a failed save changes nothing. States are never
// changed in place, so only the lists of them are copied.
func (t *Tape) draft() *Tape {
	c := *t
	c.History = slices.Clone(t.History)
	c.Future = slices.Clone(t.Future)
	return &c
}

// files lists the pool files a state needs.
func (s State) files(into map[string]bool) {
	for _, tr := range s.Tracks {
		for _, c := range tr.Clips {
			c.poolFiles(into)
		}
	}
}

// Undo steps back one version, Redo forward one.
func (t *Tape) Undo() error {
	if len(t.History) == 0 {
		return ErrNothingToDo
	}
	t.Future = append(t.Future, t.State.clone())
	t.State = t.History[len(t.History)-1]
	t.History = t.History[:len(t.History)-1]
	t.lastKind = ""
	return nil
}

func (t *Tape) Redo() error {
	if len(t.Future) == 0 {
		return ErrNothingToDo
	}
	t.History = append(t.History, t.State.clone())
	t.State = t.Future[len(t.Future)-1]
	t.Future = t.Future[:len(t.Future)-1]
	t.lastKind = ""
	return nil
}

// validate checks a state is one the renderer can play.
func (s *State) validate(length int64) error {
	if s.Grid != nil && (s.Grid.Frames <= 0 || s.Grid.Bars <= 0) {
		return fmt.Errorf("%w: the grid needs a length and bars", ErrBadParameter)
	}
	if s.Loop.Out != 0 || s.Loop.In != 0 {
		if s.Loop.In < 0 || s.Loop.Out <= s.Loop.In {
			return ErrBadLoop
		}
		if s.Loop.Out > length {
			return ErrPastTheEnd
		}
	}
	for i := range s.Tracks {
		tr := &s.Tracks[i]
		if tr.Clips == nil {
			tr.Clips = []Clip{}
		}
		if tr.Bus != BusA && tr.Bus != BusB {
			return fmt.Errorf("%w: bus %q", ErrBadParameter, tr.Bus)
		}
		if tr.Pan < -1 || tr.Pan > 1 || math.IsNaN(tr.Pan) {
			return fmt.Errorf("%w: pan must be -1..1", ErrBadParameter)
		}
		for _, c := range tr.Clips {
			if c.Frames <= 0 || c.Src < 0 || c.At < 0 {
				return fmt.Errorf("%w: clip %s", ErrBadParameter, c.ID)
			}
			if c.Frames > length || c.At > length-c.Frames { // End() > length, without overflowing
				return ErrPastTheEnd
			}
		}
		sort.SliceStable(tr.Clips, func(a, b int) bool {
			if tr.Clips[a].Layer != tr.Clips[b].Layer {
				return tr.Clips[a].Layer < tr.Clips[b].Layer
			}
			return tr.Clips[a].At < tr.Clips[b].At
		})
	}
	return nil
}

// Place puts a clip on a track. With replace, whatever the clip covers, on
// every layer, is cut away (clips are trimmed, split or removed); otherwise it goes
// on a new layer above everything it overlaps -- the OP-1's always-overdub
// rule. Called inside Change.
func (s *State) Place(track int, c Clip, replace bool) (Clip, error) {
	if track < 1 || track > len(s.Tracks) {
		return c, ErrNoSuchTrack
	}
	tr := &s.Tracks[track-1]
	if c.ID == "" {
		c.ID = NewClipID()
	}
	if replace {
		c.Layer = 0
		tr.Clips = clearRange(tr.Clips, c.At, c.End())
	} else {
		// The lowest layer the span is free on.
		c.Layer = 0
		for {
			busy := false
			for _, o := range tr.Clips {
				if o.Layer == c.Layer && o.At < c.End() && c.At < o.End() {
					busy = true
					break
				}
			}
			if !busy {
				break
			}
			c.Layer++
		}
	}
	tr.Clips = append(tr.Clips, c)
	return c, nil
}

// PlaceTogether places clips that are one part played in pieces -- a pass
// split at the loop's seam -- on one track. Layered, they share the lowest
// layer all of them are free on: the renderer joins a head to its tail
// only on the same layer, and pieces on two layers would dip at the seam
// every time round. Replacing, each clears what's under it.
func (s *State) PlaceTogether(track int, cs []Clip, replace bool) ([]Clip, error) {
	if track < 1 || track > len(s.Tracks) {
		return nil, ErrNoSuchTrack
	}
	if replace {
		out := make([]Clip, 0, len(cs))
		for _, c := range cs {
			p, err := s.Place(track, c, true)
			if err != nil {
				return nil, err
			}
			out = append(out, p)
		}
		return out, nil
	}
	tr := &s.Tracks[track-1]
	layer := 0
	for busy := true; busy; {
		busy = false
		for _, c := range cs {
			for _, o := range tr.Clips {
				if o.Layer == layer && o.At < c.End() && c.At < o.End() {
					busy = true
				}
			}
		}
		if busy {
			layer++
		}
	}
	out := make([]Clip, 0, len(cs))
	for _, c := range cs {
		if c.ID == "" {
			c.ID = NewClipID()
		}
		c.Layer = layer
		tr.Clips = append(tr.Clips, c)
		out = append(out, c)
	}
	return out, nil
}

// clearRange removes [from, to) from the clips on every layer: replace
// leaves nothing playing under what replaces it.
func clearRange(clips []Clip, from, to int64) []Clip {
	layers := map[int]bool{}
	for _, c := range clips {
		layers[c.Layer] = true
	}
	for l := range layers {
		clips = cutRange(clips, l, from, to)
	}
	return clips
}

// cutRange removes [from, to) from the clips on one layer: a clip inside is
// dropped, one across an edge is trimmed, one across the whole range is
// split in two.
func cutRange(clips []Clip, layer int, from, to int64) []Clip {
	var out []Clip
	for _, c := range clips {
		if c.Layer != layer || c.End() <= from || c.At >= to {
			out = append(out, c)
			continue
		}
		if c.At < from { // the part before
			head := c
			head.Frames = from - c.At
			head.FadeOut = 0 // its end is a cut now
			out = append(out, head)
		}
		if c.End() > to { // the part after
			tail := c
			tail.ID = NewClipID()
			cut := to - c.At
			tail.At, tail.Src, tail.Frames = to, c.Src+cut, c.Frames-cut
			tail.FadeIn = 0 // its start is a cut now
			if c.At < from {
				out = append(out, tail)
			} else {
				tail.ID = c.ID
				out = append(out, tail)
			}
		}
	}
	return out
}
