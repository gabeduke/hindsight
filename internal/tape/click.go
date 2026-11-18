package tape

import "slices"

// Where the click plays. A source hears the buses in its Leaks (on the
// Sidekick MAIN hears A and B, CH1 A, CH2 B), so a click on a bus the
// recorded source hears lands on the recording. The click goes on the first
// bus, A then B, that none of the sources being recorded from hears; when
// each bus is heard by one of them (MAIN hears both), it stays on A and the
// source reads as not clean, which the input picker and the rig show.

// clickBusFor is the bus index (0 = A, 1 = B) the click plays on while
// srcs are being recorded from.
func clickBusFor(srcs []Source) int {
	for i, bus := range []string{BusA, BusB} {
		heard := false
		for _, s := range srcs {
			heard = heard || slices.Contains(s.Leaks, bus)
		}
		if !heard {
			return i
		}
	}
	return 0
}

// busName is a bus index's name.
func busName(i int) string {
	if i == 1 {
		return BusB
	}
	return BusA
}

// recordingFrom is the sources the click must keep out of: a punch's or an
// armed Rec's inputs while there is one, otherwise the armed tracks' own
// inputs. An input of "" (the device's last choice) isn't known here.
func (e *Engine) recordingFrom(t *Tape, rec *Recording) []Source {
	var names []string
	if rec != nil && rec.Tape == t.ID {
		for _, p := range rec.Pairs {
			names = append(names, p.Source)
		}
	} else {
		for _, n := range t.RecTracks {
			if n >= 1 && n <= len(t.Inputs) && t.Inputs[n-1] != "" {
				names = append(names, t.Inputs[n-1])
			}
		}
	}
	var out []Source
	for _, n := range names {
		if s, ok := e.source(n); ok {
			out = append(out, s)
		}
	}
	return out
}

// cleanOf says whether nothing on the tape plays into a source: no unmuted
// track with clips on a bus it hears, and no click on one. What Clip.Clean
// records, and the rig's warning is worked out from.
func (e *Engine) cleanOf(t *Tape, src Source) bool {
	if t == nil {
		return true
	}
	for _, b := range src.Leaks {
		for _, tr := range t.Tracks {
			if tr.Bus == b && len(tr.Clips) > 0 && !tr.Mute {
				return false
			}
		}
	}
	if t.Click {
		bus := 0
		if m := e.mix.Load(); m != nil && m.tapeID == t.ID {
			bus = m.clickBus
		}
		if slices.Contains(src.Leaks, busName(bus)) {
			return false
		}
	}
	return true
}
