package surface

// The SMK-37's screen on protocol version 2, as a function of the tape's
// state (docs/plan/the-instrument.md, step 7, *The surface, designed*). It
// is the layout of the prototype the design was agreed on
// (~/programming/hindsight-design/smk), position for position, with the
// three overlaps measured there fixed: a long tape name is cut before the
// tempo, a counter past bar 999 makes room for its sixteenths, and the
// solos and mutes close up beside NO TRACK ARMED.

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// The palette's version 2 colours, after version 1's seven.
const (
	T1 Colour = iota + colours
	T2
	T3
	T4
	Red
	Orange
	Violet
	White
	Deep
	coloursV2
)

// Track is track n's colour, 1 to 4; Dim for any other.
func Track(n int) Colour {
	if n < 1 || n > 4 {
		return Dim
	}
	return T1 + Colour(n-1)
}

// Page is what the pads and encoders do: FX, or the Mixer while SHIFT is
// held.
type Page int

const (
	PageFX Page = iota
	PageMixer
)

// Knob is one encoder's cell: its name, its value as words, and its amount
// 0-127 for the bar under it (-1: no bar), with the colour it is lit in.
type Knob struct {
	Name, Value string
	Amount      int
	Lit         Colour
}

// Flash is the banner: words over the top line in a colour.
type Flash struct {
	Words  string
	Colour Colour
}

// State is what the screen shows.
type State struct {
	Tape  string
	Tempo float64 // BPM; 0 has no grid, and no bars to count
	Beats float64 // where the tape is, in beats from its start

	Playing, Recording bool
	Armed              int // 1-4, 0 none
	Selected           int // the Mixer page's track, 1-4
	Solo, Mute         [4]bool

	Page Page
	Held [16]bool // FX pads held now

	Meter [4]int // 0-127
	Fader [4]int // 0-127, 100 is 0 dB

	// Knobs are the panel's two rows: K1-K4, then SELECT, PAGE, PRESET and
	// the master knob.
	Knobs [8]Knob
	// LitKnob and LitFader are the one just moved, -1 none: its name and
	// value lit in place.
	LitKnob, LitFader int

	Banner *Flash
}

// The screen's places.
const (
	nameX, nameY   = 6, 7
	tempoX, tempoY = 186, 11
	counterX       = 4
	counterY       = 34
	transportX     = 162
	transportW     = 74
	lineY          = 66
	rightEdge      = 234
)

// FXPads are the FX page's pads: their labels and families' colours.
var FXPads = [16]struct {
	Label  string
	Colour Colour
}{
	{"T1", T1}, {"T2", T2}, {"T3", T3}, {"T4", T4},
	{"BRK", Orange}, {"REV", Orange}, {"CHP", Orange}, {"STP", Orange},
	{"HLF", Violet}, {"DBL", Violet}, {"ROL", Accent}, {"FLT", Accent},
	{"ECH", Accent}, {"CRS", Accent}, {"CAT", White}, {"GRB", White},
}

// round is JavaScript's Math.round, as the prototype measured with it.
func round(x float64) int { return int(math.Floor(x + 0.5)) }

// Counter is beats as the screen counts them: bars and beats (012.3), and
// the sixteenth (.2).
func Counter(beats float64) (main, six string) {
	beats = max(0, beats)
	bar := int(math.Floor(beats/4)) + 1
	beat := int(math.Floor(math.Mod(beats, 4))) + 1
	sixteenth := int(math.Floor(math.Mod(beats*4, 4))) + 1
	return fmt.Sprintf("%03d.%d", bar, beat), "." + strconv.Itoa(sixteenth)
}

// Pan is a pan's place, 0-127 with 64 centre, as words: C, L50, R12.
func Pan(v int) string {
	p := round(float64(v-64) / 63 * 50)
	switch {
	case p == 0:
		return "C"
	case p < 0:
		return "L" + strconv.Itoa(-p)
	}
	return "R" + strconv.Itoa(p)
}

// FaderDB is a fader's place, 0-127 with 100 at 0 dB, in decibels: +1, -2,
// -INF.
func FaderDB(v int) string {
	if v <= 0 {
		return "-INF"
	}
	d := 20 * math.Log10(float64(v)/100)
	s := strconv.FormatFloat(d, 'f', 0, 64)
	if d >= 0 {
		s = "+" + s
	}
	return s
}

// FaderOf is the fader's place for a gain in dB: the inverse of FaderDB.
func FaderOf(db float64) int {
	if math.IsInf(db, -1) || math.IsNaN(db) {
		return 0
	}
	return min(127, max(0, round(100*math.Pow(10, db/20))))
}

func padLeft(s string, n int) string {
	if len(s) >= n {
		return s
	}
	return strings.Repeat(" ", n-len(s)) + s
}

func cut(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// Layout is the screen for s, in the order it is drawn: a later item covers
// an earlier one.
func Layout(s State) []Item {
	var out []Item
	add := func(it Item) {
		if it.Kind != KindText || it.S != "" { // an empty TEXT removes what's there
			out = append(out, it)
		}
	}
	mix := s.Page == PageMixer

	// The top line: the tape and its tempo. The name is cut before the tempo.
	tempo := "FREE"
	if s.Tempo > 0 {
		tempo = strconv.Itoa(round(s.Tempo)) + " BPM"
	}
	add(TextItem(nameX, nameY, 2, Text, Black, cut(s.Tape, (tempoX-nameX)/12)))
	add(TextItem(tempoX, tempoY, 1, Dim, Black, tempo))

	// The counter, with the transport beside it.
	main, six := "---.-", ""
	if s.Tempo > 0 {
		main, six = Counter(s.Beats)
	}
	out = append(out, counterItems(main, six)...)
	label, box, fg := "STOP", Panel, Text
	switch {
	case s.Recording:
		label, box, fg = "REC", Red, White
	case s.Playing:
		label, box, fg = "PLAY", Green, Black
	}
	add(BoxItem(transportX, counterY, transportW, 28, box))
	add(TextItem(transportX+round(float64(transportW-len(label)*12)/2), 41, 2, fg, box, label))

	// The armed track under it, with any solos and mutes on the right.
	lead, leadColour := "NO TRACK ARMED", Dim
	if s.Armed >= 1 && s.Armed <= 4 {
		lead, leadColour = "ARM T"+strconv.Itoa(s.Armed), Track(s.Armed)
	}
	add(TextItem(6, lineY, 1, leadColour, Black, lead))
	if tail := soloMute(s.Solo, s.Mute, rightEdge-(6+len(lead)*6+6)); tail != "" {
		add(TextItem(rightEdge-len(tail)*6, lineY, 1, Dim, Black, tail))
	}

	// The pad page and its map.
	add(BoxItem(0, 76, 240, 1, Panel))
	if mix {
		add(TextItem(6, 80, 1, Amber, Black, "MUTE"))
		add(TextItem(126, 80, 1, Amber, Black, "SELECT"))
	} else {
		add(TextItem(6, 80, 1, Accent, Black, "FX PADS"))
		add(TextItem(rightEdge-17*6, 80, 1, Dim, Black, "SHIFT: MIXER PAGE"))
	}
	for i := range 16 {
		col, row := i%8, i/8
		x, y := 1+col*30, 90+row*16
		var label string
		var colour Colour
		var on bool
		if mix {
			t := col % 4
			label, colour = strconv.Itoa(t+1), Track(t+1)
			switch {
			case i < 4:
				on = s.Mute[t]
			case i < 8:
				on = s.Selected == t+1
			case i < 12:
				on = s.Solo[t]
			default:
				on = s.Armed == t+1
			}
		} else {
			label, colour, on = FXPads[i].Label, FXPads[i].Colour, s.Held[i]
		}
		lx := x + round(float64(28-len(label)*6)/2)
		if on {
			add(BoxItem(x, y, 28, 14, colour))
			add(TextItem(lx, y+4, 1, Black, colour, label))
		} else {
			add(BoxItem(x, y, 28, 14, Panel))
			add(TextItem(lx, y+4, 1, colour, Panel, label))
		}
	}
	if mix {
		add(TextItem(6, 124, 1, Amber, Black, "SOLO"))
		add(TextItem(126, 124, 1, Amber, Black, "ARM"))
	}

	// The levels of tracks 1-4, each fader's place a tick on its meter.
	soloed := s.Solo[0] || s.Solo[1] || s.Solo[2] || s.Solo[3]
	for t := range 4 {
		y := 136 + t*9
		lit := s.LitFader == t
		silent := s.Mute[t] || (soloed && !s.Solo[t])
		name, tick := Track(t+1), Dim
		if lit {
			name, tick = White, White
		}
		meter := s.Meter[t]
		if silent {
			meter = 0
		}
		fader := min(127, max(0, s.Fader[t]))
		add(TextItem(6, y, 1, name, Black, strconv.Itoa(t+1)))
		add(BarItem(16, y+1, 180, 5, meter, Track(t+1), Panel))
		add(BoxItem(16+round(178*float64(fader)/127), y, 2, 7, tick))
		db := FaderDB(fader)
		if s.Mute[t] {
			db = "M"
		}
		add(TextItem(rightEdge-4*6, y, 1, tick, Black, padLeft(db, 4)))
	}

	// The knobs, in the panel's two rows.
	add(BoxItem(0, 172, 240, 1, Panel))
	for k, kn := range s.Knobs {
		x, y := (k%4)*60, 176+(k/4)*32
		name, value, bar := Dim, Text, Dim
		if s.LitKnob == k {
			name, value, bar = White, kn.Lit, kn.Lit
		}
		add(TextItem(x+4, y, 1, name, Black, cut(kn.Name, 9)))
		add(TextItem(x+4, y+10, 2, value, Black, cut(kn.Value, 4)))
		if kn.Amount >= 0 {
			add(BarItem(x+4, y+26, 52, 2, kn.Amount, bar, Panel))
		}
	}

	// The banner, last, so it covers the top line.
	if b := s.Banner; b != nil && b.Words != "" {
		fg := Black
		if b.Colour == Red {
			fg = White
		}
		add(BoxItem(0, 0, 240, 28, b.Colour))
		add(TextItem(TopX, nameY, BannerScale, fg, b.Colour, b.Words))
	}
	return out
}

// counterItems are the counter's bars and beats at scale 4 and its
// sixteenth at scale 2 after them, as the prototype has them up to bar 999.
// Past it they are made to fit before the transport: the sixteenth at
// scale 1, then the counter smaller.
func counterItems(main, six string) []Item {
	for ms := 4; ms >= 1; ms-- {
		end := counterX + len(main)*6*ms
		for ss := 2; ss >= 1; ss-- {
			if end+len(six)*6*ss <= transportX {
				items := []Item{TextItem(counterX, counterY, ms, Text, Black, main)}
				if six != "" {
					// On the counter's foot.
					items = append(items, TextItem(end, counterY+7*ms-7*ss, ss, Dim, Black, six))
				}
				return items
			}
		}
	}
	return []Item{TextItem(counterX, counterY, 1, Text, Black, cut(main, (transportX-counterX)/6))}
}

// soloMute names the soloed and muted tracks in room pixels or fewer: SOLO
// 1 2  MUTE 4, closed up to SOLO 12  MUTE 4 or S12 M4 when that doesn't fit.
func soloMute(solo, mute [4]bool, room int) string {
	tracks := func(on [4]bool, sep string) string {
		var ns []string
		for i, b := range on {
			if b {
				ns = append(ns, strconv.Itoa(i+1))
			}
		}
		return strings.Join(ns, sep)
	}
	var last string
	for _, f := range []struct{ solo, mute, sep, gap string }{
		{"SOLO ", "MUTE ", " ", "  "},
		{"SOLO ", "MUTE ", "", "  "},
		{"S", "M", "", " "},
	} {
		var parts []string
		if s := tracks(solo, f.sep); s != "" {
			parts = append(parts, f.solo+s)
		}
		if m := tracks(mute, f.sep); m != "" {
			parts = append(parts, f.mute+m)
		}
		last = strings.Join(parts, f.gap)
		if len(last)*6 <= room {
			return last
		}
	}
	return cut(last, max(0, room/6))
}
