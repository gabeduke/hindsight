package tape

import (
	"testing"
)

// A catch remembers how loud it was, so one from a source with nothing in it
// -- the AUX jack with nothing plugged in is digital silence -- can say so;
// and each source's meter reads the ring.
func TestACatchSaysHowLoudItWasAndTheSourcesHaveMeters(t *testing.T) {
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.5 })
	if _, err := e.DropTake(tp.ID, take, 0, 96000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	e.Do(Action{Kind: "play"})
	e.Start()
	sink.play(t, 96000*3+2000)

	// AUX carries the fixture's instrument; the CH2 tap only bus B, which
	// nothing is on.
	loud, err := e.Catch(tp.ID, CatchRequest{Track: 2, Source: "aux", Pass: 1})
	if err != nil {
		t.Fatal(err)
	}
	if loud.PeakDB == nil || *loud.PeakDB < -40 || *loud.PeakDB > 0 {
		t.Fatalf("aux catch peak = %v", loud.PeakDB)
	}
	quiet, err := e.Catch(tp.ID, CatchRequest{Track: 3, Source: "ch2", Pass: 1})
	if err != nil {
		t.Fatal(err)
	}
	if quiet.PeakDB == nil || *quiet.PeakDB != -120 {
		t.Fatalf("ch2 catch peak = %v, want -120 (digital silence)", quiet.PeakDB)
	}
	// It goes with the clip: into tape.json, and through a split.
	got := e.Loaded().Tracks[2].Clips[0]
	if got.PeakDB == nil || *got.PeakDB != -120 {
		t.Fatalf("saved clip peak = %v", got.PeakDB)
	}

	meters := map[string]float64{}
	for _, s := range e.Sources() {
		if s.PeakDB == nil {
			t.Fatalf("%s has no meter", s.Name)
		}
		meters[s.Name] = *s.PeakDB
	}
	// The tape plays on bus A, which the fixture puts in MAIN and CH1 alike.
	if m := meters["main"]; m < -20 || m > -3 || m != meters["ch1"] {
		t.Fatalf("main %.1f, ch1 %.1f: want the tape's level in both", m, meters["ch1"])
	}
	if meters["ch2"] != -120 {
		t.Fatalf("ch2 meter %.1f, want -120", meters["ch2"])
	}
	if meters["aux"] < -40 {
		t.Fatalf("aux meter %.1f", meters["aux"])
	}
}

func TestPeakDB(t *testing.T) {
	for _, c := range []struct {
		p    float64
		want float64
	}{{0, -120}, {1, 0}, {0.5, -6}, {1e-9, -120}} {
		if got := *peakDB(c.p); got != c.want {
			t.Errorf("peakDB(%g) = %g, want %g", c.p, got, c.want)
		}
	}
}
