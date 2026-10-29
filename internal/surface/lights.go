package surface

// The pads' and buttons' lights on protocol version 2 (LED, command 08;
// docs/plan/the-instrument.md, step 7, *The pad lights* and *The button
// lights*). A pad is its family's colour on the FX page, or its track's on
// the Mixer page, at one of three stages: dim at rest, half the moment it
// is pressed, and full while what it does is heard. A command pad (CATCH,
// GRAB) is half from its press until it is done, then flashes full once.
// The Pi lights PLAY, REC and SHIFT; the rest stay the keyboard's.
//
// Lamps is the lights for a State and the pads' stages; PadLights keeps
// each pad's stage over time: when it was pressed, when what it does is
// heard and stops being heard, and a command pad's flash. The Keyboard
// keeps one, asks it for the stages on every Tick, and sends only the
// lights that changed, in its BATCH frames with the screen's changes.

import (
	"fmt"
	"time"
)

// KindLED is LED's command: a light, not a screen item. It is kept apart
// from the screen's list, as the keyboard keeps it: a CLEAR leaves the
// lights as they are, and HOME gives them all back.
const KindLED Kind = cmdLED

// Stage is how bright a pad is.
type Stage uint8

const (
	StageRest Stage = iota // dim
	StageHalf              // pressed, not heard yet
	StageFull              // heard
)

// stageLevel is each stage's share of the colour, as the prototype draws
// it (~/programming/hindsight-design/smk: opacity .18, .55 and 1).
var stageLevel = [...]float64{StageRest: 0.18, StageHalf: 0.55, StageFull: 1}

// Light is a button's: off, on or blinking (250 ms on, 250 ms off).
type Light uint8

const (
	LightOff Light = iota
	LightOn
	LightBlink
)

// The buttons the Pi lights, by the panel's ids (app/hindsight.h). The
// others stay the keyboard's: nothing is sent for them.
const (
	ButtonShift = 0
	ButtonPlay  = 16
	ButtonRec   = 17
)

// Pads is how many pads the keyboard has.
const Pads = 16

// FlashFor is how long a command pad flashes full, once it is done.
const FlashFor = 150 * time.Millisecond

// palette is the firmware's sixteen colours in RGB565, as the screen draws
// them (app/screen.c, hindsight_palette): a pad is lit in the same colour
// as its cell on the screen.
var palette = [coloursV2]uint16{
	0x0000, 0x18e3, 0xef5d, 0x738e, 0x07ff, 0x07e0, 0xfd20, // version 1's
	0x3cbb, 0x2d94, 0xdd02, 0xe2b3, // the tracks, T1-T4
	0xf1e6, 0xfbe5, 0xa39e, 0xffff, 0x0945, // red, orange, violet, white, deep
}

// RGB is c as the screen draws it, each 0-255.
func (c Colour) RGB() (r, g, b int) {
	if c >= coloursV2 {
		return 0, 0, 0
	}
	v := int(palette[c])
	r5, g6, b5 := v>>11, v>>5&63, v&31
	return r5<<3 | r5>>2, g6<<2 | g6>>4, b5<<3 | b5>>2
}

// PadItem is LED for pad 0-15 in c at stage: the colour's RGB as LED's
// levels, 0-127, at the stage's share.
func PadItem(pad int, c Colour, stage Stage) Item {
	r, g, b := c.RGB()
	f := stageLevel[min(int(stage), len(stageLevel)-1)]
	level := func(v int) int { return round(float64(v) * 127 / 255 * f) }
	return Item{Kind: KindLED, X: pad, Lamp: [3]int{level(r), level(g), level(b)}}
}

// ButtonItem is LED for button id at l.
func ButtonItem(id int, l Light) Item {
	return Item{Kind: KindLED, X: Pads + id, Lamp: [3]int{int(l)}}
}

// isPad says whether an LED item is a pad's (else a button's).
func (it Item) isPad() bool { return it.X < Pads }

// ledPayload is LED's payload: <pad> <r> <g> <b>, or <16 + id> <state>.
func (it Item) ledPayload() []byte {
	if it.isPad() {
		return []byte{byte(it.X), byte(it.Lamp[0]), byte(it.Lamp[1]), byte(it.Lamp[2])}
	}
	return []byte{byte(it.X), byte(it.Lamp[0])}
}

// ledString is the LED as the simulator's script has it.
func (it Item) ledString() string {
	if it.isPad() {
		return fmt.Sprintf("led pad %d %d %d %d", it.X, it.Lamp[0], it.Lamp[1], it.Lamp[2])
	}
	return fmt.Sprintf("led button %d %d", it.X-Pads, it.Lamp[0])
}

// Lamps is the lights for s, with the pads at stages and SHIFT held or
// not: the sixteen pads, then SHIFT, PLAY and REC.
//   - The FX page, by family: T1-T4 in their tracks' colours, BREAK,
//     REVERSE, CHOP and STOP orange, HALF and DOUBLE violet, ROLL, FILTER,
//     ECHO and CRUSH cyan (the accent), CATCH and GRAB white (FXPads).
//   - The Mixer page: every pad in its track's colour, full when on (muted,
//     selected, soloed, armed) and dim when off.
//   - PLAY on while the tape plays; REC on while recording, and blinking
//     while the tape plays with a track armed; SHIFT on while held (shift).
func Lamps(s State, stages [Pads]Stage, shift bool) []Item {
	out := make([]Item, 0, Pads+3)
	for i := range Pads {
		if s.Page == PageMixer {
			t := i % 4
			on := [4]bool{s.Mute[t], s.Selected == t+1, s.Solo[t], s.Armed == t+1}[i/4]
			stage := StageRest
			if on {
				stage = StageFull
			}
			out = append(out, PadItem(i, Track(t+1), stage))
			continue
		}
		out = append(out, PadItem(i, FXPads[i].Colour, stages[i]))
	}
	rec := LightOff
	switch {
	case s.Recording:
		rec = LightOn
	case s.Playing && s.Armed >= 1 && s.Armed <= 4:
		rec = LightBlink
	}
	return append(out,
		ButtonItem(ButtonShift, onOff(shift)),
		ButtonItem(ButtonPlay, onOff(s.Playing)),
		ButtonItem(ButtonRec, rec))
}

func onOff(on bool) Light {
	if on {
		return LightOn
	}
	return LightOff
}

// relit is the lights in want that lit (the keyboard's, by target) hasn't
// got as they are, in want's order.
func relit(lit map[int]Item, want []Item) []Item {
	var out []Item
	for _, it := range want {
		if have, ok := lit[it.X]; !ok || have != it {
			out = append(out, it)
		}
	}
	return out
}

// AwaitFor is the longest a pad let go before anything of it is heard
// stays half, waiting for its press to land: a bar at 60 BPM, the longest
// a quantised press waits. Its landing, or its release's, ends it sooner.
const AwaitFor = 4 * time.Second

// padTimeline is one pad's light over time. presses: pressed on the
// keyboard and not let go, or a command pad's verbs not done yet. await:
// let go before its press was heard, half until then. on and off: when
// what it does is heard and stops being heard, zero when not known.
// flash: a command pad's full until then.
type padTimeline struct {
	presses int
	await   time.Time
	on, off time.Time
	flash   time.Time
}

// PadLights keeps each pad's stage over time. Its times are the Keyboard's
// clock's; a landing's is when it is heard, which the API works out from
// Play mode's landing frame and the lead (internal/api's keyboardLandings).
// It is not safe for use by more than one goroutine: the Keyboard's lock
// guards it.
type PadLights struct {
	pads [Pads]padTimeline
}

func padOK(i int) bool { return i >= 0 && i < Pads }

// Down is pad i pressed on the keyboard, or a command pad's verb queued:
// half, until what it does is heard, or the verb is done.
func (p *PadLights) Down(i int) {
	if padOK(i) {
		p.pads[i].presses++
	}
}

// Up is pad i let go on the keyboard at now. It stays full while what it
// does is still heard, until its release lands; let go before its press
// is heard, it stays half until it is (at most AwaitFor).
func (p *PadLights) Up(i int, now time.Time) {
	if !padOK(i) || p.pads[i].presses == 0 {
		return
	}
	pd := &p.pads[i]
	pd.presses--
	if pd.presses == 0 && pd.on.IsZero() {
		pd.await = now.Add(AwaitFor)
	}
}

// Landing is a pad's press (On) or release landed, and when it is heard.
type Landing struct {
	Pad int
	On  bool
	At  time.Time
}

// Landed takes the landings since the last, and which pads the tape held
// before them. A press's landing lights its pad full from its time; a
// release's puts it back from its own, and lights nothing with no press
// known. A pad heard, with no release known, that the tape no longer
// holds and that landed nothing now, goes back at now.
func (p *PadLights) Landed(held [Pads]bool, landed []Landing, now time.Time) {
	var touched [Pads]bool
	for _, l := range landed {
		if !padOK(l.Pad) {
			continue
		}
		touched[l.Pad] = true
		pd := &p.pads[l.Pad]
		pd.await = time.Time{} // heard of, one way or the other
		if l.On {
			pd.on, pd.off = l.At, time.Time{}
		} else if !pd.on.IsZero() {
			pd.off = l.At
		}
	}
	for i := range p.pads {
		if pd := &p.pads[i]; !touched[i] && !pd.on.IsZero() && pd.off.IsZero() && !held[i] {
			pd.off = now
		}
	}
}

// Fresh is the tape's pads as the screen is taken (again), with nothing
// known of them since the screen went (the Keyboard starts its PadLights
// again then, and what landed meanwhile isn't replayed): a pad the tape
// holds is full from now, since it is heard.
func (p *PadLights) Fresh(held [Pads]bool, now time.Time) {
	for i := range p.pads {
		if pd := &p.pads[i]; held[i] && pd.on.IsZero() {
			pd.on, pd.off, pd.await = now, time.Time{}, time.Time{}
		}
	}
}

// Done is one of command pad i's verbs done at now: it flashes full for
// FlashFor if it went through (ok), and is half again after while another
// press of it waits.
func (p *PadLights) Done(i int, ok bool, now time.Time) {
	if !padOK(i) {
		return
	}
	if p.pads[i].presses > 0 {
		p.pads[i].presses--
	}
	if ok {
		p.pads[i].flash = now.Add(FlashFor)
	}
}

// Next is the first time after now at which a stage changes, zero for none.
func (p *PadLights) Next(now time.Time) time.Time {
	var next time.Time
	for _, pd := range p.pads {
		for _, t := range []time.Time{pd.on, pd.off, pd.flash, pd.await} {
			if t.After(now) && (next.IsZero() || t.Before(next)) {
				next = t
			}
		}
	}
	return next
}

// Stages is each pad's stage at now, forgetting what is over.
func (p *PadLights) Stages(now time.Time) [Pads]Stage {
	var out [Pads]Stage
	for i := range p.pads {
		pd := &p.pads[i]
		if !pd.off.IsZero() && !now.Before(pd.off) {
			pd.on, pd.off = time.Time{}, time.Time{}
		}
		if !pd.flash.IsZero() && !now.Before(pd.flash) {
			pd.flash = time.Time{}
		}
		if !pd.await.IsZero() && !now.Before(pd.await) {
			pd.await = time.Time{}
		}
		switch {
		case !pd.flash.IsZero():
			out[i] = StageFull
		case !pd.on.IsZero() && !now.Before(pd.on):
			out[i] = StageFull
		case pd.presses > 0 || !pd.on.IsZero() || !pd.await.IsZero():
			out[i] = StageHalf // pressed, or its press still to be heard
		}
	}
	return out
}
