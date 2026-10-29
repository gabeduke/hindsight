package surface

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var update = flag.Bool("update", false, "write the golden command lists in testdata/")

// fxKnobs is the FX page's knob rows as the prototype has them: the tape's
// FX, then the master knob, SCRUB or (with SHIFT) the synth's volume.
func fxKnobs(fx [7]int) [8]Knob {
	var out [8]Knob
	for k, name := range []string{"DRIVE", "AGE", "FILTER", "CRUSH", "ECHO", "WOW", "FLUTTER"} {
		out[k] = Knob{Name: name, Value: fmt.Sprint(fx[k]), Amount: fx[k], Lit: Accent}
	}
	out[7] = Knob{Name: "SCRUB", Value: "< >", Amount: -1, Lit: Accent}
	return out
}

// mixerKnobs is the Mixer page's: the four pans, the selected track's three
// that a track hasn't got yet, and the synth's volume.
func mixerKnobs(pan [4]int, sel, synth int) [8]Knob {
	var out [8]Knob
	for k := range 4 {
		out[k] = Knob{Name: fmt.Sprintf("PAN %d", k+1), Value: Pan(pan[k]), Amount: pan[k], Lit: Track(k + 1)}
	}
	for k, name := range []string{"GAIN", "MON", "SEND"} {
		out[4+k] = Knob{Name: fmt.Sprintf("%s T%d", name, sel), Value: "-", Amount: -1, Lit: Accent}
	}
	out[7] = Knob{Name: "SYNTH VOL", Value: fmt.Sprint(synth), Amount: synth, Lit: White}
	return out
}

// atRest is the prototype's fresh(): TAPE 3 at 132, stopped at 012.1, T2
// armed, the FX page up.
func atRest() State {
	return State{Tape: "Tape 3", Tempo: 132, Beats: 44, Armed: 2, Selected: 2,
		Fader: [4]int{100, 90, 112, 76}, Knobs: fxKnobs([7]int{40, 12, 88, 0, 30, 6, 4}),
		LitKnob: -1, LitFader: -1}
}

func meters(m ...float64) (out [4]int) {
	for i, v := range m {
		out[i] = round(v * 127)
	}
	return out
}

// screens are the prototype's contact sheet, in its order.
var screens = []struct {
	name  string
	state func() State
}{
	{"at-rest", atRest},
	{"filter-turned", func() State {
		s := atRest()
		s.Playing, s.Beats, s.Meter, s.LitKnob = true, 97.5, meters(.7, .5, .82, .4), 2
		s.Knobs = fxKnobs([7]int{40, 12, 104, 0, 30, 6, 4})
		return s
	}},
	{"punch-in", func() State {
		s := atRest()
		s.Playing, s.Recording, s.Beats, s.Meter = true, true, 129, meters(.6, .8, .5, .3)
		s.Banner = &Flash{"PUNCH IN T2", Red}
		return s
	}},
	{"refused", func() State {
		s := atRest()
		s.Armed, s.Banner = 0, &Flash{"NO TRACK ARMED", Amber}
		return s
	}},
	{"pads-held", func() State {
		s := atRest()
		s.Playing, s.Beats, s.Meter = true, 60.25, meters(.5, .4, .7, .6)
		s.Held[4], s.Held[11] = true, true
		return s
	}},
	{"mixer", func() State {
		s := atRest()
		s.Page, s.Playing, s.Beats, s.Meter = PageMixer, true, 33, meters(.6, .5, .7, 0)
		s.Mute[3], s.Solo[2], s.LitKnob = true, true, 7
		s.Knobs = mixerKnobs([4]int{64, 40, 88, 64}, 2, 100)
		return s
	}},
}

func lines(items []Item) string {
	var b strings.Builder
	for _, it := range items {
		b.WriteString(it.String())
		b.WriteByte('\n')
	}
	return b.String()
}

// Each of the prototype's screens is the command list in testdata, which is
// the prototype's own (the firmware's tools/screen/prototype.txt, made from
// it, drew each pixel for pixel like the prototype).
func TestTheScreensAreThePrototypes(t *testing.T) {
	for _, sc := range screens {
		t.Run(sc.name, func(t *testing.T) {
			got := lines(Layout(sc.state()))
			path := filepath.Join("testdata", sc.name+".golden")
			if *update {
				if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			want, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if got != string(want) {
				t.Fatalf("%s differs from %s:\n%s", sc.name, path, lineDiff(string(want), got))
			}
		})
	}
}

func lineDiff(want, got string) string {
	w, g := strings.Split(want, "\n"), strings.Split(got, "\n")
	var b strings.Builder
	for i := range max(len(w), len(g)) {
		var a, c string
		if i < len(w) {
			a = w[i]
		}
		if i < len(g) {
			c = g[i]
		}
		if a != c {
			fmt.Fprintf(&b, "line %d: want %q, got %q\n", i+1, a, c)
		}
	}
	return b.String()
}

// No screen holds more than the keyboard's 96 items, two at one place, or
// one that doesn't fit, and a whole screen goes in two frames at most.
func TestEveryScreenFitsTheKeyboard(t *testing.T) {
	for _, s := range overlapStates() {
		items := Layout(s)
		if len(items) > MaxItems {
			t.Errorf("%s: %d items", s.Tape, len(items))
		}
		at := map[place]bool{}
		for _, it := range items {
			if at[it.place()] {
				t.Errorf("%s: two items at %v", s.Tape, it.place())
			}
			at[it.place()] = true
			x0, y0, x1, y1 := it.Rect()
			if x0 < 0 || y0 < 0 || x1 > Width || y1 > Height || (it.Kind == KindText && it.S == "") {
				t.Errorf("%s: %v doesn't fit", s.Tape, it)
			}
		}
		// The busiest is about 960 bytes of commands, and a frame holds
		// MaxFrame: three, then.
		cmds := plan(nil, items)
		frames := 0
		for len(cmds) > 0 {
			_, n := nextBatch(cmds)
			cmds = cmds[n:]
			frames++
		}
		if frames > 3 {
			t.Errorf("%s: a whole screen takes %d frames", s.Tape, frames)
		}
	}
}

// overlapStates are screens at their fullest: long names, bars past 999,
// every track soloed and muted with none armed, both pages, lit knobs.
func overlapStates() []State {
	var out []State
	for _, sc := range screens {
		out = append(out, sc.state())
	}
	for _, name := range []string{"A tape with a long name indeed", strings.Repeat("W", 40), "Exactly15 chars"} {
		for _, beats := range []float64{0, 3995.75, 3996, 39996, 399996.5} {
			for _, page := range []Page{PageFX, PageMixer} {
				for _, armed := range []int{0, 4} {
					s := atRest()
					s.Tape, s.Beats, s.Page, s.Armed, s.Playing = name, beats, page, armed, true
					s.Solo, s.Mute = [4]bool{true, true, true, true}, [4]bool{true, true, true, true}
					s.Held = [16]bool{true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true}
					s.LitKnob, s.LitFader = 7, 3
					if page == PageMixer {
						s.Knobs = mixerKnobs([4]int{0, 127, 64, 1}, 4, 127)
					}
					s.Knobs[3].Name, s.Knobs[3].Value = "A KNOB'S LONG NAME", "-INF+"
					out = append(out, s)
				}
			}
		}
	}
	free := atRest()
	free.Tempo, free.Tape = 0, "" // no grid, and no name: no TEXT of no text
	out = append(out, free)
	return out
}

// No two texts the screen shows overlap: the three the prototype had (a
// long name into the tempo, bar 1000 into its sixteenths, NO TRACK ARMED
// into SOLO 1 2 3 4  MUTE 1 2 3 4) among them. A text a later box covers
// whole, the top line under the banner, isn't shown.
func TestNoTwoTextsOverlap(t *testing.T) {
	for _, s := range overlapStates() {
		items := Layout(s)
		shown := func(i int) bool {
			x0, y0, x1, y1 := items[i].Rect()
			for _, b := range items[i+1:] {
				bx0, by0, bx1, by1 := b.Rect()
				if b.Kind == KindBox && bx0 <= x0 && by0 <= y0 && bx1 >= x1 && by1 >= y1 {
					return false
				}
			}
			return true
		}
		for i, a := range items {
			if a.Kind != KindText || !shown(i) {
				continue
			}
			for j := i + 1; j < len(items); j++ {
				if b := items[j]; b.Kind == KindText && shown(j) && overlaps(a, b) {
					m, _ := Counter(s.Beats)
					t.Errorf("%q at %s, page %d, armed %d: %v overlaps %v", s.Tape, m, s.Page, s.Armed, a, b)
				}
			}
		}
	}
}

func TestCounterPanAndFaderWords(t *testing.T) {
	for _, c := range []struct {
		beats     float64
		main, six string
	}{{0, "001.1", ".1"}, {44, "012.1", ".1"}, {97.5, "025.2", ".3"}, {60.25, "016.1", ".2"}, {3996, "1000.1", ".1"}} {
		if m, s := Counter(c.beats); m != c.main || s != c.six {
			t.Errorf("Counter(%v) = %s %s, want %s %s", c.beats, m, s, c.main, c.six)
		}
	}
	for v, want := range map[int]string{64: "C", 40: "L19", 88: "R19", 0: "L51", 127: "R50"} {
		if got := Pan(v); got != want {
			t.Errorf("Pan(%d) = %s, want %s", v, got, want)
		}
	}
	for v, want := range map[int]string{0: "-INF", 100: "+0", 90: "-1", 112: "+1", 76: "-2"} {
		if got := FaderDB(v); got != want {
			t.Errorf("FaderDB(%d) = %s, want %s", v, got, want)
		}
	}
	for db, want := range map[float64]int{0: 100, -6: 50, 6: 127, -120: 0} {
		if got := FaderOf(db); got != want {
			t.Errorf("FaderOf(%v) = %d, want %d", db, got, want)
		}
	}
}
