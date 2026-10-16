package tape

import "fmt"

// Tape mods: the character of the tape -- wow, flutter, drive and age
// (docs/superpowers/specs/2026-10-15-punch-in-fx-design.md). Unlike the
// tricks and the punch-in FX, they belong to the tape: saved in it, undone
// like any edit, and printed in a mixdown, because they are its sound.
//
// This is the model: a tape's Style, the formulas, and the change a PATCH
// makes. WOW and FLUTTER move where the head reads (mods.go, perf.plan);
// DRIVE and AGE work on the mix (fx.go). Each is an amount from 0 to 1, and
// 0 is exactly the tape as it was: with every mod at 0 a tape renders sample
// for sample as one that never had any.

// The formulas: starting points that set all four amounts at once.
const (
	FormulaClean  = "clean"
	FormulaChrome = "chrome"
	FormulaFerric = "ferric"
	FormulaWorn   = "worn"
	// FormulaCustom is what a style reads once a knob has moved off its
	// formula's amounts.
	FormulaCustom = "custom"
)

// formulas are the four amounts each formula sets: wow, flutter, drive,
// age. A first guess, to be tuned by ear on the rig.
var formulas = map[string][numMods]float64{
	FormulaClean:  {0, 0, 0, 0},
	FormulaChrome: {.1, .1, .15, .05},
	FormulaFerric: {.2, .15, .3, .25},
	FormulaWorn:   {.5, .4, .4, .6},
}

// Formulas lists the formulas, in the order the page shows them.
func Formulas() []string {
	return []string{FormulaClean, FormulaChrome, FormulaFerric, FormulaWorn}
}

// The mods, by index and by the name the play socket previews them under.
const (
	modWow = iota
	modFlutter
	modDrive
	modAge
	numMods
)

var modNames = [numMods]string{"mod.wow", "mod.flutter", "mod.drive", "mod.age"}

// Mods is every mod, by the name the play socket previews it under.
func Mods() []string { return append([]string(nil), modNames[:]...) }

func modIndex(name string) int {
	for i, n := range modNames {
		if n == name {
			return i
		}
	}
	return -1
}

// Style is a tape's mods. A tape without one is clean.
type Style struct {
	Formula string  `json:"formula"`
	Wow     float64 `json:"wow"`
	Flutter float64 `json:"flutter"`
	Drive   float64 `json:"drive"`
	Age     float64 `json:"age"`
}

// amounts is the style's four amounts, by mod index.
func (s Style) amounts() [numMods]float64 {
	return [numMods]float64{s.Wow, s.Flutter, s.Drive, s.Age}
}

func (s *Style) set(a [numMods]float64) {
	s.Wow, s.Flutter, s.Drive, s.Age = a[modWow], a[modFlutter], a[modDrive], a[modAge]
}

func (s Style) validate() error {
	if _, ok := formulas[s.Formula]; !ok && s.Formula != FormulaCustom {
		return fmt.Errorf("%w: no formula %q", ErrBadParameter, s.Formula)
	}
	for _, v := range s.amounts() {
		if !(v >= 0 && v <= 1) { // NaN fails too
			return fmt.Errorf("%w: a tape mod is 0 to 1", ErrBadParameter)
		}
	}
	return nil
}

// StyleChange is a change to a tape's mods: a formula, and any amounts to
// set after it. Moving an amount off its formula's makes the style custom.
type StyleChange struct {
	Formula *string  `json:"formula"`
	Wow     *float64 `json:"wow"`
	Flutter *float64 `json:"flutter"`
	Drive   *float64 `json:"drive"`
	Age     *float64 `json:"age"`
}

func (c StyleChange) fields() [numMods]*float64 {
	return [numMods]*float64{c.Wow, c.Flutter, c.Drive, c.Age}
}

// Kind is the undo step a change makes: one amount alone coalesces with
// the same amount moved again a moment later, as a gain drag does; a formula
// is always a step of its own.
func (c StyleChange) Kind() string {
	if c.Formula != nil {
		return ""
	}
	kind := ""
	for i, f := range c.fields() {
		if f == nil {
			continue
		}
		if kind != "" {
			return ""
		}
		kind = "style:" + modNames[i]
	}
	return kind
}

// ApplyTo changes a state's style. Called inside an edit.
func (c StyleChange) ApplyTo(s *State) error {
	cur := Style{Formula: FormulaClean}
	if s.Style != nil {
		cur = *s.Style
	}
	if c.Formula != nil {
		a, ok := formulas[*c.Formula]
		if !ok {
			return fmt.Errorf("%w: a formula is clean, chrome, ferric or worn", ErrBadParameter)
		}
		cur.Formula = *c.Formula
		cur.set(a)
	}
	a := cur.amounts()
	moved := false
	for i, f := range c.fields() {
		if f == nil {
			continue
		}
		if !(*f >= 0 && *f <= 1) {
			return fmt.Errorf("%w: a tape mod is 0 to 1", ErrBadParameter)
		}
		a[i], moved = *f, true
	}
	cur.set(a)
	if moved {
		if f, ok := formulas[cur.Formula]; !ok || f != a {
			cur.Formula = FormulaCustom
		}
	}
	s.Style = &cur
	return nil
}

// SetStyle changes the loaded tape's mods, as one step of undo.
func (e *Engine) SetStyle(id string, c StyleChange) error {
	return e.Edit(id, c.Kind(), func(_ *Tape, s *State) error { return c.ApplyTo(s) })
}
