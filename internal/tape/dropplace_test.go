package tape

import "testing"

// The cases of web/static/lib/buffer/model.test.js's DROP key, where they
// say where it lands: the page shows it, and a DROP from any surface puts it
// there.
const dpBar = 96000 // 120 BPM at 48 kHz

type dpTape struct {
	clips  [][][2]float64 // bars, per track
	loop   *Loop
	grid   bool // false: no tempo
	length int64
}

func (d dpTape) state() (State, int64) {
	s := State{Loop: Loop{In: 0, Out: 8 * dpBar, On: true}}
	if d.loop != nil {
		s.Loop = *d.loop
	}
	if d.grid {
		s.Grid = &Grid{Frames: 8 * dpBar, Bars: 8}
	}
	clips := d.clips
	if clips == nil {
		clips = make([][][2]float64, 4)
	}
	for i, cs := range clips {
		tr := Track{N: i + 1}
		for _, c := range cs {
			tr.Clips = append(tr.Clips, Clip{At: int64(c[0] * dpBar), Frames: int64((c[1] - c[0]) * dpBar)})
		}
		s.Tracks = append(s.Tracks, tr)
	}
	length := d.length
	if length == 0 {
		length = 32 * dpBar
	}
	return s, length
}

func bars(n float64) int64 { return int64(n * dpBar) }

func loopOf(in, out int64, on bool) *Loop { return &Loop{In: in, Out: out, On: on} }

func TestDropLandsWhereThePagesDropKeySays(t *testing.T) {
	tempo := dpTape{grid: true}
	shifted := dpTape{grid: true, loop: loopOf(bars(2), bars(6), true)}
	odd := dpTape{grid: true, loop: loopOf(bars(2)+777, bars(6)+777, true)}
	off := dpTape{grid: true, loop: loopOf(0, bars(8), false)}
	full := dpTape{grid: true, clips: [][][2]float64{{{0, 8}}, {{0, 8}}, {{0, 8}}, {{0, 8}}}}
	nearEnd := dpTape{grid: true, length: bars(10), loop: loopOf(bars(8), bars(10), true)}
	nearOdd := dpTape{grid: true, length: bars(10) + 500, loop: loopOf(bars(8), bars(10), true)}
	nearly := dpTape{grid: true, length: bars(8), loop: loopOf(bars(2), bars(6), true)}
	none := dpTape{clips: [][][2]float64{{{0, 1}}, {}, {}, {}}}
	noneOff := dpTape{loop: loopOf(0, bars(8), false), clips: [][][2]float64{{}, {{0, 1}}, {}, {}}}
	noneEnd := dpTape{length: bars(10), loop: loopOf(bars(8), bars(10), true), clips: [][][2]float64{{{0, 1}}, {}, {}, {}}}
	empty := dpTape{}
	for _, c := range []struct {
		what         string
		tape         dpTape
		frames, pos  int64
		at           int64
		long, fitted bool
	}{
		{"the next bar line after the playhead", tempo, bars(2), bars(2.5), bars(3), false, false},
		{"on a bar line it is that line", tempo, bars(2), bars(3), bars(3), false, false},
		{"a frame past one: the next", tempo, bars(2), bars(3) + 1, bars(4), false, false},
		{"it just fits before the loop's Out", tempo, bars(2), bars(6), bars(6), false, false},
		{"the next bar line would run out of the loop", tempo, bars(2), bars(6.5), 0, false, false},
		{"a playhead outside the loop: its In", tempo, bars(2), bars(9), 0, false, false},
		{"before a shifted loop: its first bar line", shifted, bars(2), 0, bars(2), false, false},
		{"wraps to the In, not to 0", shifted, bars(2), bars(5.5), bars(2), false, false},
		{"at its Out: round to its In", shifted, bars(2), bars(6), bars(2), false, false},
		{"inside it, where the playhead is", shifted, bars(1), bars(5), bars(5), false, false},
		{"7.5 bars in: wraps", tempo, bars(1), bars(7.5), 0, false, false},
		{"one bar still fits before the end", tempo, bars(1), bars(6.5), bars(7), false, false},
		{"an In off the bar lines wraps to the first line inside", odd, bars(2), bars(5.9), bars(3), false, false},
		{"a part as long as that loop: its In", odd, bars(4), 0, bars(2) + 777, false, false},
		{"a part as long as the loop starts at its In", tempo, bars(8), bars(3), 0, false, false},
		{"longer than the loop: its In, running past", tempo, bars(10), bars(3), 0, true, false},
		{"longer than a shifted loop", shifted, bars(5), 0, bars(2), true, false},
		{"a full loop is no reason to refuse", full, bars(4), bars(7.9), 0, false, false},
		{"the loop off: the next bar line", off, bars(2), bars(10.5), bars(11), false, false},
		{"the loop off: wraps at the tape's end", off, bars(4), bars(30), 0, false, false},
		{"near the tape's end: moved back to fit", nearEnd, bars(4), 0, bars(6), false, true},
		{"moved back to the latest bar line that fits", nearOdd, bars(4), 0, bars(6), false, true},
		{"as long as the tape: its start, moved back", nearEnd, bars(10), 0, 0, false, true},
		{"it fits the tape, so it lands, moved back", nearly, bars(7), 0, bars(1), true, true},
		{"no tempo: the playhead", noneOff, bars(0.5), bars(0.25), bars(0.25), false, false},
		{"no tempo, the loop on: the playhead if it fits", none, bars(2), bars(3), bars(3), false, false},
		{"no tempo: it would run out of the loop", none, bars(2), bars(7), 0, false, false},
		{"no tempo: a playhead past the loop", none, bars(2), bars(9), 0, false, false},
		{"no tempo, longer than the loop", none, bars(10), bars(3), 0, true, false},
		{"no tempo: the tape's end less the part", noneEnd, bars(4), 0, bars(6), false, true},
		{"an empty tape with no tempo takes it at 0", empty, bars(3), bars(5), 0, false, false},
	} {
		s, length := c.tape.state()
		at, long, fitted := DropPlace(s, length, c.frames, c.pos)
		if at != c.at || long != c.long || fitted != c.fitted {
			t.Errorf("%s: at %d long %v fitted %v, want at %d long %v fitted %v", c.what, at, long, fitted, c.at, c.long, c.fitted)
		}
	}
}
