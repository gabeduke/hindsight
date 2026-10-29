package tape

import "testing"

// Each track's meter reads what it plays, after its fader, and falls once it
// stops sounding; a track with nothing on it reads silence.
func TestTheTracksMetersReadWhatTheyPlay(t *testing.T) {
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.5 })
	if _, err := e.DropTake(tp.ID, take, 0, 96000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	if err := e.Edit(tp.ID, "gain", func(_ *Tape, s *State) error { s.Tracks[0].GainDB = -6; return nil }); err != nil {
		t.Fatal(err)
	}
	e.Do(Action{Kind: "play"})
	e.Start()
	sink.play(t, 48000)
	l := e.TrackLevels()
	if l[0] < 0.2 || l[0] > 0.3 {
		t.Fatalf("track 1 reads %.3f, want about 0.25: half scale at -6 dB", l[0])
	}
	if l[1] != 0 {
		t.Fatalf("track 2, empty, reads %.3f", l[1])
	}
	if pos, playing := e.Heard(); !playing || pos <= 0 {
		t.Fatalf("heard at %d, playing %v: want playing, past the start", pos, playing)
	}
	if err := e.Edit(tp.ID, "mute", func(_ *Tape, s *State) error { s.Tracks[0].Mute = true; return nil }); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 48000*2)
	if l := e.TrackLevels(); l[0] > 0.25/10 {
		t.Fatalf("track 1, muted two seconds, still reads %.3f", l[0])
	}
}
