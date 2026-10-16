package tape

import "testing"

// The cases of web/static/lib/buffer/model.test.js's nextFreeSpan, so a
// DROP from a controller on the Pi lands where ↵ on a page would.
const fsBar = 96000 // 120 BPM at 48 kHz

func fsTape(clips [][][2]int64, loop Loop, grid *Grid) State {
	s := State{Grid: grid, Loop: loop}
	for i, cs := range clips {
		tr := Track{N: i + 1}
		for _, c := range cs {
			tr.Clips = append(tr.Clips, Clip{At: c[0] * fsBar, Frames: (c[1] - c[0]) * fsBar})
		}
		s.Tracks = append(s.Tracks, tr)
	}
	return s
}

var (
	fsLoop   = Loop{In: 0, Out: 8 * fsBar, On: true}
	fsGrid   = &Grid{Frames: 8 * fsBar, Bars: 8}
	fsLength = int64(32 * fsBar)
)

func fsWant(t *testing.T, what string, s State, first, count int, frames, pos int64, want int64, wantOK bool) {
	t.Helper()
	got, ok := NextFreeSpan(s, fsLength, first, count, frames, pos)
	if ok != wantOK || (ok && got != want) {
		t.Errorf("%s: got %d (%v), want %d (%v)", what, got, ok, want, wantOK)
	}
}

func TestNextFreeSpanIsTheFirstGapAfterTheNextBarLine(t *testing.T) {
	s := fsTape([][][2]int64{{}, {{0, 2}, {4, 6}}, {}, {}}, fsLoop, fsGrid)
	fsWant(t, "2 bars", s, 2, 1, 2*fsBar, fsBar/2, 2*fsBar, true)
	fsWant(t, "3 bars in the loop", s, 2, 1, 3*fsBar, fsBar/2, 0, false)
	off := s
	off.Loop.On = false
	fsWant(t, "3 bars, loop off", off, 2, 1, 3*fsBar, fsBar/2, 6*fsBar, true)

	empty := fsTape([][][2]int64{{}, {}, {}, {}}, fsLoop, fsGrid)
	fsWant(t, "after the playhead", empty, 1, 1, fsBar, 2*fsBar+1000, 3*fsBar, true)
	fsWant(t, "on the line", empty, 1, 1, fsBar, 3*fsBar, 3*fsBar, true)
}

func TestNextFreeSpanWrapsRoundTheLoop(t *testing.T) {
	s := fsTape([][][2]int64{{{2, 8}}, {}, {}, {}}, fsLoop, fsGrid)
	fsWant(t, "before the playhead", s, 1, 1, 2*fsBar, 5*fsBar+10, 0, true)
	full := fsTape([][][2]int64{{{0, 7}}, {}, {}, {}}, fsLoop, fsGrid)
	fsWant(t, "never past Out", full, 1, 1, 2*fsBar, 0, 0, false)
	fsWant(t, "longer than the loop", s, 2, 1, 9*fsBar, 0, 0, false)
}

func TestNextFreeSpanWithTheLoopOffRunsToTheEnd(t *testing.T) {
	s := fsTape([][][2]int64{{{0, 1}, {10, 32}}, {}, {}, {}}, Loop{In: 0, Out: 8 * fsBar}, fsGrid)
	fsWant(t, "round from the start", s, 1, 1, 4*fsBar, 9*fsBar, fsBar, true)
	fsWant(t, "ahead", s, 1, 1, 2*fsBar, 3*fsBar, 3*fsBar, true)
}

func TestNextFreeSpanSeveralLanes(t *testing.T) {
	s := fsTape([][][2]int64{{}, {}, {{1, 3}}, {}}, fsLoop, fsGrid)
	fsWant(t, "one bar", s, 2, 2, fsBar, 0, 0, true)
	fsWant(t, "two bars", s, 2, 2, 2*fsBar, 0, 3*fsBar, true)
	fsWant(t, "past the last track", s, 4, 2, fsBar, 0, 0, false)
}

func TestNextFreeSpanWithNoTempo(t *testing.T) {
	none := fsTape([][][2]int64{{{1, 2}}, {}, {}, {}}, Loop{}, nil)
	fsWant(t, "at the playhead", none, 1, 1, fsBar/2, fsBar/4, fsBar/4, true)
	fsWant(t, "after a clip", none, 1, 1, fsBar, fsBar/2, 2*fsBar, true)
	empty := fsTape([][][2]int64{{}, {}, {}, {}}, Loop{}, nil)
	fsWant(t, "an empty tape", empty, 3, 1, 5*fsBar, 7*fsBar, 0, true)
}
