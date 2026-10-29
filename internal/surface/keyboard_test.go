package surface

import (
	"bytes"
	"sync"
	"testing"
	"time"
)

// rig is a Keyboard on a fake port and a fake clock, ticked by hand.
type rig struct {
	t         *testing.T
	k         *Keyboard
	mu        sync.Mutex
	sent      [][]byte
	connected bool
	clock     time.Time
	presents  chan struct{}
}

func newRig(t *testing.T) *rig {
	r := &rig{t: t, connected: true, clock: time.Unix(1000, 0), presents: make(chan struct{}, 4)}
	r.k = New(func(b []byte) {
		r.mu.Lock()
		defer r.mu.Unlock()
		r.sent = append(r.sent, b)
	}, func() bool { return r.connected })
	r.k.Clock = func() time.Time { return r.clock }
	r.k.OnPresent(func() { r.presents <- struct{}{} })
	return r
}

func (r *rig) advance(d time.Duration) { r.clock = r.clock.Add(d); r.k.tick() }

// take returns what was sent since the last take.
func (r *rig) take() [][]byte {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := r.sent
	r.sent = nil
	return out
}

func frame(seq, cmd byte, payload ...byte) []byte {
	return append(append([]byte{0xF0, 0x7D, 'H', 'S', 0x01, seq, cmd}, payload...), 0xF7)
}

func ack(seq, status byte, extra ...byte) []byte {
	return frame(seq, cmdAck, append([]byte{status}, extra...)...)
}

// present brings the rig's keyboard to answering HELLO; seq 1 is spent.
func (r *rig) present() {
	r.t.Helper()
	r.advance(r.k.Probe)
	if got := r.take(); len(got) != 1 || !bytes.Equal(got[0], frame(1, cmdHello)) {
		r.t.Fatalf("probe = % x, want HELLO with seq 1", got)
	}
	r.clock = r.clock.Add(3 * time.Millisecond)
	r.k.Feed(ack(1, statusOK, 1, 16))
	select {
	case <-r.presents:
	case <-time.After(time.Second):
		r.t.Fatal("OnPresent never ran")
	}
	if s := r.k.Status(); !s.Present || s.RTT != 3*time.Millisecond {
		r.t.Fatalf("status = %+v, want present with a 3 ms round trip", s)
	}
}

func TestProbesOnlyAKeyboardThatIsPluggedIn(t *testing.T) {
	r := newRig(t)
	r.connected = false
	r.advance(10 * time.Second)
	if got := r.take(); len(got) != 0 {
		t.Fatalf("sent % x to a keyboard that isn't there", got)
	}
	r.connected = true
	r.present()
}

func TestAnUnansweredHelloIsTriedThenProbedAgain(t *testing.T) {
	r := newRig(t)
	r.advance(r.k.Probe)
	r.advance(r.k.AckTimeout / 2) // not yet
	r.advance(r.k.AckTimeout)     // again, the same seq
	r.advance(r.k.AckTimeout)     // a third time
	r.advance(r.k.AckTimeout)     // given up
	got := r.take()
	if len(got) != 3 || !bytes.Equal(got[0], frame(1, cmdHello)) || !bytes.Equal(got[2], frame(1, cmdHello)) {
		t.Fatalf("sent % x, want HELLO seq 1 three times", got)
	}
	if r.k.Clear(Black) || r.k.Text(0, 0, 1, Text, "x") {
		t.Fatal("a keyboard that never answered took a message")
	}
	r.advance(r.k.Probe)
	if got := r.take(); len(got) != 1 || !bytes.Equal(got[0], frame(2, cmdHello)) {
		t.Fatalf("the next probe = % x, want HELLO seq 2", got)
	}
}

func TestOneMessageInFlightAndTheScreenFollowsTheAcks(t *testing.T) {
	r := newRig(t)
	r.present()
	if !r.k.Clear(Black) || !r.k.Text(130, 8, 2, Accent, "Tape 3") {
		t.Fatal("a present keyboard refused a message")
	}
	if got := r.take(); len(got) != 1 || !bytes.Equal(got[0], frame(2, cmdClear, 0)) {
		t.Fatalf("sent % x, want CLEAR alone until its ack", got)
	}
	r.k.Feed(ack(9, statusOK)) // not the one in flight
	if got := r.take(); len(got) != 0 {
		t.Fatalf("an ack for another seq sent % x", got)
	}
	r.k.Feed(ack(2, statusOK))
	if !r.k.Status().Screen {
		t.Fatal("CLEAR's ack didn't give Hindsight the screen")
	}
	want := frame(3, cmdText, 130&127, 130>>7, 8, 0, 2, byte(Accent), 'T', 'a', 'p', 'e', ' ', '3')
	if got := r.take(); len(got) != 1 || !bytes.Equal(got[0], want) {
		t.Fatalf("after the ack: % x, want % x", got, want)
	}
	r.k.Feed(ack(3, statusOK))

	// HOME on the keyboard: its own RELEASE, seq 0.
	r.k.Feed(frame(0, cmdRelease))
	if r.k.Status().Screen {
		t.Fatal("the keyboard's RELEASE left Hindsight the screen")
	}
	// A TEXT answered RELEASED says the same.
	r.k.Feed(nil)
	r.k.Clear(Black)
	r.k.Feed(ack(4, statusOK))
	r.k.Text(0, 0, 1, Text, "x")
	r.k.Feed(ack(5, statusReleased))
	if r.k.Status().Screen {
		t.Fatal("a TEXT answered RELEASED left Hindsight the screen")
	}
}

func TestATextForTheSamePlaceReplacesTheWaitingOne(t *testing.T) {
	r := newRig(t)
	r.present()
	r.k.Clear(Black) // in flight
	r.k.Text(8, 40, 2, Text, "1:00")
	r.k.Text(8, 60, 1, Dim, "LOOP")
	r.k.Text(8, 40, 2, Text, "1:01")
	r.take()
	r.k.Feed(ack(2, statusOK))
	r.k.Feed(ack(3, statusOK))
	r.k.Feed(ack(4, statusOK))
	got := r.take()
	if len(got) != 2 {
		t.Fatalf("sent %d messages after CLEAR, want 2", len(got))
	}
	if want := frame(3, cmdText, 8, 0, 40, 0, 2, byte(Text), '1', ':', '0', '1'); !bytes.Equal(got[0], want) {
		t.Fatalf("first = % x, want the newer counter % x in the older one's place", got[0], want)
	}
	if !bytes.Contains(got[1], []byte("LOOP")) {
		t.Fatalf("second = % x, want LOOP", got[1])
	}
}

func TestAKeyboardThatStopsAnsweringIsForgottenAndProbedAgain(t *testing.T) {
	r := newRig(t)
	r.present()
	r.k.Clear(Black)
	for i := 0; i < r.k.Tries; i++ {
		r.advance(r.k.AckTimeout)
	}
	if s := r.k.Status(); s.Present || s.Screen {
		t.Fatalf("status = %+v after three unanswered tries, want forgotten", s)
	}
	r.take()
	r.advance(r.k.Probe)
	if got := r.take(); len(got) != 1 || got[0][6] != cmdHello {
		t.Fatalf("after forgetting: % x, want a HELLO", got)
	}
}

func TestGoneAndUnpluggedForgetTheKeyboard(t *testing.T) {
	r := newRig(t)
	r.present()
	r.k.Gone()
	if r.k.Status().Present {
		t.Fatal("Gone left the keyboard present")
	}
	r.present2()
	r.connected = false
	r.advance(time.Millisecond)
	if r.k.Status().Present {
		t.Fatal("unplugged, the keyboard is still present")
	}
}

// present2 brings a forgotten keyboard back, on the next seq.
func (r *rig) present2() {
	r.t.Helper()
	r.take()
	r.advance(r.k.Probe)
	got := r.take()
	if len(got) != 1 {
		r.t.Fatalf("probe = % x", got)
	}
	r.k.Feed(ack(got[0][5], statusOK, 1, 16))
	<-r.presents
}

func TestTextAndKnobEncoding(t *testing.T) {
	r := newRig(t)
	r.present()
	r.k.Clear(Black)
	r.k.Feed(ack(2, statusOK))
	r.take()
	// Cut to what fits from x: 240-228 = 12 px, two glyphs at scale 1.
	r.k.Text(228, 0, 1, Text, "ABC")
	if got := r.take(); len(got) != 1 || !bytes.HasSuffix(got[0], []byte{'A', 'B', 0xF7}) {
		t.Fatalf("% x, want AB", got)
	}
	r.k.Feed(ack(3, statusOK))
	r.k.Text(0, 0, 1, Text, "é\x01ok")
	if got := r.take(); len(got) != 1 || !bytes.HasSuffix(got[0], []byte{'?', '?', 'o', 'k', 0xF7}) {
		t.Fatalf("% x, want ??ok", got)
	}
	r.k.Feed(ack(4, statusOK))
	r.k.Knob(6, 127)
	if got := r.take(); len(got) != 1 || !bytes.Equal(got[0], frame(5, cmdKnob, 6, 127)) {
		t.Fatalf("% x, want KNOB 6 127", got)
	}
	for _, bad := range []bool{
		r.k.Text(235, 0, 1, Text, "x"), r.k.Text(0, 234, 1, Text, "x"), r.k.Text(0, 0, 5, Text, "x"),
		r.k.Text(0, 0, 1, colours, "x"), r.k.Knob(7, 0), r.k.Knob(0, 128), r.k.Clear(colours),
	} {
		if bad {
			t.Fatal("an impossible message was queued")
		}
	}
}

func TestSeqRunsOneTo127(t *testing.T) {
	r := newRig(t)
	r.present()
	seen := map[byte]bool{}
	for i := 0; i < 300; i++ {
		r.k.Knob(0, i%128)
		got := r.take()
		if len(got) != 1 {
			t.Fatalf("knob %d sent %d frames", i, len(got))
		}
		seq := got[0][5]
		if seq == 0 || seq > 127 {
			t.Fatalf("seq %d", seq)
		}
		seen[seq] = true
		r.k.Feed(ack(seq, statusOK))
	}
	if len(seen) != 127 {
		t.Fatalf("%d seqs used, want all 127", len(seen))
	}
}

// A TEXT merges only with TEXTs queued after the last CLEAR: merged ahead of
// a waiting CLEAR, it would be wiped by it.
func TestATextDoesNotJumpAWaitingClear(t *testing.T) {
	r := newRig(t)
	r.present()
	r.k.Clear(Black) // in flight
	r.k.Text(8, 40, 2, Text, "A")
	r.k.Clear(Amber)
	r.k.Text(8, 40, 2, Text, "B")
	r.take()
	var cmds []string
	for seq := byte(2); seq <= 5; seq++ {
		r.k.Feed(ack(seq, statusOK))
		for _, f := range r.take() {
			cmds = append(cmds, string(f[6:len(f)-1]))
		}
	}
	want := []string{
		string(append([]byte{cmdText, 8, 0, 40, 0, 2, byte(Text)}, 'A')),
		string([]byte{cmdClear, byte(Amber)}),
		string(append([]byte{cmdText, 8, 0, 40, 0, 2, byte(Text)}, 'B')),
	}
	if len(cmds) != len(want) {
		t.Fatalf("sent %q, want %q", cmds, want)
	}
	for i := range want {
		if cmds[i] != want[i] {
			t.Fatalf("message %d = % x, want % x", i, cmds[i], want[i])
		}
	}
}

// HOME is the player's: the keyboard answering again after a silence
// doesn't take the screen back. Only unplugging forgets it, or a CLEAR.
func TestHomeIsRememberedUntilUnplugged(t *testing.T) {
	r := newRig(t)
	r.present()
	r.k.Clear(Black)
	r.k.Feed(ack(2, statusOK))
	r.k.Feed(frame(0, cmdRelease))
	if s := r.k.Status(); s.Screen || !s.Homed {
		t.Fatalf("after HOME: %+v, want homed without the screen", s)
	}
	r.k.Knob(0, 1) // never answered: forgotten
	for i := 0; i < r.k.Tries; i++ {
		r.advance(r.k.AckTimeout)
	}
	if s := r.k.Status(); s.Present || !s.Homed {
		t.Fatalf("after a silence: %+v, want absent and still homed", s)
	}
	r.present2()
	if !r.k.Status().Homed {
		t.Fatal("answering again forgot the HOME")
	}
	r.k.Gone()
	if r.k.Status().Homed {
		t.Fatal("unplugged, the HOME is still remembered")
	}
	r.present2()
	r.k.Feed(frame(0, cmdRelease))
	r.k.Clear(Black)
	got := r.take()
	r.k.Feed(ack(got[0][5], statusOK))
	if s := r.k.Status(); !s.Screen || s.Homed {
		t.Fatalf("a CLEAR after HOME: %+v, want the screen and HOME forgotten", s)
	}
}

// HOME while a CLEAR waits for its ack: the keyboard keeps one reply per
// port, so its RELEASE can take the ack's place, and the CLEAR sent again
// would take the screen straight back. The player's HOME wins: what was
// drawing Hindsight's screen is dropped, and a late ack changes nothing.
func TestHomeDropsTheDrawingStillWaiting(t *testing.T) {
	r := newRig(t)
	r.present()
	r.k.Clear(Black)
	r.k.Text(8, 8, 1, Text, "HI")
	r.k.Knob(0, 64)
	r.take()
	r.k.Feed(frame(0, cmdRelease))
	if got := r.take(); len(got) != 1 || got[0][6] != cmdKnob {
		t.Fatalf("after HOME sent % x, want the KNOB alone", got)
	}
	r.k.Feed(ack(2, statusOK)) // the CLEAR's, late
	r.advance(r.k.AckTimeout)
	for _, f := range r.take() {
		if f[6] == cmdClear || f[6] == cmdText {
			t.Fatalf("after HOME, sent % x again", f)
		}
	}
	if s := r.k.Status(); s.Screen || !s.Homed {
		t.Fatalf("after HOME and a late ack: %+v, want homed without the screen", s)
	}
}

// A TEXT answered RELEASED on a screen Hindsight had: once a CLEAR has
// taken it, only HOME gives it back, so that was HOME, its RELEASE lost
// behind an ack. Before any CLEAR, it says nothing about HOME.
func TestATextRefusedOnHindsightsScreenIsAHome(t *testing.T) {
	r := newRig(t)
	r.present()
	r.k.Text(8, 8, 1, Text, "HI")
	r.k.Feed(ack(2, statusReleased))
	if s := r.k.Status(); s.Homed {
		t.Fatalf("a TEXT refused before any CLEAR: %+v, want no HOME", s)
	}
	r.k.Clear(Black)
	r.k.Feed(ack(3, statusOK))
	r.k.Text(8, 8, 1, Text, "HI")
	r.k.Feed(ack(4, statusReleased))
	if s := r.k.Status(); s.Screen || !s.Homed {
		t.Fatalf("a TEXT refused on Hindsight's screen: %+v, want homed without the screen", s)
	}
}

// HOME held on the keyboard hands the screen over: the HOME is forgotten,
// and the screen is taken as when the keyboard first answered, or then.
func TestAnOfferForgetsHomeAndPresentsAgain(t *testing.T) {
	r := newRig(t)
	r.k.Feed(frame(0, cmdOffer)) // before it has answered: taken when it does
	r.present()
	select {
	case <-r.presents:
		t.Fatal("an offer from a keyboard that hadn't answered presented it twice")
	case <-time.After(50 * time.Millisecond):
	}
	r.k.Clear(Black)
	r.k.Feed(ack(2, statusOK))
	r.k.Feed(frame(0, cmdRelease))
	r.k.Feed(frame(0, cmdOffer))
	select {
	case <-r.presents:
	case <-time.After(time.Second):
		t.Fatal("an offer after HOME didn't present the keyboard again")
	}
	if r.k.Status().Homed {
		t.Fatal("an offer left the HOME remembered")
	}
	r.k.Feed(frame(5, cmdOffer)) // not the keyboard's own: only seq 0 is
	select {
	case <-r.presents:
		t.Fatal("an OFFER with a seq presented the keyboard")
	case <-time.After(50 * time.Millisecond):
	}

	// HOME, then a silence long enough to forget the keyboard: an OFFER
	// meanwhile still forgets the HOME, so its answer takes the screen.
	r.k.Feed(frame(0, cmdRelease))
	r.k.Knob(0, 1)
	for i := 0; i < r.k.Tries; i++ {
		r.advance(r.k.AckTimeout)
	}
	if s := r.k.Status(); s.Present || !s.Homed {
		t.Fatalf("after HOME and a silence: %+v, want absent and homed", s)
	}
	r.k.Feed(frame(0, cmdOffer))
	r.present2()
	if r.k.Status().Homed {
		t.Fatal("an offer from a forgotten keyboard left the HOME remembered")
	}
}

// As Hindsight stops it gives back the screen it has, without waiting.
func TestFarewell(t *testing.T) {
	r := newRig(t)
	if r.k.Farewell() != nil {
		t.Fatal("a farewell with no screen to give back")
	}
	r.present()
	r.k.Clear(Black)
	r.k.Feed(ack(2, statusOK))
	f := r.k.Farewell()
	if !bytes.Equal(f, frame(3, cmdRelease)) || r.k.Status().Screen {
		t.Fatalf("farewell = % x, status %+v; want RELEASE and no screen", f, r.k.Status())
	}
	if r.k.Farewell() != nil {
		t.Fatal("a second farewell")
	}
}

// taken is the rig's keyboard with Hindsight's screen and its top line
// drawn, everything acked; the next seq is 4.
func (r *rig) taken() {
	r.t.Helper()
	r.present()
	r.k.Clear(Black)
	r.k.Feed(ack(2, statusOK))
	r.k.Text(TopX, TopY, 3, Accent, "HINDSIGHT")
	r.k.Feed(ack(3, statusOK))
	r.take()
}

// sentNow is what went since the last take, acking each so the next goes.
func (r *rig) sentNow() [][]byte {
	r.t.Helper()
	var out [][]byte
	for {
		got := r.take()
		if len(got) == 0 {
			return out
		}
		for _, f := range got {
			r.k.Feed(ack(f[5], statusOK))
		}
		out = append(out, got...)
	}
}

func text(seq byte, x, y, scale int, c Colour, s string) []byte {
	return frame(seq, cmdText, append([]byte{byte(x & 127), byte(x >> 7), byte(y & 127), byte(y >> 7), byte(scale), byte(c)}, s...)...)
}

func expectSent(t *testing.T, step string, got [][]byte, want ...[]byte) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s: sent % x, want % x", step, got, want)
	}
	for i := range want {
		if !bytes.Equal(got[i], want[i]) {
			t.Fatalf("%s: message %d = % x, want % x", step, i, got[i], want[i])
		}
	}
}

// The banner: the top line's place, at once, then the line that was there
// once BannerFor has passed since the press, on the Keyboard's own loop.
func TestABannerShowsForASecondFromThePressThenTheTopLineComesBack(t *testing.T) {
	r := newRig(t)
	r.taken()
	pressed := r.k.Now()
	r.clock = r.clock.Add(40 * time.Millisecond) // the verb ran meanwhile
	if !r.k.Banner(pressed, Green, "PLAY") {
		t.Fatal("the banner was refused")
	}
	expectSent(t, "the press", r.sentNow(), text(4, TopX, TopY, BannerScale, Green, "PLAY"))
	r.advance(BannerFor - 40*time.Millisecond - time.Millisecond)
	expectSent(t, "just under a second", r.sentNow())
	r.advance(time.Millisecond)
	expectSent(t, "a second on", r.sentNow(), text(5, TopX, TopY, 3, Accent, "HINDSIGHT"))
	r.advance(5 * time.Second)
	expectSent(t, "after", r.sentNow())
}

// A new press replaces the banner showing, and its second starts again.
func TestANewPressReplacesTheBanner(t *testing.T) {
	r := newRig(t)
	r.taken()
	r.k.Banner(r.k.Now(), Green, "PLAY")
	expectSent(t, "the first press", r.sentNow(), text(4, TopX, TopY, BannerScale, Green, "PLAY"))
	r.advance(500 * time.Millisecond)
	r.k.Banner(r.k.Now(), Text, "STOP")
	expectSent(t, "the second", r.sentNow(), text(5, TopX, TopY, BannerScale, Text, "STOP"))
	r.advance(500 * time.Millisecond)
	expectSent(t, "the first's second", r.sentNow())
	r.advance(500 * time.Millisecond)
	expectSent(t, "the second's", r.sentNow(), text(6, TopX, TopY, 3, Accent, "HINDSIGHT"))
}

// A top line drawn while the banner shows waits for it to go, and is what
// comes back.
func TestTheTopLineDrawnUnderTheBannerComesBackWhenItGoes(t *testing.T) {
	r := newRig(t)
	r.taken()
	r.k.Banner(r.k.Now(), Amber, "NO TRACK ARMED")
	r.k.Text(TopX, TopY, 2, Text, "TAPE 3")
	r.k.Text(8, 48, 1, Text, "ELSEWHERE")
	expectSent(t, "under the banner", r.sentNow(),
		text(4, TopX, TopY, BannerScale, Amber, "NO TRACK ARMED"), text(5, 8, 48, 1, Text, "ELSEWHERE"))
	r.advance(BannerFor)
	expectSent(t, "a second on", r.sentNow(), text(6, TopX, TopY, 2, Text, "TAPE 3"))
}

// With no top line, the banner goes with a TEXT of no text: removed.
func TestABannerOverNoTopLineIsRemoved(t *testing.T) {
	r := newRig(t)
	r.present()
	r.k.Clear(Black)
	r.k.Feed(ack(2, statusOK))
	r.take()
	r.k.Banner(r.k.Now(), Accent, "KEPT 30 S")
	expectSent(t, "the press", r.sentNow(), text(3, TopX, TopY, BannerScale, Accent, "KEPT 30 S"))
	r.advance(BannerFor)
	expectSent(t, "its end", r.sentNow(), text(4, TopX, TopY, BannerScale, Text, ""))
}

// HOME is the player's: a banner showing then is never put back, and none
// is drawn on the keyboard's own screen, nor one whose second is over.
func TestNoBannerFightsHome(t *testing.T) {
	r := newRig(t)
	r.taken()
	r.k.Banner(r.k.Now(), Green, "PLAY")
	expectSent(t, "the press", r.sentNow(), text(4, TopX, TopY, BannerScale, Green, "PLAY"))
	r.k.Feed(frame(0, cmdRelease)) // HOME
	r.advance(BannerFor)
	expectSent(t, "after HOME", r.sentNow())
	if r.k.Banner(r.k.Now(), Text, "STOP") {
		t.Fatal("a banner was drawn on the keyboard's own screen")
	}
	r.advance(BannerFor)
	expectSent(t, "a press after HOME", r.sentNow())

	r = newRig(t)
	r.taken()
	late := r.k.Now()
	r.clock = r.clock.Add(BannerFor)
	if r.k.Banner(late, Green, "PLAY") {
		t.Fatal("a banner whose second was over was drawn")
	}
	expectSent(t, "a late banner", r.sentNow())
}
