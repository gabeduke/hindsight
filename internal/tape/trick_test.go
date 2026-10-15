package tape

import (
	"math"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
)

// The rig: a grid of one-second bars at 48 kHz, so a sixteenth is 3000
// frames and a beat 12000, and two tracks -- 1 on bus A, 2 on bus B --
// reading a ramp whose value at tape frame f is f/1e6. What comes out says
// exactly where on the tape it was read.
//
// The engine is never started: the test calls advance itself, a block at a
// time, so every frame is where the test put it.
const (
	rigBar       = 48000
	rigSixteenth = rigBar / 16
	rigBeat      = rigBar / BeatsPerBar
	rigFrames    = 8 * rigBar
)

type rig struct {
	e   *Engine
	out uint64
}

func newRig(t *testing.T, loop Loop) *rig {
	t.Helper()
	s := newTestStore(t)
	pool := NewPool(s)
	rel := poolWAV(t, s, rigFrames, func(i int) float64 { return float64(i) / 1e6 })
	clips := func(id string) []Clip { return []Clip{{ID: id, File: rel, Frames: rigFrames}} }
	st := State{Grid: &Grid{Frames: 4 * rigBar, Bars: 4}, Loop: loop, Tracks: []Track{
		{N: 1, Bus: BusA, Clips: clips("a")},
		{N: 2, Bus: BusB, Clips: clips("b")},
	}}
	m := NewMix(st, pool, 48000)
	m.length = 2 * rigFrames
	e := NewEngine(Options{Store: s})
	e.mix.Store(m)
	return &rig{e: e}
}

// playFrom locates the tape at pos and plays it.
func (r *rig) playFrom(pos int64) {
	r.e.Do(Action{Kind: "locate", Pos: pos})
	r.e.Do(Action{Kind: "play"})
}

// run renders blocks of output and returns them.
func (r *rig) run(blocks int) []float32 {
	out := make([]float32, blocks*BlockFrames*OutChannels)
	for b := 0; b < blocks; b++ {
		r.e.advance(out[b*BlockFrames*OutChannels:(b+1)*BlockFrames*OutChannels], r.out, BlockFrames)
		r.out += BlockFrames
	}
	return out
}

// readAt is where on the tape output frame k of a run on bus b (0 A, 1 B) was
// read, from the ramp's value on that bus's left channel.
func readAt(out []float32, k, bus int) float64 { return float64(out[k*OutChannels+bus*2]) * 1e6 }

// pair plays two identical rigs from pos for blocks, so one can be tricked
// and the other left alone.
func pair(t *testing.T, pos int64, loop Loop) (*rig, *rig) {
	a, b := newRig(t, loop), newRig(t, loop)
	a.playFrom(pos)
	b.playFrom(pos)
	return a, b
}

func firstDiff(a, b []float32) int {
	for i := range a {
		if a[i] != b[i] {
			return i / OutChannels
		}
	}
	return -1
}

func TestTheSixteenthLinesAreTheBeatsAndBarsToo(t *testing.T) {
	g := Grid{Frames: 4 * rigBar, Bars: 4}
	for pos, want := range map[int64]int64{0: 0, 1: 3000, 2999: 3000, 3000: 3000, 3001: 6000} {
		if got := g.NextDivision(pos, 16); got != want {
			t.Fatalf("NextDivision(%d, 16) = %d, want %d", pos, got, want)
		}
	}
	// At 84 BPM a bar is 137142.857 frames: every fourth sixteenth must land
	// on exactly the frame its beat does, rounding and all.
	g84 := GridFor(84, 4, 48000)
	for n := int64(0); n < 64; n++ {
		if g84.DivisionStart(4*n, 16) != g84.BeatStart(n) {
			t.Fatalf("sixteenth %d at %d, its beat at %d", 4*n, g84.DivisionStart(4*n, 16), g84.BeatStart(n))
		}
	}
}

func TestATrickLandsOnTheNextSixteenthOfTheTape(t *testing.T) {
	// Playing from 10000, which is no line at all. After three blocks the
	// render head is at tape frame 13072; the next sixteenth is 15000.
	a, b := pair(t, 10000, Loop{})
	a.run(3)
	b.run(3)
	if err := a.e.Press(PadStop, QuantumSixteenth); err != nil {
		t.Fatal(err)
	}
	k := firstDiff(a.run(4), b.run(4))
	if k < 0 {
		t.Fatal("the trick changed nothing")
	}
	if tape := 10000 + 3*BlockFrames + k; tape != 15000 {
		t.Fatalf("it first sounded at tape frame %d, want the sixteenth at 15000", tape)
	}
}

func TestATrickComesBackInTime(t *testing.T) {
	// The point of the design: the transport never stopped, so once the
	// release's crossfade is over the tape is exactly where it would have
	// been, to the sample.
	for _, pad := range []string{PadBreak, PadStop, PadReverse, PadChop, PadHalf, PadDouble} {
		t.Run(pad, func(t *testing.T) {
			a, b := pair(t, 10000, Loop{})
			a.run(2)
			b.run(2)
			if err := a.e.Press(pad, QuantumSixteenth); err != nil {
				t.Fatal(err)
			}
			held, plain := a.run(16), b.run(16)
			if firstDiff(held, plain) < 0 {
				t.Fatal("holding it changed nothing")
			}
			if err := a.e.Release(pad); err != nil {
				t.Fatal(err)
			}
			a.run(6) // the release's sixteenth, and its crossfade
			b.run(6)
			if k := firstDiff(a.run(8), b.run(8)); k >= 0 {
				t.Fatalf("frame %d after the release differs from a tape never tricked", k)
			}
			if a.e.tr.pos != b.e.tr.pos {
				t.Fatalf("the transport is at %d, untricked at %d", a.e.tr.pos, b.e.tr.pos)
			}
		})
	}
}

// engaged plays a rig from 10000, presses pad on the next sixteenth and
// returns what it played from the press on, and the frame of that output
// the head left on (tape frame 15000, as above).
func engaged(t *testing.T, pad, quantum string, blocks int) ([]float32, int) {
	t.Helper()
	r := newRig(t, Loop{})
	r.playFrom(10000)
	r.run(3)
	if err := r.e.Press(pad, quantum); err != nil {
		t.Fatal(err)
	}
	return r.run(blocks), 15000 - (10000 + 3*BlockFrames)
}

const xf = 240 // the renderer's 5 ms seam, at 48 kHz

func TestReverseAndVarispeedReadAtTheirRates(t *testing.T) {
	for pad, rate := range map[string]float64{PadReverse: -1, PadHalf: 0.5, PadDouble: 2} {
		out, k0 := engaged(t, pad, QuantumSixteenth, 6)
		// Past the crossfade, every frame on moves the read by the rate.
		for k := k0 + xf + 10; k < k0+3000; k++ {
			for bus := 0; bus < 2; bus++ {
				step := readAt(out, k+1, bus) - readAt(out, k, bus)
				if math.Abs(step-rate) > 0.01 {
					t.Fatalf("%s: frame %d stepped %.4f frames of tape, want %v", pad, k, step, rate)
				}
			}
		}
		// And from where it left: the head reads from tape frame 15000.
		k := k0 + 1000
		if want := 15000 + rate*1000; math.Abs(readAt(out, k, 0)-want) > 0.05 {
			t.Fatalf("%s: 1000 frames in it reads %.2f, want %.2f", pad, readAt(out, k, 0), want)
		}
	}
}

func TestStopWindsDownOverABeatThenFallsSilent(t *testing.T) {
	h := head{on: true, pad: padIndex(PadStop), anchor: 15000, beat: rigBeat}
	// The speed falls in a straight line from 1 to 0 over the beat, and the
	// level with it.
	for _, k := range []int64{0, 3000, 6000, 9000, 11998} {
		p0, l, ok := h.read(k, Loop{})
		p1, _, _ := h.read(k+1, Loop{})
		want := 1 - float64(k)/rigBeat
		if !ok || math.Abs((p1-p0)-want) > 1e-3 || math.Abs(float64(l)-want) > 1e-3 {
			t.Fatalf("k=%d: speed %.4f level %.4f, want %.4f", k, p1-p0, l, want)
		}
	}
	if _, _, ok := h.read(rigBeat, Loop{}); ok {
		t.Fatal("still sounding a beat after it was pressed")
	}

	out, k0 := engaged(t, PadStop, QuantumSixteenth, 16)
	for k := k0 + rigBeat; k < len(out)/OutChannels; k++ {
		for c := 0; c < OutChannels; c++ {
			if v := out[k*OutChannels+c]; v != 0 {
				t.Fatalf("frame %d, a beat after the stop, carries %v", k, v)
			}
		}
	}
}

func TestBreakCutsToSilenceWhileTheTapeRunsOn(t *testing.T) {
	r := newRig(t, Loop{})
	r.playFrom(10000)
	r.run(3)
	if err := r.e.Press(PadBreak, QuantumSixteenth); err != nil {
		t.Fatal(err)
	}
	before := r.e.tr.pos
	out := r.run(8)
	k0 := 15000 - (10000 + 3*BlockFrames)
	for k := k0 + xf; k < len(out)/OutChannels; k++ {
		if out[k*OutChannels] != 0 || out[k*OutChannels+2] != 0 {
			t.Fatalf("frame %d sounds under BREAK", k)
		}
	}
	if moved := r.e.tr.pos - before; moved != 8*BlockFrames {
		t.Fatalf("the transport moved %d frames under BREAK, want %d", moved, 8*BlockFrames)
	}
}

func TestChopRepeatsTheLastSlice(t *testing.T) {
	out, k0 := engaged(t, PadChop, QuantumSixteenth, 16)
	// The slice is the sixteenth before the press: tape [12000, 15000).
	for k := k0 + xf; k < k0+rigSixteenth; k++ {
		want := 12000 + float64(k-k0)
		if got := readAt(out, k, 0); math.Abs(got-want) > 0.05 {
			t.Fatalf("the first pass reads %.2f at frame %d, want %.2f", got, k, want)
		}
	}
	// From the second pass on it repeats, seam and all.
	for k := k0 + rigSixteenth; k+rigSixteenth < len(out)/OutChannels; k++ {
		if d := math.Abs(readAt(out, k, 0) - readAt(out, k+rigSixteenth, 0)); d > 0.05 {
			t.Fatalf("frame %d and the same frame one slice on differ by %.3f", k, d)
		}
	}
	// The slice follows the quantise switch: an eighth chops 6000 frames.
	eighth, k8 := engaged(t, PadChop, QuantumEighth, 16)
	// The press waited for the next eighth, 18000; the slice is [12000, 18000).
	k8 += 3000
	if got := readAt(eighth, k8+4000, 0); math.Abs(got-16000) > 0.05 {
		t.Fatalf("an eighth's chop reads %.2f 4000 frames in, want 16000", got)
	}
	if d := math.Abs(readAt(eighth, k8+6000+1000, 0) - readAt(eighth, k8+1000, 0)); d > 0.05 {
		t.Fatalf("an eighth's chop doesn't repeat every 6000 frames: off by %.3f", d)
	}
}

func TestATrackKeyDropsOnlyItsTrack(t *testing.T) {
	a, b := pair(t, 10000, Loop{})
	a.run(3)
	b.run(3)
	if err := a.e.Press(PadTrack2, QuantumSixteenth); err != nil {
		t.Fatal(err)
	}
	held, plain := a.run(8), b.run(8)
	k0 := 15000 - (10000 + 3*BlockFrames)
	for k := 0; k < len(held)/OutChannels; k++ {
		if held[k*OutChannels] != plain[k*OutChannels] {
			t.Fatalf("bus A changed at frame %d: track 1 isn't the one held", k)
		}
		if k >= k0+144 && held[k*OutChannels+2] != 0 { // past the 3 ms declick
			t.Fatalf("track 2 still sounds at frame %d", k)
		}
	}
	if err := a.e.Release(PadTrack2); err != nil {
		t.Fatal(err)
	}
	a.run(4)
	b.run(4)
	if k := firstDiff(a.run(4), b.run(4)); k >= 0 {
		t.Fatalf("track 2 isn't back at frame %d after the release", k)
	}
}

func TestATrackKeyAndATrickTogether(t *testing.T) {
	r := newRig(t, Loop{})
	r.playFrom(10000)
	r.run(3)
	if err := r.e.Press(PadTrack1, QuantumSixteenth); err != nil {
		t.Fatal(err)
	}
	if err := r.e.Press(PadReverse, QuantumSixteenth); err != nil {
		t.Fatal(err)
	}
	out := r.run(6)
	k := 15000 - (10000 + 3*BlockFrames) + 1000
	if v := out[k*OutChannels]; v != 0 {
		t.Fatalf("track 1 sounds (%v) with its key held", v)
	}
	if got := readAt(out, k, 1); math.Abs(got-14000) > 0.05 {
		t.Fatalf("track 2 reads %.2f reversed, want 14000", got)
	}
}

func TestTheNewestTrickHeldIsHeardAndLettingGoFallsBack(t *testing.T) {
	r := newRig(t, Loop{})
	r.playFrom(10000)
	r.run(3)
	_ = r.e.Press(PadReverse, QuantumSixteenth)
	r.run(4) // reversing from 15000
	_ = r.e.Press(PadHalf, QuantumSixteenth)
	r.run(4)
	if r.e.perf.top() != padIndex(PadHalf) {
		t.Fatal("the newest held isn't the one heard")
	}
	_ = r.e.Release(PadHalf)
	r.run(4)
	if r.e.perf.top() != padIndex(PadReverse) || !r.e.perf.head.on || r.e.perf.head.pad != padIndex(PadReverse) {
		t.Fatal("letting the newest go didn't fall back to the one still held")
	}
	_ = r.e.Release(PadReverse)
	r.run(4)
	if r.e.perf.head.on || len(r.e.perf.order) != 0 {
		t.Fatal("with nothing held the head should be back on the transport")
	}
}

func TestATapStillPlaysAWholeSixteenth(t *testing.T) {
	// Pressed and let go before either reached the renderer: the release
	// waits a whole line, so the tap is heard.
	r := newRig(t, Loop{})
	r.playFrom(10000)
	r.run(3)
	_ = r.e.Press(PadBreak, QuantumSixteenth)
	_ = r.e.Release(PadBreak)
	out := r.run(8)
	k0 := 15000 - (10000 + 3*BlockFrames)
	for k := k0 + xf; k < k0+rigSixteenth; k++ {
		if out[k*OutChannels] != 0 {
			t.Fatalf("frame %d sounds: the tap's break didn't last its sixteenth", k)
		}
	}
	if v := out[(k0+rigSixteenth+xf+10)*OutChannels]; v == 0 {
		t.Fatal("the tape didn't come back after the tap's sixteenth")
	}
}

func TestAReleaseIsNeverDropped(t *testing.T) {
	r := newRig(t, Loop{})
	r.playFrom(10000)
	for i := 0; i < maxPresses; i++ {
		_ = r.e.Press(pads[trackPads+i%(numPads-trackPads)], QuantumSixteenth)
	}
	_ = r.e.Press(PadStop, QuantumSixteenth) // the 65th press: dropped
	r.e.ReleaseAll(QuantumNow)
	r.e.tricks.mu.Lock()
	n, last := len(r.e.tricks.msgs), r.e.tricks.msgs[len(r.e.tricks.msgs)-1]
	r.e.tricks.mu.Unlock()
	if n != maxPresses+1 || !last.all {
		t.Fatalf("the inbox holds %d messages, the last %+v: the release must get in past a full inbox", n, last)
	}
	r.run(8)
	if r.e.perf.head.on || len(r.e.perf.order) != 0 {
		t.Fatalf("after a release of everything, %v is still held", r.e.perf.order)
	}
}

func TestPressingWhileStoppedTakesTheHeadWhenItPlays(t *testing.T) {
	r := newRig(t, Loop{})
	r.e.Do(Action{Kind: "locate", Pos: 20000})
	_ = r.e.Press(PadReverse, QuantumSixteenth)
	r.run(1) // stopped: held, but nothing to read
	if r.e.perf.head.on {
		t.Fatal("a stopped tape has no head")
	}
	r.e.Do(Action{Kind: "play"})
	out := r.run(2)
	if got := readAt(out, 500, 0); math.Abs(got-19500) > 0.05 {
		t.Fatalf("it reads %.2f, want 19500: reversing from where it started", got)
	}
	r.e.Do(Action{Kind: "stop"})
	r.run(1)
	if r.e.perf.head.on {
		t.Fatal("stopping the tape should drop the head")
	}
}

func TestAReverseInsideTheLoopStaysInIt(t *testing.T) {
	// Looping [12000, 24000): reversing from 15000 runs back to 12000, then
	// comes round to the loop's end.
	r := newRig(t, Loop{In: 12000, Out: 24000, On: true})
	r.playFrom(12000)
	r.run(2) // to 14048
	_ = r.e.Press(PadReverse, QuantumSixteenth)
	out := r.run(8)
	k0 := 15000 - (12000 + 2*BlockFrames)
	if got := readAt(out, k0+2000, 0); math.Abs(got-13000) > 0.05 {
		t.Fatalf("2000 frames in it reads %.2f, want 13000", got)
	}
	if got := readAt(out, k0+4000, 0); math.Abs(got-23000) > 0.05 {
		t.Fatalf("4000 frames in it reads %.2f, want 23000: round the loop", got)
	}
}

func TestTricksLeaveNoUndoAndWriteNothing(t *testing.T) {
	e, _, tp := newEngine(t)
	path := filepath.Join(e.store.Dir(), "tapes", tp.ID, "tape.json")
	if _, err := os.Stat(path); err != nil {
		dir, derr := e.store.tapeDir(tp.ID)
		if derr != nil {
			t.Fatal(derr)
		}
		path = filepath.Join(dir, "tape.json")
	}
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(20 * time.Millisecond) // a write after this would show in the mtime
	before := e.Loaded()
	undo0, redo0 := e.UndoDepth()

	e.Do(Action{Kind: "play"})
	var out uint64
	buf := make([]float32, BlockFrames*OutChannels)
	for i := 0; i < 200; i++ {
		p := pads[i%numPads]
		if i%2 == 0 {
			_ = e.Press(p, QuantumSixteenth)
		} else {
			_ = e.Release(p)
		}
		clear(buf)
		e.advance(buf, out, BlockFrames)
		out += BlockFrames
	}
	e.ReleaseAll(QuantumNow)
	e.advance(buf, out, BlockFrames)

	if u, r := e.UndoDepth(); u != undo0 || r != redo0 {
		t.Fatalf("undo %d/%d after a jam, was %d/%d", u, r, undo0, redo0)
	}
	if after := e.Loaded(); !reflect.DeepEqual(before.State, after.State) {
		t.Fatal("a jam changed the tape's state")
	}
	if st2, err := os.Stat(path); err != nil || !st2.ModTime().Equal(st.ModTime()) {
		t.Fatalf("tape.json was written during a jam (%v)", err)
	}
}

func TestPressAndReleaseRefuseWhatPlayModeDoesntHave(t *testing.T) {
	r := newRig(t, Loop{})
	if err := r.e.Press("loud", QuantumSixteenth); err != ErrNoSuchPad {
		t.Fatalf("a made-up pad: %v", err)
	}
	if err := r.e.Press(PadStop, "triplet"); err != ErrBadParameter {
		t.Fatalf("a made-up quantum: %v", err)
	}
	if err := r.e.Release("loud"); err != ErrNoSuchPad {
		t.Fatalf("releasing a made-up pad: %v", err)
	}
}

// BenchmarkRenderABlock is the cost of one 21 ms block with four tracks
// playing, plain and under each trick: the number to watch on the Pi, where
// a block that takes longer than it plays is a gap in the room.
func BenchmarkRenderABlock(b *testing.B) {
	for _, pad := range []string{"", PadDouble, PadHalf, PadReverse, PadChop, PadStop, PadTrack2} {
		name := pad
		if name == "" {
			name = "plain"
		}
		b.Run(name, func(b *testing.B) {
			s, err := OpenStore(b.TempDir(), 48000, 4, 60)
			if err != nil {
				b.Fatal(err)
			}
			pool := NewPool(s)
			rel, path, err := s.NewPoolFile("bench", time.Now())
			if err != nil {
				b.Fatal(err)
			}
			if err := writeRamp(path, rigFrames); err != nil {
				b.Fatal(err)
			}
			var tracks []Track
			for n := 1; n <= 4; n++ {
				tracks = append(tracks, Track{N: n, Bus: BusA, Clips: []Clip{{ID: "c", File: rel, Frames: rigFrames}}})
			}
			m := NewMix(State{Grid: &Grid{Frames: 4 * rigBar, Bars: 4}, Loop: Loop{In: 0, Out: 4 * rigBar, On: true}, Tracks: tracks}, pool, 48000)
			m.length = 2 * rigFrames
			e := NewEngine(Options{Store: s})
			e.mix.Store(m)
			e.Do(Action{Kind: "play"})
			buf := make([]float32, BlockFrames*OutChannels)
			var out uint64
			e.advance(buf, out, BlockFrames)
			out += BlockFrames
			if pad != "" {
				_ = e.Press(pad, QuantumNow)
			}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				clear(buf)
				e.advance(buf, out, BlockFrames)
				out += BlockFrames
				if pad == PadStop && e.perf.head.on && float64(out-e.perf.head.start) > e.perf.head.beat {
					// Keep it winding: a stopped head renders nothing.
					e.perf.head.start = out
				}
			}
		})
	}
}

func writeRamp(path string, frames int) error {
	data := make([]int32, frames*2)
	for i := 0; i < frames; i++ {
		v := int32(float64(i) / 1e6 * 2147483647)
		data[2*i], data[2*i+1] = v, -v
	}
	_, err := audio.WriteWAV(path, data, 2, []int{0, 1}, 48000)
	return err
}
