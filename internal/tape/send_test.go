package tape

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// 120 BPM at 48 kHz: a bar is 2 s, 96,000 frames.
const bar120 = 96000

func TestGridPlacement(t *testing.T) {
	g120 := GridFor(120, 4, 48000)
	g84 := GridFor(84, 4, 48000) // a bar is 137,142.857 frames: bar lines round
	cases := []struct {
		name     string
		g        Grid
		anchor   int64
		from     int64
		downbeat int64
		bpm      float64
		at, bar  int64
	}{
		{"downbeat at the start of the take lands on the anchor", g120, 0, 0, 0, 120, 0, 0},
		{"on the anchor bar line wherever it is", g120, 3 * bar120, 0, 0, 120, 3 * bar120, 3},
		{"a count-in before the downbeat sits in the bar before it, so the anchor moves on", g120, 0, 0, 48000, 120, 48000, 1},
		{"a count-in with room before the anchor needs no move", g120, 3 * bar120, 0, 48000, 120, 3*bar120 - 48000, 3},
		{"a count-in of a bar and a half moves on two bars", g120, 0, 0, 144000, 120, 2*bar120 - 144000, 2},
		{"a count-in of exactly a bar moves on one", g120, 0, 0, bar120, 120, 0 + bar120 - bar120, 1},
		{"a downbeat five bars in moves on whole bars to keep the pickup", g120, 0, 0, 500000, 120, 6*bar120 - 500000, 6},
		{"a selection starting in the pickup keeps its distance from the downbeat", g120, 0, 20000, 100000, 120, bar120 - 80000, 1},
		{"a selection after the downbeat keeps its place in its bar", g120, 0, 250000, 0, 120, 250000 - 2*bar120, 0},
		{"a selection on a bar line of the take lands on the anchor", g120, 5 * bar120, 2 * bar120, 0, 120, 5 * bar120, 5},
		{"bars are counted from the take's downbeat, not from frame 0", g120, 0, 100000 + 3*bar120 + 1000, 100000, 120, 1000, 0},
		{"the tape's bar lines round as the tape rounds them", g84, g84.BarStart(3), 0, 0, 84, g84.BarStart(3), 3},
		{"…and a count-in is placed from the rounded bar line", g84, 0, 0, 100000, 84, g84.BarStart(1) - 100000, 1},
	}
	for _, c := range cases {
		at, bar := GridPlacement(c.g, c.anchor, c.from, c.downbeat, c.bpm, 48000)
		if at != c.at || bar != c.bar {
			t.Errorf("%s: at %d bar %d, want %d, %d", c.name, at, bar, c.at, c.bar)
		}
		if at < 0 {
			t.Errorf("%s: placed before the start of the tape", c.name)
		}
	}
}

// Whatever the pickup and the anchor, the take's downbeat ends up on a tape
// bar line and nothing starts before 0.
func TestGridPlacementPutsTheDownbeatOnABarLine(t *testing.T) {
	g := GridFor(97.3, 4, 48000)
	for _, down := range []int64{0, 1, 4800, 50000, 123456, 700000} {
		for _, anchor := range []int64{0, g.BarStart(1), g.BarStart(7)} {
			at, _ := GridPlacement(g, anchor, 0, down, 97.3, 48000)
			if at < 0 {
				t.Fatalf("downbeat %d anchor %d: at %d", down, anchor, at)
			}
			if d := at + down; g.BarStart(g.BarAt(d)) != d {
				t.Errorf("downbeat %d anchor %d: the downbeat is at tape frame %d, not on a bar line", down, anchor, d)
			}
			if at+down < anchor {
				t.Errorf("downbeat %d anchor %d: the downbeat landed before the anchor", down, anchor)
			}
		}
	}
}

func TestSameTempo(t *testing.T) {
	for _, c := range []struct {
		a, b float64
		same bool
	}{
		{120, 120, true}, {120, 120.1, true}, {125.25, 125.32, true}, {120, 120.5, false},
		{120, 100, false}, {0, 120, false}, {120, 0, false},
	} {
		if SameTempo(c.a, c.b) != c.same {
			t.Errorf("SameTempo(%v, %v) = %v", c.a, c.b, !c.same)
		}
	}
}

func TestMinutesText(t *testing.T) {
	for frames, want := range map[int64]string{
		60 * 48000: "1 minute", 360 * 48000: "6 minutes", 1200 * 48000: "20 minutes", 330 * 48000: "5.5 minutes",
	} {
		if got := minutesText(frames, 48000); got != want {
			t.Errorf("%d frames: %q, want %q", frames, got, want)
		}
	}
}

// newEngineLen is newEngine with tracks of the given length in seconds.
func newEngineLen(t *testing.T, seconds int) (*Engine, *loopSink, *Tape) {
	t.Helper()
	s, err := OpenStore(t.TempDir(), 48000, 4, seconds)
	if err != nil {
		t.Fatal(err)
	}
	sink := &loopSink{ring: audio.NewRing(48000*20, 8)}
	e := NewEngine(Options{Store: s, Capture: sink, Sink: sink})
	tp, err := s.Create("test", 0, 0, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Load(tp.ID); err != nil {
		t.Fatal(err)
	}
	testEngine = e
	t.Cleanup(func() { e.Stop(); testEngine = nil })
	return e, sink, tp
}

func sendReq(take string, from, to int64, bpm float64, downbeat int64) SendRequest {
	return SendRequest{Take: take, From: from, To: to, Track: 1, BPM: bpm, Downbeat: downbeat, Pick: []int{0, 1}}
}

func TestSendingATempoTakeToAnEmptyTapeGivesItTheTempoAndNoLoop(t *testing.T) {
	e, _, tp := newEngineLen(t, 60)
	take := takeWAV(t, 20*48000, func(i int) float64 { return 0.25 }) // 10 bars at 120
	got, err := e.SendTake(tp.ID, sendReq(take, 0, 20*48000, 120, 0))
	if err != nil {
		t.Fatal(err)
	}
	l := e.Loaded()
	if l.Grid == nil || l.Grid.BPM(48000) < 119.999 || l.Grid.BPM(48000) > 120.001 {
		t.Fatalf("the tape's tempo should be the take's 120: %+v", l.Grid)
	}
	if l.Loop.On || l.Loop.In != 0 || l.Loop.Out != 0 {
		t.Fatalf("a whole take is no loop: %+v", l.Loop)
	}
	cl := l.Tracks[0].Clips
	if len(cl) != 1 || cl[0].At != 0 || cl[0].Frames != 20*48000 {
		t.Fatalf("clips %+v: one, whole, from the start", cl)
	}
	if got.Mode != SendOnGrid || !got.TempoSet || got.Bar != 1 || got.BPM < 119.99 || got.Warning != "" {
		t.Fatalf("sent = %+v", got)
	}
}

func TestACountInIsPlacedInTheBarBeforeTheDownbeat(t *testing.T) {
	e, _, tp := newEngineLen(t, 60)
	take := takeWAV(t, 20*48000, func(i int) float64 { return 0.25 })
	// Bar 1 is 0.5 s in: a half-bar of count-in. Nothing is cut off, and
	// the downbeat lands on tape bar 2's line.
	got, err := e.SendTake(tp.ID, sendReq(take, 0, 20*48000, 120, 24000))
	if err != nil {
		t.Fatal(err)
	}
	c := e.Loaded().Tracks[0].Clips[0]
	if c.At != bar120-24000 || c.Frames != 20*48000 || got.Bar != 2 {
		t.Fatalf("clip at %d, bar %d: want the pickup in bar 1 and the downbeat on %d", c.At, got.Bar, bar120)
	}
}

func TestASelectionKeepsItsPlaceOnTheTakesBarGrid(t *testing.T) {
	e, _, tp := newEngineLen(t, 60)
	take := takeWAV(t, 20*48000, func(i int) float64 { return 0.25 })
	// From 100,000 to 200,000: 4,000 frames into the take's second bar.
	if _, err := e.SendTake(tp.ID, sendReq(take, 100000, 200000, 120, 0)); err != nil {
		t.Fatal(err)
	}
	c := e.Loaded().Tracks[0].Clips[0]
	if c.At != 4000 || c.Frames != 100000 {
		t.Fatalf("clip %+v: want it 4,000 frames after a bar line, 100,000 long", c)
	}
	if l := e.Loaded().Loop; l.On {
		t.Fatalf("a selection isn't a loop either: %+v", l)
	}
}

func TestSendingAgainOnAMatchingTempoLandsOnTheNextBarLine(t *testing.T) {
	e, sink, tp := newEngineLen(t, 60)
	take := takeWAV(t, 10*48000, func(i int) float64 { return 0.25 })
	if _, err := e.SendTake(tp.ID, sendReq(take, 0, 10*48000, 120, 0)); err != nil {
		t.Fatal(err)
	}
	e.Start()
	// The playhead in the middle of bar 2: the next send goes on bar 3.
	e.Do(Action{Kind: "locate", Pos: bar120 + 5000})
	waitFor(t, func() bool {
		sink.play(t, 512)
		return e.tr.Status().Pos == bar120+5000 || e.tr.Status().Pos > bar120+5000
	})
	pos := e.tr.Status().Pos
	want := (&Grid{Frames: 4 * bar120, Bars: 4}).NextBar(pos)
	// 120.05 BPM is the same tempo to a tape: the tape's grid is used.
	got, err := e.SendTake(tp.ID, SendRequest{Take: take, From: 0, To: 10 * 48000, Track: 2, BPM: 120.05, Pick: []int{0, 1}})
	if err != nil {
		t.Fatal(err)
	}
	if got.Mode != SendOnGrid || got.TempoSet || got.Clip.At != want {
		t.Fatalf("sent %+v, want on the grid at %d", got, want)
	}
	if g := e.Loaded().Grid; g.Frames != 4*bar120 {
		t.Fatalf("the tape's tempo moved: %+v", g)
	}
}

func TestATakeAtAnotherTempoIsNotStretchedOrLinedUp(t *testing.T) {
	e, _, tp := newEngineLen(t, 60)
	take := takeWAV(t, 10*48000, func(i int) float64 { return 0.25 })
	if _, err := e.SendTake(tp.ID, sendReq(take, 0, 10*48000, 120, 0)); err != nil {
		t.Fatal(err)
	}
	before := *e.Loaded().Grid
	got, err := e.SendTake(tp.ID, SendRequest{Take: take, From: 0, To: 5 * 48000, Track: 2, BPM: 100, Downbeat: 20000, Pick: []int{0, 1}})
	if err != nil {
		t.Fatal(err)
	}
	if got.Mode != SendAsIs || got.Warning == "" || !strings.Contains(got.Warning, "100.00") || !strings.Contains(got.Warning, "120.00") {
		t.Fatalf("sent = %+v: want it placed as it is, with the two tempos named", got)
	}
	if g := *e.Loaded().Grid; g != before {
		t.Fatalf("the tape's tempo changed: %+v -> %+v", before, g)
	}
	if c := e.Loaded().Tracks[1].Clips[0]; c.Frames != 5*48000 {
		t.Fatalf("clip %+v: stretched?", c)
	}
}

// An empty tape has no tempo to keep, even if it was given one.
func TestAnEmptyTapeWithAnotherTempoTakesTheTakes(t *testing.T) {
	e, _, tp := newEngineLen(t, 60)
	if err := e.Edit(tp.ID, "", func(_ *Tape, s *State) error {
		g := GridFor(90, 4, 48000)
		s.Grid, s.Loop = &g, Loop{In: 0, Out: g.Frames, On: true}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	take := takeWAV(t, 10*48000, func(i int) float64 { return 0.25 })
	got, err := e.SendTake(tp.ID, sendReq(take, 0, 10*48000, 120, 0))
	if err != nil {
		t.Fatal(err)
	}
	l := e.Loaded()
	if !got.TempoSet || l.Grid.Frames != 4*bar120 || l.Loop.On {
		t.Fatalf("sent %+v grid %+v loop %+v: want 120 BPM and no loop", got, l.Grid, l.Loop)
	}
}

func TestATakeLongerThanATrackIsRefusedWithTheLimitAndTheSetting(t *testing.T) {
	e, _, tp := newEngineLen(t, 60)
	take := takeWAV(t, 90*48000, func(i int) float64 { return 0.1 })
	for _, bpm := range []float64{120, 0} {
		_, err := e.SendTake(tp.ID, sendReq(take, 0, 90*48000, bpm, 0))
		if !errors.Is(err, ErrBadParameter) {
			t.Fatalf("bpm %v: err = %v", bpm, err)
		}
		for _, s := range []string{"1:30", "1 minute", "TAPE_LENGTH_S"} {
			if !strings.Contains(err.Error(), s) {
				t.Errorf("bpm %v: %q should say %q", bpm, err, s)
			}
		}
	}
	if !e.Loaded().Empty() {
		t.Fatal("a refused send left something on the tape")
	}
}

// A take that fits but, with its count-in moved on to a bar line, doesn't.
func TestASendThatRunsPastTheEndAfterPlacementIsRefused(t *testing.T) {
	e, _, tp := newEngineLen(t, 60)
	take := takeWAV(t, 59*48000+24000, func(i int) float64 { return 0.1 })
	_, err := e.SendTake(tp.ID, sendReq(take, 0, 59*48000+24000, 120, 24000)) // lands at 1 s
	if !errors.Is(err, ErrPastTheEnd) || !strings.Contains(err.Error(), "TAPE_LENGTH_S") {
		t.Fatalf("err = %v", err)
	}
	if !e.Loaded().Empty() {
		t.Fatal("a refused send left something on the tape")
	}
}

func TestATakeWithNoTempoStillMakesTheFirstLoopWhenShort(t *testing.T) {
	e, _, tp := newEngineLen(t, 120)
	take := takeWAV(t, 30*48000, func(i int) float64 { return 0.25 })
	got, err := e.SendTake(tp.ID, sendReq(take, 0, 4*48000, 0, 0))
	if err != nil {
		t.Fatal(err)
	}
	l := e.Loaded()
	if got.Mode != SendFirstLoop || l.Grid == nil || l.Grid.Frames != 4*48000 || !l.Loop.On || l.Loop.Out != 4*48000 {
		t.Fatalf("sent %+v grid %+v loop %+v: want the first loop", got, l.Grid, l.Loop)
	}
}

func TestALongTakeWithNoTempoIsLaidDownLinearWithNoTempo(t *testing.T) {
	e, _, tp := newEngineLen(t, 120)
	take := takeWAV(t, 70*48000, func(i int) float64 { return 0.25 })
	got, err := e.SendTake(tp.ID, sendReq(take, 0, 70*48000, 0, 0))
	if err != nil {
		t.Fatal(err)
	}
	l := e.Loaded()
	if got.Mode != SendLinear || l.Grid != nil || l.Loop.On || l.Loop.Out != 0 {
		t.Fatalf("sent %+v grid %+v loop %+v: want linear, no tempo", got, l.Grid, l.Loop)
	}
	if c := l.Tracks[0].Clips; len(c) != 1 || c[0].At != 0 || c[0].Frames != 70*48000 {
		t.Fatalf("clips %+v", c)
	}
	// A minute exactly is still a loop; a clipboard drop follows the same rule.
	e2, _, tp2 := newEngineLen(t, 120)
	c, err := e2.CopyTake(take, "jam_take.wav", 0, 61*48000, []int{0, 1})
	if err != nil || c.Frames != 61*48000 {
		t.Fatalf("copy %+v %v", c, err)
	}
	if _, err := e2.DropClipboard(tp2.ID, 1, false); err != nil {
		t.Fatal(err)
	}
	if l := e2.Loaded(); l.Grid != nil || l.Loop.On {
		t.Fatalf("a long clipboard drop made a loop: %+v %+v", l.Grid, l.Loop)
	}
}

func TestALongClipboardFromATempoTakeKeepsTheTempoAndNoLoop(t *testing.T) {
	e, _, tp := newEngineLen(t, 120)
	take := takeWAV(t, 70*48000, func(i int) float64 { return 0.25 })
	bpm := 100.0
	if err := audio.WriteMeta(take, audio.Meta{BPM: &bpm}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.CopyTake(take, "jam_take.wav", 0, 65*48000, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.DropClipboard(tp.ID, 1, false); err != nil {
		t.Fatal(err)
	}
	l := e.Loaded()
	if l.Grid == nil || l.Loop.On {
		t.Fatalf("grid %+v loop %+v", l.Grid, l.Loop)
	}
	if b := l.Grid.BPM(48000); b < 99.99 || b > 100.01 {
		t.Fatalf("tempo %v, want the take's 100", b)
	}
}

func TestASendWithNoTempoOntoATapeWithAudioGoesAtThePlayhead(t *testing.T) {
	e, _, tp := newEngineLen(t, 120)
	take := takeWAV(t, 30*48000, func(i int) float64 { return 0.25 })
	if _, err := e.SendTake(tp.ID, sendReq(take, 0, 4*48000, 0, 0)); err != nil {
		t.Fatal(err)
	}
	got, err := e.SendTake(tp.ID, sendReq(take, 0, 2*48000, 0, 0))
	if err != nil || got.Mode != SendAsIs {
		t.Fatalf("sent %+v %v", got, err)
	}
}

func TestATapeMadeWithShorterTracksIsAsLongAsTracksAreNow(t *testing.T) {
	dir := t.TempDir()
	old, err := OpenStore(dir, 48000, 4, 360)
	if err != nil {
		t.Fatal(err)
	}
	tp, err := old.Create("old", 0, 0, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if tp.Length != 360*48000 {
		t.Fatalf("length %d", tp.Length)
	}
	now, err := OpenStore(dir, 48000, 4, 1200)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := now.Load(tp.ID); err != nil || got.Length != 1200*48000 {
		t.Fatalf("loaded %+v %v: want the new length", got, err)
	}
	// And a longer one keeps its own if the setting is lowered.
	short, _ := OpenStore(dir, 48000, 4, 120)
	if got, err := short.Load(tp.ID); err != nil || got.Length != 360*48000 {
		t.Fatalf("loaded %+v %v: want it to keep 360 s", got, err)
	}
}

// Bar says where the downbeat landed, so it's only there when the downbeat is
// in what was sent: a selection after it has no bar 1 to name.
func TestTheBarNamesTheDownbeatOnlyWhenTheDownbeatWasSent(t *testing.T) {
	e, _, tp := newEngineLen(t, 60)
	take := takeWAV(t, 20*48000, func(i int) float64 { return 0.25 })
	got, err := e.SendTake(tp.ID, sendReq(take, 250000, 300000, 120, 0))
	if err != nil {
		t.Fatal(err)
	}
	if got.Mode != SendOnGrid || got.Bar != 0 {
		t.Fatalf("a selection after the downbeat: mode %q bar %d, want on-grid and no bar", got.Mode, got.Bar)
	}
	e, _, tp = newEngineLen(t, 60)
	got, err = e.SendTake(tp.ID, sendReq(take, 20000, 300000, 120, 100000))
	if err != nil {
		t.Fatal(err)
	}
	if got.Bar != 2 { // 80,000 of pickup sits in bar 1; the downbeat is bar 2
		t.Fatalf("a selection with the downbeat in it: bar %d, want 2", got.Bar)
	}
}
