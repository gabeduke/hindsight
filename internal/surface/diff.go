package surface

// What to send to turn the screen the keyboard has into the one it should
// have. The keyboard keeps a list (items.go): a replaced item keeps its
// place in the order, a new one goes last, and a later one covers an
// earlier one. So a change is the removals first (the list holds 96, and
// they make room), then the replacements, then the new items in the
// layout's order. Where that order would leave an item under one it should
// cover (the banner's box, say, sent before a top line that came back),
// the covering one is taken away and sent again after it.

// plan is the commands that make shown (the keyboard's list, in its order)
// into want (Layout's, in its order).
func plan(shown, want []Item) []Item {
	wanted := make(map[place]int, len(want))
	for i, it := range want {
		wanted[it.place()] = i
	}
	var removals []Item
	kept := make([]Item, 0, len(shown)) // what stays, in the keyboard's order
	for _, it := range shown {
		if _, ok := wanted[it.place()]; ok {
			kept = append(kept, it)
		} else {
			removals = append(removals, it.removal())
		}
	}
	for {
		// The order the keyboard will have: what stays, then the new.
		at := make(map[place]int, len(want))
		for i, it := range kept {
			at[it.place()] = i
		}
		n := len(kept)
		for _, it := range want {
			if _, ok := at[it.place()]; !ok {
				at[it.place()] = n
				n++
			}
		}
		moved := -1
		for i := 0; i < len(kept) && moved < 0; i++ {
			top := want[wanted[kept[i].place()]]
			for _, under := range want[:wanted[top.place()]] {
				if at[under.place()] > i && overlaps(under, top) {
					moved = i // drawn before what it covers: send it again
					break
				}
			}
		}
		if moved < 0 {
			break
		}
		removals = append(removals, kept[moved].removal())
		kept = append(kept[:moved], kept[moved+1:]...)
	}
	cmds := removals
	staying := make(map[place]bool, len(kept))
	for _, it := range kept {
		staying[it.place()] = true
		if w := want[wanted[it.place()]]; w != it {
			cmds = append(cmds, w)
		}
	}
	for _, it := range want {
		if !staying[it.place()] {
			cmds = append(cmds, it)
		}
	}
	return cmds
}

// apply is the keyboard's list after cmd, as app/hindsight.h keeps it.
func apply(list []Item, cmd Item) []Item {
	for i, it := range list {
		if it.place() == cmd.place() {
			if cmd.removes() {
				return append(list[:i:i], list[i+1:]...)
			}
			list[i] = cmd
			return list
		}
	}
	if cmd.removes() {
		return list
	}
	return append(list, cmd)
}

// MaxFrame is the longest frame the keyboard takes, F0 to F7.
const MaxFrame = 1024

// frameBytes is a frame's own bytes: F0 7D 48 53 <v> <seq> <cmd> and F7.
const frameBytes = 8

// nextBatch is a BATCH's payload of as many of cmds, from the first, as
// fit in one frame, and how many those are.
func nextBatch(cmds []Item) ([]byte, int) {
	var out []byte
	n := 0
	for _, c := range cmds {
		p := c.payload()
		if frameBytes+len(out)+2+len(p) > MaxFrame {
			break
		}
		out = append(append(out, byte(c.Kind), byte(len(p))), p...)
		n++
	}
	return out, n
}
