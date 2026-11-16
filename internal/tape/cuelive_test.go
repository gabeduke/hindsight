package tape

import (
	"math"
	"slices"
	"testing"
	"time"
)

// cueBusA reads output frame f's left sample on bus A.
func cueBusA(out []int32, f int) float64 { return float64(out[f*OutChannels]) / 2147483647 }

// waitCue polls Live until ok holds of the cue lane, as the page would.
func waitCue(t *testing.T, e *Engine, what string, ok func(*CueLive) bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !ok(e.CueLive()) {
		if time.Now().After(deadline) {
			t.Fatalf("cue lane never %s: %+v", what, e.CueLive())
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestACueClipLaunchesOnTheNextBarLoopsAndStopsOnTheOneAfter(t *testing.T) {
	e, sink, tp := newEngine(t)
	// A one-bar loop of 0.5 on track 1 (96000 frames, 120 BPM), and a cue
	// clip of 0.3, a quarter of a bar long.
	if _, err := e.DropTake(tp.ID, takeWAV(t, 200000, func(int) float64 { return 0.5 }), 96000, 192000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	g, err := e.GrabTakeToCue(tp.ID, takeWAV(t, 48000, func(int) float64 { return 0.3 }), "hit.wav", "Hit", 0, 24000, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	cue := g.Clip
	if !cue.Loop || cue.Frames != 24000 {
		t.Fatalf("cue clip = %+v, want a looping 24000 frames", cue)
	}
	e.Do(Action{Kind: "play"})
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	tape := 0.5 * math.Pow(10, -6.0/20)

	// play pulls whole device blocks: from and to are output frames.
	pull := func(to int) ([]int32, int) {
		from := int(sink.out)
		return sink.play(t, to-from), from
	}
	pull(30000)
	if err := e.CueLaunch(tp.ID, cue.ID, "toggle", false); err != nil {
		t.Fatal(err)
	}
	waitCue(t, e, "queued the launch", func(l *CueLive) bool { return l != nil && slices.Contains(l.Queued, cue.ID) })

	out, from := pull(156000)
	at := func(f int) float64 { return cueBusA(out, f-from) }
	if got := at(95000); math.Abs(got-tape) > 0.02 {
		t.Fatalf("before the bar line bus A = %.4f, want the tape alone (%.4f)", got, tape)
	}
	for _, f := range []int{96000 + 1000, 96000 + 23000, 96000 + 24000 + 1000, 96000 + 50000} {
		if got := at(f); math.Abs(got-(tape+0.3)) > 0.02 {
			t.Fatalf("frame %d bus A = %.4f, want the tape and the looping cue (%.4f)", f, got, tape+0.3)
		}
	}
	// The tape crossfades into itself at its seam; the clip adds nothing yet.
	if got := at(96000 - 1); got > tape*1.42 {
		t.Fatalf("the frame before the bar line = %.4f: the clip started early", got)
	}
	waitCue(t, e, "said it's playing", func(l *CueLive) bool {
		return l != nil && slices.Equal(l.Playing, []string{cue.ID}) && len(l.Queued) == 0
	})
	if got := e.CueLive().Starts[cue.ID]; got != 0 {
		t.Fatalf("it started at tape frame %d, want the bar line at the loop's In (0)", got)
	}

	// Cue: the cue lane alone in the output.
	solo := true
	if _, err := e.EditOp(tp.ID, EditRequest{Op: "cue-solo", Solo: &solo}); err != nil {
		t.Fatal(err)
	}
	out, from = pull(176000)
	if got := at(175000); math.Abs(got-0.3) > 0.02 {
		t.Fatalf("soloed bus A = %.4f, want the cue clip alone (0.3)", got)
	}

	// Tapped again: it stops on the next bar line, 192000.
	if err := e.CueLaunch(tp.ID, cue.ID, "toggle", false); err != nil {
		t.Fatal(err)
	}
	out, from = pull(206000)
	if got := at(191000); math.Abs(got-0.3) > 0.02 {
		t.Fatalf("before the stop's bar line = %.4f, want the clip still playing", got)
	}
	if got := at(193000); got != 0 {
		t.Fatalf("after the stop's bar line = %.4f, want silence (the tape is soloed out)", got)
	}
	waitCue(t, e, "let go of it", func(l *CueLive) bool { return l == nil })
}

func TestACueClipLaunchedWithTheTapeStandingStartsAtOnceAndStopStopsIt(t *testing.T) {
	e, sink, tp := newEngine(t)
	g, err := e.GrabTakeToCue(tp.ID, takeWAV(t, 48000, func(int) float64 { return 0.3 }), "hit.wav", "Hit", 0, 24000, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	cue := g.Clip
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 4096)
	if err := e.CueLaunch(tp.ID, cue.ID, "launch", false); err != nil {
		t.Fatal(err)
	}
	out := sink.play(t, 60000)
	if got := cueBusA(out, 59000); math.Abs(got-0.3) > 0.02 {
		t.Fatalf("bus A = %.4f, want the clip looping with the tape standing", got)
	}
	waitCue(t, e, "said it started", func(l *CueLive) bool { return l != nil && len(l.Playing) == 1 })
	if got := e.CueLive().Starts[cue.ID]; got != -1 {
		t.Fatalf("Starts = %d, want -1 with the tape standing", got)
	}
	// One transport: Stop stops the cue lane.
	e.Do(Action{Kind: "stop"})
	out = sink.play(t, 20000)
	if got := cueBusA(out, 19000); got != 0 {
		t.Fatalf("after Stop bus A = %.4f, want silence", got)
	}
	waitCue(t, e, "stopped with the tape", func(l *CueLive) bool { return l == nil })

	if err := e.CueLaunch(tp.ID, "nope", "launch", false); err == nil {
		t.Fatal("launching a clip that isn't on the lane should fail")
	}
}
