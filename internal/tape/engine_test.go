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

// loopSink is a device the test drives: each play() pulls one block, and
// writes it into an 8-channel ring the way the Sidekick brings the returns
// back -- bus A into channels 3/4 (and MAIN), with AUX carrying a ramp that
// stands in for an instrument -- with output frame o landing at ring frame
// o + delta.
type loopSink struct {
	mu    sync.Mutex
	pull  func([]int32)
	ring  *audio.Ring
	delta int64
	out   int64 // output frames pulled
}

func (s *loopSink) Open(ch int, pull func([]int32)) (string, error) {
	s.mu.Lock()
	s.pull = pull
	s.mu.Unlock()
	return "test", nil
}
func (s *loopSink) Close()               { s.mu.Lock(); s.pull = nil; s.mu.Unlock() }
func (s *loopSink) Delta() (int64, bool) { return s.delta, true }
func (s *loopSink) Ring() *audio.Ring    { return s.ring }
func auxAt(ringFrame int64) int32        { return int32(ringFrame * 1000) }

// play pulls n frames in device-sized blocks and records them into the ring.
func (s *loopSink) play(t *testing.T, frames int) []int32 {
	t.Helper()
	var all []int32
	for done := 0; done < frames; done += 512 {
		out := make([]int32, 512*OutChannels)
		// Let the renderer keep up, as a real device's period would.
		deadline := time.Now().Add(2 * time.Second)
		for {
			s.mu.Lock()
			p := s.pull
			s.mu.Unlock()
			if p == nil {
				t.Fatal("not open")
			}
			if eng := testEngine; eng != nil && len(eng.blocks) == 0 && eng.cur == nil && time.Now().Before(deadline) {
				time.Sleep(time.Millisecond)
				continue
			}
			p(out)
			break
		}
		all = append(all, out...)
		// What the device played comes back in the ring, delta later. The
		// test keeps delta = 0 by writing it straight in.
		in := make([]int32, 512*8)
		for i := 0; i < 512; i++ {
			rf := s.out + int64(i) + s.delta
			o := out[i*OutChannels:]
			in[i*8+0], in[i*8+1] = o[0]+o[2], o[1]+o[3] // MAIN
			in[i*8+2], in[i*8+3] = o[0], o[1]           // CH1 tap: bus A
			in[i*8+4], in[i*8+5] = o[2], o[3]           // CH2 tap: bus B
			in[i*8+6], in[i*8+7] = auxAt(rf), auxAt(rf) // AUX: the instrument
		}
		s.ring.WriteFrames(in)
		s.out += 512
	}
	return all
}

var testEngine *Engine

// takeWAV writes a stereo take of n frames, left = v(i), right = -v(i).
func takeWAV(t *testing.T, n int, v func(int) float64) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "jam_take.wav")
	data := make([]int32, n*2)
	for i := 0; i < n; i++ {
		x := int32(v(i) * 2147483647)
		data[2*i], data[2*i+1] = x, -x
	}
	if _, err := audio.WriteWAV(p, data, 2, []int{0, 1}, 48000); err != nil {
		t.Fatal(err)
	}
	return p
}

func newEngine(t *testing.T) (*Engine, *loopSink, *Tape) {
	t.Helper()
	s := newTestStore(t)
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

func TestADropBecomesTheFirstLoopAndPlaysLooped(t *testing.T) {
	e, sink, tp := newEngine(t)
	// A 0.25 s take: frames carry 0.5.
	take := takeWAV(t, 48000, func(i int) float64 { return 0.5 })
	clip, err := e.DropTake(tp.ID, take, 12000, 24000, 1, 1, []int{0, 1})
	if err != nil {
		t.Fatal(err)
	}
	loaded := e.Loaded()
	if loaded.Grid == nil || loaded.Grid.Frames != 12000 || !loaded.Loop.On || loaded.Loop.Out != 12000 {
		t.Fatalf("the first drop should set the loop: %+v %+v", loaded.Grid, loaded.Loop)
	}
	if clip.At != 0 || clip.Frames != 12000 || clip.Src != 480 {
		t.Fatalf("clip %+v: 10 ms of overhang before it", clip)
	}
	e.Do(Action{Kind: "play"})
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	out := sink.play(t, 48000) // four passes
	// At -6 dB, 0.5 plays as about 0.25 on bus A, all the way round. At the
	// seam the clip crossfades into itself (equal power: correlated audio
	// swells by up to 3 dB for 5 ms), and never drops out.
	want := 0.5 * math.Pow(10, -6.0/20)
	for f := 11990; f < 12300; f++ {
		if got := float64(out[f*OutChannels]) / 2147483647; got < want*0.98 || got > want*1.42 {
			t.Fatalf("frame %d at the seam = %.4f", f, got)
		}
	}
	for _, f := range []int{1000, 11999, 12300, 30000} {
		got := float64(out[f*OutChannels]) / 2147483647
		if math.Abs(got-want) > 0.02 {
			t.Fatalf("frame %d bus A = %.4f, want %.4f", f, got, want)
		}
		if out[f*OutChannels+2] != 0 {
			t.Fatalf("frame %d: bus B should be silent", f)
		}
	}
	if c := e.Live().Cycles; len(c) < 2 || c[0].Out != 0 || c[1].Out != 12000 || c[0].Len != 12000 {
		t.Fatalf("cycles = %+v", c)
	}
}

func TestCatchingAPassPutsTheRingsSpanWhereItWasPlayed(t *testing.T) {
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 48000, func(i int) float64 { return 0.5 })
	if _, err := e.DropTake(tp.ID, take, 0, 12000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	e.Do(Action{Kind: "play"})
	e.Start()
	sink.play(t, 12000*3+2000) // three passes, and into the fourth
	clip, err := e.Catch(tp.ID, CatchRequest{Track: 2, Source: "aux", Pass: 1})
	if err != nil {
		t.Fatal(err)
	}
	// The last complete pass began at output frame 24000; with delta 0 the
	// ring heard it at 24000, and the file starts 10 ms (480) before.
	if clip.At != 0 || clip.Frames != 12000 || clip.Src != 480 || clip.Source != "aux" || !clip.Clean {
		t.Fatalf("clip = %+v", clip)
	}
	data := readPool(t, e.store, clip.File)
	if data[2*480] != auxAt(24000) || data[2*(480+11999)] != auxAt(24000+11999) {
		t.Fatalf("the catch holds ring frames %d.., want 24000..", data[2*480]/1000)
	}
	// Catching from the CH1 tap, which bus A is sounding into, is flagged.
	clip2, err := e.Catch(tp.ID, CatchRequest{Track: 3, Source: "ch1", Pass: 2})
	if err != nil || clip2.Clean {
		t.Fatalf("ch1 catch = %+v %v, want it marked not clean", clip2, err)
	}
	// Undo takes the catch back off.
	if err := e.Undo(tp.ID, false); err != nil {
		t.Fatal(err)
	}
	if n := len(e.Loaded().Tracks[2].Clips); n != 0 {
		t.Fatalf("track 3 has %d clips after undo", n)
	}
}

func TestCatchingTheLastBarsThroughTheSeam(t *testing.T) {
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 48000, func(i int) float64 { return 0.5 })
	// A 4-bar loop of 24000 frames: a bar is 6000.
	if _, err := e.DropTake(tp.ID, take, 0, 24000, 1, 4, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	e.Do(Action{Kind: "play"})
	e.Start()
	sink.play(t, 24000+8000) // into the second pass: bar 1 of it is done at 30000
	clip, err := e.Catch(tp.ID, CatchRequest{Track: 2, Source: "aux", Bars: 2})
	if err != nil {
		t.Fatal(err)
	}
	// The last bar line in the ring is output 30000 (tape 6000); two bars
	// back is output 18000, tape 18000 -- across the seam, so the catch is
	// split: 6000 at tape 18000, and 6000 at tape 0.
	clips := e.Loaded().Tracks[1].Clips
	if len(clips) != 2 {
		t.Fatalf("clips = %+v, want the catch split at the seam", clips)
	}
	byAt := map[int64]Clip{clips[0].At: clips[0], clips[1].At: clips[1]}
	head, tail := byAt[18000], byAt[0]
	if head.Frames != 6000 || tail.Frames != 6000 || tail.Src != head.Src+6000 || clip.At != 18000 {
		t.Fatalf("head %+v tail %+v", head, tail)
	}
	data := readPool(t, e.store, head.File)
	if data[2*head.Src] != auxAt(18000) {
		t.Fatalf("starts at ring frame %d, want 18000", data[2*head.Src]/1000)
	}
}

func TestALateRenderPlaysSilenceAndTheTapeCountsOn(t *testing.T) {
	e, _, tp := newEngine(t)
	take := takeWAV(t, 48000, func(i int) float64 { return 0.5 })
	e.DropTake(tp.ID, take, 0, 12000, 1, 1, []int{0, 1})
	// No Start: drive pull directly with nothing rendered.
	out := make([]int32, 512*OutChannels)
	e.pull(out)
	if e.late.Load() != 1 || e.delivered.Load() != 512 {
		t.Fatalf("late %d delivered %d", e.late.Load(), e.delivered.Load())
	}
	for _, v := range out {
		if v != 0 {
			t.Fatal("a late block must be silence")
		}
	}
}

func readPool(t *testing.T, s *Store, rel string) []int32 {
	t.Helper()
	path := s.AudioPath(rel)
	info, err := audio.ReadWAVInfo(path)
	if err != nil {
		t.Fatal(err)
	}
	var all []int32
	audio.ReadFrames(path, 0, info.Frames(), 1<<14, func(b []int32, _ int64) error { all = append(all, b...); return nil })
	return all
}

func TestALoadForgetsThePassesOfTheLastTape(t *testing.T) {
	e, sink, tp := newEngine(t)
	take := takeWAV(t, 48000, func(i int) float64 { return 0.5 })
	if _, err := e.DropTake(tp.ID, take, 0, 12000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	e.Do(Action{Kind: "play"})
	e.Start()
	sink.play(t, 12000*3)
	if len(e.Live().Cycles) == 0 {
		t.Fatal("no passes logged")
	}
	other, err := e.store.Create("other", 120, 1, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Load(other.ID); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 2048) // the render goroutine applies the load's actions
	deadline := time.Now().Add(2 * time.Second)
	for len(e.Live().Cycles) != 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if c := e.Live().Cycles; len(c) != 0 {
		t.Fatalf("passes of the last tape survived a load: %+v", c)
	}
	if _, err := e.Catch(other.ID, CatchRequest{Track: 1, Source: "aux", Pass: 1}); !errors.Is(err, ErrNoPass) {
		t.Fatalf("catching a pass after a load = %v, want ErrNoPass", err)
	}
}

func TestWithoutAnOutputTheTapeLocatesButDoesNotPlay(t *testing.T) {
	s := newTestStore(t)
	e := NewEngine(Options{Store: s})
	tp, _ := s.Create("quiet", 120, 1, time.Now())
	if _, err := e.Load(tp.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	defer e.Stop()
	if e.HasOutput() {
		t.Fatal("no sink, but an output")
	}
	e.Do(Action{Kind: "play"})
	e.Do(Action{Kind: "locate", Pos: 4800})
	deadline := time.Now().Add(2 * time.Second)
	for e.Live().Pos != 4800 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if l := e.Live(); l.Pos != 4800 || l.Playing {
		t.Fatalf("live = %+v, want stopped at 4800", l.Status)
	}
}
