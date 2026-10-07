package tape

import (
	"errors"
	"fmt"
	"math"
	"slices"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Sections (step A6, docs/superpowers/specs/2026-10-07-sections-design.md):
// named spans of the tape -- an intro, a verse, a chorus -- above the ruler.
// Tapping one on the page selects its bars, so Lift, Copy and ×2 act on it;
// a stem export writes them as MIDI markers. They're part of the tape's state,
// so every change is one undo step, and on a tape with a tempo they sit on
// bar lines. They don't overlap.

// Section is one named span, [At, End).
type Section struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	At    int64  `json:"at"`
	End   int64  `json:"end"`
	Color string `json:"color,omitempty"` // one of SectionColors; "" is the first
}

// SectionColors are the colours a section can wear (the page draws them;
// "" is its default).
var SectionColors = []string{"blue", "amber", "red", "green", "violet", "cyan"}

// sectionName is a name as a section keeps it: no control or format
// characters (it goes into MIDI markers), trimmed.
func sectionName(s string) string {
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, s))
}

// MaxSectionName is the longest a section's name can be.
const MaxSectionName = 40

func (s *State) validSections(length int64) error {
	sort.SliceStable(s.Sections, func(a, b int) bool { return s.Sections[a].At < s.Sections[b].At })
	for i, sc := range s.Sections {
		if sc.At < 0 {
			return fmt.Errorf("%w: a section starts at or after the tape's start", ErrBadParameter)
		}
		if sc.End <= sc.At {
			return fmt.Errorf("%w: a section ends after it starts", ErrBadParameter)
		}
		if sc.End > length {
			return ErrPastTheEnd
		}
		if i > 0 && s.Sections[i-1].End > sc.At {
			return fmt.Errorf("%w: %s overlaps %s", ErrBadParameter, sc.Name, s.Sections[i-1].Name)
		}
		if n := sectionName(sc.Name); n == "" || utf8.RuneCountInString(n) > MaxSectionName {
			return fmt.Errorf("%w: a section's name is 1 to %d characters", ErrBadParameter, MaxSectionName)
		}
		if sc.Color != "" && !slices.Contains(SectionColors, sc.Color) {
			return fmt.Errorf("%w: no colour %q", ErrBadParameter, sc.Color)
		}
	}
	return nil
}

// onBar puts a frame on the nearest bar line, when the tape has a tempo.
func onBar(g *Grid, f int64) int64 {
	if g == nil || g.Frames <= 0 || g.Bars <= 0 {
		return f
	}
	return g.BarStart(int64(math.Round(float64(f) / g.BarFrames())))
}

// snapSection puts a span on bar lines, at least a bar long.
func snapSection(g *Grid, at, end int64) (int64, int64) {
	at, end = onBar(g, at), onBar(g, end)
	if g != nil && g.Frames > 0 && g.Bars > 0 && end <= at {
		end = g.BarStart(g.BarAt(at) + 1)
	}
	return at, end
}

// addSection names a new span.
func (s *State) addSection(name, color string, at, end int64) (Section, error) {
	if end <= at {
		return Section{}, fmt.Errorf("%w: a section ends after it starts", ErrBadParameter)
	}
	at, end = snapSection(s.Grid, at, end)
	sc := Section{ID: "s" + NewClipID()[1:], Name: sectionName(name), At: at, End: end, Color: color}
	s.Sections = append(s.Sections, sc)
	return sc, nil // validate refuses an overlap, a bad name or colour
}

// setSection renames, recolours or moves a section's edges.
func (s *State) setSection(id string, name, color *string, at, end *int64) (Section, error) {
	for i := range s.Sections {
		sc := &s.Sections[i]
		if sc.ID != id {
			continue
		}
		if name != nil {
			sc.Name = sectionName(*name)
		}
		if color != nil {
			sc.Color = *color
		}
		// Only the edges sent move, onto bar lines: one left where it is
		// stays, even off a bar line after the tempo changed.
		a, b := sc.At, sc.End
		if at != nil {
			a = onBar(s.Grid, *at)
		}
		if end != nil {
			b = onBar(s.Grid, *end)
		}
		if b <= a {
			return Section{}, fmt.Errorf("%w: a section ends after it starts", ErrBadParameter)
		}
		sc.At, sc.End = a, b
		return *sc, nil
	}
	return Section{}, ErrNoSuchSection
}

// removeSection takes a section away; the audio under it stays.
func (s *State) removeSection(id string) error {
	for i, sc := range s.Sections {
		if sc.ID == id {
			s.Sections = append(s.Sections[:i:i], s.Sections[i+1:]...)
			return nil
		}
	}
	return ErrNoSuchSection
}

// sectionEdit carries out a section's add, set or remove as one undo step.
func (e *Engine) sectionEdit(id string, req EditRequest) (EditResult, error) {
	var out *Section
	err := e.Edit(id, "", func(_ *Tape, s *State) error {
		switch req.Op {
		case "section-add":
			if req.At == nil || req.End == nil || req.Name == nil {
				return fmt.Errorf("%w: a section needs at, end and a name", ErrBadParameter)
			}
			color := ""
			if req.Color != nil {
				color = *req.Color
			}
			sc, err := s.addSection(*req.Name, color, *req.At, *req.End)
			out = &sc
			return err
		case "section-set":
			was := slices.Clone(s.Sections)
			sc, err := s.setSection(req.Section, req.Name, req.Color, req.At, req.End)
			out = &sc
			if err == nil && slices.Equal(was, s.Sections) {
				return errNoChange // the name or colour it has already: no undo step
			}
			return err
		default:
			return s.removeSection(req.Section)
		}
	})
	if errors.Is(err, errNoChange) {
		err = nil
	}
	if err != nil {
		return EditResult{}, err
	}
	// The section as the state has it, sorted and checked.
	if out != nil {
		if t := e.Loaded(); t != nil {
			for _, sc := range t.Sections {
				if sc.ID == out.ID {
					*out = sc
				}
			}
		}
	}
	return EditResult{Op: req.Op, Section: out}, nil
}

// errNoChange aborts an edit that would change nothing, so it adds no undo
// step; the caller answers as if it had been made.
var errNoChange = errors.New("nothing to change")
