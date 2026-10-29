package tape

import "testing"

func TestChangesTapEverySubscriberAndForgetACancelledOne(t *testing.T) {
	var c Changes
	c.Bump() // with nobody listening
	a, cancelA := c.Subscribe()
	b, cancelB := c.Subscribe()
	defer cancelB()
	c.Bump()
	c.Bump() // a second tap while the first is unread: one tap, the newest rev
	for name, ch := range map[string]<-chan struct{}{"a": a, "b": b} {
		select {
		case <-ch:
		default:
			t.Fatalf("%s wasn't tapped", name)
		}
		select {
		case <-ch:
			t.Fatalf("%s was tapped twice for two unread bumps", name)
		default:
		}
	}
	if c.Rev() != 3 {
		t.Fatalf("rev = %d, want 3", c.Rev())
	}
	cancelA()
	c.Bump()
	select {
	case <-a:
		t.Fatal("a cancelled subscriber was tapped")
	default:
	}
	select {
	case <-b:
	default:
		t.Fatal("b wasn't tapped after a's cancel")
	}
}

// Every change a page sees in /api/tapes/state moves the revision
// (docs/plan/pushing-tape-state.md), or a page told to poll on a new one
// never hears of it.
func TestEveryChangeThePageSeesMovesTheRevision(t *testing.T) {
	e, sink, tp := newEngine(t)
	moves := func(what string, f func()) {
		t.Helper()
		was := e.Changes().Rev()
		f()
		if e.Changes().Rev() == was {
			t.Fatalf("%s didn't move the revision", what)
		}
	}
	take := takeWAV(t, 200000, func(i int) float64 { return 0.5 })
	moves("a drop", func() {
		if _, err := e.DropTake(tp.ID, take, 96000, 192000, 1, 1, []int{0, 1}); err != nil {
			t.Fatal(err)
		}
	})
	moves("an edit", func() {
		if err := e.Edit(tp.ID, "gain:1", func(_ *Tape, s *State) error { s.Tracks[0].GainDB = -6; return nil }); err != nil {
			t.Fatal(err)
		}
	})
	moves("an undo", func() {
		if err := e.Undo(tp.ID, false); err != nil {
			t.Fatal(err)
		}
	})
	moves("arming ● Rec", func() {
		if _, err := e.Record(tp.ID, 2, "aux", false); err != nil {
			t.Fatal(err)
		}
	})
	moves("the clipboard", func() {
		if err := e.ClearClipboard(); err != nil {
			t.Fatal(err)
		}
	})
	moves("loading a tape", func() {
		if _, err := e.Load(tp.ID); err != nil {
			t.Fatal(err)
		}
	})

	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 4096) // the load's locate, carried out
	// What a page polling at the tap would read: the tap comes once the
	// view shows what it announces, never before. A tap too early is a
	// race with the render goroutine's publishing, so it's tried twenty
	// times over.
	tapped, cancel := e.Changes().Subscribe()
	defer cancel()
	for i := 0; i < 20; i++ {
		want := i%2 == 0 // ▶, then ■
		kind := map[bool]string{true: "play", false: "stop"}[want]
		select {
		case <-tapped: // the last one's, already read by its poll
		default:
		}
		seen := make(chan bool, 1)
		go func() {
			<-tapped
			seen <- e.Live().Playing
		}()
		moves(kind+", once it's carried out", func() {
			if _, err := e.Transport(tp.ID, Action{Kind: kind}); err != nil {
				t.Fatal(err)
			}
			sink.play(t, 4096)
		})
		if <-seen != want {
			t.Fatalf("the tap for %s came before the view said so", kind)
		}
	}
	if _, err := e.Transport(tp.ID, Action{Kind: "play"}); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 4096)
	// Nothing else is asked of it now: a whole pass of the loop, which Catch
	// can take, is what moves it.
	moves("a pass of the loop", func() { sink.play(t, 2*96000) })
	moves("■", func() {
		if _, err := e.Transport(tp.ID, Action{Kind: "stop"}); err != nil {
			t.Fatal(err)
		}
		sink.play(t, 4096)
	})
	// ▶ with ● Rec armed counts a bar in; the tape starts playing by itself
	// when it ends, with nothing asked of it.
	if _, err := e.Record(tp.ID, 2, "aux", false); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Transport(tp.ID, Action{Kind: "play"}); err != nil {
		t.Fatal(err)
	}
	sink.play(t, 8192)
	if l := e.Live(); l.Playing || l.CountIn == 0 {
		t.Fatalf("not counting in: %+v", l.Status)
	}
	moves("the count-in ending", func() {
		for !e.Live().Playing {
			sink.play(t, 4096)
		}
	})
}
