package surface

import (
	"bytes"
	"flag"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func ack2(seq, status byte, extra ...byte) []byte {
	return append(append([]byte{0xF0, 0x7D, 'H', 'S', 0x02, seq, cmdAck, status}, extra...), 0xF7)
}

// presentV2 brings the rig's keyboard to answering HELLO as version 2's
// firmware does, 02 60, and takes its screen; seq 2 is spent.
func (r *rig) presentV2() {
	r.t.Helper()
	r.advance(r.k.Probe)
	if got := r.take(); len(got) != 1 || !bytes.Equal(got[0], frame(1, cmdHello)) {
		r.t.Fatalf("probe = % x, want a version 1 HELLO, which every version reads", got)
	}
	r.k.Feed(ack(1, statusOK, 2, 0x60))
	<-r.presents
	if v := r.k.Status().Version; v != 2 {
		r.t.Fatalf("version %d, want 2", v)
	}
	r.k.Clear(Black)
	got := r.take()
	if len(got) != 1 || got[0][4] != 2 || got[0][6] != cmdClear {
		r.t.Fatalf("CLEAR = % x, want it in a version 2 frame", got)
	}
	r.k.Feed(ack2(got[0][5], statusOK))
}

// batches are the commands in the BATCH frames sent since the last take,
// acked as version 2 acks them, with each frame checked.
func (r *rig) batches() []Item {
	r.t.Helper()
	var out []Item
	for {
		got := r.take()
		if len(got) == 0 {
			return out
		}
		for _, f := range got {
			if f[4] != 2 || f[6] != cmdBatch || len(f) > MaxFrame || f[len(f)-1] != 0xF7 {
				r.t.Fatalf("sent % x, want a version 2 BATCH of at most %d bytes", f, MaxFrame)
			}
			out = append(out, decodeBatch(r.t, f[7:len(f)-1])...)
			r.k.Feed(ack2(f[5], statusOK))
		}
	}
}

// decodeBatch reads a BATCH's commands back into items.
func decodeBatch(t *testing.T, p []byte) []Item {
	t.Helper()
	var out []Item
	n14 := func(b []byte, i int) int { return int(b[2*i]) | int(b[2*i+1])<<7 }
	for len(p) > 0 {
		cmd, size := Kind(p[0]), int(p[1])
		b := p[2 : 2+size]
		it := Item{Kind: cmd, X: n14(b, 0), Y: n14(b, 1)}
		switch cmd {
		case KindText:
			it.Scale, it.Colour, it.Back, it.S = int(b[4]), Colour(b[5]), Colour(b[6]), string(b[7:])
		case KindBox:
			it.W, it.H, it.Colour = n14(b, 2), n14(b, 3), Colour(b[8])
		case KindBar:
			it.W, it.H, it.Value, it.Colour, it.Back = n14(b, 2), n14(b, 3), int(b[8]), Colour(b[9]), Colour(b[10])
		default:
			t.Fatalf("a BATCH holds command %d", cmd)
		}
		out = append(out, it)
		p = p[2+size:]
	}
	return out
}

// On version 2, Show draws the whole screen once the CLEAR is acked, as
// Layout has it, in BATCH frames; then only what changes.
func TestVersion2ShowsTheLayoutThenOnlyItsChanges(t *testing.T) {
	r := newRig(t)
	r.presentV2()
	if !r.k.Show(atRest()) {
		t.Fatal("Show refused on version 2")
	}
	want := Layout(atRest())
	if got := r.batches(); lines(got) != lines(want) {
		t.Fatalf("the first screen:\n%s", lineDiff(lines(want), lines(got)))
	}
	next := screens[1].state() // playing, FILTER turned
	r.advance(r.k.MeterEvery)  // so its meters are taken
	r.k.Show(next)
	got := r.batches()
	if wantCmds := plan(want, Layout(next)); lines(got) != lines(wantCmds) || len(got) > 20 {
		t.Fatalf("the change sent %d commands:\n%s", len(got), lineDiff(lines(wantCmds), lines(got)))
	}
	r.k.Show(next)
	if got := r.batches(); len(got) != 0 {
		t.Fatalf("the same screen again sent %v", got)
	}
}

// Meters are taken at most every MeterEvery: a level that moves sooner
// waits, so they can't fill the link.
func TestMetersAreTakenAtMostEveryMeterEvery(t *testing.T) {
	r := newRig(t)
	r.presentV2()
	s := atRest()
	r.k.Show(s)
	r.batches()
	s.Meter[0] = 80
	r.advance(r.k.MeterEvery / 2)
	r.k.Show(s)
	if got := r.batches(); len(got) != 0 {
		t.Fatalf("a meter sooner than MeterEvery sent %v", got)
	}
	s.Beats++ // the counter isn't held
	r.k.Show(s)
	if got := r.batches(); len(got) != 1 || got[0].Y != counterY {
		t.Fatalf("the counter's move sent %v", got)
	}
	r.advance(r.k.MeterEvery / 2)
	r.k.Show(s)
	if got := r.batches(); len(got) != 1 || got[0] != BarItem(16, 137, 180, 5, 80, T1, Panel) {
		t.Fatalf("the meter, MeterEvery on, sent %v", got)
	}
}

// Follow's source is asked every Refresh, on the Keyboard's own loop.
func TestFollowIsAskedEveryRefresh(t *testing.T) {
	r := newRig(t)
	r.presentV2()
	asked := 0
	s := atRest()
	r.k.Follow(func() State { asked++; s.Beats++; return s })
	r.advance(r.k.Refresh)
	r.advance(r.k.Refresh / 2)
	r.advance(r.k.Refresh / 2)
	if asked != 2 {
		t.Fatalf("asked %d times in two Refreshes, want 2", asked)
	}
	if got := r.batches(); len(got) == 0 {
		t.Fatal("what Follow gave wasn't drawn")
	}
}

// The banner on version 2 is the layout's: a box in the press's colour with
// its words, for BannerFor, then taken away.
func TestVersion2sBannerIsABoxThatGoes(t *testing.T) {
	r := newRig(t)
	r.presentV2()
	r.k.Show(atRest())
	r.batches()
	if !r.k.Banner(r.k.Now(), Red, "KEPT 30 S") {
		t.Fatal("the banner was refused")
	}
	got := r.batches()
	want := []Item{BoxItem(0, 0, 240, 28, Red), TextItem(TopX, 7, BannerScale, White, Red, "KEPT 30 S")}
	if lines(got) != lines(want) {
		t.Fatalf("the banner:\n%s", lineDiff(lines(want), lines(got)))
	}
	r.advance(BannerFor)
	if got := r.batches(); len(got) != 2 || !got[0].removes() || !got[1].removes() {
		t.Fatalf("the banner's going sent %v", got)
	}
}

// A BATCH that stops short counts what it did: those stay done, and the
// screen stops being drawn rather than be refused again and again.
func TestABatchStoppedShortKeepsWhatItDid(t *testing.T) {
	r := newRig(t)
	r.presentV2()
	r.k.Show(atRest())
	f := r.take()[0]
	r.k.Feed(ack2(f[5], 3, 5, 0)) // FULL, five done
	if n := len(r.k.shown); n != 5 {
		t.Fatalf("the keyboard's list has %d items, want the 5 done", n)
	}
	r.k.Show(atRest())
	if got := r.take(); len(got) != 0 {
		t.Fatalf("drew again after a refusal: % x", got)
	}
}

// HOME on version 2, its RELEASE in a version 1 frame as the keyboard always
// sends it, drops the screen waiting, and draws nothing more.
func TestHomeOnVersion2DropsTheScreen(t *testing.T) {
	r := newRig(t)
	r.presentV2()
	r.k.Show(atRest())
	if got := r.take(); len(got) != 1 {
		t.Fatalf("sent %d frames, want the first BATCH alone", len(got))
	}
	r.k.Feed(frame(0, cmdRelease))
	if r.k.Status().Screen {
		t.Fatal("HOME left the screen Hindsight's")
	}
	r.k.Show(screens[1].state())
	r.advance(r.k.AckTimeout)
	if got := r.take(); len(got) != 0 {
		t.Fatalf("drew after HOME: % x", got)
	}
}

// On version 1 the screen stays what Clear and Text draw: Show draws
// nothing, and the banner is a TEXT in version 1's colours, red the accent.
func TestVersion1KeepsItsScreen(t *testing.T) {
	r := newRig(t)
	r.taken()
	if v := r.k.Status().Version; v != 1 {
		t.Fatalf("version %d, want 1", v)
	}
	if r.k.Show(atRest()) {
		t.Fatal("Show drew on version 1")
	}
	r.k.Follow(func() State { return atRest() })
	r.advance(r.k.Refresh)
	expectSent(t, "Show and Follow", r.sentNow())
	r.k.Banner(r.k.Now(), Red, "KEPT 30 S")
	expectSent(t, "the banner", r.sentNow(), text(4, TopX, TopY, BannerScale, Accent, "KEPT 30 S"))
	r.k.Banner(r.k.Now(), White, "CAUGHT 8 S")
	expectSent(t, "a white banner", r.sentNow(), text(5, TopX, TopY, BannerScale, Text, "CAUGHT 8 S"))
}

var script = flag.String("script", "", "write the screens, as the Keyboard sends them, as a script for the firmware's screen simulator (tools/screen/run.sh)")

// With -script, the prototype's screens and the overlaps' are written as a
// script for the firmware's simulator: each the frames a Keyboard sends,
// drawn whole from a CLEAR, then the six again each as only its change
// from the one before, to compare with the whole.
func TestWriteSimulatorScript(t *testing.T) {
	if *script == "" {
		t.Skip("no -script")
	}
	long := atRest()
	long.Tape, long.Playing, long.Beats = "A tape with a long name indeed", true, 3996.5
	long.Armed, long.Solo, long.Mute = 0, [4]bool{true, true, true, true}, [4]bool{true, true, true, true}
	all := append(screens[:len(screens):len(screens)], struct {
		name  string
		state func() State
	}{"overlaps-fixed", func() State { return long }})

	var b strings.Builder
	b.WriteString("# Hindsight's internal/surface: the screens as its Keyboard sends them (go test -run TestWriteSimulatorScript -script=...).\nboot\nwait 1500\nstrict\n")
	r := newRig(t)
	r.presentV2()
	r.take()
	frames := func() {
		for {
			got := r.take()
			if len(got) == 0 {
				return
			}
			for _, f := range got {
				fmt.Fprintf(&b, "sysex % X\n", f)
				r.k.Feed(ack2(f[5], statusOK))
			}
		}
	}
	show := func(s State) {
		r.k.banner = time.Time{}
		if s.Banner != nil {
			r.k.banner, r.k.flash = r.clock.Add(time.Hour), *s.Banner
		}
		r.advance(r.k.MeterEvery)
		r.k.Show(s)
		frames()
	}
	for _, sc := range all {
		fmt.Fprintf(&b, "# %s, whole\n", sc.name)
		r.k.Clear(Black)
		frames()
		show(sc.state())
		fmt.Fprintf(&b, "wait 200\nshot %s\n", sc.name)
	}
	r.k.Clear(Black)
	frames()
	for _, sc := range all {
		fmt.Fprintf(&b, "# %s, as a change from the one before\n", sc.name)
		show(sc.state())
		fmt.Fprintf(&b, "wait 200\nshot %s-changed\n", sc.name)
	}
	if err := os.WriteFile(*script, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}
