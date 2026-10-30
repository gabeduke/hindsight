package tape

import "slices"

// DropPlace is where DROP puts a part `frames` long, on whichever surface it
// is pressed: the next bar line at or after the playhead (pos) inside the
// loop -- or, with the loop off, the tape -- where the whole part fits before
// its Out; none left, the first bar line from its In (wrapping, as the loop
// plays), else its In itself. It never looks at what is there: DROP lays over
// it. A part longer than the loop starts at its In and runs past its Out
// (long). With no tempo it is the playhead, and an empty tape with none takes
// it at 0, as its first loop.
//
// A part the tape can hold is never refused: if it would end past the tape,
// it starts at the latest bar line from which it fits -- the tape's end less
// the part with no tempo -- and fitted says it was moved back. A part longer
// than the tape has no place: the caller refuses it.
//
// The page's DROP key says where it will land before it is pressed, so it
// works this out too (web/static/lib/buffer/model.js, dropPlace);
// dropplace_test.go has that file's cases, and the two must agree.
func DropPlace(s State, length, frames, pos int64) (at int64, long, fitted bool) {
	looping := s.Loop.On && s.Loop.Out > s.Loop.In
	lo, hi := int64(0), length
	if looping {
		lo, hi = s.Loop.In, s.Loop.Out
	}
	var g *Grid
	if s.Grid != nil && s.Grid.Frames > 0 && s.Grid.Bars > 0 {
		g = s.Grid
	}
	fit := func(start int64) (int64, bool, bool) {
		at, fitted := start, false
		if at+frames > length {
			at = length - frames
			if g != nil {
				at = g.BarStart(g.BarAt(at))
			}
			at, fitted = max(0, at), true
		}
		return at, looping && at+frames > hi, fitted
	}
	if g == nil && !slices.ContainsFunc(s.Tracks, func(t Track) bool { return len(t.Clips) > 0 }) {
		return 0, false, false
	}
	start := max(pos, lo) // from the loop's In; past its Out nothing fits ahead, so it wraps
	if g == nil {
		if start+frames <= hi {
			return fit(start)
		}
		return fit(lo)
	}
	if ahead := g.NextBar(start); ahead+frames <= hi {
		return fit(ahead)
	}
	if round := g.NextBar(lo); round+frames <= hi {
		return fit(round)
	}
	return fit(lo)
}
