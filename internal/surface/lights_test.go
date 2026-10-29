package surface

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

// golden is a command list written one per line, as lines writes it.
func golden(ls ...string) string {
	if len(ls) == 0 {
		return ""
	}
	return strings.Join(ls, "\n") + "\n"
}

func expectLamps(t *testing.T, what string, got []Item, want string) {
	t.Helper()
	if lines(got) != want {
		t.Fatalf("%s:\n%s", what, lineDiff(want, lines(got)))
	}
}

// restLamps is the FX page at rest, the tape standing: every pad dim in its
// family's colour, and the three buttons the Pi lights off.
var restLamps = golden(
	"led pad 0 5 13 20", // T1-T4, their tracks' colours
	"led pad 1 4 16 15",
	"led pad 2 20 15 1",
	"led pad 3 21 8 14",
	"led pad 4 23 11 4", // BREAK, REVERSE, CHOP, STOP: orange
	"led pad 5 23 11 4",
	"led pad 6 23 11 4",
	"led pad 7 23 11 4",
	"led pad 8 15 10 22", // HALF, DOUBLE: violet
	"led pad 9 15 10 22",
	"led pad 10 0 23 23", // ROLL, FILTER, ECHO, CRUSH: cyan
	"led pad 11 0 23 23",
	"led pad 12 0 23 23",
	"led pad 13 0 23 23",
	"led pad 14 23 23 23", // CATCH, GRAB: white
	"led pad 15 23 23 23",
	"led button 0 0", // SHIFT, PLAY, REC
	"led button 16 0",
	"led button 17 0",
)

// lit is a rig on version 2 with the screen at rest drawn and its lights
// sent, nothing waiting.
func lit(t *testing.T) *rig {
	t.Helper()
	r := newRig(t)
	r.presentV2()
	r.k.Show(atRest())
	expectLamps(t, "the lights at rest", r.lamps(), restLamps)
	return r
}

// At rest the pads are dim by family and the buttons off; standing, nothing
// more is sent.
func TestTheLightsAtRest(t *testing.T) {
	r := lit(t)
	r.advance(time.Second)
	r.k.Show(atRest())
	expectLamps(t, "standing", r.lamps(), "")
}

// A pad is half the moment it is pressed and full when what it does is
// heard, at its landing's time; it stays full, let go, until its release
// is heard, then dim.
func TestAPadIsHalfThenFullAtItsLandingThenDim(t *testing.T) {
	r := lit(t)
	r.k.PadDown(4) // BREAK
	expectLamps(t, "pressed", r.lamps(), golden("led pad 4 70 34 11"))
	held := [Pads]bool{4: true}
	r.k.PadsLanded(held, []Landing{{4, true, r.clock.Add(120 * time.Millisecond)}})
	expectLamps(t, "its landing known", r.lamps(), "")
	r.advance(100 * time.Millisecond)
	expectLamps(t, "before its landing", r.lamps(), "")
	r.advance(20 * time.Millisecond)
	expectLamps(t, "at its landing", r.lamps(), golden("led pad 4 127 62 20"))
	r.k.PadUp(4)
	expectLamps(t, "let go, its release not heard yet", r.lamps(), "")
	r.k.PadsLanded([Pads]bool{}, []Landing{{4, false, r.clock.Add(60 * time.Millisecond)}})
	r.advance(40 * time.Millisecond)
	expectLamps(t, "before its release is heard", r.lamps(), "")
	r.advance(20 * time.Millisecond)
	expectLamps(t, "its release heard", r.lamps(), golden("led pad 4 23 11 4"))
}

// A pad let go before anything is heard of it goes back to dim at once.
func TestAPadLetGoUnheardGoesBackToDim(t *testing.T) {
	r := lit(t)
	r.k.PadDown(10)
	expectLamps(t, "pressed", r.lamps(), golden("led pad 10 0 70 70"))
	r.k.PadUp(10)
	expectLamps(t, "let go", r.lamps(), golden("led pad 10 0 23 23"))
}

// A pad heard that the tape lets go of with no release heard (a tape
// loaded under it) goes back to dim, rather than stay lit.
func TestAPadTheTapeLetGoOfGoesDim(t *testing.T) {
	r := lit(t)
	r.k.PadsLanded([Pads]bool{}, []Landing{{7, true, r.clock}}) // pressed after the tape was read
	expectLamps(t, "heard", r.lamps(), golden("led pad 7 127 62 20"))
	r.k.PadsLanded([Pads]bool{7: true}, nil)
	expectLamps(t, "still held", r.lamps(), "")
	r.k.PadsLanded([Pads]bool{}, nil)
	expectLamps(t, "let go by the tape", r.lamps(), golden("led pad 7 23 11 4"))
}

// A command pad is half from its press until it is done, then flashes full
// once, for FlashFor; one refused goes back to dim with no flash.
func TestACommandPadFlashesFullOnceWhenDone(t *testing.T) {
	r := lit(t)
	r.k.PadDown(15) // GRAB
	expectLamps(t, "pressed", r.lamps(), golden("led pad 15 70 70 70"))
	r.advance(500 * time.Millisecond) // waiting for the bar
	expectLamps(t, "waiting", r.lamps(), "")
	r.k.PadDone(15, true)
	expectLamps(t, "done", r.lamps(), golden("led pad 15 127 127 127"))
	r.advance(FlashFor - 20*time.Millisecond)
	expectLamps(t, "flashing", r.lamps(), "")
	r.advance(20 * time.Millisecond)
	expectLamps(t, "the flash over", r.lamps(), golden("led pad 15 23 23 23"))

	r.k.PadDown(14) // CATCH
	expectLamps(t, "pressed", r.lamps(), golden("led pad 14 70 70 70"))
	r.k.PadDone(14, false)
	expectLamps(t, "refused", r.lamps(), golden("led pad 14 23 23 23"))
	r.advance(FlashFor)
	expectLamps(t, "refused, later", r.lamps(), "")
}

// PLAY is on while the tape plays; REC blinks while it plays with a track
// armed and is on while recording; SHIFT is on while held.
func TestTheButtonsLights(t *testing.T) {
	r := lit(t)
	s := atRest() // T2 armed
	s.Playing = true
	r.k.Show(s)
	expectLamps(t, "playing, T2 armed", r.lamps(), golden("led button 16 1", "led button 17 2"))
	s.Recording = true
	r.k.Show(s)
	expectLamps(t, "recording", r.lamps(), golden("led button 17 1"))
	s.Recording, s.Armed = false, 0
	r.k.Show(s)
	expectLamps(t, "playing, nothing armed", r.lamps(), golden("led button 17 0"))
	s.Shift = true
	r.k.Show(s)
	expectLamps(t, "SHIFT held", r.lamps(), golden("led button 0 1"))
	s.Playing, s.Shift = false, false
	r.k.Show(s)
	expectLamps(t, "stopped, SHIFT let go", r.lamps(), golden("led button 0 0", "led button 16 0"))
}

// The Mixer page: every pad its track's colour, full when on (mute,
// select, solo, arm), dim when off, whatever is held.
func TestTheMixerPagesLights(t *testing.T) {
	s := atRest() // T2 armed and selected
	s.Page, s.Mute[3], s.Solo[2] = PageMixer, true, true
	var held [Pads]Stage
	held[0] = StageFull
	got := Lamps(s, held)[:Pads]
	expectLamps(t, "the Mixer page", got, golden(
		"led pad 0 5 13 20", "led pad 1 4 16 15", "led pad 2 20 15 1", "led pad 3 115 42 78", // mute T4
		"led pad 4 5 13 20", "led pad 5 20 89 82", "led pad 6 20 15 1", "led pad 7 21 8 14", // select T2
		"led pad 8 5 13 20", "led pad 9 4 16 15", "led pad 10 111 81 8", "led pad 11 21 8 14", // solo T3
		"led pad 12 5 13 20", "led pad 13 20 89 82", "led pad 14 20 15 1", "led pad 15 21 8 14", // arm T2
	))
}

// A CLEAR keeps the lights, as the keyboard does: drawing the screen again
// whole sends none of them again.
func TestTheLightsSurviveAClear(t *testing.T) {
	r := lit(t)
	r.k.Clear(Black)
	got := r.take()
	if len(got) != 1 || got[0][6] != cmdClear {
		t.Fatalf("sent % x, want the CLEAR", got)
	}
	r.k.Feed(ack2(got[0][5], statusOK))
	if screen := r.batches(); lines(screen) != lines(Layout(atRest())) {
		t.Fatal("the screen wasn't drawn again whole")
	}
	expectLamps(t, "after a CLEAR", r.lamps(), "")
}

// HOME gives the lights back with the screen: nothing is lit after it, and
// when the screen is taken again every light is sent again.
func TestHomeGivesTheLightsBack(t *testing.T) {
	r := lit(t)
	r.k.Feed(frame(0, cmdRelease))
	r.k.PadDown(4)
	r.advance(r.k.AckTimeout)
	if got := r.take(); len(got) != 0 {
		t.Fatalf("lit after HOME: % x", got)
	}
	r.k.Clear(Black) // OFFER: the screen taken again
	got := r.take()
	r.k.Feed(ack2(got[0][5], statusOK))
	r.k.Show(atRest())
	want := strings.Replace(restLamps, "led pad 4 23 11 4", "led pad 4 70 34 11", 1) // BREAK still pressed
	expectLamps(t, "the screen taken again", r.lamps(), want)
}

// On version 1 nothing new is sent: LED is version 2's.
func TestVersion1LightsNothing(t *testing.T) {
	r := newRig(t)
	r.taken()
	r.k.Follow(func() State { s := atRest(); s.Playing = true; return s })
	r.k.PadDown(4)
	r.k.PadsLanded([Pads]bool{4: true}, []Landing{{4, true, r.clock}})
	r.k.PadDown(15)
	r.k.PadDone(15, true)
	r.advance(r.k.Refresh)
	r.advance(time.Second)
	expectSent(t, "pads and the tape playing", r.sentNow())
}

var lightsScript = flag.String("lights", "", "write the lights, as the Keyboard sends them, as a script for the firmware's screen simulator, with its light checks (tools/screen/run.sh)")

// With -lights, the lights at rest, a pad's press, landing and release, a
// command pad's flash and the buttons are written as a script for the
// firmware's simulator: each the frames a Keyboard sends, then a `light`
// check of what the firmware set, so the simulator says it took them. HOME
// last, and every light is the keyboard's again.
func TestWriteLightsScript(t *testing.T) {
	if *lightsScript == "" {
		t.Skip("no -lights")
	}
	var b strings.Builder
	b.WriteString("# Hindsight's internal/surface: the lights as its Keyboard sends them (go test -run TestWriteLightsScript -lights=...).\nboot\nwait 1500\nstrict\n")
	r := newRig(t)
	r.presentV2()
	r.take()
	// What the firmware keeps for a pad: each level scaled to its full, 48.
	fw := func(it Item) string {
		v := 0
		for _, l := range it.Lamp {
			v = v<<8 | (l*48+63)/127
		}
		return fmt.Sprintf("%06x", v)
	}
	var now [Pads + 18]Item
	frames := func(step string) {
		fmt.Fprintf(&b, "# %s\n", step)
		for {
			got := r.take()
			if len(got) == 0 {
				break
			}
			for _, f := range got {
				fmt.Fprintf(&b, "sysex % X\n", f)
				if f[6] != cmdBatch {
					r.k.Feed(ack2(f[5], statusOK))
					continue
				}
				for _, it := range decodeBatch(t, f[7:len(f)-1]) {
					if f[6] == cmdBatch && it.Kind == KindLED {
						now[it.X] = it
					}
				}
				r.k.Feed(ack2(f[5], statusOK))
			}
		}
		for i, it := range now {
			switch {
			case it.Kind != KindLED:
			case i < Pads:
				fmt.Fprintf(&b, "light pad %d %s\n", i, fw(it))
			default:
				on := it.Lamp[0]
				if Light(on) == LightBlink {
					continue // on or off, by the firmware's clock
				}
				fmt.Fprintf(&b, "light button %d %d\n", i-Pads, on)
			}
		}
	}
	r.k.Clear(Black)
	frames("CLEAR")
	r.k.Show(atRest())
	frames("at rest")
	r.k.PadDown(4)
	frames("BREAK pressed: half")
	r.k.PadsLanded([Pads]bool{}, []Landing{{4, true, r.clock.Add(40 * time.Millisecond)}})
	r.advance(40 * time.Millisecond)
	frames("BREAK heard: full")
	r.k.PadUp(4)
	r.k.PadsLanded([Pads]bool{}, []Landing{{4, false, r.clock}})
	r.advance(20 * time.Millisecond)
	frames("BREAK let go and its release heard: dim")
	r.k.PadDown(15)
	frames("GRAB pressed: half")
	r.k.PadDone(15, true)
	frames("GRAB done: full")
	r.advance(FlashFor)
	frames("GRAB's flash over: dim")
	s := atRest()
	s.Playing, s.Recording, s.Shift = true, true, true
	r.k.Show(s)
	frames("recording, SHIFT held")
	b.WriteString("# HOME: the lights are the keyboard's again\npress 2\nrelease 2\nwait 100\n")
	for i := range Pads {
		fmt.Fprintf(&b, "light pad %d open\n", i)
	}
	for _, id := range []int{ButtonShift, ButtonPlay, ButtonRec} {
		fmt.Fprintf(&b, "light button %d open\n", id)
	}
	b.WriteString("shot lights-home\n")
	if err := os.WriteFile(*lightsScript, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}
