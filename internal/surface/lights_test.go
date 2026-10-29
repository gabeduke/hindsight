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

// landings is a stand-in for Play mode, as the Keyboard's loop asks it:
// the pads the tape holds and the landings given since the last ask.
type landings struct {
	held   [Pads]bool
	landed []Landing
	fresh  int // asks that were fresh
}

func (l *landings) ask(fresh bool) ([Pads]bool, []Landing) {
	if fresh {
		l.fresh++
	}
	out := l.landed
	l.landed = nil
	return l.held, out
}

// land says the tape holds held and these landed, and ticks the keyboard
// once, as its loop asks then.
func (r *rig) land(held [Pads]bool, ls ...Landing) {
	r.play.held = held
	r.play.landed = append(r.play.landed, ls...)
	r.advance(0)
}

// lit is a rig on version 2 with the screen at rest drawn and its lights
// sent, nothing waiting, Play mode's landings the rig's.
func lit(t *testing.T) *rig {
	t.Helper()
	r := newRig(t)
	r.play = &landings{}
	r.k.Landings(r.play.ask)
	r.presentV2()
	r.k.Show(atRest())
	r.advance(0) // the loop asks Play mode, and the lights go
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
	r.land(held, Landing{4, true, r.clock.Add(120 * time.Millisecond)})
	expectLamps(t, "its landing known", r.lamps(), "")
	r.advance(100 * time.Millisecond)
	expectLamps(t, "before its landing", r.lamps(), "")
	r.advance(20 * time.Millisecond)
	expectLamps(t, "at its landing", r.lamps(), golden("led pad 4 127 62 20"))
	r.k.PadUp(4)
	expectLamps(t, "let go, its release not heard yet", r.lamps(), "")
	r.land([Pads]bool{}, Landing{4, false, r.clock.Add(60 * time.Millisecond)})
	r.advance(40 * time.Millisecond)
	expectLamps(t, "before its release is heard", r.lamps(), "")
	r.advance(20 * time.Millisecond)
	expectLamps(t, "its release heard", r.lamps(), golden("led pad 4 23 11 4"))
}

// A quantised press let go before it is heard stays half until it is, then
// full until its release is heard; one never heard goes dim after
// AwaitFor.
func TestAPadLetGoUnheardStaysHalfUntilHeard(t *testing.T) {
	r := lit(t)
	r.k.PadDown(10)
	expectLamps(t, "pressed", r.lamps(), golden("led pad 10 0 70 70"))
	r.k.PadUp(10)
	expectLamps(t, "let go, its press not landed yet", r.lamps(), "")
	r.advance(30 * time.Millisecond)
	r.land([Pads]bool{10: true}, Landing{10, true, r.clock.Add(40 * time.Millisecond)}, Landing{10, false, r.clock.Add(80 * time.Millisecond)})
	expectLamps(t, "landed, not heard yet", r.lamps(), "")
	r.advance(40 * time.Millisecond)
	expectLamps(t, "heard", r.lamps(), golden("led pad 10 0 127 127"))
	r.advance(40 * time.Millisecond)
	expectLamps(t, "its release heard", r.lamps(), golden("led pad 10 0 23 23"))

	r.k.PadDown(11)
	r.k.PadUp(11)
	expectLamps(t, "FILTER pressed and let go", r.lamps(), golden("led pad 11 0 70 70"))
	r.advance(AwaitFor - time.Millisecond)
	expectLamps(t, "still waiting", r.lamps(), "")
	r.advance(time.Millisecond)
	expectLamps(t, "never heard", r.lamps(), golden("led pad 11 0 23 23"))
}

// Two CATCHes queued: the first done flashes, and the pad is half again
// while the second waits, then flashes for it.
func TestASecondQueuedCommandStaysHalf(t *testing.T) {
	r := lit(t)
	r.k.PadDown(14)
	r.k.PadDown(14)
	expectLamps(t, "pressed twice", r.lamps(), golden("led pad 14 70 70 70"))
	r.k.PadDone(14, true)
	expectLamps(t, "the first done", r.lamps(), golden("led pad 14 127 127 127"))
	r.advance(FlashFor)
	expectLamps(t, "the second waiting", r.lamps(), golden("led pad 14 70 70 70"))
	r.k.PadDone(14, true)
	r.advance(FlashFor)
	expectLamps(t, "the second done", r.lamps(), golden("led pad 14 127 127 127", "led pad 14 23 23 23"))
}

// Landings are asked on the loop and sent with the Tick's screen, never
// alone before it: the getter's change and the light go in one frame.
func TestLandingsGoWithTheTicksScreen(t *testing.T) {
	r := lit(t)
	s := atRest()
	s.Playing = true
	r.k.Follow(func() State { return s })
	r.play.landed = []Landing{{4, true, r.clock.Add(r.k.Refresh)}}
	r.advance(r.k.Refresh)
	got := r.take()
	if len(got) != 1 {
		t.Fatalf("sent %d frames, want the screen and the lights in one", len(got))
	}
	items := decodeBatch(t, got[0][7:len(got[0])-1])
	if l := lines(items); !strings.Contains(l, "led pad 4 127 62 20") || !strings.Contains(l, "PLAY") {
		t.Fatalf("the frame:\n%s", l)
	}
	r.k.Feed(ack2(got[0][5], statusOK))
}

// A light whose time comes between Ticks: Wait wakes the loop at it, not at
// the next tick, and an ack between ticks sends the stage of that moment.
func TestTheLoopWakesAtALanding(t *testing.T) {
	r := lit(t)
	r.land([Pads]bool{4: true}, Landing{4, true, r.clock.Add(7 * time.Millisecond)})
	if w := r.k.Wait(); w != 7*time.Millisecond {
		t.Fatalf("Wait = %v, want 7ms: the landing", w)
	}
	r.k.Show(func() State { s := atRest(); s.Beats++; return s }()) // a frame in flight
	f := r.take()
	r.clock = r.clock.Add(7 * time.Millisecond)
	r.k.Feed(ack2(f[0][5], statusOK)) // its ack after the landing, before a tick
	expectLamps(t, "the ack's frame", r.lamps(), golden("led pad 4 127 62 20"))
	if w := r.k.Wait(); w != tickEvery {
		t.Fatalf("Wait = %v with nothing due, want %v", w, tickEvery)
	}
}

// A pad heard that the tape lets go of with no release heard (a tape
// loaded under it) goes back to dim, rather than stay lit.
func TestAPadTheTapeLetGoOfGoesDim(t *testing.T) {
	r := lit(t)
	r.land([Pads]bool{}, Landing{7, true, r.clock}) // pressed after the tape was read
	expectLamps(t, "heard", r.lamps(), golden("led pad 7 127 62 20"))
	r.land([Pads]bool{7: true})
	expectLamps(t, "still held", r.lamps(), "")
	r.land([Pads]bool{})
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
	r.k.ShiftHeld(true)
	expectLamps(t, "SHIFT held", r.lamps(), golden("led button 0 1"))
	r.k.ShiftHeld(false)
	s.Playing = false
	r.k.Show(s)
	expectLamps(t, "stopped, SHIFT let go", r.lamps(), golden("led button 0 0", "led button 16 0"))
}

// SHIFT held when the screen goes back, its release lost with it, is let
// go: taken again, it is off.
func TestShiftIsLetGoWithTheScreen(t *testing.T) {
	for name, lose := range map[string]func(r *rig){
		"HOME":      func(r *rig) { r.k.Feed(frame(0, cmdRelease)) },
		"Gone":      func(r *rig) { r.k.Gone() },
		"forgotten": func(r *rig) { r.connected = false; r.advance(0); r.connected = true },
	} {
		t.Run(name, func(t *testing.T) {
			r := lit(t)
			r.k.ShiftHeld(true)
			expectLamps(t, "SHIFT held", r.lamps(), golden("led button 0 1"))
			lose(r)
			if !r.k.Status().Present {
				r.advance(r.k.Probe)
				got := r.take()
				r.k.Feed(ack(got[0][5], statusOK, 2, 0x60))
				<-r.presents
			}
			r.k.Clear(Black)
			got := r.take()
			r.k.Feed(ack2(got[len(got)-1][5], statusOK))
			r.k.Show(atRest())
			r.advance(0)
			expectLamps(t, "taken again", r.lamps(), restLamps)
		})
	}
}

// Taken again, the pads start from what the tape holds then: what landed
// while the screen was the keyboard's is not replayed, and a pad still held
// is full.
func TestARetakeStartsThePadsFromTheTape(t *testing.T) {
	r := lit(t)
	r.land([Pads]bool{6: true}, Landing{6, true, r.clock})
	expectLamps(t, "CHOP heard", r.lamps(), golden("led pad 6 127 62 20"))
	r.k.Feed(frame(0, cmdRelease)) // HOME
	asked := r.play.fresh
	r.k.Clear(Black)
	got := r.take()
	r.k.Feed(ack2(got[0][5], statusOK))
	r.play.held = [Pads]bool{2: true} // a tape loaded under CHOP; T3 held
	r.k.Show(atRest())
	r.advance(0)
	if r.play.fresh != asked+1 {
		t.Fatalf("asked fresh %d times after the retake, want once", r.play.fresh-asked)
	}
	want := strings.Replace(restLamps, "led pad 2 20 15 1", "led pad 2 111 81 8", 1)
	expectLamps(t, "taken again", r.lamps(), want)
}

// The Mixer page: every pad its track's colour, full when on (mute,
// select, solo, arm), dim when off, whatever is held.
func TestTheMixerPagesLights(t *testing.T) {
	s := atRest() // T2 armed and selected
	s.Page, s.Mute[3], s.Solo[2] = PageMixer, true, true
	var held [Pads]Stage
	held[0] = StageFull
	got := Lamps(s, held, false)[:Pads]
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
	r.advance(0)
	want := strings.Replace(restLamps, "led pad 4 23 11 4", "led pad 4 70 34 11", 1) // BREAK still pressed
	expectLamps(t, "the screen taken again", r.lamps(), want)
}

// On version 1 nothing new is sent: LED is version 2's.
func TestVersion1LightsNothing(t *testing.T) {
	r := newRig(t)
	r.taken()
	r.k.Follow(func() State { s := atRest(); s.Playing = true; return s })
	r.k.PadDown(4)
	r.k.Landings(func(bool) ([Pads]bool, []Landing) { return [Pads]bool{4: true}, []Landing{{4, true, r.clock}} })
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
	r.play = &landings{}
	r.k.Landings(r.play.ask)
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
	r.advance(0)
	frames("at rest")
	r.k.PadDown(4)
	frames("BREAK pressed: half")
	r.land([Pads]bool{}, Landing{4, true, r.clock.Add(40 * time.Millisecond)})
	r.advance(40 * time.Millisecond)
	frames("BREAK heard: full")
	r.k.PadUp(4)
	r.land([Pads]bool{}, Landing{4, false, r.clock})
	r.advance(20 * time.Millisecond)
	frames("BREAK let go and its release heard: dim")
	r.k.PadDown(15)
	frames("GRAB pressed: half")
	r.k.PadDone(15, true)
	frames("GRAB done: full")
	r.advance(FlashFor)
	frames("GRAB's flash over: dim")
	s := atRest()
	s.Playing, s.Recording = true, true
	r.k.ShiftHeld(true)
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
