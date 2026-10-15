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
	// A tape with something on it, so the jam really plays tricks: the first
	// drop sets a one-bar loop (as TestADropBecomesTheFirstLoopAndPlaysLooped).
	take := takeWAV(t, 200000, func(i int) float64 { return 0.5 })
	if _, err := e.DropTake(tp.ID, take, 96000, 192000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
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
	engaged := 0
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
		if e.perf.head.on {
			engaged++
		}
	}
	if engaged == 0 {
		t.Fatal("no trick ever engaged: the test proves nothing")
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
// playing, plain and under each trick, each punch-in FX, the tape mods, and
// everything at once: the number to watch on the Pi, where a block that
// takes longer than it plays is a gap in the room. The punch-in FX spec's
// budget is a quarter of the block, about 5 ms, for "everything".
func BenchmarkRenderABlock(b *testing.B) {
	full := Style{Wow: 1, Flutter: 1, Drive: 1, Age: 1}
	cases := []struct {
		name   string
		pads   []string
		mods   *Style
		moving bool // every amount set somewhere new each block: always gliding
	}{
		{name: "plain"},
		{name: PadDouble, pads: []string{PadDouble}},
		{name: PadHalf, pads: []string{PadHalf}},
		{name: PadReverse, pads: []string{PadReverse}},
		{name: PadChop, pads: []string{PadChop}},
		{name: PadStop, pads: []string{PadStop}},
		{name: PadTrack2, pads: []string{PadTrack2}},
		{name: PadRoll, pads: []string{PadRoll}},
		{name: PadFilter, pads: []string{PadFilter}},
		{name: PadEcho, pads: []string{PadEcho}},
		{name: PadCrush, pads: []string{PadCrush}},
		{name: PadBend, pads: []string{PadBend}},
		{name: "fx-all-four", pads: []string{PadRoll, PadFilter, PadEcho, PadCrush}},
		{name: "mods", mods: &full},
		// Four FX, four mods, the bend and a trick: 2× is the dearest head,
		// and over ROLL it's the one heard.
		{name: "everything", pads: []string{PadRoll, PadFilter, PadEcho, PadCrush, PadBend, PadDouble}, mods: &full},
		{name: "fx-all-four-moving", pads: []string{PadRoll, PadFilter, PadEcho, PadCrush}, moving: true},
		{name: "mods-moving", mods: &full, moving: true},
		{name: "everything-moving", pads: []string{PadRoll, PadFilter, PadEcho, PadCrush, PadBend, PadDouble}, mods: &full, moving: true},
	}
	for _, c := range cases {
		b.Run(c.name, func(b *testing.B) {
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
			m := NewMix(State{Grid: &Grid{Frames: 4 * rigBar, Bars: 4}, Loop: Loop{In: 0, Out: 4 * rigBar, On: true}, Tracks: tracks, Style: c.mods}, pool, 48000)
			m.length = 2 * rigFrames
			e := NewEngine(Options{Store: s})
			e.mix.Store(m)
			e.Do(Action{Kind: "play"})
			buf := make([]float32, BlockFrames*OutChannels)
			var out uint64
			e.advance(buf, out, BlockFrames)
			out += BlockFrames
			for _, p := range c.pads {
				_ = e.PressAmount(p, QuantumNow, 0.8)
			}
			// Into the steady state: the amounts arrived, the echo ringing.
			for i := 0; i < 20; i++ {
				clear(buf)
				e.advance(buf, out, BlockFrames)
				out += BlockFrames
			}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if c.moving {
					// What's engaged, somewhere new: a mod wheel and the
					// knobs in a hand that won't stay still.
					v := 0.2 + 0.6*float64(i%2)
					for _, p := range c.pads {
						if amountPad(padIndex(p)) {
							_ = e.Set(p, v)
						}
					}
					if c.mods != nil {
						for _, md := range Mods() {
							_ = e.Set(md, v)
						}
					}
				}
				clear(buf)
				e.advance(buf, out, BlockFrames)
				out += BlockFrames
				if c.name == PadStop && e.perf.head.on && float64(out-e.perf.head.start) > e.perf.head.beat {
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

// ---------------------------------------------------------------------------
// From review: each of these failed before its fix.

// maxJump is the largest frame-to-frame step on bus b's left channel over
// output frames [from, to): on the ramp rig a clean change of source steps
// about 0.0002, and a cut steps a hundred times that.
func maxJump(out []float32, from, to, bus int) (float64, int) {
	best, at := 0.0, -1
	for k := max(1, from); k < to; k++ {
		d := math.Abs(float64(out[k*OutChannels+bus*2] - out[(k-1)*OutChannels+bus*2]))
		if d > best {
			best, at = d, k
		}
	}
	return best, at
}

const clickStep = 0.002

func TestAReleaseOfEverythingAfterAPressStillLetsGo(t *testing.T) {
	// Release everything, press, release everything -- all before one
	// drain. The second release must not be taken for the first.
	r := newRig(t, Loop{})
	r.playFrom(10000)
	r.run(1)
	r.e.ReleaseAll(QuantumNow)
	_ = r.e.Press(PadReverse, QuantumNow)
	r.e.ReleaseAll(QuantumNow)
	r.run(40)
	i := padIndex(PadReverse)
	if r.e.perf.held[i] || r.e.perf.down[i] || r.e.perf.head.on {
		t.Fatalf("REV stuck: held=%v down=%v head=%v", r.e.perf.held[i], r.e.perf.down[i], r.e.perf.head.on)
	}
}

func TestChangesOfSourceOnOneFrameDontClick(t *testing.T) {
	cases := map[string]func(r *rig){
		// REV let go as CHOP lands, on one sixteenth.
		"switching tricks": func(r *rig) {
			_ = r.e.Press(PadReverse, QuantumSixteenth)
			r.run(8)
			_ = r.e.Release(PadReverse)
			_ = r.e.Press(PadChop, QuantumSixteenth)
		},
		// BREAK over REV, both let go together.
		"letting go of a stack": func(r *rig) {
			_ = r.e.Press(PadReverse, QuantumSixteenth)
			r.run(4)
			_ = r.e.Press(PadBreak, QuantumSixteenth)
			r.run(8)
			_ = r.e.Release(PadBreak)
			_ = r.e.Release(PadReverse)
		},
		"releasing everything from a stack": func(r *rig) {
			_ = r.e.Press(PadReverse, QuantumSixteenth)
			r.run(4)
			_ = r.e.Press(PadBreak, QuantumSixteenth)
			r.run(8)
			r.e.ReleaseAll(QuantumSixteenth)
		},
		"two pads pressed on one line": func(r *rig) {
			_ = r.e.Press(PadBreak, QuantumSixteenth)
			_ = r.e.Press(PadReverse, QuantumSixteenth)
		},
	}
	for name, play := range cases {
		t.Run(name, func(t *testing.T) {
			r := newRig(t, Loop{})
			r.playFrom(10000)
			r.run(3)
			play(r)
			out := r.run(10)
			if j, at := maxJump(out, 1, len(out)/OutChannels, 0); j > clickStep {
				t.Fatalf("a step of %.4f at frame %d: a click", j, at)
			}
		})
	}
	t.Run("a quantise-off tap", func(t *testing.T) {
		// Pressed and let go in one drain with quantise off: both land on one
		// frame, and nothing should be heard to change at all.
		r := newRig(t, Loop{})
		r.playFrom(10000)
		r.run(3)
		_ = r.e.Press(PadBreak, QuantumNow)
		_ = r.e.Release(PadBreak)
		out := r.run(1)
		for k := 0; k < len(out)/OutChannels; k++ {
			want := float64(10000+3*BlockFrames+k) / 1e6 // the tape, untouched
			if got := float64(out[k*OutChannels]); got < 0.9*want {
				t.Fatalf("frame %d at %.6f, the tape there %.6f: a hole where nothing was held", k, got, want)
			}
		}
	})
}

func TestAHeadPlaysThroughTheLoopsSeamWithoutADip(t *testing.T) {
	// The usual loop: one clip filling it exactly, as a tap, drop or catch
	// makes. A head going round it (or back round it) must sound as the
	// tape does going round: no dip at the seam.
	const in, out = 48000, 96000
	s := newTestStore(t)
	pool := NewPool(s)
	rel := poolWAV(t, s, rigFrames, func(int) float64 { return 0.5 })
	st := State{Grid: &Grid{Frames: 4 * rigBar, Bars: 4}, Loop: Loop{In: in, Out: out, On: true}, Tracks: []Track{
		{N: 1, Bus: BusA, Clips: []Clip{{ID: "a", File: rel, Src: in, At: in, Frames: out - in}}},
	}}
	for _, pad := range []string{"", PadReverse, PadDouble, PadHalf, PadChop} {
		t.Run(pad, func(t *testing.T) {
			m := NewMix(st, pool, 48000)
			m.length = 2 * rigFrames
			e := NewEngine(Options{Store: s})
			e.mix.Store(m)
			r := &rig{e: e}
			r.playFrom(in + 1000)
			r.run(2)
			if pad != "" {
				_ = r.e.Press(pad, QuantumSixteenth)
			}
			res := r.run(110) // the transport goes round once, a head at least once
			for k := 300; k < len(res)/OutChannels; k++ {
				if v := res[k*OutChannels]; v < 0.45 || v > 0.75 {
					t.Fatalf("frame %d at %.4f, against a steady 0.5", k, v)
				}
			}
		})
	}
}

func TestChopOnTheLoopsDownbeatRepeatsTheLoopsLastSlice(t *testing.T) {
	// Pressed so it lands on Out, which is In after the wrap: the last
	// sixteenth heard is the loop's own last one.
	const in, out = 48000, 96000
	r := newRig(t, Loop{In: in, Out: out, On: true})
	r.playFrom(90000)
	r.run(4) // to 94096: the next sixteenth is Out
	_ = r.e.Press(PadChop, QuantumSixteenth)
	res := r.run(8)
	k0 := out - (90000 + 4*BlockFrames)
	for _, k := range []int{k0 + 500, k0 + 1500, k0 + 2500, k0 + 3000 + 500} {
		if got := readAt(res, k, 0); got < out-rigSixteenth || got >= out {
			t.Fatalf("%d frames in it reads %.1f: outside the loop's last sixteenth [%d, %d)", k-k0, got, out-rigSixteenth, out)
		}
	}
}

func TestAPressDuringAMixdownTakesTheHeadOnTheNextPlay(t *testing.T) {
	r := newRig(t, Loop{})
	r.e.Do(Action{Kind: "locate", Pos: 30000})
	r.run(1)
	r.e.Do(Action{Kind: "once", Pos: 30000, End: 50000})
	r.run(2)
	_ = r.e.Press(PadReverse, QuantumNow) // lands during the pass
	r.run(30)                             // the pass ends; the tape stands at 30000
	r.e.Do(Action{Kind: "play"})
	res := r.run(3)
	if got := readAt(res, 500, 0); math.Abs(got-29500) > 0.05 {
		t.Fatalf("REV held, played from 30000: reads %.1f at frame 500, want 29500", got)
	}
}

func TestAQuickRePressStaysHeld(t *testing.T) {
	// Pressed, let go and pressed again before the release landed: the
	// finger is down, so the pad must be.
	r := newRig(t, Loop{})
	r.playFrom(10000)
	r.run(1)
	_ = r.e.Press(PadBreak, QuantumSixteenth)
	r.e.advance(make([]float32, 10*OutChannels), r.out, 10)
	r.out += 10
	_ = r.e.Release(PadBreak)
	r.e.advance(make([]float32, 10*OutChannels), r.out, 10)
	r.out += 10
	_ = r.e.Press(PadBreak, QuantumSixteenth)
	r.run(20)
	i := padIndex(PadBreak)
	if !r.e.perf.held[i] || !r.e.perf.down[i] || !r.e.perf.head.on {
		t.Fatalf("finger down, pad up: down=%v held=%v head=%v", r.e.perf.down[i], r.e.perf.held[i], r.e.perf.head.on)
	}
}

// xorshift is the stress tests' repeatable randomness.
func xorshift(seed uint64) func(int) int {
	return func(n int) int {
		seed ^= seed << 13
		seed ^= seed >> 7
		seed ^= seed << 17
		return int(seed % uint64(n))
	}
}

func TestARandomJamNeverPanicsOrSticks(t *testing.T) {
	// Random presses, releases, transport actions and mixes -- loops of
	// three frames among them -- at random span lengths and through late
	// renders. advance is called bare, so a panic fails the test. After a
	// release of everything, nothing is held.
	s := newTestStore(t)
	pool := NewPool(s)
	rel := poolWAV(t, s, rigFrames, func(i int) float64 { return 0.5 * math.Sin(float64(i)/37) })
	mk := func(loop Loop, grid *Grid, whole bool) *Mix {
		clips := []Clip{{ID: "a", File: rel, At: 0, Frames: rigFrames / 2}, {ID: "b", File: rel, Src: 5000, At: rigFrames / 2, Frames: rigFrames / 3}}
		if whole && loop.On {
			clips = []Clip{{ID: "w", File: rel, Src: 1000, At: loop.In, Frames: loop.Out - loop.In}}
		}
		m := NewMix(State{Grid: grid, Loop: loop, Tracks: []Track{
			{N: 1, Bus: BusA, Clips: clips}, {N: 2, Bus: BusB, Clips: clips}, {N: 3, Bus: BusA, Clips: clips},
		}}, pool, 48000)
		m.length = 2 * rigFrames
		return m
	}
	loops := []Loop{{}, {In: 0, Out: 48000, On: true}, {In: 12000, Out: 24000, On: true}, {In: 100, Out: 400, On: true}, {In: 0, Out: 3, On: true}}
	grids := []*Grid{nil, {Frames: 4 * rigBar, Bars: 4}, {Frames: 137143, Bars: 1}}
	quanta := []string{QuantumNow, QuantumSixteenth, QuantumEighth, QuantumBeat, QuantumBar}
	rnd := xorshift(12345)
	trials := 80
	if raceOn {
		trials = 12
	}
	for trial := 0; trial < trials; trial++ {
		e := NewEngine(Options{Store: s})
		e.mix.Store(mk(loops[rnd(len(loops))], grids[rnd(len(grids))], rnd(2) == 0))
		e.Do(Action{Kind: "locate", Pos: int64(rnd(rigFrames))})
		e.Do(Action{Kind: "play"})
		var out uint64
		buf := make([]float32, 4*BlockFrames*OutChannels)
		for step := 0; step < 200; step++ {
			switch rnd(12) {
			case 0, 1, 2:
				_ = e.Press(pads[rnd(numPads)], quanta[rnd(len(quanta))])
			case 3, 4, 5:
				_ = e.Release(pads[rnd(numPads)])
			case 6:
				e.ReleaseAll(quanta[rnd(len(quanta))])
			case 7:
				e.Do(Action{Kind: []string{"play", "stop", "locate"}[rnd(3)], Pos: int64(rnd(rigFrames * 2))})
			case 8:
				e.mix.Store(mk(loops[rnd(len(loops))], grids[rnd(len(grids))], rnd(2) == 0))
			}
			n := 1 + rnd(4*BlockFrames)
			if rnd(10) == 0 {
				e.advance(nil, out, n)
			} else {
				d := buf[:n*OutChannels]
				clear(d)
				e.advance(d, out, n)
				for i, v := range d {
					if math.IsNaN(float64(v)) || math.Abs(float64(v)) > 4 {
						t.Fatalf("trial %d step %d: sample %d is %v", trial, step, i, v)
					}
				}
			}
			out += uint64(n)
		}
		e.advance(nil, out, 1)
		out++
		e.ReleaseAll(QuantumNow)
		e.Do(Action{Kind: "play"})
		e.advance(nil, out, 300000) // past any release's line: a bar is under 140000 frames here
		for i := range pads {
			if e.perf.held[i] || e.perf.down[i] {
				t.Fatalf("trial %d: %s still held=%v down=%v after a release of everything", trial, pads[i], e.perf.held[i], e.perf.down[i])
			}
		}
		if e.perf.head.on || len(e.perf.order) > 0 {
			t.Fatalf("trial %d: head on=%v order=%v after a release of everything", trial, e.perf.head.on, e.perf.order)
		}
	}
}

func TestAfterAJamTheTapeIsUntouched(t *testing.T) {
	// Two engines given the same transport and the same mixes, one jammed
	// on. Once everything is let go and settled, the jammed one plays
	// exactly what the other does, sample for sample, click track and all.
	s := newTestStore(t)
	pool := NewPool(s)
	rel := poolWAV(t, s, rigFrames, func(i int) float64 { return 0.5 * math.Sin(float64(i)/37) })
	mk := func(loop Loop, grid *Grid) *Mix {
		clips := []Clip{{ID: "a", File: rel, At: 0, Frames: rigFrames / 2}, {ID: "b", File: rel, Src: 5000, At: rigFrames / 2, Frames: rigFrames / 3}}
		var tracks []Track
		for n := 1; n <= 5; n++ {
			bus := BusA
			if n%2 == 0 {
				bus = BusB
			}
			tracks = append(tracks, Track{N: n, Bus: bus, Clips: clips})
		}
		m := NewMix(State{Grid: grid, Loop: loop, Tracks: tracks}, pool, 48000)
		m.length = 2 * rigFrames
		m.click = true
		return m
	}
	loops := []Loop{{}, {In: 0, Out: 48000, On: true}, {In: 12000, Out: 24000, On: true}}
	grids := []*Grid{nil, {Frames: 4 * rigBar, Bars: 4}, {Frames: 137143, Bars: 1}}
	quanta := []string{QuantumNow, QuantumSixteenth, QuantumEighth, QuantumBeat}
	rnd := xorshift(987654321)
	trials := 40
	if raceOn {
		trials = 10
	}
	for trial := 0; trial < trials; trial++ {
		m0 := mk(loops[rnd(len(loops))], grids[rnd(len(grids))])
		a, b := NewEngine(Options{Store: s}), NewEngine(Options{Store: s})
		a.mix.Store(m0)
		b.mix.Store(m0)
		pos := int64(rnd(rigFrames))
		for _, e := range []*Engine{a, b} {
			e.Do(Action{Kind: "locate", Pos: pos})
			e.Do(Action{Kind: "play"})
		}
		var out uint64
		ba := make([]float32, BlockFrames*OutChannels)
		bb := make([]float32, BlockFrames*OutChannels)
		for step := 0; step < 150; step++ {
			switch rnd(10) {
			case 0, 1, 2:
				_ = a.Press(pads[rnd(numPads)], quanta[rnd(len(quanta))])
			case 3, 4, 5:
				_ = a.Release(pads[rnd(numPads)])
			case 6:
				m := mk(loops[rnd(len(loops))], grids[rnd(len(grids))])
				a.mix.Store(m)
				b.mix.Store(m)
			}
			clear(ba)
			clear(bb)
			a.advance(ba, out, BlockFrames)
			b.advance(bb, out, BlockFrames)
			out += BlockFrames
		}
		a.advance(nil, out, 1)
		b.advance(nil, out, 1)
		out++
		a.ReleaseAll(QuantumNow)
		a.advance(nil, out, 600000)
		b.advance(nil, out, 600000)
		out += 600000
		for k := 0; k < 8; k++ {
			clear(ba)
			clear(bb)
			a.advance(ba, out, BlockFrames)
			b.advance(bb, out, BlockFrames)
			out += BlockFrames
			if i := firstDiff(ba, bb); i >= 0 {
				t.Fatalf("trial %d: after the jam, block %d frame %d differs", trial, k, i)
			}
		}
	}
}

func TestTheLogSaysWhenAPressAndReleaseSounded(t *testing.T) {
	r := newRig(t, Loop{})
	r.playFrom(10000)
	r.run(3)
	_ = r.e.Press(PadStop, QuantumSixteenth)
	r.run(2)
	ev, seq := r.e.TrickEventsSince(0)
	if len(ev) != 1 || ev[0].Pad != PadStop || !ev[0].On || ev[0].Pos != 15000 || ev[0].Out != 5000 {
		t.Fatalf("events %+v: want stop on, at output frame 5000, tape frame 15000", ev)
	}
	if h := r.e.HeldPads(); len(h) != 1 || h[0] != PadStop {
		t.Fatalf("held %v", h)
	}
	_ = r.e.Release(PadStop)
	r.run(4)
	ev, _ = r.e.TrickEventsSince(seq)
	if len(ev) != 1 || ev[0].On || ev[0].Pos%rigSixteenth != 0 {
		t.Fatalf("after the release, events %+v: want one off, on a sixteenth", ev)
	}
	if h := r.e.HeldPads(); len(h) != 0 {
		t.Fatalf("still held: %v", h)
	}
	if ev, _ := r.e.TrickEventsSince(seq + 1); len(ev) != 0 {
		t.Fatalf("a reader that has seen everything gets %v", ev)
	}
}

func TestTheLogKeepsItsNewest(t *testing.T) {
	r := newRig(t, Loop{})
	for i := 0; i < 100; i++ {
		r.e.logTrick(padIndex(PadBreak), i%2 == 0, uint64(i), int64(i))
	}
	ev, seq := r.e.TrickEventsSince(0)
	if seq != 100 || len(ev) != 64 || ev[0].Seq != 37 || ev[63].Seq != 100 {
		t.Fatalf("seq %d, %d events from %d to %d: want the newest 64, 37 to 100", seq, len(ev), ev[0].Seq, ev[len(ev)-1].Seq)
	}
}
