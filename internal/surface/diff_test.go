package surface

import (
	"math/rand"
	"testing"
)

// looksLike says whether the keyboard's list draws the same picture as
// want: the same items, and of any two that overlap, the one want draws
// later is later in the list.
func looksLike(t *testing.T, list, want []Item) {
	t.Helper()
	if len(list) != len(want) {
		t.Fatalf("the keyboard has %d items, want %d", len(list), len(want))
	}
	at := map[place]int{}
	for i, it := range list {
		at[it.place()] = i
	}
	for i, w := range want {
		j, ok := at[w.place()]
		if !ok || list[j] != w {
			t.Fatalf("the keyboard has %v at %v, want %v", list[j], w.place(), w)
		}
		for _, later := range want[i+1:] {
			if overlaps(w, later) && at[later.place()] < j {
				t.Fatalf("%v is drawn over %v, which should cover it", w, later)
			}
		}
	}
}

// send is what the keyboard's list is after plan's commands, and the
// commands.
func send(shown []Item, want []Item) ([]Item, []Item) {
	cmds := plan(shown, want)
	list := append([]Item(nil), shown...)
	for _, c := range cmds {
		list = apply(list, c)
	}
	return list, cmds
}

func TestAScreenFromNothingIsEveryItemInOrder(t *testing.T) {
	want := Layout(atRest())
	list, cmds := send(nil, want)
	if len(cmds) != len(want) {
		t.Fatalf("%d commands for %d items", len(cmds), len(want))
	}
	looksLike(t, list, want)
	if _, again := send(list, want); len(again) != 0 {
		t.Fatalf("the same screen again sent %v", again)
	}
}

// A change sends only what changed: a meter's level is one BAR.
func TestAChangeSendsOnlyWhatChanged(t *testing.T) {
	s := atRest()
	shown, _ := send(nil, Layout(s))
	s.Meter[2] = 90
	list, cmds := send(shown, Layout(s))
	if len(cmds) != 1 || cmds[0] != BarItem(16, 155, 180, 5, 90, T3, Panel) {
		t.Fatalf("a meter's move sent %v", cmds)
	}
	looksLike(t, list, Layout(s))
}

// What goes is taken away before anything comes, so the list has room:
// STOP to REC moves the transport's word, and the banner comes.
func TestRemovalsGoFirst(t *testing.T) {
	s := atRest()
	shown, _ := send(nil, Layout(s))
	s.Playing, s.Recording, s.Banner = true, true, &Flash{"REC T2", Red}
	list, cmds := send(shown, Layout(s))
	if len(cmds) == 0 || !cmds[0].removes() || cmds[0].place() != (place{KindText, 175, 41}) {
		t.Fatalf("commands %v, want STOP's removal first", cmds)
	}
	for i, c := range cmds[1:] {
		if c.removes() {
			t.Fatalf("a removal after an addition, at %d: %v", i+1, c)
		}
	}
	looksLike(t, list, Layout(s))
	// And back: the banner goes.
	s.Banner = nil
	list, cmds = send(list, Layout(s))
	if !cmds[0].removes() || !cmds[1].removes() || len(cmds) != 2 {
		t.Fatalf("the banner's going sent %v", cmds)
	}
	looksLike(t, list, Layout(s))
}

// A top line that comes back while the banner shows would go last, over
// the banner: the banner is sent again after it, so it still covers it.
func TestAnItemComingUnderOneSendsThatOneAgain(t *testing.T) {
	s := atRest()
	s.Tape, s.Banner = "", &Flash{"PLAY", Green}
	shown, _ := send(nil, Layout(s))
	s.Tape = "Tape 4"
	list, cmds := send(shown, Layout(s))
	looksLike(t, list, Layout(s))
	if len(cmds) < 3 {
		t.Fatalf("sent %v: want the banner taken away and sent again after the name", cmds)
	}
}

// Between any two screens, the plan's commands make the one into the other.
func TestAnyScreenBecomesAnyOther(t *testing.T) {
	states := overlapStates()
	r := rand.New(rand.NewSource(1))
	for range 400 {
		a, b := states[r.Intn(len(states))], states[r.Intn(len(states))]
		if r.Intn(2) == 0 {
			b.Banner = &Flash{"PUNCH IN T2", Red}
		}
		shown, _ := send(nil, Layout(a))
		list, cmds := send(shown, Layout(b))
		looksLike(t, list, Layout(b))
		if len(list) > MaxItems {
			t.Fatalf("%d items", len(list))
		}
		_ = cmds
	}
}

// A change bigger than a frame goes in several, each whole commands and at
// most MaxFrame bytes, in order.
func TestBatchesFitAFrame(t *testing.T) {
	cmds := plan(nil, Layout(screens[2].state()))
	var got []Item
	for len(cmds) > 0 {
		payload, n := nextBatch(cmds)
		if n == 0 || frameBytes+len(payload) > MaxFrame {
			t.Fatalf("a batch of %d commands, %d bytes", n, frameBytes+len(payload))
		}
		for p := 0; p < len(payload); {
			cmd, size := payload[p], int(payload[p+1])
			if Kind(cmd) != cmds[0].Kind || string(payload[p+2:p+2+size]) != string(cmds[0].payload()) {
				t.Fatalf("batch holds % x, want %v", payload[p:p+2+size], cmds[0])
			}
			got, cmds, p = append(got, cmds[0]), cmds[1:], p+2+size
		}
	}
	if len(got) != len(Layout(screens[2].state())) {
		t.Fatalf("batched %d of %d", len(got), len(Layout(screens[2].state())))
	}
}
