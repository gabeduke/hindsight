package tape

import (
	"math"
	"testing"
)

func busB(out []int32, f int) float64 { return float64(out[f*OutChannels+2]) / 2147483647 }

// peakOver is the loudest of bus(out, f) over [from, to).
func peakOver(out []int32, from, to int, bus func([]int32, int) float64) float64 {
	var p float64
	for f := from; f < to; f++ {
		p = math.Max(p, math.Abs(bus(out, f)))
	}
	return p
}

// On the Sidekick CH1 hears bus A: a punch from it gets the count-in and the
// click on bus B, where CH1 can't hear them.
func TestRecordingFromABusATapMovesTheClickToBusB(t *testing.T) {
	e, sink, tp := tempoEngine(t, 4)
	if !e.Loaded().Click {
		t.Fatal("a new tape's click should be on")
	}
	if _, err := e.Record(tp.ID, 1, "ch1", false); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Transport(tp.ID, Action{Kind: "play"}); err != nil {
		t.Fatal(err)
	}
	e.Start()
	out := sink.play(t, 96000+30000)       // the count-in's bar, then a beat in
	for _, beat := range []int{0, 96000} { // a count-in click, the tape's first
		if p := peakOver(out, beat, beat+600, busB); p < 0.05 {
			t.Fatalf("no click on bus B at frame %d (peak %.3f)", beat, p)
		}
		if p := peakOver(out, beat, beat+600, busA); p != 0 {
			t.Fatalf("the click is still on bus A at frame %d (peak %.3f)", beat, p)
		}
	}
	for _, s := range e.Sources() {
		if want := s.Name != "main" && s.Name != "ch2"; s.Clean != want {
			t.Fatalf("%s clean = %v while the click is on B, want %v", s.Name, s.Clean, want)
		}
	}
	if _, err := e.EndRecording(tp.ID, true); err != nil {
		t.Fatal(err)
	}
	if m := e.mix.Load(); m.clickBus != 0 {
		t.Fatalf("after the punch the click is on bus %d, want A again", m.clickBus)
	}
}

// With nothing being recorded the click is on A; an armed track's input
// moves it, and MAIN, which hears both buses, never reads as clean while
// the click is on.
func TestTheClickCountsAgainstTheSourcesThatHearIt(t *testing.T) {
	e, _, tp := tempoEngine(t, 1)
	clean := func() map[string]bool {
		m := map[string]bool{}
		for _, s := range e.Sources() {
			m[s.Name] = s.Clean
		}
		return m
	}
	if c := clean(); c["main"] || c["ch1"] || !c["ch2"] || !c["aux"] {
		t.Fatalf("an empty tape with the click on A: %v, want main and ch1 not clean", c)
	}
	if err := e.SetMeta(tp.ID, func(t *Tape) error {
		if err := t.SetArmed([]int{2}); err != nil {
			return err
		}
		return t.SetInput(2, "ch1")
	}); err != nil {
		t.Fatal(err)
	}
	if c := clean(); c["main"] || !c["ch1"] || c["ch2"] || !c["aux"] {
		t.Fatalf("track 2 armed from ch1: %v, want the click on B", c)
	}
	if err := e.SetMeta(tp.ID, func(t *Tape) error { return t.SetInput(2, "main") }); err != nil {
		t.Fatal(err)
	}
	if c := clean(); c["main"] {
		t.Fatalf("armed from main: %v, want main not clean (it hears both buses)", c)
	}
	if err := e.SetMeta(tp.ID, func(t *Tape) error { t.Click = false; return nil }); err != nil {
		t.Fatal(err)
	}
	if c := clean(); !c["main"] || !c["ch1"] {
		t.Fatalf("the click off on an empty tape: %v, want every source clean", c)
	}
}

func TestClickBusFor(t *testing.T) {
	src := func(n string) Source {
		for _, s := range DefaultSources {
			if s.Name == n {
				return s
			}
		}
		t.Fatalf("no %s", n)
		return Source{}
	}
	for _, c := range []struct {
		from []string
		want int
	}{
		{nil, 0},
		{[]string{"aux"}, 0},
		{[]string{"ch2"}, 0},
		{[]string{"ch1"}, 1},
		{[]string{"ch1", "aux"}, 1},
		{[]string{"main"}, 0},       // hears both: nowhere is clean
		{[]string{"ch1", "ch2"}, 0}, // the same
	} {
		var srcs []Source
		for _, n := range c.from {
			srcs = append(srcs, src(n))
		}
		if got := clickBusFor(srcs); got != c.want {
			t.Errorf("clickBusFor(%v) = %d, want %d", c.from, got, c.want)
		}
	}
}

// A tape with no tempo yet has no beats: its click is on, but nothing
// clicks, so it leaks into no source.
func TestATapeWithNoTempoHasNoClickToHear(t *testing.T) {
	e, _, _ := newEngine(t)
	if tp := e.Loaded(); !tp.Click || tp.Grid != nil {
		t.Fatalf("want a new tape with the click on and no tempo: click %v grid %v", tp.Click, tp.Grid)
	}
	for _, s := range e.Sources() {
		if !s.Clean {
			t.Fatalf("%s isn't clean on a tape with no tempo", s.Name)
		}
	}
}
