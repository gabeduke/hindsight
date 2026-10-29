package surface

// The screen on protocol version 2 is a list of items (app/hindsight.h): a
// TEXT, a BOX or a BAR, each found by its kind and its place. A later item
// covers an earlier one where they overlap; a replaced item keeps its place
// in the order, and a new one goes last. Layout makes the list the screen
// should be; plan (diff.go) is what to send to make it so.

import (
	"fmt"
	"strings"
)

// Kind is an item's kind: its command's number.
type Kind byte

const (
	KindText Kind = cmdText
	KindBox  Kind = cmdBox
	KindBar  Kind = cmdBar
	// KindKnob is KNOB: where an encoder stands, not a screen item, kept
	// apart from the list as the lights are (Stands, in layout.go).
	KindKnob Kind = cmdKnob
)

// Item is one thing on the screen. A TEXT is S at (X, Y) at Scale in Colour
// on Back; a BOX fills W by H at (X, Y) in Colour; a BAR fills the left
// Value/127 of its W by H in Colour and the rest in Back. An LED (lights.go)
// is a light, not on the screen: X is its target, a pad 0-15 or 16 + a
// button's id, and Lamp a pad's red, green and blue, 0-127, or a button's
// Light first. A KNOB is where encoder X stands, at Value; with Echo, At is
// where its value is drawn, the TEXT's x and y then the BAR's, which a turn
// on the keyboard writes into.
type Item struct {
	Kind         Kind
	X, Y, W, H   int
	Scale        int
	Colour, Back Colour
	Value        int
	S            string
	Lamp         [3]int
	At           [4]int
	Echo         bool
}

// TextItem is a TEXT: s cleaned to what the keyboard draws (capitals,
// printable, cut to fit the screen and MaxText).
func TextItem(x, y, scale int, c, back Colour, s string) Item {
	return Item{Kind: KindText, X: x, Y: y, Scale: scale, Colour: c, Back: back, S: cleanText(x, scale, strings.ToUpper(s))}
}

// BoxItem is a BOX.
func BoxItem(x, y, w, h int, c Colour) Item {
	return Item{Kind: KindBox, X: x, Y: y, W: w, H: h, Colour: c}
}

// BarItem is a BAR, its value clamped to 0-127.
func BarItem(x, y, w, h, value int, c, back Colour) Item {
	return Item{Kind: KindBar, X: x, Y: y, W: w, H: h, Value: min(127, max(0, value)), Colour: c, Back: back}
}

// cleanText is s as the keyboard takes it at x and scale: printable, cut to
// what fits and to MaxText.
func cleanText(x, scale int, s string) string {
	var b strings.Builder
	for _, r := range s {
		if r < ' ' || r > '~' {
			r = '?'
		}
		b.WriteRune(r)
	}
	t := b.String()
	if scale >= 1 {
		if fit := (Width - x) / (6 * scale); len(t) > fit {
			t = t[:max(0, fit)]
		}
	}
	if len(t) > MaxText {
		t = t[:MaxText]
	}
	return t
}

type place struct {
	kind Kind
	x, y int
}

func (it Item) place() place { return place{it.Kind, it.X, it.Y} }

// Rect is what the item covers: [x0, x1) by [y0, y1).
func (it Item) Rect() (x0, y0, x1, y1 int) {
	if it.Kind == KindText {
		return it.X, it.Y, it.X + len(it.S)*6*it.Scale, it.Y + 7*it.Scale
	}
	return it.X, it.Y, it.X + it.W, it.Y + it.H
}

// overlaps says whether two items cover a pixel in common.
func overlaps(a, b Item) bool {
	ax0, ay0, ax1, ay1 := a.Rect()
	bx0, by0, bx1, by1 := b.Rect()
	return ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1
}

// removal is the command that takes the item at it's place away: a TEXT
// with no text, a BOX or a BAR of no size.
func (it Item) removal() Item {
	out := Item{Kind: it.Kind, X: it.X, Y: it.Y}
	if it.Kind == KindText {
		out.Scale, out.Colour = 1, Text
	}
	return out
}

// removes says whether the item is a removal. A light never is: it is set,
// to off if need be.
func (it Item) removes() bool {
	if it.Kind == KindLED || it.Kind == KindKnob {
		return false
	}
	if it.Kind == KindText {
		return it.S == ""
	}
	return it.W == 0 || it.H == 0
}

func put14(b []byte, vs ...int) []byte {
	for _, v := range vs {
		b = append(b, byte(v&127), byte(v>>7&127))
	}
	return b
}

// payload is the item's command payload in version 2.
func (it Item) payload() []byte {
	switch it.Kind {
	case KindText:
		b := put14(nil, it.X, it.Y)
		return append(append(b, byte(it.Scale), byte(it.Colour), byte(it.Back)), it.S...)
	case KindBox:
		return append(put14(nil, it.X, it.Y, it.W, it.H), byte(it.Colour))
	case KindLED:
		return it.ledPayload()
	case KindKnob:
		b := []byte{byte(it.X), byte(it.Value)}
		if it.Echo {
			b = put14(b, it.At[:]...)
		}
		return b
	default:
		return append(put14(nil, it.X, it.Y, it.W, it.H), byte(it.Value), byte(it.Colour), byte(it.Back))
	}
}

// String is the item as a line of the fork's screen simulator's script
// (gabeduke/smk37-hindsight's tools/screen/screen.c), spaces in a
// TEXT written as underscores: the golden lists are in this form, so the
// simulator draws them as they are.
func (it Item) String() string {
	switch it.Kind {
	case KindText:
		return fmt.Sprintf("text %d %d %d %d %d %s", it.X, it.Y, it.Scale, it.Colour, it.Back, strings.ReplaceAll(it.S, " ", "_"))
	case KindBox:
		return fmt.Sprintf("box %d %d %d %d %d", it.X, it.Y, it.W, it.H, it.Colour)
	case KindLED:
		return it.ledString()
	case KindKnob:
		// The simulator's "knob" turns an encoder; this is the Pi's KNOB.
		return "sysex " + fmt.Sprintf("% X", append(append([]byte{0xF0, 0x7D, 'H', 'S', 2, 0, cmdKnob}, it.payload()...), 0xF7))
	default:
		return fmt.Sprintf("bar %d %d %d %d %d %d %d", it.X, it.Y, it.W, it.H, it.Value, it.Colour, it.Back)
	}
}
