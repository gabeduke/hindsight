package api

import (
	"bytes"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/gabeduke/hindsight/internal/audio"
	"github.com/gabeduke/hindsight/internal/surface"
	"github.com/gabeduke/hindsight/internal/tape"
)

// fakeClock is the keyboard's clock, moved by hand.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

// cannedVerbs answers each verb as the test says.
type cannedVerbs func(id, rt string) (verbDone, error)

func (c cannedVerbs) Verb(id, rt string) (verbDone, error) { return c(id, rt) }

// bannerRig is a keyboard whose screen Hindsight has taken, on a fake
// clock and ticked by hand (no Start), with what it has been sent so far
// forgotten. Its verbs are the test's, or the Pi's own, behind a barrier.
type bannerRig struct {
	t     *testing.T
	a     *API
	kb    *surface.Keyboard
	fw    *firmware
	clock *fakeClock
	pads  *fakeTricks
	verbs *barrierVerbs
}

// barrierVerbs runs the verbs the test sets, and answers a barrier: a verb
// with rt "barrier", which runs after everything queued before it on its
// queue has run and said what it did.
type barrierVerbs struct {
	inner verbs
	ran   chan struct{}
}

func (b *barrierVerbs) Verb(id, rt string) (verbDone, error) {
	if rt == "barrier" {
		b.ran <- struct{}{}
		return verbDone{}, nil
	}
	return b.inner.Verb(id, rt)
}

func newBannerRig(t *testing.T) *bannerRig {
	t.Helper()
	f, _, a, _ := controlsAPI(t, t.TempDir())
	fw := &firmware{acks: make(chan []byte, 16)}
	kb := surface.New(fw.send, func() bool { return true })
	clock := &fakeClock{t: time.Unix(1000, 0)}
	kb.Clock = clock.now
	a.SetKeyboard(kb)
	r := &bannerRig{t: t, a: a, kb: kb, fw: fw, clock: clock, pads: f,
		verbs: &barrierVerbs{inner: piVerbs{a}, ran: make(chan struct{})}}
	a.controls.verbs = r.verbs
	kb.Tick() // HELLO; its answer takes the screen, on its own goroutine
	deadline := time.After(3 * time.Second)
	for !kb.Status().Screen || len(fw.sent()) < 6 {
		select {
		case ack := <-fw.acks:
			a.ControlSysEx("SMK-37", ack)
		case <-deadline:
			t.Fatalf("the screen was never taken: %+v", kb.Status())
		}
	}
	r.pump()
	r.take()
	return r
}

// pump acks what the keyboard has been sent, and what that lets go, until
// nothing waits.
func (r *bannerRig) pump() {
	for {
		select {
		case ack := <-r.fw.acks:
			r.a.ControlSysEx("SMK-37", ack)
		default:
			return
		}
	}
}

// settle waits for the verbs queued so far to have run and said what they
// did: a barrier down the quick queue and, unless a test holds it, the slow.
func (r *bannerRig) settle(slow bool) {
	r.t.Helper()
	ids := []string{"transport"}
	if slow {
		ids = append(ids, "grab")
	}
	for _, id := range ids {
		r.a.queueVerb("barrier", id, "barrier")
		select {
		case <-r.verbs.ran:
		case <-time.After(3 * time.Second):
			r.t.Fatalf("the %s queue never reached its barrier", id)
		}
	}
}

// take is the frames sent since the last take.
func (r *bannerRig) take() [][]byte {
	r.fw.mu.Lock()
	defer r.fw.mu.Unlock()
	out := r.fw.frames
	r.fw.frames = nil
	return out
}

// expect is what the keyboard has been sent once every press so far has
// answered, each frame's command and payload (the seq is the client's).
func (r *bannerRig) expect(step string, want ...[]byte) { r.expectAfter(true, step, want...) }

func (r *bannerRig) expectAfter(slow bool, step string, want ...[]byte) {
	r.t.Helper()
	r.settle(slow)
	r.pump()
	got := r.take()
	if len(got) != len(want) {
		r.t.Fatalf("%s: sent % x, want % x", step, got, want)
	}
	for i := range want {
		if body := got[i][6 : len(got[i])-1]; !bytes.Equal(body, want[i]) {
			r.t.Fatalf("%s: message %d = % x, want % x", step, i, body, want[i])
		}
	}
}

// expire moves the keyboard's clock on by d, and ticks it once.
func (r *bannerRig) expire(d time.Duration) {
	r.clock.add(d)
	r.kb.Tick()
}

// topText is a TEXT at the top line's place: the banner's, or the line
// it covers.
func topText(scale int, c surface.Colour, s string) []byte {
	return append([]byte{0x02, surface.TopX, 0, surface.TopY, 0, byte(scale), byte(c)}, s...)
}

var hindsightLine = topText(3, surface.Accent, "HINDSIGHT")

const (
	playOn  = 0x9F // a button: note on channel 16
	padOn   = 0x99 // a pad: note on channel 10
	playBtn = 16
	recBtn  = 17
)

// Every press on the keyboard says on its screen what it did, over the top
// line for a second from the press, in its colour; then the top line comes
// back.
func TestEachKeyboardPressBannersItsWordsForASecond(t *testing.T) {
	r := newBannerRig(t)
	playing := false
	r.verbs.inner = cannedVerbs(func(id, rt string) (verbDone, error) {
		switch id {
		case "transport":
			playing = !playing
			if playing {
				return verbDone{"play", "PLAY"}, nil
			}
			return verbDone{"stop", "STOP"}, nil
		case "keep":
			return verbDone{"kept", keptWords(keepSeconds)}, nil
		case "catch":
			return verbDone{"caught", caughtWords(7.6)}, nil
		case "grab":
			return verbDone{"grabbed", grabbedWords(grabBars, "BARS")}, nil
		case "drop":
			return verbDone{"dropped", droppedWords(2)}, nil
		}
		return verbDone{}, errors.New("not in this test")
	})
	for _, c := range []struct {
		status, note byte
		banner       []byte
	}{
		{playOn, playBtn, topText(surface.BannerScale, surface.Green, "PLAY")},
		{playOn, playBtn, topText(surface.BannerScale, surface.Text, "STOP")},
		{playOn, recBtn, topText(surface.BannerScale, surface.Accent, "KEPT 30 S")},
		{padOn, 50, topText(surface.BannerScale, surface.Text, "CAUGHT 8 S")},
		{padOn, 51, topText(surface.BannerScale, surface.Text, "GRABBED 4 BARS")},
		{padOn, 52, topText(surface.BannerScale, surface.Text, "DROPPED ON T2")},
	} {
		r.a.ControlMIDI("SMK-37", c.status, c.note, 127)
		r.a.ControlMIDI("SMK-37", c.status-0x10, c.note, 0)
		r.expect("the press", c.banner)
		r.expire(surface.BannerFor - time.Millisecond)
		r.expect("just under a second on")
		r.expire(time.Millisecond)
		r.expect("a second on", hindsightLine)
	}
}

// A press refused says why, in amber: the Pi's own verbs, with no tape
// and nothing to keep from, and a pad Play mode turns down.
func TestARefusedPressBannersWhyInAmber(t *testing.T) {
	r := newBannerRig(t)
	r.pads.refuse = map[string]error{"track1": tape.ErrMixingDown}
	for _, c := range []struct {
		status, note byte
		banner       []byte
	}{
		{playOn, recBtn, topText(surface.BannerScale, surface.Amber, "NOTHING TO KEEP")},
		{playOn, playBtn, topText(surface.BannerScale, surface.Amber, "NO TAPE LOADED")},
		{padOn, 50, topText(surface.BannerScale, surface.Amber, "NO TAPE LOADED")}, // CATCH
		{padOn, 36, topText(surface.BannerScale, surface.Amber, "MIXDOWN PLAYING")},
	} {
		r.a.ControlMIDI("SMK-37", c.status, c.note, 127)
		r.a.ControlMIDI("SMK-37", c.status-0x10, c.note, 0)
		r.expect("the press", c.banner)
		r.expire(surface.BannerFor)
		r.expect("a second on", hindsightLine)
	}
}

// A new press replaces the banner showing, and its second starts again.
func TestANewKeyboardPressReplacesTheBanner(t *testing.T) {
	r := newBannerRig(t)
	r.a.ControlMIDI("SMK-37", playOn, playBtn, 127)
	r.expect("PLAY", topText(surface.BannerScale, surface.Amber, "NO TAPE LOADED"))
	r.expire(500 * time.Millisecond)
	r.a.ControlMIDI("SMK-37", playOn, recBtn, 127)
	r.expect("REC", topText(surface.BannerScale, surface.Amber, "NOTHING TO KEEP"))
	r.expire(500 * time.Millisecond)
	r.expect("PLAY's second")
	r.expire(500 * time.Millisecond)
	r.expect("REC's", hindsightLine)
}

// Only the keyboard's own presses say anything on it, a pad played says
// nothing (the design lights its cell), and nothing after HOME: neither a
// banner then showing put back, nor a new one.
func TestNoBannerForAnotherControllerOrAfterHome(t *testing.T) {
	r := newBannerRig(t)
	r.a.ControlMIDI("Keystation 49", 0xFA, 0, 0) // Start
	r.a.ControlMIDI("Keystation 49", 0x90, 53, 100)
	r.expect("another controller's presses")
	r.a.ControlMIDI("SMK-37", padOn, 36, 100)
	r.a.ControlMIDI("SMK-37", padOn-0x10, 36, 0)
	r.expect("a pad played")

	r.a.ControlMIDI("SMK-37", playOn, playBtn, 127)
	r.expect("PLAY", topText(surface.BannerScale, surface.Amber, "NO TAPE LOADED"))
	r.a.ControlSysEx("SMK-37", keyboardHome)
	r.expire(surface.BannerFor)
	r.expect("a second after HOME")
	r.a.ControlMIDI("SMK-37", playOn, playBtn, 127)
	r.expect("a press after HOME")
	r.expire(surface.BannerFor)
	r.expect("its second")
}

// A command dropped because the verbs before it haven't finished says so.
func TestAFullVerbQueueBannersStillBusy(t *testing.T) {
	r := newBannerRig(t)
	held := &slowGrab{gate: make(chan struct{}), entered: make(chan struct{}, 1)}
	t.Cleanup(func() { close(held.gate) })
	r.verbs.inner = held
	r.a.ControlMIDI("SMK-37", padOn, 51, 100) // GRAB, waiting for its bar
	<-held.entered
	for i := 0; i < cap(r.a.controls.slowQ); i++ {
		r.a.ControlMIDI("SMK-37", padOn, 52, 100) // DROPs waiting behind it
	}
	r.expectAfter(false, "a full queue")
	r.a.ControlMIDI("SMK-37", padOn, 52, 100) // one too many
	r.expectAfter(false, "one too many", topText(surface.BannerScale, surface.Amber, "STILL BUSY"))
}

// The words the Pi's verbs say fit the banner at their longest.
func TestTheVerbsWordsFitTheBanner(t *testing.T) {
	fit := (surface.Width - surface.TopX) / (6 * surface.BannerScale)
	for _, w := range []string{
		keptWords(keepSeconds), caughtWords(1e12), grabbedWords(grabBars, "BARS"),
		grabbedWords(2*grabBars, "S"), droppedWords(99),
	} {
		if len(w) > fit {
			t.Errorf("%q runs off the banner's %d characters", w, fit)
		}
	}
	for _, id := range []string{"catch", "grab", "drop"} {
		if c := did(id, "X").colour; c != surface.Text {
			t.Errorf("%s's banner is colour %d, want the text colour", id, c)
		}
	}
}

// The banner's words for each refusal the verbs know, in 19 characters.
func TestEveryRefusalFitsTheBanner(t *testing.T) {
	for _, c := range refusals {
		if len(c.words) > (surface.Width-surface.TopX)/(6*surface.BannerScale) {
			t.Errorf("%q runs off the banner", c.words)
		}
	}
	for err, want := range map[error]string{
		errNotArmed:                     "NO TRACK ARMED",
		audio.ErrNoAudio:                "NOTHING TO KEEP",
		tape.ErrNeedsJamRoom:            "PLAYING ON A PHONE",
		errors.New("something new"):     "GRAB REFUSED",
		errors.Join(errNoRoom, errBusy): "NO ROOM ON TRACK",
		tape.ErrEmptyClipboard:          "BUFFER IS EMPTY",
	} {
		if got := refused("grab", err); got.words != want || got.colour != surface.Amber {
			t.Errorf("refused(grab, %v) = %+v, want %q in amber", err, got, want)
		}
	}
	if _, err := (piVerbs{&API{}}).Verb("keep", ""); !errors.Is(err, errNothingToKeep) {
		t.Fatalf("KEEP with nothing to keep from: %v", err)
	}
}
