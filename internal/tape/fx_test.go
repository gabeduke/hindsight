package tape

import (
	"errors"
	"math"
	"os"
	"reflect"
	"runtime"
	"testing"
	"time"
)

// The punch-in FX and the tape mods, tested as the tricks are (trick_test.go):
// the ramp rig, whose every sample says where on the tape it was read; a
// twin engine left alone, to compare with sample for sample; and maxJump,
// the biggest step between two frames, for clicks. Rigs of tones and
// impulses show each stage's shape.

// withMods gives a rig's mix the tape mods a style has.
func withMods(r *rig, s Style) *rig {
	m := *r.e.mix.Load()
	m.style = s.amounts()
	r.e.mix.Store(&m)
	return r
}

// toneRig is a rig whose one track, on bus A, reads val: left val, right
// -val, at unity gain.
func toneRig(t *testing.T, val func(i int) float64) *rig {
	t.Helper()
	s := newTestStore(t)
	rel := poolWAV(t, s, rigFrames, val)
	st := State{Grid: &Grid{Frames: 4 * rigBar, Bars: 4}, Tracks: []Track{
		{N: 1, Bus: BusA, Clips: []Clip{{ID: "a", File: rel, Frames: rigFrames}}},
	}}
	m := NewMix(st, NewPool(s), 48000)
	m.length = 2 * rigFrames
	e := NewEngine(Options{Store: s})
	e.mix.Store(m)
	return &rig{e: e}
}

func sine(hz, amp float64) func(int) float64 {
	return func(i int) float64 { return amp * math.Sin(2*math.Pi*hz*float64(i)/48000) }
}

// rms is bus A left's RMS over output frames [from, to).
func rms(out []float32, from, to int) float64 {
	var s float64
	for k := from; k < to; k++ {
		v := float64(out[k*OutChannels])
		s += v * v
	}
	return math.Sqrt(s / float64(to-from))
}

func db(x float64) float64 { return 20 * math.Log10(x) }

// bin is the magnitude of bus A left's component at hz over [from, to),
// a whole number of its periods long.
func bin(out []float32, from, to int, hz float64) float64 {
	var re, im float64
	for k := from; k < to; k++ {
		w := 2 * math.Pi * hz * float64(k) / 48000
		v := float64(out[k*OutChannels])
		re += v * math.Cos(w)
		im += v * math.Sin(w)
	}
	return 2 * math.Hypot(re, im) / float64(to-from)
}

var fxPads = []string{PadRoll, PadFilter, PadEcho, PadCrush, PadBend}

// echoTail is how long ECHO rings once let go, at the rig's tempo, in
// blocks: twelve repeats of 3/16 of a one-second bar, and the fades.
const echoTail = (echoRepeats*9000+3*xf)/BlockFrames + 2

func TestEachFXComesBackToTheTapeExactly(t *testing.T) {
	// The tricks' promise, kept by the FX: once one is let go and its tail
	// has died -- FILTER's reopen, ECHO's ring-out, the bend's rejoin -- the
	// tape is exactly what an untouched twin plays.
	for _, pad := range fxPads {
		t.Run(pad, func(t *testing.T) {
			a, b := pair(t, 10000, Loop{})
			a.run(2)
			b.run(2)
			if err := a.e.PressAmount(pad, QuantumSixteenth, 0.8); err != nil {
				t.Fatal(err)
			}
			held, plain := a.run(12), b.run(12) // ECHO's first repeat is 9000 frames on
			if firstDiff(held, plain) < 0 {
				t.Fatal("holding it changed nothing")
			}
			if err := a.e.Set(pad, 0.3); err != nil { // moved while held
				t.Fatal(err)
			}
			a.run(4)
			b.run(4)
			if err := a.e.Release(pad); err != nil {
				t.Fatal(err)
			}
			a.run(echoTail + 4)
			b.run(echoTail + 4)
			if k := firstDiff(a.run(8), b.run(8)); k >= 0 {
				t.Fatalf("frame %d after the release and its tail differs from a tape never touched", k)
			}
			p := &a.e.perf
			if !p.bus.quiet() || p.head.on || p.head.bent || p.fade.on {
				t.Fatalf("still engaged: quiet %v head %v bent %v fade %v", p.bus.quiet(), p.head.on, p.head.bent, p.fade.on)
			}
		})
	}
}

// layeredRig is the ramp rig with a third track of two overlapping layers
// and the click on: where float sums could come out in another order.
func layeredRig(t *testing.T, loop Loop) *rig {
	t.Helper()
	s := newTestStore(t)
	pool := NewPool(s)
	ramp := poolWAV(t, s, rigFrames, func(i int) float64 { return float64(i) / 1e6 })
	wob := poolWAV(t, s, rigFrames, func(i int) float64 { return 0.3 * math.Sin(float64(i)/53) })
	st := State{Grid: &Grid{Frames: 4 * rigBar, Bars: 4}, Loop: loop, Tracks: []Track{
		{N: 1, Bus: BusA, GainDB: -3, Pan: 0.2, Clips: []Clip{{ID: "a", File: ramp, Frames: rigFrames}}},
		{N: 2, Bus: BusB, Clips: []Clip{{ID: "b", File: ramp, Frames: rigFrames}}},
		{N: 3, Bus: BusA, Clips: []Clip{{ID: "c", File: wob, Frames: rigFrames}, {ID: "d", File: ramp, Src: 777, At: 5000, Frames: 60000, Layer: 1, GainDB: -1.5}}},
	}}
	m := NewMix(st, pool, 48000)
	m.length = 2 * rigFrames
	m.click = true
	e := NewEngine(Options{Store: s})
	e.mix.Store(m)
	return &rig{e: e}
}

// asBefore is what advance rendered before there were mods or FX, for a
// tape played from pos for n frames: the mix, span by span to the loop's
// end and round.
func asBefore(m *Mix, pos int64, n int) []float32 {
	want := make([]float32, n*OutChannels)
	wrapped := false
	for k := 0; k < n; {
		span := n - k
		if m.loop.On && pos < m.loop.Out {
			span = min(span, int(m.loop.Out-pos))
		}
		m.render(want[k*OutChannels:], pos, span, wrapped)
		pos += int64(span)
		k += span
		if m.loop.On && pos == m.loop.Out {
			pos, wrapped = m.loop.In, true
		}
	}
	return want
}

func TestATapeWithNoModsRendersAsItDidBefore(t *testing.T) {
	for name, loop := range map[string]Loop{"straight": {}, "looping": {In: 12000, Out: 30000, On: true}} {
		t.Run(name, func(t *testing.T) {
			for _, style := range []*Style{nil, {Formula: FormulaClean}} {
				r := layeredRig(t, loop)
				if style != nil {
					withMods(r, *style)
				}
				r.playFrom(12000)
				if k := firstDiff(r.run(60), asBefore(r.e.mix.Load(), 12000, 60*BlockFrames)); k >= 0 {
					t.Fatalf("style %+v: frame %d isn't what the tape played before mods", style, k)
				}
			}
		})
	}
}

func TestModsBackAtZeroRenderAsBefore(t *testing.T) {
	// Every mod up, then each preview let go: once they have glided back to
	// 0, the tape plays exactly as one never modded.
	a, b := layeredRig(t, Loop{In: 12000, Out: 60000, On: true}), layeredRig(t, Loop{In: 12000, Out: 60000, On: true})
	a.playFrom(12000)
	b.playFrom(12000)
	for _, m := range Mods() {
		_ = a.e.Set(m, 1)
	}
	held, plain := a.run(20), b.run(20)
	if firstDiff(held, plain) < 0 {
		t.Fatal("the mods changed nothing")
	}
	for _, m := range Mods() {
		_ = a.e.Release(m)
	}
	a.run(20)
	b.run(20)
	if k := firstDiff(a.run(30), b.run(30)); k >= 0 {
		t.Fatalf("frame %d differs once every mod is back at 0", k)
	}
}

func TestFXDontClick(t *testing.T) {
	// Engaged, moved twice while held, and let go: no step on the ramp rig
	// is a click. The ramp hears where the head reads (ROLL, the bend) and
	// ECHO's send; FILTER and CRUSH need a tone (TestFilterAndCrushDontClick).
	amounts := map[string][3]float64{
		PadFilter: {0.6, 0.95, 0.2},
		PadEcho:   {0.6, 1, 0.3},
		PadCrush:  {0.1, 0.25, 0},
		PadRoll:   {0.3, 0.9, 0.5},
		PadBend:   {0.5, -1, 0.2},
	}
	for pad, v := range amounts {
		t.Run(pad, func(t *testing.T) {
			r := newRig(t, Loop{})
			r.playFrom(10000)
			r.run(3)
			_ = r.e.PressAmount(pad, QuantumSixteenth, v[0])
			out := r.run(6)
			_ = r.e.Set(pad, v[1])
			out = append(out, r.run(6)...)
			_ = r.e.Set(pad, v[2])
			out = append(out, r.run(6)...)
			_ = r.e.Release(pad)
			out = append(out, r.run(echoTail+4)...)
			for bus := 0; bus < 2; bus++ {
				if j, at := maxJump(out, 1, len(out)/OutChannels, bus); j > clickStep {
					t.Fatalf("bus %d: a step of %.4f at frame %d: a click", bus, j, at)
				}
			}
		})
	}
}

func TestFilterAndCrushDontClick(t *testing.T) {
	// The ramp rig can't hear these: a ramp passes a 200 Hz low-pass and
	// 10-bit rounding unchanged. A 2 kHz sine (whose own steps are 0.065)
	// hears FILTER's cutoff jump: 0.17 switched hard, 0.105 gliding.
	r := toneRig(t, sine(2000, 0.25))
	r.playFrom(10000)
	r.run(3)
	_ = r.e.PressAmount(PadFilter, QuantumSixteenth, 1)
	out := r.run(6)
	for _, v := range []float64{0, 1, 0.6, 0.95, 0.2} {
		_ = r.e.Set(PadFilter, v)
		out = append(out, r.run(6)...)
	}
	_ = r.e.Release(PadFilter)
	out = append(out, r.run(8)...)
	if j, at := maxJump(out, 1, len(out)/OutChannels, 0); j > 0.13 {
		t.Fatalf("FILTER: a step of %.4f at frame %d, against the sine's own 0.065", j, at)
	}
	// CRUSH's own steps are its sound, and a rounding whose step moves jumps
	// however smoothly it moves. What mustn't jump is coming in and going
	// out: over a steady 0.3, rounded to 0.25 at 4 bits, it glides there
	// and back across 5 ms.
	r = toneRig(t, func(int) float64 { return 0.3 })
	r.playFrom(10000)
	r.run(3)
	_ = r.e.PressAmount(PadCrush, QuantumSixteenth, 1)
	out = r.run(8)
	_ = r.e.Release(PadCrush)
	out = append(out, r.run(8)...)
	if j, at := maxJump(out, 1, len(out)/OutChannels, 0); j > 0.001 {
		t.Fatalf("CRUSH: a step of %.4f at frame %d over a steady signal", j, at)
	}
	if lo := out[(15000-10000-3*BlockFrames+xf+10)*OutChannels]; math.Abs(float64(lo)-0.25) > 1e-6 {
		t.Fatalf("CRUSH at 4 bits holds 0.3 at %v, want 0.25: the test proves nothing", lo)
	}
}

func TestModsDontClick(t *testing.T) {
	r := newRig(t, Loop{In: 12000, Out: 40000, On: true})
	r.playFrom(12000)
	out := r.run(2)
	for _, step := range []map[string]float64{
		{"mod.wow": 1, "mod.drive": 0.7},
		{"mod.flutter": 1, "mod.age": 1},
		{"mod.wow": 0.3, "mod.drive": 0},
		{"mod.age": 0, "mod.flutter": 0.2},
		{"mod.wow": 0, "mod.flutter": 0},
	} {
		for m, v := range step {
			_ = r.e.Set(m, v)
		}
		out = append(out, r.run(12)...)
	}
	for bus := 0; bus < 2; bus++ {
		if j, at := maxJump(out, 1, len(out)/OutChannels, bus); j > clickStep {
			t.Fatalf("bus %d: a step of %.4f at frame %d: a click", bus, j, at)
		}
	}
}

func TestFilterIsTwentyDecibelsDownAtFourTimesItsCutoff(t *testing.T) {
	// The amount that puts the cutoff at 500 Hz.
	v := math.Log(500.0/filterOpenHz) / math.Log(filterClosedHz/filterOpenHz)
	if c := filterCutoff(v, 48000); math.Abs(c-500) > 0.01 {
		t.Fatalf("cutoff %.2f Hz, want 500", c)
	}
	level := func(hz float64) float64 {
		r := toneRig(t, sine(hz, 0.5))
		r.playFrom(0)
		_ = r.e.PressAmount(PadFilter, QuantumNow, v)
		out := r.run(30)
		return db(rms(out, 10*BlockFrames, 10*BlockFrames+48000/4) / (0.5 / math.Sqrt2))
	}
	if l := level(2000); l > -20 {
		t.Fatalf("a sine at four times the cutoff is %.1f dB, want 20 dB down or more", l)
	}
	if l := level(125); math.Abs(l) > 1.5 {
		t.Fatalf("a sine at a quarter of the cutoff is %.1f dB, want it through", l)
	}
}

func TestEchoRepeatsAtThreeSixteenthsOfABarEachAtPointFiveFive(t *testing.T) {
	// An impulse at tape frame 20000, played from 10000: heard at output
	// frame 10000, then every 3/16 of the one-second bar (9000 frames),
	// each 0.55 of the last. A second impulse, played after ECHO is let go,
	// isn't sent.
	r := toneRig(t, func(i int) float64 {
		if i == 20000 || i == 85000 {
			return 1
		}
		return 0
	})
	if d := echoFrames(r.e.mix.Load()); d != 9000 {
		t.Fatalf("the delay is %d frames, want 9000", d)
	}
	r.playFrom(10000)
	_ = r.e.PressAmount(PadEcho, QuantumNow, 1)
	out := r.run(65) // to 66560: the first impulse and six repeats
	_ = r.e.Release(PadEcho)
	out = append(out, r.run(40)...)
	at := func(k int) float64 { return float64(out[k*OutChannels]) }
	want := 1.0
	for j := 1; j <= 8; j++ {
		k := 10000 + j*9000
		if math.Abs(at(k)-want) > 1e-5 {
			t.Fatalf("repeat %d at frame %d is %.6f, want %.6f", j, k, at(k), want)
		}
		if at(k-1) != 0 || at(k+1) != 0 {
			t.Fatalf("repeat %d isn't one frame: %.6f %.6f around it", j, at(k-1), at(k+1))
		}
		want *= 0.55
	}
	// 75000 is the second impulse, dry; 84000 is where its echo would be.
	if math.Abs(at(75000)-1) > 1e-6 || at(84000) != 0 {
		t.Fatalf("the impulse played after the release: %.4f, its echo %.6f, want none", at(75000), at(84000))
	}
}

func TestCrushKeepsNoMoreThanItsLevels(t *testing.T) {
	r := toneRig(t, sine(440, 0.9))
	r.playFrom(0)
	_ = r.e.PressAmount(PadCrush, QuantumNow, 1)
	out := r.run(24)
	levels := map[float32]bool{}
	changes := 0
	for k := 1000; k < len(out)/OutChannels; k++ {
		levels[out[k*OutChannels]] = true
		if out[k*OutChannels] != out[(k-1)*OutChannels] {
			changes++
		}
	}
	if bits := crushBits(1); len(levels) > 1<<int(bits) || len(levels) < 8 {
		t.Fatalf("%d levels at %v bits, want no more than %d", len(levels), bits, 1<<int(bits))
	}
	if frames := len(out)/OutChannels - 1000; changes > frames/7 {
		t.Fatalf("%d changes in %d frames: the rate isn't down to an eighth", changes, frames)
	}
}

// twoTone is a rig with two tracks on bus A, each a sine of amp: together
// they're over full scale.
func twoTone(t *testing.T, hz, amp float64) *rig {
	t.Helper()
	s := newTestStore(t)
	rel := poolWAV(t, s, rigFrames, sine(hz, amp))
	clip := []Clip{{ID: "a", File: rel, Frames: rigFrames}}
	m := NewMix(State{Grid: &Grid{Frames: 4 * rigBar, Bars: 4}, Tracks: []Track{{N: 1, Bus: BusA, Clips: clip}, {N: 2, Bus: BusA, Clips: clip}}}, NewPool(s), 48000)
	m.length = 2 * rigFrames
	e := NewEngine(Options{Store: s})
	e.mix.Store(m)
	return &rig{e: e}
}

func TestDriveStaysWithinFullScaleAndAddsOddHarmonics(t *testing.T) {
	for _, v := range []float64{0.05, 0.3, 1} {
		r := twoTone(t, 300, 0.9) // 1.8 at its peaks
		r.playFrom(0)
		_ = r.e.Set("mod.drive", v)
		out := r.run(20)
		for i, x := range out {
			if x > 1 || x < -1 {
				t.Fatalf("drive %v: sample %d is %v", v, i, x)
			}
		}
	}
	r := toneRig(t, sine(1000, 0.5))
	r.playFrom(0)
	_ = r.e.Set("mod.drive", 1)
	out := r.run(20)
	from := 10 * BlockFrames
	h1, h2, h3 := bin(out, from, from+4800, 1000), bin(out, from, from+4800, 2000), bin(out, from, from+4800, 3000)
	if h3/h1 < 0.01 || h2/h1 > 1e-3 {
		t.Fatalf("harmonics 1–3: %.4f %.6f %.4f: want a third, and no second", h1, h2, h3)
	}
}

func TestDriveKeepsTheLevelAtItsReference(t *testing.T) {
	// A sine at the reference, -18 dBFS RMS, comes out as loud as it went in
	// at any drive; quieter is lifted a little, louder squeezed: the curve
	// is the same whatever played before.
	ref := math.Pow(10, driveRefDB/20) * math.Sqrt2
	for _, c := range []struct {
		amp, v, lo, hi float64
	}{
		{ref, 0.3, -0.3, 0.3}, {ref, 0.6, -0.3, 0.3}, {ref, 1, -0.3, 0.3},
		{0.01 * math.Sqrt2, 1, 0, 4.5}, {0.01 * math.Sqrt2, 0.4, 0, 0.8},
		{0.5 * math.Sqrt2, 1, -11, 0},
	} {
		r := toneRig(t, sine(220, c.amp))
		r.playFrom(0)
		_ = r.e.Set("mod.drive", c.v)
		out := r.run(30)
		if l := db(rms(out, 20*BlockFrames, 20*BlockFrames+9600) / (c.amp / math.Sqrt2)); l < c.lo || l > c.hi {
			t.Fatalf("drive %v on a sine of %.1f dBFS RMS: %.2f dB, want %v to %v", c.v, db(c.amp/math.Sqrt2), l, c.lo, c.hi)
		}
	}
}

func TestDriveDoesntDuckAnAttack(t *testing.T) {
	// The tape's level after a silence, or a burst's first moments, comes
	// out as loud as what follows it: no follower lagging behind the music.
	for _, v := range []float64{0.4, 1} {
		r := withMods(toneRig(t, sine(220, 0.5)), Style{Drive: v})
		r.e.Do(Action{Kind: "locate", Pos: 10000})
		r.run(50) // standing, the drive on over silence
		r.e.Do(Action{Kind: "play"})
		out := r.run(30)
		steady := rms(out, 19200, 24000)
		if l := db(rms(out, 0, 480) / steady); math.Abs(l) > 1 {
			t.Fatalf("drive %v: the first 10 ms after play are %.1f dB from the steady level", v, l)
		}
	}
	burst := func(i int) float64 { // 60 ms of 200 Hz at 0.5, every 500 ms
		if i%24000 < 2880 {
			return 0.5 * math.Sin(2*math.Pi*200*float64(i%24000)/48000)
		}
		return 0
	}
	for _, v := range []float64{0.4, 1} {
		r := withMods(toneRig(t, burst), Style{Drive: v})
		r.playFrom(0)
		out := r.run(150)
		for _, b := range []int{120000, 144000} {
			if l := db(rms(out, b, b+240) / rms(out, b+1920, b+2880)); math.Abs(l) > 1 {
				t.Fatalf("drive %v: the burst at %d starts %.1f dB from its end", v, b, l)
			}
		}
	}
}

func TestAgeTakesTheTopEndOff(t *testing.T) {
	level := func(hz float64) float64 {
		r := toneRig(t, sine(hz, 0.5))
		r.playFrom(0)
		_ = r.e.Set("mod.age", 1)
		out := r.run(20)
		return db(rms(out, 10*BlockFrames, 10*BlockFrames+9600) / (0.5 / math.Sqrt2))
	}
	if l := level(12000); l > -6 {
		t.Fatalf("12 kHz is %.1f dB, want 6 dB down or more", l)
	}
	if l := level(200); math.Abs(l) > 0.5 {
		t.Fatalf("200 Hz is %.1f dB, want it through", l)
	}
}

func TestWowAndFlutterStayWithinTheirDepthAndAverageToZero(t *testing.T) {
	for _, c := range []struct {
		mod   string
		depth float64
		cycle int
	}{
		{"mod.wow", wowDepth * 48000 / (2 * math.Pi * wowHz), 60000},
		{"mod.flutter", flutterDev * 48000 / (2 * math.Pi * flutterHz * (1 + flutterJitter)), 30000},
	} {
		t.Run(c.mod, func(t *testing.T) {
			r := newRig(t, Loop{})
			r.playFrom(10000)
			_ = r.e.Set(c.mod, 1)
			r.run(10) // the amount glides up
			out := r.run(c.cycle/BlockFrames + 1)
			from := 10000 + 10*BlockFrames
			var sum, most float64
			for k := 0; k < c.cycle; k++ {
				for bus := 0; bus < 2; bus++ {
					d := readAt(out, k, bus) - float64(from+k)
					if math.Abs(d) > c.depth+0.02 {
						t.Fatalf("frame %d bus %d reads %.3f frames off the transport, deeper than %.3f", k, bus, d, c.depth)
					}
					most = math.Max(most, math.Abs(d))
					if bus == 0 {
						sum += d
					}
				}
			}
			if most < 0.8*c.depth {
				t.Fatalf("it never wobbled more than %.3f of %.3f", most, c.depth)
			}
			if mean := sum / float64(c.cycle); math.Abs(mean) > 0.05*c.depth {
				t.Fatalf("the read position averages %.3f frames off the transport over a cycle", mean)
			}
		})
	}
}

func TestRollRepeatsTheSliceFromWhereItLanded(t *testing.T) {
	r := newRig(t, Loop{})
	r.playFrom(10000)
	r.run(3)
	_ = r.e.PressAmount(PadRoll, QuantumSixteenth, 0.3) // an eighth: 6000 frames
	out := r.run(20)
	k0 := 15000 - (10000 + 3*BlockFrames)
	for _, x := range []int{xf + 10, 3000, 5990, 6000 + xf + 10, 9000, 12000 + 4000} {
		want := 15000 + float64(x%6000)
		if got := readAt(out, k0+x, 0); math.Abs(got-want) > 0.05 {
			t.Fatalf("%d frames in it reads %.2f, want %.2f", x, got, want)
		}
	}
	// Moved to a thirty-second while held: from its next repeat, so it
	// stays on the grid.
	k := 20*BlockFrames - k0 // frames since it landed
	_ = r.e.Set(PadRoll, 0.9)
	more := r.run(8)
	next := (k/6000 + 1) * 6000 // the next repeat
	for _, x := range []int{next - 500, next + xf + 10, next + 1000, next + 1500 + xf + 10, next + 2000} {
		want := 15000 + float64(x%6000)
		if x >= next {
			want = 15000 + float64((x-next)%1500)
		}
		if got := readAt(more, x-k, 0); math.Abs(got-want) > 0.05 {
			t.Fatalf("%d frames in it reads %.2f, want %.2f", x, got, want)
		}
	}
}

func TestTheBendNudgesTheSpeed(t *testing.T) {
	for _, v := range []float64{1, -1, 0.5} {
		r := newRig(t, Loop{})
		r.playFrom(10000)
		r.run(2)
		_ = r.e.PressAmount(PadBend, QuantumSixteenth, v) // the bend lands now
		out := r.run(12)
		for k := 6 * BlockFrames; k < 12*BlockFrames-1; k++ {
			if step := readAt(out, k+1, 0) - readAt(out, k, 0); math.Abs(step-(1+bendDepth*v)) > 0.01 {
				t.Fatalf("bend %v: frame %d steps %.4f frames of tape, want %.4f", v, k, step, 1+bendDepth*v)
			}
		}
	}
}

func TestTheClickStaysDry(t *testing.T) {
	// A tape with nothing on it but the click: every FX held hard, and every
	// mod up, and the click is exactly the click.
	mk := func() *rig {
		s := newTestStore(t)
		m := NewMix(State{Grid: &Grid{Frames: 4 * rigBar, Bars: 4}, Tracks: []Track{{N: 1, Bus: BusA}}}, NewPool(s), 48000)
		m.length, m.click = 2*rigFrames, true
		m.end = rigFrames
		e := NewEngine(Options{Store: s})
		e.mix.Store(m)
		return &rig{e: e}
	}
	a, b := mk(), mk()
	withMods(a, Style{Wow: 1, Flutter: 1, Drive: 1, Age: 1})
	a.playFrom(0)
	b.playFrom(0)
	for _, p := range []string{PadFilter, PadCrush, PadEcho} {
		_ = a.e.PressAmount(p, QuantumNow, 1)
	}
	got, want := a.run(100), b.run(100)
	if k := firstDiff(got, want); k >= 0 {
		t.Fatalf("frame %d of the click differs under the FX: %v, want %v", k, got[k*OutChannels], want[k*OutChannels])
	}
	if rms(want, 0, len(want)/OutChannels) == 0 {
		t.Fatal("no click to hear: the test proves nothing")
	}
}

func TestFXCarryTheirStateAcrossSplits(t *testing.T) {
	// One engine rendered a block at a time, its twin in spans of any
	// length: with every FX and mod going, the two are the same, sample for
	// sample.
	a, b := layeredRig(t, Loop{In: 12000, Out: 100000, On: true}), layeredRig(t, Loop{In: 12000, Out: 100000, On: true})
	for _, r := range []*rig{a, b} {
		withMods(r, Style{Wow: .6, Flutter: .5, Drive: .4, Age: .7})
		r.playFrom(12000)
	}
	rnd := xorshift(42)
	var ga, gb []float32
	for seg := 0; seg < 24; seg++ {
		switch seg {
		case 2, 9:
			for _, r := range []*rig{a, b} {
				for _, p := range []string{PadFilter, PadCrush, PadEcho, PadRoll} {
					_ = r.e.PressAmount(p, QuantumSixteenth, 0.4+0.1*float64(seg%3))
				}
			}
		case 5:
			for _, r := range []*rig{a, b} {
				_ = r.e.PressAmount(PadBend, QuantumNow, 0.7)
			}
		case 7, 14:
			for _, r := range []*rig{a, b} {
				for _, p := range []string{PadFilter, PadCrush, PadEcho, PadRoll, PadBend} {
					_ = r.e.Release(p)
				}
			}
		}
		ga = append(ga, a.run(4)...)
		// The twin: the same 4096 frames in pieces.
		for left := 4 * BlockFrames; left > 0; {
			n := min(left, 1+rnd(1500))
			buf := make([]float32, n*OutChannels)
			b.e.advance(buf, b.out, n)
			b.out += uint64(n)
			gb = append(gb, buf...)
			left -= n
		}
	}
	if k := firstDiff(ga, gb); k >= 0 {
		t.Fatalf("frame %d differs between whole blocks and pieces of them", k)
	}
}

func TestALateRenderDropsAnEchosTailAndStepsTheClocks(t *testing.T) {
	t.Run("the tail", func(t *testing.T) {
		a, b := pair(t, 10000, Loop{})
		_ = a.e.PressAmount(PadEcho, QuantumNow, 1)
		a.run(12)
		b.run(12)
		_ = a.e.Release(PadEcho)
		a.run(1)
		b.run(1)
		// The device played silence for a while: the repeats due then are
		// gone, not played late.
		for _, r := range []*rig{a, b} {
			r.e.advance(nil, r.out, 3000)
			r.out += 3000
		}
		if k := firstDiff(a.run(20), b.run(20)); k >= 0 {
			t.Fatalf("frame %d after the late render still has the echo in it", k)
		}
	})
	t.Run("the clocks", func(t *testing.T) {
		// Wow through a late render keeps its place: it comes out where it
		// would have been had the frames been rendered.
		a, b := newRig(t, Loop{}), newRig(t, Loop{})
		for _, r := range []*rig{a, b} {
			withMods(r, Style{Wow: 1})
			r.playFrom(10000)
		}
		a.run(30)
		b.run(10)
		b.e.advance(nil, b.out, 20*BlockFrames)
		b.out += 20 * BlockFrames
		got, want := b.run(10), a.run(10)
		for k := 0; k < len(got)/OutChannels; k++ {
			if d := math.Abs(readAt(got, k, 0) - readAt(want, k, 0)); d > 0.01 {
				t.Fatalf("frame %d reads %.3f frames from where it would have", k, d)
			}
		}
	})
}

func TestAMixdownsPassPrintsTheModsAndNotTheFX(t *testing.T) {
	pass := func(r *rig, fx bool) []float32 {
		r.e.Do(Action{Kind: "locate", Pos: 30000})
		r.run(1)
		if fx {
			for _, p := range []string{PadFilter, PadCrush, PadEcho} {
				_ = r.e.PressAmount(p, QuantumNow, 1)
			}
			r.run(2)
		} else {
			r.run(2)
		}
		r.e.Do(Action{Kind: "once", Pos: 30000, End: 50000})
		return r.run(25)
	}
	plain := pass(newRig(t, Loop{}), false)
	if fx := pass(newRig(t, Loop{}), true); firstDiff(fx, plain) >= 0 {
		t.Fatalf("frame %d of a mixdown's pass has the FX held over it", firstDiff(fx, plain))
	}
	if modded := pass(withMods(newRig(t, Loop{}), Style{Wow: .5, Drive: .8, Age: .5}), false); firstDiff(modded, plain) < 0 {
		t.Fatal("a mixdown with mods is the same as one without")
	}
}

func TestAMixdownRefusesFXAndPrintsTheMods(t *testing.T) {
	// A kilohertz at 0.25, -6 dB on its track: 0.125 in the take.
	e, sink, tp, saver, _ := mixdownEngineOf(t, sine(1000, 0.25))
	if err := e.SetStyle(tp.ID, StyleChange{Drive: ptr(1.0)}); err != nil {
		t.Fatal(err)
	}
	e.Start()
	sink.play(t, 4096)
	// Held before the mixdown, ECHO is in the room but not in the take.
	if err := e.PressAmount(PadEcho, QuantumNow, 1); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 4096)
	if _, err := e.StartMixdown(tp.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := e.PressAmount(PadFilter, QuantumNow, 1); !errors.Is(err, ErrMixingDown) {
		t.Fatalf("FILTER during a mixdown: %v, want refused", err)
	}
	got := waitMixdown(t, e, sink)
	if got.State != "done" {
		t.Fatalf("mixdown = %+v", got)
	}
	take := make([]float32, len(saver.main)*OutChannels)
	for i, v := range saver.main {
		take[i*OutChannels] = float32(float64(v) / 2147483647)
	}
	// The drive is printed: a third harmonic, at the level the curve gives
	// a sine of 0.125. An echo printed too would cancel the kilohertz: its
	// repeat lands 187.5 periods on, upside down.
	from := 24000
	h1, h3 := bin(take, from, from+48000, 1000), bin(take, from, from+48000, 3000)
	if h3/h1 < 0.01 {
		t.Fatalf("harmonics %.4f, %.4f: the drive isn't in the take", h1, h3)
	}
	var want float64
	for q := 0; q < 48; q++ {
		x := 0.125 * math.Sin(2*math.Pi*(float64(q)+0.5)/48)
		y := driveGain(1) * math.Tanh(10*x) / math.Tanh(10)
		want += y * y / 48
	}
	if l := db(rms(take, from, from+48000) / math.Sqrt(want)); math.Abs(l) > 0.5 {
		t.Fatalf("the take is %.1f dB from the driven tape's level", l)
	}
}

func TestFXLeaveNoUndoAndWriteNothing(t *testing.T) {
	e, _, tp := newEngine(t)
	take := takeWAV(t, 200000, func(i int) float64 { return 0.5 * math.Sin(float64(i)/40) })
	if _, err := e.DropTake(tp.ID, take, 96000, 192000, 1, 1, []int{0, 1}); err != nil {
		t.Fatal(err)
	}
	path := tapeJSON(t, e, tp.ID)
	before := mtime(t, path)
	time.Sleep(20 * time.Millisecond)
	state := e.Loaded().State
	undo0, redo0 := e.UndoDepth()

	e.Do(Action{Kind: "play"})
	var out uint64
	buf := make([]float32, BlockFrames*OutChannels)
	rnd := xorshift(7)
	for i := 0; i < 300; i++ {
		p := fxPads[rnd(len(fxPads))]
		switch rnd(4) {
		case 0:
			_ = e.PressAmount(p, QuantumSixteenth, float64(rnd(100))/100)
		case 1:
			_ = e.Release(p)
		case 2:
			_ = e.Set(p, float64(rnd(100))/100)
		case 3:
			_ = e.Set(Mods()[rnd(numMods)], float64(rnd(100))/100)
		}
		clear(buf)
		e.advance(buf, out, BlockFrames)
		out += BlockFrames
	}
	if u, r := e.UndoDepth(); u != undo0 || r != redo0 {
		t.Fatalf("undo %d/%d after a jam of FX, was %d/%d", u, r, undo0, redo0)
	}
	if !reflect.DeepEqual(state, e.Loaded().State) {
		t.Fatal("a jam of FX changed the tape's state")
	}
	if !mtime(t, path).Equal(before) {
		t.Fatal("tape.json was written during a jam of FX")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
}

func TestAJamOfFXLeavesTheTapeUntouched(t *testing.T) {
	// The twin test with the FX, their amounts and the mods' previews: once
	// everything is let go and settled, the jammed engine plays what its
	// twin does, sample for sample.
	rnd := xorshift(31337)
	trials := 20
	if raceOn {
		trials = 5
	}
	for trial := 0; trial < trials; trial++ {
		loop := []Loop{{}, {In: 0, Out: 48000, On: true}, {In: 12000, Out: 24000, On: true}}[rnd(3)]
		a, b := layeredRig(t, loop), layeredRig(t, loop)
		pos := int64(rnd(rigFrames))
		for _, r := range []*rig{a, b} {
			r.e.Do(Action{Kind: "locate", Pos: pos})
			r.e.Do(Action{Kind: "play"})
		}
		quanta := []string{QuantumNow, QuantumSixteenth, QuantumEighth}
		for step := 0; step < 120; step++ {
			p := pads[rnd(numPads)]
			switch rnd(8) {
			case 0, 1:
				_ = a.e.PressAmount(p, quanta[rnd(3)], float64(rnd(101))/100)
			case 2, 3:
				_ = a.e.Release(p)
			case 4:
				_ = a.e.Set(fxPads[rnd(len(fxPads))], float64(rnd(201))/100-1)
			case 5:
				_ = a.e.Set(Mods()[rnd(numMods)], float64(rnd(101))/100)
			case 6:
				_ = a.e.Release(Mods()[rnd(numMods)])
			}
			a.run(1)
			b.run(1)
		}
		a.e.ReleaseAll(QuantumNow)
		for _, m := range Mods() {
			_ = a.e.Release(m)
		}
		a.run(echoTail + 8)
		b.run(echoTail + 8)
		if k := firstDiff(a.run(8), b.run(8)); k >= 0 {
			t.Fatalf("trial %d: frame %d differs after the jam", trial, k)
		}
	}
}

func TestTheLogCarriesAmountsAndThinsTheirMoves(t *testing.T) {
	r := newRig(t, Loop{})
	r.playFrom(10000)
	r.run(3)
	_, seq := r.e.TrickEventsSince(0)
	_ = r.e.PressAmount(PadFilter, QuantumSixteenth, 0.7)
	r.run(2)
	ev, seq := r.e.TrickEventsSince(seq)
	if len(ev) != 1 || ev[0].Pad != PadFilter || !ev[0].On || ev[0].V == nil || *ev[0].V != 0.7 || ev[0].Move {
		t.Fatalf("the press: %+v", ev)
	}
	// A hundred sets in one block are drawn once, then the last one a
	// thirtieth of a second on.
	for i := 1; i <= 100; i++ {
		_ = r.e.Set(PadFilter, float64(i)/100)
		if i == 50 {
			r.run(1)
		}
	}
	r.run(4)
	ev, _ = r.e.TrickEventsSince(seq)
	if len(ev) != 2 || !ev[0].Move || *ev[0].V != 0.5 || *ev[1].V != 1 || ev[1].Out-ev[0].Out < 1600 {
		for _, e := range ev {
			t.Logf("%+v v=%v", e, *e.V)
		}
		t.Fatalf("%d move events, want 2: .5, then 1 a thirtieth of a second on", len(ev))
	}
	_ = r.e.Set("mod.wow", 0.4)
	r.run(1)
	ev, _ = r.e.TrickEventsSince(seq + 2)
	if len(ev) != 1 || ev[0].Pad != "mod.wow" || !ev[0].On || *ev[0].V != 0.4 {
		t.Fatalf("a preview's event: %+v", ev)
	}
}

func TestAReleaseAfterASetStillLetsGo(t *testing.T) {
	// Pressed, moved and let go before the render goroutine drained any of
	// it: the set waiting between them must not be taken for a release
	// already queued, or the release is dropped and the pad sticks.
	r := newRig(t, Loop{})
	r.playFrom(10000)
	r.run(1)
	_ = r.e.PressAmount(PadFilter, QuantumSixteenth, 0.9)
	_ = r.e.Set(PadFilter, 0.5)
	_ = r.e.Release(PadFilter)
	r.run(12)
	if p := &r.e.perf; p.held[iFilter] || p.down[iFilter] || p.bus.filter.live {
		t.Fatalf("FILTER stuck: held=%v down=%v live=%v", p.held[iFilter], p.down[iFilter], p.bus.filter.live)
	}
}

func TestABendLetGoFromFarAheadDoesntClick(t *testing.T) {
	// Two seconds at full bend reads 7680 frames ahead: letting go rejoins
	// the transport through a crossfade, not a jump.
	r := newRig(t, Loop{})
	r.playFrom(10000)
	r.run(2)
	_ = r.e.PressAmount(PadBend, QuantumNow, 1)
	r.run(93)
	if off := r.e.perf.mod.bendOff; off < 7000 {
		t.Fatalf("the bend is only %.0f frames ahead: the test proves nothing", off)
	}
	out := r.run(1) // the last block bent, and the release from the frame after it
	_ = r.e.Release(PadBend)
	out = append(out, r.run(4)...)
	if j, at := maxJump(out, 1, len(out)/OutChannels, 0); j > clickStep {
		t.Fatalf("a step of %.4f at frame %d: the bend let go with a click", j, at)
	}
	if got, want := readAt(out, 3*BlockFrames, 0), float64(r.e.tr.pos-2*BlockFrames); math.Abs(got-want) > 0.05 {
		t.Fatalf("after the release it reads %.1f, want the transport's %.1f", got, want)
	}
}

func TestTheBendOnlyRunsWhileTheTapeDoes(t *testing.T) {
	// The bend is how far ahead of the transport the room hears: held while
	// the tape stands, through a count-in, or over a mixdown's pass (which it
	// isn't heard in), it hasn't gone anywhere. When the tape plays, the room
	// hears the transport, then the bend from there.
	cases := map[string]func(r *rig){
		"standing": func(r *rig) {
			r.e.Do(Action{Kind: "stop"})
			r.run(1)
			_ = r.e.PressAmount(PadBend, QuantumNow, 1)
			r.run(94) // two seconds, the wheel held
			r.e.Do(Action{Kind: "play"})
		},
		"a count-in": func(r *rig) {
			r.e.Do(Action{Kind: "stop"})
			r.e.Do(Action{Kind: "locate", Pos: 60000}) // counts in from bar 2, 48000
			r.run(1)
			_ = r.e.PressAmount(PadBend, QuantumNow, 1)
			r.e.Do(Action{Kind: "play", CountIn: true})
			r.run(46) // the bar of click, 48000 frames, to its last frame
			rest := 48000 - 46*BlockFrames
			r.e.advance(make([]float32, rest*OutChannels), r.out, rest)
			r.out += uint64(rest)
		},
		"a mixdown's pass": func(r *rig) {
			r.e.Do(Action{Kind: "stop"})
			r.run(1)
			_ = r.e.PressAmount(PadBend, QuantumNow, 1)
			r.e.Do(Action{Kind: "once", Pos: 30000, End: 60000})
			r.run(32) // the pass, then standing back at 30000
			r.e.Do(Action{Kind: "play"})
		},
		"a late render while standing": func(r *rig) {
			r.e.Do(Action{Kind: "stop"})
			r.run(1)
			_ = r.e.PressAmount(PadBend, QuantumNow, 1)
			r.run(1)
			r.e.advance(nil, r.out, 96000)
			r.out += 96000
			r.e.Do(Action{Kind: "play"})
		},
	}
	for name, before := range cases {
		t.Run(name, func(t *testing.T) {
			r := newRig(t, Loop{})
			r.playFrom(10000)
			r.run(2)
			before(r)
			out := r.run(2)
			start := r.e.tr.pos - 2*BlockFrames // where the transport played from
			for _, k := range []int{0, 10, 100} {
				// Ahead by no more than the bend has run since: 8 % of k.
				if d := readAt(out, k, 0) - float64(start+int64(k)); d < -0.05 || d > bendDepth*float64(k)+0.05 {
					t.Fatalf("%d frames into playing, the room hears %.0f frames from the transport", k, d)
				}
			}
		})
	}
}

func TestEchoDoesntAllocateOnTheRenderPath(t *testing.T) {
	// The render goroutine must never wait on the allocator for a delay
	// line (up to 1.5 MB at a slow tempo): it's made with the engine.
	r := newRig(t, Loop{})
	r.playFrom(10000)
	r.run(4) // the scratch the render keeps, made
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	_ = r.e.PressAmount(PadEcho, QuantumNow, 1)
	r.e.advance(make([]float32, 0), r.out, 0) // drain only
	buf := make([]float32, BlockFrames*OutChannels)
	runtime.ReadMemStats(&after)
	base := after.TotalAlloc - before.TotalAlloc // the press and the buffer
	runtime.ReadMemStats(&before)
	r.e.advance(buf, r.out, BlockFrames)
	runtime.ReadMemStats(&after)
	if !r.e.perf.bus.echo.live {
		t.Fatal("ECHO never came in: the test proves nothing")
	}
	if got := after.TotalAlloc - before.TotalAlloc; got > 16<<10 {
		t.Fatalf("the block ECHO came in on allocated %d bytes (the press took %d)", got, base)
	}
}
