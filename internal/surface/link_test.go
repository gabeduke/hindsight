package surface

import (
	"fmt"
	"math/rand"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The link, as the unit showed it (docs/architecture/keyboard.md, *Learnt on
// the unit*): over the Pi's USB MIDI a frame of about 700 bytes or more
// never arrives (764 was lost, 624 acked in 2 ms), and an ack can be lost
// like any message. Where it goes was found on the unit: Linux puts all of
// it on the wire, and the keyboard's SysEx reader loses a frame that comes
// in one burst (internal/api writes chunks, which it takes). This models
// what was seen, so a client that sends what the unit can't take never
// draws its screen here.

// unitLoses is the shortest frame the model loses: the edge seen on the
// unit, rounded down.
const unitLoses = 700

// unit is the keyboard's firmware as far as the link sees it
// (app/hindsight.c in gabeduke/smk37-hindsight): one frame at a time, each
// acked with its seq; the screen's list, at most MaxItems, by kind and
// place; the lights; where the knobs stand and their echo.
type unit struct {
	t      *testing.T
	active bool
	items  []Item
	lights map[int]Item
	knobs  map[int]Item
	got    int // frames that arrived
	lost   int // frames lost on the way
}

func (u *unit) place(it Item) byte {
	if !u.active {
		return statusReleased
	}
	for i, have := range u.items {
		if have.place() == it.place() {
			if it.removes() {
				u.items = append(u.items[:i:i], u.items[i+1:]...)
			} else {
				u.items[i] = it
			}
			return statusOK
		}
	}
	if it.removes() {
		return statusOK
	}
	if len(u.items) == MaxItems {
		return 3 // full
	}
	u.items = append(u.items, it)
	return statusOK
}

func (u *unit) do(it Item) byte {
	switch it.Kind {
	case KindLED:
		if !u.active {
			return statusReleased
		}
		u.lights[it.X] = it
		return statusOK
	case KindKnob:
		u.knobs[it.X] = it
		return statusOK
	}
	return u.place(it)
}

// receive is a frame from the Pi; it answers the ack, or nil when the
// frame never arrived.
func (u *unit) receive(f []byte) []byte {
	if len(f) >= unitLoses {
		u.lost++
		return nil
	}
	u.got++
	v, seq, cmd := f[4], f[5], f[6]
	reply := func(status byte, extra ...byte) []byte {
		return append(append([]byte{0xF0, 0x7D, 'H', 'S', v, seq, cmdAck, status}, extra...), 0xF7)
	}
	switch cmd {
	case cmdHello:
		return reply(statusOK, 2, MaxItems, EchoPads|EchoKnobs|QuietClock)
	case cmdClear:
		u.active, u.items, u.knobs = true, nil, map[int]Item{} // a CLEAR forgets the knobs' places
		return reply(statusOK)
	case cmdRelease:
		u.active, u.lights, u.knobs = false, map[int]Item{}, map[int]Item{}
		return reply(statusOK)
	case cmdBatch:
		done := 0
		for _, it := range decodeBatch(u.t, f[7:len(f)-1]) {
			if st := u.do(it); st != statusOK {
				return reply(st, byte(done&127), byte(done>>7))
			}
			done++
		}
		return reply(statusOK, byte(done&127), byte(done>>7))
	}
	return reply(1) // unknown
}

// turn is encoder i turned to value on the panel: its value written where
// its KNOB said, in each item's own style, as the firmware's echo does.
func (u *unit) turn(i, value int) {
	k, ok := u.knobs[i]
	if !ok || !k.Echo || !u.active {
		return
	}
	for n, it := range u.items {
		if it.Kind == KindText && it.X == k.At[0] && it.Y == k.At[1] {
			u.items[n].S = strconv.Itoa(value)
		}
		if it.Kind == KindBar && it.X == k.At[2] && it.Y == k.At[3] {
			u.items[n].Value = value
		}
	}
	k.Value = value
	u.knobs[i] = k
}

// screenOf is a list as lines, sorted: the same items in any order.
func screenOf(items []Item) string {
	lines := make([]string, len(items))
	for i, it := range items {
		lines[i] = it.String()
	}
	slices.Sort(lines)
	return strings.Join(lines, "\n")
}

// coversAsWanted is the first pair of items that overlap on the keyboard in
// the other order from want's, which would draw the wrong one on top.
func coversAsWanted(have, want []Item) (Item, Item, bool) {
	at := map[place]int{}
	for i, it := range want {
		at[it.place()] = i
	}
	for i, a := range have {
		for _, b := range have[i+1:] {
			if overlaps(a, b) && at[a.place()] > at[b.place()] {
				return a, b, false
			}
		}
	}
	return Item{}, Item{}, true
}

// linkRun drives a Keyboard against the unit over a link that loses frames
// of unitLoses or more and drops acks at random (dropAcks of them), for
// steps of 20 ms with the screen changing (and a knob turned on the panel)
// at random. Then, the link quiet, the keyboard's screen must be the last
// state's Layout, its lights the last state's, and its knobs where it says.
func linkRun(t *testing.T, seed int64, dropAcks float64) {
	t.Helper()
	rnd := rand.New(rand.NewSource(seed))
	r := newRig(t)
	u := &unit{t: t, lights: map[int]Item{}, knobs: map[int]Item{}}
	retake := make(chan struct{}, 64)
	r.k.OnPresent(func() { retake <- struct{}{} })
	names := []string{"TAPE 3", "A VERY LONG TAPE NAME INDEED", "JAM", "SUNDAY 2026-10-29 07:41"}
	state := atRest()
	drop := dropAcks
	deliver := func() {
		for _, f := range r.take() {
			if len(f) > MaxFrame {
				t.Fatalf("seed %d: a %d-byte frame, over MaxFrame %d", seed, len(f), MaxFrame)
			}
			a := u.receive(f)
			if a != nil && rnd.Float64() >= drop {
				r.k.Feed(a)
			}
		}
		select {
		case <-retake:
			r.k.Clear(Black)
		default:
		}
	}
	for step := range 1500 {
		switch n := rnd.Intn(20); {
		case n == 0:
			state.Tape = names[rnd.Intn(len(names))]
		case n < 4:
			state.Beats += rnd.Float64() * 8
			state.Playing = !state.Playing
			state.Meter = [4]int{rnd.Intn(128), rnd.Intn(128), rnd.Intn(128), rnd.Intn(128)}
		case n < 6:
			k, v := rnd.Intn(7), rnd.Intn(128)
			value := strconv.Itoa(v)
			if rnd.Intn(3) == 0 {
				value = Pan(v) // a value that isn't its number: no places, no echo
			}
			state.Knobs[k] = Knob{Name: state.Knobs[k].Name, Value: value, Amount: v, Lit: Accent}
			state.LitKnob = k
		case n == 6:
			// The panel: a turn the keyboard echoes, then the Pi hears it.
			k, v := rnd.Intn(7), rnd.Intn(128)
			u.turn(k, v)
			r.k.Turned(k, v)
		case n == 7:
			state.Solo[rnd.Intn(4)] = rnd.Intn(2) == 0
			state.Mute[rnd.Intn(4)] = rnd.Intn(2) == 0
			state.Armed = rnd.Intn(5)
		}
		r.k.Show(state)
		r.advance(20 * time.Millisecond)
		deliver()
		_ = step
	}
	// Quiet: nothing lost, nothing changing, until the screen settles.
	drop = 0
	state.LitKnob = -1
	r.k.Show(state)
	for range 400 {
		r.advance(20 * time.Millisecond)
		r.k.Show(state)
		deliver()
	}
	if !r.k.Status().Screen {
		t.Fatalf("seed %d: the keyboard's screen isn't Hindsight's after the link settled (%d frames lost)", seed, u.lost)
	}
	if got, want := screenOf(u.items), screenOf(Layout(state)); got != want {
		t.Fatalf("seed %d: the keyboard shows\n%s\nwant\n%s", seed, got, want)
	}
	if a, b, ok := coversAsWanted(u.items, Layout(state)); !ok {
		t.Fatalf("seed %d: %v is drawn under %v", seed, a, b)
	}
	for _, want := range Lamps(state, [Pads]Stage{}, false) {
		if got := u.lights[want.X]; got != want {
			t.Fatalf("seed %d: light %d is %v, want %v", seed, want.X, got, want)
		}
	}
	for _, want := range Stands(state, true) {
		if got := u.knobs[want.X]; got != want {
			t.Fatalf("seed %d: knob %d stands %+v, want %+v", seed, want.X, got, want)
		}
	}
}

// Over the link as the unit showed it, with acks lost too, the screen, its
// lights and its knobs end up as the Pi wants them, whatever was sent on
// the way. A client sending frames the unit loses (MaxFrame 1,024, as
// before #202) never draws here: it is forgotten and retaken, blank, over
// and over, as Gabe saw on the rig.
func TestTheScreenSettlesOverTheUnitsLink(t *testing.T) {
	for seed := range int64(6) {
		t.Run(fmt.Sprint(seed), func(t *testing.T) { linkRun(t, seed, 0.05) })
	}
}
