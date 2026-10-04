package tape

import (
	"errors"
	"math"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// fakeSaver keeps the span it was asked for, and the ring's MAIN over it.
type fakeSaver struct {
	mu       sync.Mutex
	ring     *audio.Ring
	from, to uint64
	main     []int32
	calls    int
}

func (f *fakeSaver) SaveRange(from, to uint64) (audio.SavedRange, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.from, f.to = from, to
	f.main = nil
	err := f.ring.Range(from, to, []int{0}, func(b []int32) error {
		f.main = append(f.main, b...)
		return nil
	})
	return audio.SavedRange{Name: "jam_mix.wav", From: from, To: to, Seconds: float64(to-from) / 48000}, err
}

// mixdownEngine is a tape with a one-bar loop of constant level on track 1
// (bus A), a saver, and a short tail.
func mixdownEngine(t *testing.T) (*Engine, *loopSink, *Tape, *fakeSaver, string) {
	t.Helper()
	s := newTestStore(t)
	sink := &loopSink{ring: audio.NewRing(48000*30, 8)}
	saver := &fakeSaver{ring: sink.ring}
	dir := t.TempDir()
	e := NewEngine(Options{Store: s, Capture: sink, Sink: sink, Saver: saver, TakesDir: dir, MixdownTail: 0.25})
	tp, err := s.Create("song", 0, 0, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Load(tp.ID); err != nil {
		t.Fatal(err)
	}
	testEngine = e
	t.Cleanup(func() { e.Stop(); testEngine = nil })
	take := takeWAV(t, 200000, func(i int) float64 { return 0.25 })
	if _, err := e.CopyTake(take, "jam_take.wav", 0, 96000, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.DropClipboard(tp.ID, 1, false); err != nil {
		t.Fatal(err)
	}
	return e, sink, tp, saver, dir
}

func waitMixdown(t *testing.T, e *Engine, sink *loopSink) *Mixdown {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		sink.play(t, 512)
		m := e.MixdownStatus()
		if m != nil && m.State != "playing" {
			// About real time, as a device would pull: the mixdown waits on
			// the clock for its tail and the aligner, and the ring mustn't
			// lap it.
			time.Sleep(10 * time.Millisecond)
		}
		if m != nil && (m.State == "done" || m.State == "failed") {
			return m
		}
		if time.Now().After(deadline) {
			t.Fatalf("the mixdown didn't finish: %+v", m)
		}
	}
}

func TestAMixdownPlaysTheLoopOnceAndSavesItWithItsTail(t *testing.T) {
	e, sink, tp, saver, dir := mixdownEngine(t)
	e.Start()
	sink.play(t, 4096)
	m, err := e.StartMixdown(tp.ID, false)
	if err != nil || m.State != "playing" || m.From != 0 || m.To != 96000 || m.Tail != 12000 {
		t.Fatalf("start = %+v %v", m, err)
	}
	// A second can't start meanwhile, nor a punch.
	if _, err := e.StartMixdown(tp.ID, false); !errors.Is(err, ErrMixingDown) {
		t.Fatalf("a second mixdown = %v", err)
	}
	if _, err := e.Record(tp.ID, 2, "aux", false); !errors.Is(err, ErrMixingDown) {
		t.Fatalf("a punch during a mixdown = %v", err)
	}
	got := waitMixdown(t, e, sink)
	if got.State != "done" || got.Take != "jam_mix.wav" {
		t.Fatalf("mixdown = %+v", got)
	}
	// The span: the loop's 96000 frames and the tail, where it played.
	if saver.to-saver.from != 96000+12000 {
		t.Fatalf("saved %d frames, want 108000", saver.to-saver.from)
	}
	main := saver.main
	level := func(i int) float64 { return float64(main[i]) / 2147483647 }
	// The loop once: its level, faded in over the declick, and silent after
	// Out -- no second pass, though the loop is on.
	if l := level(0); l > 0.01 {
		t.Fatalf("first frame %.3f, want faded in", l)
	}
	for _, i := range []int{1000, 48000, 95000} {
		if l := level(i); l < 0.12 || l > 0.13 { // 0.25 at the track's −6 dB
			t.Fatalf("frame %d = %.3f, want the loop's 0.125", i, l)
		}
	}
	for _, i := range []int{96000, 100000, 107999} {
		if l := level(i); l != 0 {
			t.Fatalf("frame %d = %.3f, want the tail silent", i, l)
		}
	}
	// It's labelled with the tape, on its tempo from bar 1.
	meta := audio.ReadMeta(filepath.Join(dir, "jam_mix.wav"))
	if meta.Label != "song" || meta.BPM == nil || meta.DownbeatFrame == nil || *meta.DownbeatFrame != 0 {
		t.Fatalf("meta = %+v", meta)
	}
	// The tape stands back at In after it.
	if st := e.tr.Status(); st.Playing || st.Pos != 0 {
		t.Fatalf("after the mixdown: %+v", st)
	}
}

func TestAStopCancelsAMixdownAndSavesNothing(t *testing.T) {
	e, sink, tp, saver, _ := mixdownEngine(t)
	e.Start()
	sink.play(t, 4096)
	if _, err := e.StartMixdown(tp.ID, false); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 20000)
	e.Do(Action{Kind: "stop"})
	got := waitMixdown(t, e, sink)
	if got.State != "failed" || saver.calls != 0 {
		t.Fatalf("a stopped mixdown = %+v, %d saves", got, saver.calls)
	}
	// Another can start after it.
	if _, err := e.StartMixdown(tp.ID, false); err != nil {
		t.Fatalf("after a cancel: %v", err)
	}
}

func TestAMixdownOfTheWholeTapeRunsToItsLastClip(t *testing.T) {
	e, sink, tp, saver, _ := mixdownEngine(t)
	e.Start()
	// A second copy after the loop: the whole tape is two loops long.
	waitFor(t, func() bool { sink.play(t, 512); return e.tr.Status().Pos == 96000 })
	e.DropClipboard(tp.ID, 2, false)
	if _, err := e.StartMixdown(tp.ID, true); err != nil {
		t.Fatal(err)
	}
	got := waitMixdown(t, e, sink)
	if got.State != "done" || got.From != 0 || got.To != 192000 || saver.to-saver.from != 192000+12000 {
		t.Fatalf("whole tape = %+v, saved %d", got, saver.to-saver.from)
	}
	// Straight through Out, where the loop would wrap: no step there, only
	// the clips' own fades.
	main := saver.main
	for i := 95000; i < 97000; i++ {
		if d := math.Abs(float64(main[i])-float64(main[i-1])) / 2147483647; d > 0.002 {
			t.Fatalf("a step of %.4f at frame %d, by Out", d, i)
		}
	}
}

func TestStoppingInAMixdownsTailCancelsIt(t *testing.T) {
	e, sink, tp, saver, _ := mixdownEngine(t)
	e.Start()
	sink.play(t, 4096)
	if _, err := e.StartMixdown(tp.ID, false); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { sink.play(t, 512); m := e.MixdownStatus(); return m.State == "tail" })
	e.Do(Action{Kind: "stop"})
	got := waitMixdown(t, e, sink)
	if got.State != "failed" || saver.calls != 0 {
		t.Fatalf("stopped in the tail = %+v, %d saves", got, saver.calls)
	}
}

func TestAPassThatPlayedLateOrNeverIsMarked(t *testing.T) {
	// The transport alone, driven by hand: what the render goroutine does.
	e, _, _, _ := firstLoop(t) // not started
	tr := e.tr
	buf := make([]float32, 512*OutChannels)
	for len(e.actions) > 0 {
		<-e.actions // the drop's locate, never carried out
	}
	tr.queue(pending{at: 0, action: Action{Kind: "once", Pos: 0, End: 2048, job: 7}})
	e.advance(buf, 0, 512)
	e.advance(nil, 512, 512) // the device played silence here
	e.advance(buf, 1024, 512)
	e.advance(buf, 1536, 512)
	if r := tr.Once(); r.Job != 7 || !r.Done || !r.Late || r.StartOut != 0 || r.EndOut != 2048 {
		t.Fatalf("a late pass = %+v", r)
	}
	if st := tr.Status(); st.Playing || st.Pos != 0 {
		t.Fatalf("after the pass: %+v, want stopped at its start", st)
	}
	// One queued and then dropped by a load is broken, not left waiting.
	tr.queue(pending{at: 99999, action: Action{Kind: "once", Pos: 0, End: 2048, job: 8}})
	tr.reset(2048)
	if r := tr.Once(); r.Job != 8 || !r.Broken {
		t.Fatalf("a queued pass after a load = %+v", r)
	}
}

func TestAMixdownIsRefusedWhenItCantWork(t *testing.T) {
	// No saver, no output, an empty tape, too long for the ring.
	s := newTestStore(t)
	sink := &loopSink{ring: audio.NewRing(48000*8, 8)}
	e := NewEngine(Options{Store: s, Capture: sink, Sink: sink})
	tp, _ := s.Create("x", 0, 0, time.Now())
	e.Load(tp.ID)
	testEngine = e
	t.Cleanup(func() { e.Stop(); testEngine = nil })
	if _, err := e.StartMixdown(tp.ID, false); !errors.Is(err, ErrNoSaver) {
		t.Fatalf("no saver = %v", err)
	}
	e.saver = &fakeSaver{ring: sink.ring}
	if _, err := e.StartMixdown(tp.ID, false); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("an empty tape = %v", err)
	}
	take := takeWAV(t, 200000, func(i int) float64 { return 0.25 })
	e.CopyTake(take, "jam_take.wav", 0, 192000, []int{0, 1}) // 4 s
	e.DropClipboard(tp.ID, 1, false)
	if _, err := e.StartMixdown(tp.ID, false); !errors.Is(err, ErrBadParameter) {
		t.Fatalf("4 s + tail in an 8 s ring with a 5 s margin = %v", err)
	}
	if _, err := e.StartMixdown("other", false); err != ErrWrongTape {
		t.Fatalf("another tape = %v", err)
	}
	e.sink = nil
	if _, err := e.StartMixdown(tp.ID, false); !errors.Is(err, ErrNoOutput) {
		t.Fatalf("no output = %v", err)
	}
}
