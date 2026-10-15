package tape

import (
	"slices"
	"sort"
)

// NextFreeSpan is where a DROP from a controller on the Pi puts the
// clipboard (docs/superpowers/specs/2026-10-15-instrument-strip-design.md),
// as ↵ does on a page (web/static/lib/buffer/model.js, nextFreeSpan): the
// first span `frames` long free on tracks first to first+count-1, from the
// next bar line at or after pos, on a bar line, as far as the loop's Out --
// then round from its In, as the loop plays -- or, with the loop off, the
// tape's end and then round from its start. With no tempo, at pos or where a
// clip ends. An empty tape with no tempo takes it at 0, as its first loop.
// ok is false when nothing fits.
func NextFreeSpan(s State, length int64, first, count int, frames, pos int64) (at int64, ok bool) {
	if frames <= 0 || first < 1 || count < 1 || first+count-1 > len(s.Tracks) {
		return 0, false
	}
	lanes := s.Tracks[first-1 : first-1+count]
	busy := func(a, b int64) bool {
		for _, tr := range lanes {
			for _, c := range tr.Clips {
				if c.At < b && c.At+c.Frames > a {
					return true
				}
			}
		}
		return false
	}
	lo, hi := int64(0), length
	if s.Loop.On && s.Loop.Out > s.Loop.In {
		lo, hi = s.Loop.In, s.Loop.Out
	}
	if frames > hi-lo {
		return 0, false
	}
	hasGrid := s.Grid != nil && s.Grid.Frames > 0 && s.Grid.Bars > 0
	if !hasGrid && slices.IndexFunc(s.Tracks, func(t Track) bool { return len(t.Clips) > 0 }) < 0 {
		return 0, true
	}
	start := lo
	if pos >= lo && pos < hi {
		start = pos
	}
	var ahead, round []int64
	if hasGrid {
		g := *s.Grid
		for n := g.BarAt(g.NextBar(lo)); ; n++ {
			a := g.BarStart(n)
			if a+frames > hi {
				break
			}
			if a >= start {
				ahead = append(ahead, a)
			} else {
				round = append(round, a)
			}
		}
	} else {
		cands := []int64{start}
		seen := map[int64]bool{}
		for _, tr := range lanes {
			for _, c := range tr.Clips {
				if e := c.At + c.Frames; !seen[e] {
					seen[e] = true
					cands = append(cands, e)
				}
			}
		}
		cands = append(cands, lo)
		for _, a := range cands {
			if a < lo || a+frames > hi {
				continue
			}
			if a >= start {
				ahead = append(ahead, a)
			} else {
				round = append(round, a)
			}
		}
		sort.Slice(ahead, func(i, j int) bool { return ahead[i] < ahead[j] })
		sort.Slice(round, func(i, j int) bool { return round[i] < round[j] })
	}
	for _, a := range append(ahead, round...) {
		if !busy(a, a+frames) {
			return a, true
		}
	}
	return 0, false
}
