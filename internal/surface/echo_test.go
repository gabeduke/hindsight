package surface

import (
	"strconv"
	"testing"
	"time"
)

// presentEcho brings the rig's keyboard to answering HELLO as a firmware
// with features does, 02 60 <features>, and takes its screen.
func (r *rig) presentEcho(features byte) {
	r.t.Helper()
	r.advance(r.k.Probe)
	r.take()
	r.k.Feed(ack(1, statusOK, 2, 0x60, features))
	<-r.presents
	if s := r.k.Status(); s.Version != 2 || s.Features != features {
		r.t.Fatalf("status %+v, want version 2 with features %d", s, features)
	}
	r.k.Clear(Black)
	got := r.take()
	r.k.Feed(ack2(got[0][5], statusOK))
}

// echoing is a rig whose keyboard echoes (features), its screen at rest
// drawn, lights and knobs sent, nothing waiting.
func echoing(t *testing.T, features byte) *rig {
	t.Helper()
	r := newRig(t)
	r.play = &landings{}
	r.k.Landings(r.play.ask)
	r.presentEcho(features)
	r.k.Show(atRest())
	r.advance(0)
	r.lamps()
	return r
}

// Every light is sent again every Reassert while the screen is Hindsight's,
// as if the keyboard had none: a pad that went wrong on the panel is never
// news to the acks.
func TestEveryLightIsSentAgainEveryReassert(t *testing.T) {
	r := lit(t)
	r.k.Reassert = 2 * time.Second
	r.advance(1900 * time.Millisecond)
	expectLamps(t, "before Reassert", r.lamps(), "")
	r.advance(100 * time.Millisecond)
	expectLamps(t, "at Reassert", r.lamps(), restLamps)
	r.advance(time.Second)
	expectLamps(t, "after", r.lamps(), "")
}

// A keyboard that echoes pads lit a press itself; the Pi answers it by
// setting that pad again with its next frame, whatever it decided: the
// press's half once it is taken (PadDown), or, refused, the pad as it was.
// Confirm is the press to that answer's ack.
func TestAnEchoedPressIsAnsweredAndTimed(t *testing.T) {
	r := echoing(t, EchoPads)
	r.k.Pressed(3)
	r.clock = r.clock.Add(time.Millisecond)
	r.k.PadDown(3)
	r.clock = r.clock.Add(3 * time.Millisecond)
	got := r.lamps()
	if len(got) != 1 || got[0].X != 3 || got[0] == PadItem(3, Track(4), StageRest) {
		t.Fatalf("the answer: %v, want pad 3 at its half alone", got)
	}
	if c := r.k.Status().Confirm; c != 4*time.Millisecond {
		t.Fatalf("Confirm %v, want the 4 ms from the press to its answer's ack", c)
	}
	r.k.PadUp(3)
	r.lamps()
	// Refused: nothing changes, and the pad is set again all the same.
	r.k.Pressed(5)
	r.advance(20 * time.Millisecond)
	expectLamps(t, "a refused press's answer", r.lamps(), golden("led pad 5 23 11 4"))
	// A firmware that doesn't echo needs no answer.
	r = echoing(t, 0)
	r.k.Pressed(3)
	r.advance(20 * time.Millisecond)
	expectLamps(t, "no echo", r.lamps(), "")
}

// Each encoder with an amount stands where the State says (KNOB), and a
// knob whose value shows as its number says where, for the keyboard to
// echo a turn into.
func TestTheKnobsStandWhereTheStateSays(t *testing.T) {
	r := echoing(t, EchoKnobs)
	if len(r.knobs) != 7 {
		t.Fatalf("KNOBs %v, want the seven encoders", r.knobs)
	}
	k := r.knobs[2]
	x, y := knobCell(2)
	if k.X != 2 || k.Value != 88 || !k.Echo || k.At != [4]int{x, y + knobValueY, x, y + knobBarY} {
		t.Fatalf("KNOB %+v, want FILTER at 88 with its value's places", k)
	}
	r.knobs = nil
	r.advance(time.Second)
	r.k.Show(atRest())
	if r.batches(); len(r.knobs) != 0 {
		t.Fatalf("standing: sent %v, want nothing", r.knobs)
	}
	// Without the feature, KNOB says only where it stands.
	r = echoing(t, 0)
	if k := r.knobs[2]; k.Echo || k.Value != 88 {
		t.Fatalf("KNOB %+v, want 88 and no places", k)
	}
}

// A turn on a keyboard that echoes knobs wrote its number into the cell:
// the Pi changes its list as the keyboard did, and for TurnHold the cell
// shows the keyboard's value and no KNOB goes, so nothing is put back while
// the State hasn't heard the turn. After it, the State wins: the cell is
// drawn as it says, and the knob put where it says.
func TestATurnIsEchoedThenConfirmed(t *testing.T) {
	r := echoing(t, EchoKnobs)
	r.knobs = nil
	x, y := knobCell(2)
	r.k.Turned(2, 89)
	r.k.Show(atRest()) // still 88: it hasn't heard the turn
	if got := r.batches(); len(got) != 0 || len(r.knobs) != 0 {
		t.Fatalf("after the echo: sent %v and %v, want nothing: the cell agrees with the keyboard", got, r.knobs)
	}
	r.advance(TurnHold)
	r.k.Show(atRest())
	got := r.batches()
	want := []Item{TextItem(x, y+knobValueY, 2, Text, Black, "88"), BarItem(x, y+knobBarY, 52, 2, 88, Dim, Panel)}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("after TurnHold: sent %v, want the cell as the State has it, %v", got, want)
	}
	if len(r.knobs) != 1 || r.knobs[0].Value != 88 {
		t.Fatalf("after TurnHold: sent %v, want KNOB 2 at 88", r.knobs)
	}
	// The State that heard the turn: nothing to put back, and no KNOB.
	r.knobs = nil
	s := atRest()
	s.Knobs[2] = Knob{Name: "FILTER", Value: "89", Amount: 89, Lit: Accent}
	r.k.Turned(2, 89)
	r.k.Show(s)
	r.batches()
	r.advance(TurnHold)
	r.k.Show(s)
	r.batches()
	if len(r.knobs) != 0 {
		t.Fatalf("sent %v, want none: the keyboard stands at 89 already", r.knobs)
	}
}

// A knob that doesn't show its number (the Mixer's pans) gives no places.
func TestAKnobNotShownAsItsNumberGivesNoPlaces(t *testing.T) {
	s := atRest()
	s.Knobs = mixerKnobs([4]int{64, 40, 90, 64}, 0, 100)
	for _, it := range Stands(s, true) {
		if it.Echo && s.Knobs[it.X].Value != strconv.Itoa(it.Value) {
			t.Fatalf("%+v echoes %q", it, s.Knobs[it.X].Value)
		}
	}
}

// A CLEAR forgets where the knobs' values are drawn, on the keyboard, so
// every KNOB goes again after one.
func TestAClearSendsTheKnobsAgain(t *testing.T) {
	r := echoing(t, EchoKnobs)
	r.knobs = nil
	r.k.Clear(Black)
	got := r.take()
	r.k.Feed(ack2(got[0][5], statusOK))
	r.k.Show(atRest())
	if r.batches(); len(r.knobs) != 7 || !r.knobs[2].Echo {
		t.Fatalf("after a CLEAR: sent %v, want the seven KNOBs with their places", r.knobs)
	}
}
