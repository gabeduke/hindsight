package tape

import (
	"encoding/json"
	"errors"
	"math"
	"testing"
)

func TestAFormulaSetsTheFourAmountsAndAKnobMakesItCustom(t *testing.T) {
	var s State
	if err := (StyleChange{Formula: ptr(FormulaFerric)}).ApplyTo(&s); err != nil {
		t.Fatal(err)
	}
	if want := (Style{Formula: FormulaFerric, Wow: .2, Flutter: .15, Drive: .3, Age: .25}); *s.Style != want {
		t.Fatalf("ferric = %+v, want %+v", *s.Style, want)
	}
	if err := (StyleChange{Wow: ptr(0.6)}).ApplyTo(&s); err != nil {
		t.Fatal(err)
	}
	if want := (Style{Formula: FormulaCustom, Wow: .6, Flutter: .15, Drive: .3, Age: .25}); *s.Style != want {
		t.Fatalf("a knob moved = %+v, want %+v", *s.Style, want)
	}
	// A page that sends a formula's own amounts with it keeps its name.
	all := StyleChange{Formula: ptr(FormulaWorn), Wow: ptr(.5), Flutter: ptr(.4), Drive: ptr(.4), Age: ptr(.6)}
	if err := all.ApplyTo(&s); err != nil || s.Style.Formula != FormulaWorn {
		t.Fatalf("worn with its own amounts = %+v %v", s.Style, err)
	}
	for _, bad := range []StyleChange{{Formula: ptr("cassette")}, {Formula: ptr(FormulaCustom)}, {Drive: ptr(1.5)}, {Age: ptr(-0.1)}, {Wow: ptr(math.NaN())}} {
		if err := bad.ApplyTo(&State{}); !errors.Is(err, ErrBadParameter) {
			t.Fatalf("%+v: %v, want a bad parameter", bad, err)
		}
	}
}

func TestAStyleSavesAndLoadsAndAPlainTapeHasNone(t *testing.T) {
	// A tape that never had mods writes no "style" at all: its tape.json is
	// as it was before there were mods.
	b, _ := json.Marshal(State{})
	if string(b) != `{"grid":null,"loop":{"in":0,"out":0,"on":false},"tracks":null}` {
		t.Fatalf("a plain state is %s", b)
	}
	e, _, tp := newEngine(t)
	if err := e.SetStyle(tp.ID, StyleChange{Formula: ptr(FormulaChrome)}); err != nil {
		t.Fatal(err)
	}
	back, err := e.store.Load(tp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if back.Style == nil || *back.Style != *e.Loaded().Style || back.Style.Formula != FormulaChrome {
		t.Fatalf("saved %+v, loaded %+v", e.Loaded().Style, back.Style)
	}
	// A clone for undo is its own.
	c := back.State.clone()
	c.Style.Wow = 1
	if back.Style.Wow == 1 {
		t.Fatal("a clone shares its style with the original")
	}
}
